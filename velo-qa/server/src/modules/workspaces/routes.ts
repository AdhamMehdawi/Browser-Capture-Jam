import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  acceptInviteSchema,
  createInviteSchema,
  createWorkspaceSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from './schemas.js';
import * as ws from './service.js';

const idParams = z.object({ id: z.string().min(1) });
const memberParams = z.object({ id: z.string().min(1), userId: z.string().min(1) });
const inviteParams = z.object({ id: z.string().min(1), inviteId: z.string().min(1) });

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    const { userId } = await app.requireAuth(req);
    const list = await ws.listWorkspaces(userId);
    return { workspaces: list };
  });

  app.post('/', async (req) => {
    const { userId } = await app.requireAuth(req);
    const input = createWorkspaceSchema.parse(req.body);
    const created = await ws.createWorkspace(userId, input);
    return { workspace: created };
  });

  app.get('/:id', async (req) => {
    const { userId } = await app.requireAuth(req);
    const { id } = idParams.parse(req.params);
    const workspace = await ws.getWorkspace(userId, id);
    return { workspace };
  });

  app.patch('/:id', async (req) => {
    const { userId } = await app.requireAuth(req);
    const { id } = idParams.parse(req.params);
    const patch = updateWorkspaceSchema.parse(req.body);
    const updated = await ws.updateWorkspace(userId, id, patch);
    return { workspace: updated };
  });

  app.delete('/:id', async (req, reply) => {
    const { userId } = await app.requireAuth(req);
    const { id } = idParams.parse(req.params);
    await ws.deleteWorkspace(userId, id);
    return reply.status(204).send();
  });

  // Members
  app.patch('/:id/members/:userId', async (req) => {
    const { userId } = await app.requireAuth(req);
    const params = memberParams.parse(req.params);
    const { role } = updateMemberSchema.parse(req.body);
    const updated = await ws.updateMemberRole(userId, params.id, params.userId, role);
    return { membership: updated };
  });

  app.delete('/:id/members/:userId', async (req, reply) => {
    const { userId } = await app.requireAuth(req);
    const params = memberParams.parse(req.params);
    await ws.removeMember(userId, params.id, params.userId);
    return reply.status(204).send();
  });

  // Invites
  app.get('/:id/invites', async (req) => {
    const { userId } = await app.requireAuth(req);
    const { id } = idParams.parse(req.params);
    const invites = await ws.listInvites(userId, id);
    return { invites };
  });

  app.post('/:id/invites', async (req) => {
    const { userId } = await app.requireAuth(req);
    const { id } = idParams.parse(req.params);
    const input = createInviteSchema.parse(req.body);
    const result = await ws.createInvite(userId, id, input);
    return result;
  });

  app.delete('/:id/invites/:inviteId', async (req, reply) => {
    const { userId } = await app.requireAuth(req);
    const params = inviteParams.parse(req.params);
    await ws.revokeInvite(userId, params.id, params.inviteId);
    return reply.status(204).send();
  });

  app.post('/invites/accept', async (req) => {
    const { userId } = await app.requireAuth(req);
    const { token } = acceptInviteSchema.parse(req.body);
    return ws.acceptInvite(userId, token);
  });
};
