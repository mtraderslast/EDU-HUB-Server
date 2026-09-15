import express from "express";
import { verifyToken } from "../../middleware/authMiddleware.js";
import protectRoute from "../../middleware/protectRoute.js";
import { ROLES } from "../../utils/roles.js";
import { createBlog, deleteBlog, getAllBlogs, getBlogDetails, updateBlog } from "./blog.controller.js";


const router = express.Router();

router.get("/", getAllBlogs);
router.get("/:id", getBlogDetails);
router.post("/", verifyToken, protectRoute(ROLES.ADMIN), createBlog);
router.patch("/:id", verifyToken, protectRoute(ROLES.ADMIN), updateBlog);
router.delete("/:id", verifyToken, protectRoute(ROLES.ADMIN), deleteBlog);

export default router;