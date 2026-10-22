import crypto from 'crypto';
import mongoose from 'mongoose';
import Enrollment from '../enrollment/enrollment.model.js';
import Course from '../course/course.model.js';
import catchAsync from '../../utils/catchAsync.js';
import AppError from '../../utils/AppError.js';
import { DEFAULT_CURRENCY, getClientIp, getMaxPaymentAmount, toMajorAmount } from '../payment-services/config.js';
import { FREE_GATEWAY, PAYMENT_STATUS } from '../payment-services/constants.js';
import {
    describeGateways,
    getOrCreateGatewayConfig,
    resolveActiveGateway,
    createGatewaySession,
    setActiveGateway,
    syncPendingPayment,
    handleGatewayWebhook,
    listRegisteredGateways,
} from '../payment-services/paymentManager.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const resolveAmount = (course, requestedAmount) => {
    if (!hasValue(requestedAmount)) {
        return toMajorAmount(course.price);
    }

    const amount = toMajorAmount(requestedAmount);
    const max = getMaxPaymentAmount();

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError(400, 'Please enter a valid amount greater than zero');
    }
    if (amount > max) {
        throw new AppError(400, `Amount cannot be greater than ${max}`);
    }

    return amount;
};

export const getActiveGateway = catchAsync(async (req, res) => {
    const config = await getOrCreateGatewayConfig();

    res.status(200).json({
        success: true,
        activeGateway: config.activeGateway,
        availableGateways: listRegisteredGateways(),
    });
});

export const getAdminGateways = catchAsync(async (req, res) => {
    const config = await getOrCreateGatewayConfig();

    res.status(200).json({
        success: true,
        activeGateway: config.activeGateway,
        gateways: describeGateways(),
    });
});

export const switchActiveGateway = catchAsync(async (req, res) => {
    const config = await setActiveGateway(req.body.gateway);

    res.status(200).json({
        success: true,
        message: `Payment gateway changed to ${config.activeGateway}`,
        activeGateway: config.activeGateway,
        gateways: describeGateways(),
    });
});

export const initiatePayment = catchAsync(async (req, res) => {
    const { courseId, customerName, customerEmail, customer, amount: requestedAmount } = req.body;

    if (!courseId || !mongoose.isValidObjectId(courseId)) {
        throw new AppError(400, 'A valid course is required to initiate payment');
    }

    const userEmail = String(req.user?.email || customerEmail || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(userEmail)) {
        throw new AppError(400, 'A valid email address is required to initiate payment');
    }

    const course = await Course.findById(courseId);
    if (!course) {
        throw new AppError(404, 'Course not found');
    }

    const orderId = `ORDER_${crypto.randomUUID()}`;
    const userName = String(customerName || req.user?.name || 'Guest').trim() || 'Guest';
    const isFreeCourse = Number(course.price) <= 0 && !hasValue(requestedAmount);

    if (isFreeCourse) {
        const enrollment = await Enrollment.create({
            orderId,
            courseId: String(course._id),
            userEmail,
            userName,
            gateway: FREE_GATEWAY,
            amount: 0,
            currency: DEFAULT_CURRENCY,
            paymentStatus: PAYMENT_STATUS.SUCCESS,
            isAccessGranted: true,
        });

        return res.status(200).json({
            success: true,
            checkoutUrl: null,
            orderId: enrollment.orderId,
            gateway: FREE_GATEWAY,
            paymentStatus: enrollment.paymentStatus,
        });
    }

    const amount = resolveAmount(course, requestedAmount);
    const gateway = await resolveActiveGateway();

    const enrollment = await Enrollment.create({
        orderId,
        courseId: String(course._id),
        userEmail,
        userName,
        gateway: gateway.name,
        amount,
        currency: DEFAULT_CURRENCY,
        paymentStatus: PAYMENT_STATUS.PENDING,
        isAccessGranted: false,
    });

    try {
        const session = await createGatewaySession(gateway, {
            orderId,
            amount,
            currency: DEFAULT_CURRENCY,
            title: course.title,
            courseId: String(course._id),
            customerEmail: userEmail,
            customerName: userName,
            customer,
            ipAddress: getClientIp(req),
        });

        enrollment.gatewayPaymentId = session.gatewayPaymentId;
        await enrollment.save();

        return res.status(200).json({
            success: true,
            checkoutUrl: session.checkoutUrl,
            orderId,
            gateway: session.gateway,
        });
    } catch (error) {
        enrollment.paymentStatus = PAYMENT_STATUS.FAILED;
        enrollment.failureReason = String(error.message || 'Session creation failed').slice(0, 300);
        await enrollment.save();

        if (error.statusCode && error.statusCode < 500) throw error;
        console.error(`[Payment] ${gateway.name} session failed for ${orderId}:`, error.message);
        throw new AppError(502, 'We could not start the payment right now. Please try again later.');
    }
});

export const getPaymentStatus = catchAsync(async (req, res) => {
    const enrollment = await Enrollment.findOne({ orderId: req.params.orderId });

    if (!enrollment) {
        throw new AppError(404, 'Order not found');
    }

    const latest = await syncPendingPayment(enrollment, { silent: true });

    res.status(200).json({
        success: true,
        data: {
            orderId: latest.orderId,
            gateway: latest.gateway,
            paymentStatus: latest.paymentStatus,
            isAccessGranted: latest.isAccessGranted,
            amount: latest.amount,
            currency: latest.currency,
            courseId: latest.courseId,
        },
    });
});

export const handlePaymentWebhook = catchAsync(async (req, res) => {
    const { ack } = await handleGatewayWebhook(req);

    if (typeof ack === 'string') {
        return res.status(200).type('text/plain').send(ack);
    }

    res.status(200).json(ack);
});
