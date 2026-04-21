import type { Role } from '@prisma/client';
import { prisma } from '../../db.js';
import { loadEnv } from '../../env.js';
import { generateOpaqueToken, hashToken } from '../../lib/tokens.js';
import { randomSuffix, slugify } from '../../lib/slug.js';
import { createMailer } from '../../lib/mailer.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../errors.js';

const INVITE_TTL_DAYS = 7;

const ROLE_RANK: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function canAssignRole(actor: Role, target: Role): boolean {
  // Actors can only assign roles strictly below their own. Only an OWNER can
  // create another OWNER (handled via explicit transfer, not this path).
  if (target === 'OWNER') return false;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

async function requireMembership(workspaceId: string, userId: string, min: Role): Promise<Role> {
  const m = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!m) throw NotFound('workspace_not_found', 'Workspace not found');
  if (ROLE_RANK[m.role] < ROLE_RANK[min]) throw Forbidden('insufficient_role', 'Insufficient role');
  return m.role;
}

async function allocateSlug(preferred: string | undefined, fallbackSeed: string): Promise<string> {
  const base = preferred || slugify(fallbackSeed) || 'workspace';
  for (let i = 0; i < 6; i++) {
    const slug = i === 0 ? base : `${base}-${randomSuffix(4)}`;
    const exists = await prisma.workspace.findUnique({ where: { slug } });
    if (!exists) return slug;
    if (preferred && i === 0) throw Conflict('slug_taken', 'Workspace slug is already taken');
  }
  throw new Error('could_not_allocate_workspace_slug');
}

export async function createWorkspace(
  userId: string,
  input: { name: string; slug?: string | undefined },
) {
  const slug = await allocateSlug(input.slug, input.name);
  return prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({ data: { slug, name: input.name } });
    await tx.membership.create({ data: { userId, workspaceId: ws.id, role: 'OWNER' } });
    return ws;
  });
}

export async function listWorkspaces(userId: string) {
  return prisma.workspace.findMany({
    where: { memberships: { some: { userId } } },
    select: {
      id: true,
      slug: true,
      name: true,
      createdAt: true,
      memberships: {
        where: { userId },
        select: { role: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getWorkspace(userId: string, workspaceId: string) {
  await requireMembership(workspaceId, userId, 'VIEWER');
  return prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      memberships: {
        include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      },
    },
  });
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  patch: { name?: string },
) {
  await requireMembership(workspaceId, userId, 'ADMIN');
  return prisma.workspace.update({ where: { id: workspaceId }, data: patch });
}

export async function deleteWorkspace(userId: string, workspaceId: string) {
  await requireMembership(workspaceId, userId, 'OWNER');
  await prisma.workspace.delete({ where: { id: workspaceId } });
}

export async function updateMemberRole(
  userId: string,
  workspaceId: string,
  targetUserId: string,
  role: Role,
) {
  const actorRole = await requireMembership(workspaceId, userId, 'ADMIN');
  if (!canAssignRole(actorRole, role)) {
    throw Forbidden('cannot_assign_role', 'You cannot assign this role');
  }
  const target = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
  });
  if (!target) throw NotFound('member_not_found', 'Member not found');
  if (target.role === 'OWNER') {
    throw Forbidden('cannot_modify_owner', 'Owners must transfer ownership explicitly');
  }
  return prisma.membership.update({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    data: { role },
  });
}

export async function removeMember(userId: string, workspaceId: string, targetUserId: string) {
  const actorRole = await requireMembership(workspaceId, userId, 'ADMIN');
  if (userId === targetUserId) {
    throw BadRequest('leave_instead', 'Use leave to remove yourself');
  }
  const target = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
  });
  if (!target) throw NotFound('member_not_found', 'Member not found');
  if (target.role === 'OWNER') throw Forbidden('cannot_remove_owner', 'Cannot remove the owner');
  if (ROLE_RANK[actorRole] <= ROLE_RANK[target.role]) {
    throw Forbidden('insufficient_role', 'Insufficient role to remove this member');
  }
  await prisma.membership.delete({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
  });
}

export async function createInvite(
  userId: string,
  workspaceId: string,
  input: { email: string; role: Role },
) {
  const actorRole = await requireMembership(workspaceId, userId, 'ADMIN');
  if (!canAssignRole(actorRole, input.role)) {
    throw Forbidden('cannot_assign_role', 'You cannot invite someone at this role');
  }

  // Short-circuit if the email already belongs to a member.
  const existingMember = await prisma.membership.findFirst({
    where: { workspaceId, user: { email: input.email } },
  });
  if (existingMember) throw Conflict('already_member', 'This email is already a member');

  const { raw, hash } = generateOpaqueToken(32);
  const env = loadEnv();
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw NotFound('workspace_not_found', 'Workspace not found');

  const invite = await prisma.invite.create({
    data: {
      workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: hash,
      invitedById: userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  const url = `${env.WEB_ORIGIN}/invite?token=${raw}`;
  await createMailer().send({
    to: input.email,
    subject: `You're invited to ${workspace.name} on Velo QA`,
    text: `You've been invited to join the ${workspace.name} workspace.\n\nAccept: ${url}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
  });

  return { inviteId: invite.id };
}

export async function acceptInvite(userId: string, rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  if (!invite) throw BadRequest('invalid_invite', 'Invite is invalid');
  if (invite.status !== 'PENDING') throw BadRequest('invite_unavailable', 'Invite is no longer available');
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.invite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    throw BadRequest('invite_expired', 'Invite has expired');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw BadRequest('invalid_user', 'Invalid user');
  if (user.email !== invite.email) {
    throw Forbidden('email_mismatch', 'Invite was sent to a different email');
  }

  return prisma.$transaction(async (tx) => {
    const already = await tx.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
    });
    if (!already) {
      await tx.membership.create({
        data: { userId, workspaceId: invite.workspaceId, role: invite.role },
      });
    }
    await tx.invite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    return { workspaceId: invite.workspaceId };
  });
}

export async function listInvites(userId: string, workspaceId: string) {
  await requireMembership(workspaceId, userId, 'ADMIN');
  return prisma.invite.findMany({
    where: { workspaceId, status: 'PENDING' },
    select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeInvite(userId: string, workspaceId: string, inviteId: string) {
  await requireMembership(workspaceId, userId, 'ADMIN');
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.workspaceId !== workspaceId) throw NotFound('invite_not_found', 'Invite not found');
  if (invite.status !== 'PENDING') return;
  await prisma.invite.update({ where: { id: inviteId }, data: { status: 'REVOKED' } });
}
