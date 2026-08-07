import express from "express";
import * as apiArtifactController from "../../../controllers/v1/system/apiArtifact.controller.js";

const router = express.Router();

router.get("/collection", apiArtifactController.getPostmanCollection);
router.get("/environment", apiArtifactController.getPostmanEnvironment);

export default router;
