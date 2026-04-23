import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const MOCK_AUTH = process.env.MOCK_AUTH === "true";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Skip Clerk proxy when in mock auth mode
if (!MOCK_AUTH) {
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Skip Clerk middleware when in mock auth mode
if (!MOCK_AUTH) {
  // Use Clerk middleware but don't let it crash on invalid tokens
  // The requireAuth middleware will handle authorization
  app.use((req, res, next) => {
    clerkMiddleware()(req, res, (err) => {
      // Ignore Clerk errors and continue - our requireAuth will handle auth
      if (err) {
        logger.warn({ err: err.message }, "Clerk middleware error (ignored)");
      }
      next();
    });
  });
} else {
  logger.info("Running in MOCK_AUTH mode - Clerk authentication disabled");
}

app.use("/api", router);

export default app;
