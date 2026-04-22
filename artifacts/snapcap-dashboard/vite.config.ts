import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// USE_CLERK_MOCK=1 swaps @clerk/react for a local stub so the UI renders
// without a real publishable key. Local dev only.
const useClerkMock = process.env.USE_CLERK_MOCK === "1";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    // USE_CLERK_MOCK=1 mode also implies "no SnapCap api-server" — we bridge
    // to the OpenJam server running on :4000 and reshape its Jam records into
    // SnapCap Recording shape so the real dashboard UI shows real captures.
    //
    // Bridge endpoints:
    //   GET /api/user/me            → static demo user
    //   GET /api/recordings         → translate OpenJam /jams list
    //   GET /api/recordings/stats   → compute stats from OpenJam list
    //   GET /api/recordings/:id     → translate OpenJam /jams/:id
    //   GET /api/storage/:assetId   → proxy OpenJam /jams/assets/:id (video blob)
    ...(useClerkMock
      ? [{
          name: "openjam:mock-api",
          configureServer(server: any) {
            const OPENJAM = process.env.OPENJAM_API_URL || "http://localhost:4000";
            const json = (res: any, body: unknown, status = 200) => {
              res.statusCode = status;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(body));
            };
            async function fetchJson<T = any>(path: string): Promise<T | null> {
              try {
                const r = await fetch(OPENJAM + path);
                if (!r.ok) return null;
                return (await r.json()) as T;
              } catch { return null; }
            }
            function jamToRecording(j: any) {
              const network = Array.isArray(j.network) ? j.network : [];
              const consoleLogs = Array.isArray(j.console) ? j.console : [];
              const actions = Array.isArray(j.actions) ? j.actions : [];
              const errorCount =
                network.filter((n: any) => n && (n.error || (n.status && n.status >= 400))).length +
                consoleLogs.filter((c: any) => c?.level === "error").length;
              const vidAsset =
                j.assets?.find?.((a: any) => a.kind === "video") ||
                j.assets?.find?.((a: any) => a.kind === "screenshot"); // screenshots shown as a single-frame "video"
              return {
                id: j.id,
                userId: j.createdBy?.id ?? "user_demo",
                title: j.title || j.pageTitle || j.pageUrl || "Untitled",
                duration: j.durationMs ?? 0,
                createdAt: j.createdAt,
                pageUrl: j.pageUrl ?? null,
                pageTitle: j.pageTitle ?? null,
                networkLogsCount: network.length,
                errorCount,
                consoleCount: consoleLogs.length,
                clickCount: actions.filter((a: any) => a?.type === "click").length,
                videoObjectPath: vidAsset ? `/objects/${vidAsset.id}` : null,
                shareToken: null,
                tags: [],
                browserInfo: j.device ?? null,
              };
            }
            function jamToRecordingWithEvents(j: any) {
              const base = jamToRecording(j);
              const networkRaw = (j.network || []).map((n: any) => ({
                id: n.id || `n-${n.startedAt}`,
                type: "request" as const,
                method: n.method,
                url: n.url,
                status: n.status,
                duration: n.durationMs,
                timestamp: n.startedAt,
                requestHeaders: n.requestHeaders,
                responseHeaders: n.responseHeaders,
                requestBody: n.requestBody,
                responseBody: n.responseBody,
                error: n.error,
              }));
              const consoleRaw = (j.console || []).map((c: any, i: number) => ({
                id: `c-${c.timestamp}-${i}`,
                type: "console" as const,
                level: c.level,
                message: c.message,
                timestamp: c.timestamp,
                stack: c.stack,
              }));
              // Flatten actions into event entries the dashboard already
              // knows how to filter. We tag them with action-specific fields
              // so the Cypress exporter can round-trip them.
              const actionsRaw = (j.actions || []).map((a: any, i: number) => ({
                id: `a-${a.timestamp}-${i}`,
                type: a.type, // "click" | "input" | "select" | "submit" | "navigation"
                message:
                  a.type === 'navigation'
                    ? `→ ${a.url || ''}`
                    : a.type === 'input'
                    ? `${a.target?.tag || 'input'}[${a.target?.name || a.target?.inputType || ''}] = ${a.value ?? ''}`
                    : a.type === 'select'
                    ? `select → ${a.value ?? ''}`
                    : `${a.target?.tag || ''}${a.target?.text ? ` "${a.target.text}"` : ''}`,
                selector: a.selector,
                selectorAlts: a.selectorAlts,
                targetTag: a.target?.tag,
                targetText: a.target?.text,
                targetRole: a.target?.role,
                inputType: a.target?.inputType,
                targetName: a.target?.name,
                value: a.value,
                url: a.url,
                timestamp: a.timestamp,
              }));
              const all = [...networkRaw, ...consoleRaw, ...actionsRaw];
              // Rebase timestamps: subtract the earliest event's timestamp so
              // event.timestamp is "ms since the first captured event" —
              // matches what the dashboard's `{event.timestamp}ms` display
              // actually implies. Recordings captured across ~8s now read
              // 0ms, 81ms, 212ms instead of raw epoch milliseconds.
              const baseTs = all.length
                ? Math.min(...all.map((e) => e.timestamp || 0))
                : 0;
              const events = all.map((e) => ({
                ...e,
                // preserve original for anyone who needs wall-clock time
                absoluteTimestamp: e.timestamp,
                timestamp: Math.max(0, (e.timestamp || 0) - baseTs),
              }));
              return { ...base, events };
            }

            server.middlewares.use(async (req: any, res: any, next: any) => {
              const url = req.url?.split("?")[0] ?? "";
              if (!url.startsWith("/api/")) return next();

              if (url === "/api/user/me") return json(res, {
                userId: "user_demo", email: "demo@example.com",
                firstName: "Demo", lastName: "User",
                totalRecordings: 0, apiKeyPreview: null,
              });

              if (url === "/api/recordings") {
                const page = await fetchJson<any>("/jams-admin/list");
                // /jams-admin/list doesn't exist — use getJams via a workaround.
                // Instead, we fall back to scraping the gallery route which
                // is public and returns all jams. But simpler: add a helper
                // endpoint-less approach by calling through OpenJam's list.
                // Our OpenJam `GET /jams?workspaceId=` requires auth, so we
                // go through the public `/` gallery JSON if available, or
                // just accept that the dashboard list is empty for now.
                // Workaround: the viewer.ts renders HTML; we don't have JSON
                // list. So we call a tiny list endpoint we added below.
                const list = await fetchJson<any>("/jams-public-list");
                const jams = list?.jams ?? [];
                return json(res, {
                  recordings: jams.map(jamToRecording),
                  total: jams.length, page: 1, limit: 100,
                });
              }

              if (url === "/api/recordings/stats") {
                const list = await fetchJson<any>("/jams-public-list");
                const jams = list?.jams ?? [];
                const totalRecordings = jams.length;
                const totalRequests = jams.reduce(
                  (a: number, j: any) => a + (j.network?.length ?? 0), 0);
                const totalErrors = jams.reduce((a: number, j: any) => {
                  const net = (j.network || []).filter(
                    (n: any) => n && (n.error || (n.status && n.status >= 400))).length;
                  const cons = (j.console || []).filter(
                    (c: any) => c?.level === "error").length;
                  return a + net + cons;
                }, 0);
                const totalDuration = jams.reduce(
                  (a: number, j: any) => a + (j.durationMs ?? 0), 0);
                const avgErrorRate = totalRequests ? (totalErrors / totalRequests) * 100 : 0;
                return json(res, {
                  totalRecordings, totalRequests, totalErrors, totalDuration,
                  avgErrorRate, requestsByDay: [], topErrorPages: [],
                });
              }

              const single = url.match(/^\/api\/recordings\/([^/]+)$/);
              if (single) {
                const j = await fetchJson<any>(`/jams-public/${single[1]}`);
                if (!j) return json(res, { error: "Not found" }, 404);
                return json(res, jamToRecordingWithEvents(j));
              }

              const storage = url.match(/^\/api\/storage\/objects\/([^/]+)$/) || url.match(/^\/api\/storage\/([^/]+)$/);
              if (storage) {
                // Stream the asset from OpenJam. We pipe the whole body
                // since Vite's middleware doesn't support streaming easily,
                // but for screenshots and short videos this is fine.
                try {
                  const r = await fetch(`${OPENJAM}/jams/assets/${storage[1]}`);
                  if (!r.ok) { res.statusCode = r.status; return res.end(); }
                  res.statusCode = 200;
                  res.setHeader("content-type", r.headers.get("content-type") || "application/octet-stream");
                  const buf = Buffer.from(await r.arrayBuffer());
                  return res.end(buf);
                } catch (e) {
                  res.statusCode = 502; return res.end();
                }
              }
              return json(res, {});
            });
          },
        }]
      : []),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      ...(useClerkMock
        ? { "@clerk/react": path.resolve(import.meta.dirname, "src/mocks/clerk.tsx") }
        : {}),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
