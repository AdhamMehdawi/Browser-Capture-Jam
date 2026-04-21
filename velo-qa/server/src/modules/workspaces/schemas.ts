import { z } from 'zod';

export const roleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
export type RoleInput = z.infer<typeof roleSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase letters, digits, and dashes only')
    .optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
});

export const createInviteSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  role: roleSchema.default('MEMBER'),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(16).max(256),
});

export const updateMemberSchema = z.object({
  role: roleSchema,
});
