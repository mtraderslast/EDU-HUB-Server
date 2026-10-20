import express from 'express';
import {
    getActiveGateway,
    getAdminGateways,
    initiatePayment,
    getPaymentStatus,
    handlePaymentWebhook,
    switchActiveGateway,
} from './payment.controller.js';
import { optionalAuth, verifyToken } from '../../middleware/authMiddleware.js';
import protectRoute from '../../middleware/protectRoute.js';
import { ROLES } from '../../utils/roles.js';

const router = express.Router();

router.get('/active-gateway', getActiveGateway);
router.post('/initiate', optionalAuth, initiatePayment);
router.get('/status/:orderId', getPaymentStatus);

router.post('/webhook/:gateway', handlePaymentWebhook);
router.get('/webhook/:gateway', handlePaymentWebhook);

router.get('/admin/gateways', verifyToken, protectRoute(ROLES.ADMIN), getAdminGateways);
router.patch('/admin/switch-gateway', verifyToken, protectRoute(ROLES.ADMIN), switchActiveGateway);

export default router;
