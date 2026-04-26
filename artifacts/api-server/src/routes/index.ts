import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import recordingsRouter from "./recordings";
import userRouter from "./user";
import shareRouter from "./share";
import jamsRouter from "./jams";

const router: IRouter = Router();

// Public routes first (no auth middleware)
router.use(healthRouter);
router.use(storageRouter);
router.use(shareRouter);

// Authenticated routes
router.use(recordingsRouter);
router.use(userRouter);
router.use(jamsRouter);

export default router;
