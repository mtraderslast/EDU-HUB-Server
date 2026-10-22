import express from "express";
import { createCourse, deleteCourse, getAllCourses, getCourseById, getEnrolledCourseContent, updateCourse } from "./course.controller.js";
import { optionalAuth, verifyToken } from "../../middleware/authMiddleware.js";
import protectRoute from "../../middleware/protectRoute.js";
import { ROLES } from "../../utils/roles.js";


const router = express.Router();

router.get("/", getAllCourses);
router.get("/:id/learn", verifyToken, getEnrolledCourseContent);
router.get("/:id", optionalAuth, getCourseById);
router.post("/", verifyToken, protectRoute(ROLES.ADMIN), createCourse);
router.patch("/:id", verifyToken, protectRoute(ROLES.ADMIN), updateCourse);
router.delete("/:id", verifyToken, protectRoute(ROLES.ADMIN), deleteCourse);

export default router;