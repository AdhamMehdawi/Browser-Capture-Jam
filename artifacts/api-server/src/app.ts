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

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/api/healthz",
  "/api/share/",
  "/api/storage/",
];

// Skip Clerk middleware when in mock auth mode
if (!MOCK_AUTH) {
  // Use Clerk middleware but skip for public routes
  app.use((req, res, next) => {
    // Skip Clerk for public routes
    const isPublicRoute = PUBLIC_ROUTES.some(route => req.path.startsWith(route));
    if (isPublicRoute) {
      return next();
    }

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
