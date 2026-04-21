import { prisma } from '../../db.js';
import { Forbidden, NotFound, BadRequest } from '../../errors.js';
import { redactNetworkEntry } from './redact.js';
import type { CreateJamInput } from './schemas.js';

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } {
  // A WebM from MediaRecorder looks like `data:video/webm;codecs=vp9,opus;base64,...`
  // — the content type itself contains a `;`, so we can't match it with a
  // naive `[^;]+`. Find the literal `;base64,` delimiter instead.
  if (!dataUrl.startsWith('data:')) {
    throw BadRequest('bad_media', 'Media must be a base64 data URL');
  }
  const marker = ';base64,';
  const idx = dataUrl.indexOf(marker);
  if (idx === -1) throw BadRequest('bad_media', 'Media must be a base64 data URL');
  const contentType = dataUrl.slice('data:'.length, idx) || 'application/octet-stream';
  const buffer = Buffer.from(dataUrl.slice(idx + marker.length), 'base64');
  if (buffer.length === 0) throw BadRequest('empty_media', 'Media payload was empty');
  return { contentType, buffer };
}

async function requireWorkspaceMembership(userId: string, workspaceId: string): Promise<void> {
  const m = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!m) throw Forbidden('not_a_member', 'Not a member of this workspace');
}

export async function createJam(userId: string, input: CreateJamInput) {
  await requireWorkspaceMembership(userId, input.workspaceId);

  const redactedNetwork = input.network.map(redactNetworkEntry);

  return prisma.$transaction(async (tx) => {
    const jam = await tx.jam.create({
      data: {
        workspaceId: input.workspaceId,
        createdById: userId,
        type: input.type,
        title: input.title ?? null,
        pageUrl: input.page.url,
        pageTitle: input.page.title ?? null,
        referrer: input.page.referrer ?? null,
        durationMs: input.durationMs ?? null,
        device: input.device,
        console: input.console,
        network: redactedNetwork,
        actions: input.actions,
        visibility: input.visibility,
      },
    });

    if (input.media) {
      const { contentType, buffer } = parseDataUrl(input.media.dataUrl);
      await tx.jamAsset.create({
        data: {
          jamId: jam.id,
          kind: input.media.kind,
          contentType,
          bytes: buffer.length,
          data: buffer,
        },
      });
    }

    return jam;
  });
}

export async function getJamForViewer(jamId: string, viewerUserId: string | null) {
  const jam = await prisma.jam.findUnique({
    where: { id: jamId },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, slug: true, name: true } },
      assets: {
        select: { id: true, kind: true, contentType: true, bytes: true, createdAt: true },
      },
    },
  });
  if (!jam) throw NotFound('jam_not_found', 'Jam not found');

  if (jam.visibility === 'WORKSPACE') {
    if (!viewerUserId) throw Forbidden('login_required', 'This Jam is workspace-only');
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: viewerUserId, workspaceId: jam.workspaceId } },
    });
    if (!membership) throw Forbidden('not_a_member', 'Not a member of this workspace');
  }

  return jam;
}

export async function getJamAsset(assetId: string, viewerUserId: string | null) {
  const asset = await prisma.jamAsset.findUnique({
    where: { id: assetId },
    include: { jam: { select: { visibility: true, workspaceId: true } } },
  });
  if (!asset) throw NotFound('asset_not_found', 'Asset not found');
  if (asset.jam.visibility === 'WORKSPACE') {
    if (!viewerUserId) throw Forbidden('login_required', 'This Jam is workspace-only');
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: viewerUserId, workspaceId: asset.jam.workspaceId } },
    });
    if (!membership) throw Forbidden('not_a_member', 'Not a member of this workspace');
  }
  return asset;
}

/**
 * Gallery — all PUBLIC Jams across all workspaces, newest first.
 * Used by the unauthenticated index page at `/`. Includes the first
 * screenshot/thumbnail asset id per Jam so the gallery can render tiles.
 */
export async function listPublicJams(limit = 100) {
  const jams = await prisma.jam.findMany({
    where: { visibility: 'PUBLIC' },
    select: {
      id: true,
      type: true,
      title: true,
      pageUrl: true,
      pageTitle: true,
      durationMs: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
      workspace: { select: { name: true } },
      assets: {
        select: { id: true, kind: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return jams.map((j) => {
    // Prefer an explicit thumbnail, then a screenshot, then nothing.
    const thumb =
      j.assets.find((a) => a.kind === 'thumbnail') ??
      j.assets.find((a) => a.kind === 'screenshot');
    const { assets: _omit, ...rest } = j;
    return { ...rest, _thumbnailAssetId: thumb?.id ?? null };
  });
}

export async function listJams(userId: string, workspaceId: string) {
  await requireWorkspaceMembership(userId, workspaceId);
  return prisma.jam.findMany({
    where: { workspaceId },
    select: {
      id: true,
      type: true,
      title: true,
      pageUrl: true,
      pageTitle: true,
      visibility: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { assets: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
