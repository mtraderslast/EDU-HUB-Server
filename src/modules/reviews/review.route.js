import express from "express";
import { createReview, deleteReview, getCourseReviews, getHomePageReviews } from "./review.controller.js";
import { verifyToken } from "../../middleware/authMiddleware.js";
import protectRoute from "../../middleware/protectRoute.js";
import { ROLES } from "../../utils/roles.js";



const router = express.Router();

router.get("/home-page-review", getHomePageReviews);
router.get("/course/:id", getCourseReviews);
router.post("/create-review", verifyToken, protectRoute(ROLES.USER), createReview);
router.delete("/delete-course/:id", verifyToken, protectRoute(ROLES.USER), deleteReview)

export default router;