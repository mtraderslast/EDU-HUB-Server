import express from "express";
import {
    confirmAntomPaymentLegacy,
    confirmPayment,
    createPendingOrder,
    deleteEnrollment,
    getAllEnrollmentsForAdmin,
} from "./enrollment.controller.js";
import { getMyCourses } from "../course/course.controller.js";
import { verifyToken } from "../../middleware/authMiddleware.js";
import protectRoute from "../../middleware/protectRoute.js";
import { ROLES } from "../../utils/roles.js";

const router = express.Router();

router.post('/create-pending', createPendingOrder);
router.post('/confirm-antom-payment', confirmAntomPaymentLegacy);

router.get('/user-enrollment', verifyToken, protectRoute(ROLES.ADMIN), getAllEnrollmentsForAdmin);
router.get('/my-courses', verifyToken, getMyCourses);
router.post('/verify/:orderId', verifyToken, protectRoute(ROLES.ADMIN), confirmPayment);
router.delete("/:id", verifyToken, protectRoute(ROLES.ADMIN), deleteEnrollment);

export default router;
