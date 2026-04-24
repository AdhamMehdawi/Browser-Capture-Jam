import "dotenv/config";
// Instrumentation must load before `app` so App Insights can monkey-patch
// http / https / pg before any route handler or DB client is imported.
import "./lib/instrumentation";
import app from "./app";
import { logger } from "./lib/logger";

// Default to port 4000 for local development
const rawPort = process.env["PORT"] || "4000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
