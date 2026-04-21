import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(10).max(128),
  name: z.string().min(1).max(80).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(256),
});

export const requestVerifySchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
});
