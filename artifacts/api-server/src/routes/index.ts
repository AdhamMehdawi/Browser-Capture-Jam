import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import recordingsRouter from "./recordings";
import userRouter from "./user";
import shareRouter from "./share";
import jamsRouter from "./jams";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(recordingsRouter);
router.use(userRouter);
router.use(shareRouter);
router.use(jamsRouter);

export default router;
