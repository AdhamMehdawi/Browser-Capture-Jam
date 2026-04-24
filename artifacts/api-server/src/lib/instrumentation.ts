// App Insights auto-instrumentation. Must load before `./app` so it can
// monkey-patch http / https / pg before the app imports them.
//
// Reads the connection string from APPLICATIONINSIGHTS_CONNECTION_STRING
// (wired via Terraform secret ref).

import { createRequire } from "node:module";

// Use createRequire rather than ESM `import * as` — applicationinsights v2.x
// is CJS and the ESM interop in Node 24 returns a namespace that doesn't
// expose `defaultClient` / side-effectful `.start()` cleanly.
const localRequire = createRequire(import.meta.url);

if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  try {
    const appInsights = localRequire("applicationinsights");
    appInsights
      .setup()
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true, true)
      .setSendLiveMetrics(false)
      .start();
    console.log("[ai] Application Insights initialized");
  } catch (err) {
    // Never let instrumentation block server startup.
    console.error("[ai] Failed to initialize; continuing without telemetry:", err);
  }
} else {
  console.log("[ai] APPLICATIONINSIGHTS_CONNECTION_STRING not set; telemetry disabled");
}
