import Enrollment from '../enrollment/enrollment.model.js';
import PaymentGatewayConfig from '../paymentGateway/paymentGateway.model.js';
import AppError from '../../utils/AppError.js';
import { FREE_GATEWAY, GATEWAYS, PAYMENT_STATUS } from './constants.js';
import {
    describeGateways,
    getGateway,
    isGatewayRegistered,
    listRegisteredGateways,
    registerGateway,
} from './gatewayRegistry.js';
import { antomGateway } from './antom.service.js';
import { centiwiseGateway } from './centiwise.service.js';

/*
 * A gateway strategy exposes: name, label, isConfigured(), createSession(), inquireStatus(),
 * verifyWebhook(), parseWebhook(), webhookAck(). Register a new one below to add a gateway.
 */
registerGateway(antomGateway);
registerGateway(centiwiseGateway);

const AMOUNT_TOLERANCE = 0.01;

const toComparableAmount = (gatewayAmount, orderAmount) => {
    if (!Number.isFinite(gatewayAmount)) return undefined;
    if (Math.abs(gatewayAmount - orderAmount) <= AMOUNT_TOLERANCE) return gatewayAmount;

    const asMajor = gatewayAmount / 100;
    if (Math.abs(asMajor - orderAmount) <= AMOUNT_TOLERANCE) return asMajor;

    return gatewayAmount;
};

export const getOrCreateGatewayConfig = async () => {
    let config = await PaymentGatewayConfig.findOne();
    if (!config) {
        config = await PaymentGatewayConfig.create({ activeGateway: GATEWAYS.ANTOM });
    }
    return config;
};

export const resolveActiveGateway = async () => {
    const config = await getOrCreateGatewayConfig();
    return getGateway(config.activeGateway);
};

export const setActiveGateway = async (name) => {
    const gateway = getGateway(name);

    if (typeof gateway.isConfigured === 'function' && !gateway.isConfigured()) {
        throw new AppError(400, `${gateway.label || gateway.name} is not configured on the server`);
    }

    const config = await getOrCreateGatewayConfig();
    config.activeGateway = gateway.name;
    await config.save();
    return config;
};

export const createGatewaySession = async (gateway, paymentData) => {
    const session = await gateway.createSession(paymentData);

    return {
        checkoutUrl: session.checkoutUrl,
        gateway: gateway.name,
        gatewayPaymentId: session.gatewayPaymentId || '',
        raw: session.raw,
    };
};

export const inquirePaymentStatus = ({ gateway, orderId, gatewayPaymentId }) =>
    getGateway(gateway).inquireStatus({ orderId, gatewayPaymentId });

export const applyPaymentResult = async ({
    orderId,
    status,
    proofId,
    gatewayPaymentId,
    failureReason,
    amount,
    expectedGateway,
}) => {
    if (!orderId) {
        throw new AppError(400, 'Missing order id');
    }

    const enrollment = await Enrollment.findOne({ orderId });
    if (!enrollment) {
        throw new AppError(404, 'Order not found');
    }

    if (enrollment.paymentStatus === PAYMENT_STATUS.SUCCESS) {
        return enrollment;
    }

    if (status !== PAYMENT_STATUS.SUCCESS && status !== PAYMENT_STATUS.FAILED) {
        return enrollment;
    }

    if (expectedGateway && enrollment.gateway && enrollment.gateway !== expectedGateway) {
        console.error(
            `[Payment] ${expectedGateway} result received for ${orderId} which belongs to ${enrollment.gateway}; ignored`
        );
        return enrollment;
    }

    const comparableAmount = toComparableAmount(amount, enrollment.amount);

    if (
        status === PAYMENT_STATUS.SUCCESS &&
        Number.isFinite(comparableAmount) &&
        Math.abs(comparableAmount - enrollment.amount) > AMOUNT_TOLERANCE
    ) {
        console.error(
            `[Payment] Amount mismatch for ${orderId}: gateway=${amount}, order=${enrollment.amount}; access NOT granted`
        );
        return enrollment;
    }

    const update = {
        paymentStatus: status,
        isAccessGranted: status === PAYMENT_STATUS.SUCCESS,
    };
    if (proofId) update.proofId = proofId;
    if (gatewayPaymentId) update.gatewayPaymentId = gatewayPaymentId;
    if (status === PAYMENT_STATUS.FAILED && failureReason) update.failureReason = failureReason;

    const updated = await Enrollment.findOneAndUpdate(
        { orderId, paymentStatus: { $ne: PAYMENT_STATUS.SUCCESS } },
        { $set: update },
        { returnDocument: 'after' }
    );

    return updated || Enrollment.findOne({ orderId });
};

export const syncPendingPayment = async (enrollment, { silent = false } = {}) => {
    const isPending = enrollment.paymentStatus === PAYMENT_STATUS.PENDING;
    const hasGateway = enrollment.gateway && enrollment.gateway !== FREE_GATEWAY;

    if (!isPending || !hasGateway) return enrollment;

    try {
        const inquiry = await inquirePaymentStatus({
            gateway: enrollment.gateway,
            orderId: enrollment.orderId,
            gatewayPaymentId: enrollment.gatewayPaymentId,
        });

        return await applyPaymentResult({
            orderId: enrollment.orderId,
            status: inquiry.status,
            proofId: inquiry.proofId,
            gatewayPaymentId: inquiry.proofId,
            failureReason: inquiry.failureReason,
        });
    } catch (error) {
        if (!silent) throw error;
        console.error(`[Payment] status inquiry failed for ${enrollment.orderId}:`, error.message);
        return enrollment;
    }
};

export const handleGatewayWebhook = async (req) => {
    const gateway = getGateway(req.params.gateway);

    if (!gateway.verifyWebhook(req)) {
        throw new AppError(401, 'Invalid webhook signature');
    }

    const event = gateway.parseWebhook(req);
    let enrollment = null;

    try {
        enrollment = await applyPaymentResult({
            orderId: event.orderId,
            status: event.status,
            proofId: event.proofId,
            gatewayPaymentId: event.proofId,
            failureReason: event.failureReason,
            amount: event.amount,
            expectedGateway: gateway.name,
        });
    } catch (error) {
        if (error.statusCode !== 404 && error.statusCode !== 400) {
            throw error;
        }
        console.warn(`[Payment] ${gateway.name} webhook ignored: ${error.message} (order=${event.orderId})`);
    }

    return { ack: gateway.webhookAck(), enrollment };
};

export { describeGateways, listRegisteredGateways, isGatewayRegistered, GATEWAYS };
