import { z } from 'zod';

export const jamTypeSchema = z.enum(['SCREENSHOT', 'VIDEO']);
export const visibilitySchema = z.enum(['PUBLIC', 'WORKSPACE']);

export const consoleEntrySchema = z.object({
  level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
  message: z.string().max(8_000),
  args: z.array(z.string().max(2_000)).max(20).optional(),
  stack: z.string().max(8_000).optional(),
  timestamp: z.number().int().nonnegative(),
  source: z.enum(['console', 'error', 'unhandledrejection']).optional(),
});
export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

export const networkEntrySchema = z.object({
  id: z.string().max(64),
  method: z.string().max(10),
  url: z.string().max(4_000),
  status: z.number().int().nullable().optional(),
  statusText: z.string().max(200).optional(),
  initiator: z.string().max(200).optional(),
  type: z.enum(['fetch', 'xhr']).optional(),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  requestBody: z.string().max(100_000).optional(),
  responseBody: z.string().max(100_000).optional(),
  startedAt: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().max(500).optional(),
});
export type NetworkEntry = z.infer<typeof networkEntrySchema>;

export const deviceSchema = z.object({
  userAgent: z.string().max(500),
  platform: z.string().max(80).optional(),
  language: z.string().max(40).optional(),
  languages: z.array(z.string().max(40)).max(10).optional(),
  timezone: z.string().max(80).optional(),
  screen: z
    .object({
      width: z.number(),
      height: z.number(),
      dpr: z.number(),
      colorDepth: z.number().optional(),
    })
    .optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  colorScheme: z.enum(['light', 'dark']).optional(),
});
export type DeviceInfo = z.infer<typeof deviceSchema>;

// `.nullish()` == optional OR explicitly null. Extension code coerces absent
// values to `null` in places, so we accept both shapes and normalize in the
// service. Keeps clients simple.
export const actionEntrySchema = z.object({
  type: z.enum(['click', 'input', 'select', 'submit', 'navigation']),
  selector: z.string().max(500),
  selectorAlts: z.array(z.string().max(500)).max(5).optional(),
  target: z.object({
    tag: z.string().max(40),
    text: z.string().max(200).optional(),
    role: z.string().max(40).optional(),
    inputType: z.string().max(40).optional(),
    name: z.string().max(100).optional(),
  }),
  value: z.string().max(500).optional(),
  url: z.string().max(4_000).optional(),
  timestamp: z.number().int().nonnegative(),
});
export type ActionEntry = z.infer<typeof actionEntrySchema>;

export const createJamSchema = z.object({
  workspaceId: z.string().min(1),
  type: jamTypeSchema,
  title: z.string().max(200).nullish(),
  page: z.object({
    url: z.string().max(4_000),
    title: z.string().max(400).nullish(),
    referrer: z.string().max(4_000).nullish(),
  }),
  device: deviceSchema,
  console: z.array(consoleEntrySchema).max(2_000).default([]),
  network: z.array(networkEntrySchema).max(1_000).default([]),
  actions: z.array(actionEntrySchema).max(1_000).default([]),
  durationMs: z.number().int().nonnegative().nullish(),
  visibility: visibilitySchema.default('PUBLIC'),
  // Media is a data URL ("data:image/png;base64,...") capped below at 15 MB.
  media: z
    .object({
      kind: z.enum(['screenshot', 'video']),
      dataUrl: z.string().min(32).max(110_000_000),
    })
    .nullish(),
});
export type CreateJamInput = z.infer<typeof createJamSchema>;
