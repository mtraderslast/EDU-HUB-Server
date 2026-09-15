import express from "express";
import { confirmPayment, createPendingOrder, deleteEnrollment, getAllEnrollmentsForAdmin, getMyEnrolledCourses } from "./enrollment.controller.js";
import { verifyToken } from "../../middleware/authMiddleware.js";
import protectRoute from "../../middleware/protectRoute.js";
import { ROLES } from "../../utils/roles.js";


const router = express.Router();

router.post('/create-pending', createPendingOrder);
router.post('/confirm-antom-payment', confirmPayment);
router.get('/user-enrollment', getAllEnrollmentsForAdmin)
router.get('/my-courses', verifyToken, getMyEnrolledCourses);
router.delete("/:id", verifyToken, protectRoute(ROLES.ADMIN), deleteEnrollment);


export default router;