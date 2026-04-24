import * as appInsights from "applicationinsights";

// Must run before the app imports anything that makes HTTP or DB calls so
// the SDK can monkey-patch http / https / pg / redis / mongodb / etc.
// Picks up the connection string from env var APPLICATIONINSIGHTS_CONNECTION_STRING
// (wired via Terraform secret ref).
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights
    .setup()
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, true)
    .setSendLiveMetrics(false) // cheaper; flip to true when debugging
    .start();

  // Tag every telemetry item with the cloud-role so dev/prod are separable
  // in the App Insights UI.
  appInsights.defaultClient.context.tags[
    appInsights.defaultClient.context.keys.cloudRole
  ] = `velocap-api-${process.env.NODE_ENV ?? "unknown"}`;

  console.log("[ai] Application Insights initialized");
} else {
  console.log("[ai] APPLICATIONINSIGHTS_CONNECTION_STRING not set; telemetry disabled");
}
