import express from "express";
import { verifyToken } from "../../middleware/authMiddleware.js";
import { contactEmail } from "./contact.controller.js";

const router = express.Router();

router.post('/', contactEmail)

export default router;