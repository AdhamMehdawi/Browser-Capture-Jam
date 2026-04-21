import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '../../env.js';
import { prisma } from '../../db.js';
import { createJamSchema } from './schemas.js';
import * as svc from './service.js';
import { renderJamGallery, renderJamHtml } from './viewer.js';

const idParams = z.object({ id: z.string().min(1) });
const listQuery = z.object({ workspaceId: z.string().min(1) });

export const jamRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/',
    { bodyLimit: 120 * 1024 * 1024 },
    async (req) => {
      const { userId } = await app.requireAuth(req);
      const input = createJamSchema.parse(req.body);
      const jam = await svc.createJam(userId, input);
      const env = loadEnv();
      return {
        id: jam.id,
        url: `${env.PUBLIC_API_URL}/j/${jam.id}`,
      };
    },
  );

  app.get('/', async (req) => {
    const { userId } = await app.requireAuth(req);
    const { workspaceId } = listQuery.parse(req.query);
    const jams = await svc.listJams(userId, workspaceId);
    return { jams };
  });

  app.get('/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const viewer = req.userId ?? null;
    const jam = await svc.getJamForViewer(id, viewer);
    return { jam };
  });

  app.get('/assets/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const viewer = req.userId ?? null;
    const asset = await svc.getJamAsset(id, viewer);
    reply
      .header('content-type', asset.contentType)
      .header('cache-control', 'private, max-age=60')
      .send(asset.data);
  });
};

export const viewerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const viewer = req.userId ?? null;
    const jam = await svc.getJamForViewer(id, viewer);
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderJamHtml(jam));
  });
};

export const galleryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (_req, reply) => {
    const jams = await svc.listPublicJams(100);
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .send(renderJamGallery(jams));
  });
};

/**
 * Bridge endpoints for the SnapCap dashboard's Vite-dev proxy — return
 * full Jam data as JSON without requiring workspace auth. Only returns
 * PUBLIC jams, same rule as the gallery. Not for production use.
 */
export const publicBridgeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/jams-public-list', async () => {
    const jams = await prisma.jam.findMany({
      where: { visibility: 'PUBLIC' },
      include: {
        createdBy: { select: { id: true, email: true, name: true } },
        workspace: { select: { id: true, name: true, slug: true } },
        assets: { select: { id: true, kind: true, contentType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { jams };
  });

  app.get('/jams-public/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const jam = await prisma.jam.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, email: true, name: true } },
        workspace: { select: { id: true, name: true, slug: true } },
        assets: { select: { id: true, kind: true, contentType: true } },
      },
    });
    if (!jam || jam.visibility !== 'PUBLIC') {
      throw new Error('not_found');
    }
    return jam;
  });
};
