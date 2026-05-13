export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  args?: string[];
  stack?: string;
  timestamp: number;
  source?: 'console' | 'error' | 'unhandledrejection';
}

export interface NetworkEntry {
  id: string;
  method: string;
  url: string;
  status?: number | null;
  statusText?: string;
  initiator?: string;
  type?: 'fetch' | 'xhr';
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  startedAt: number;
  durationMs?: number;
  error?: string;
}

export interface DeviceInfo {
  userAgent: string;
  platform?: string;
  language?: string;
  languages?: string[];
  timezone?: string;
  screen?: { width: number; height: number; dpr: number; colorDepth?: number };
  viewport?: { width: number; height: number };
  colorScheme?: 'light' | 'dark';
}

export interface ActionEntry {
  // Issue 12: added mouse / wheel / key / focus / visibility events. All
  // fields beyond `type` and `timestamp` are optional so each event kind
  // populates only what's relevant.
  type:
    | 'click'
    | 'input'
    | 'select'
    | 'submit'
    | 'navigation'
    | 'mousemove'
    | 'mousedown'
    | 'mouseup'
    | 'wheel'
    | 'keydown'
    | 'focus'
    | 'blur'
    | 'visibility';
  selector?: string;
  selectorAlts?: string[];
  target?: {
    tag: string;
    text?: string;
    role?: string;
    inputType?: string;
    name?: string;
  };
  value?: string;
  url?: string;
  timestamp: number;
  // Mouse / pointer.
  x?: number;
  y?: number;
  button?: number;
  // Wheel.
  deltaX?: number;
  deltaY?: number;
  scrollTop?: number;
  // Keyboard (non-typing keys only).
  key?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  // Visibility / focus.
  state?: 'visible' | 'hidden' | 'focus' | 'blur';
}

export interface CapturePayload {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  actions: ActionEntry[];
  device: DeviceInfo;
  page: { url: string; title: string; referrer?: string };
}

export interface AuthState {
  accessToken: string;
  user: { id: string; email: string; name: string | null };
  workspaces: Array<{ id: string; slug: string; name: string; role: string }>;
  activeWorkspaceId: string;
}

export type BgMessage =
  | { kind: 'ping' }
  | { kind: 'capture-screenshot'; workspaceId: string }
  | { kind: 'collect-context'; tabId: number }
  | { kind: 'context-response'; payload: CapturePayload };

export type ContentMessage =
  | { kind: 'capture-context' }
  | { kind: 'context-response'; payload: CapturePayload };

export const MSG = {
  capture: 'capture-context',
  contextResponse: 'context-response',
} as const;
