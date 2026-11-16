import crypto from 'crypto';
import AppError from '../../utils/AppError.js';
import { GATEWAYS, PAYMENT_STATUS } from './constants.js';
import {
    DEFAULT_CURRENCY,
    getPaymentFailUrl,
    getPaymentSuccessUrl,
    toMinorUnits,
} from './config.js';

/*
 * Dodo Payments checkout sessions (https://docs.dodopayments.com):
 *   POST {test|live}.dodopayments.com/checkouts
 *   GET  {test|live}.dodopayments.com/checkouts/{session_id}
 * One Pay What You Want product in the dashboard; course price is sent as
 * product_cart[].amount in cents. Fulfill on payment.succeeded, not the redirect.
 */

const WEBHOOK_TOLERANCE_SECONDS = 300;

const SUCCESS_STATUSES = new Set(['succeeded', 'success']);
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'canceled']);

const getApiKey = () => String(process.env.DODO_PAYMENTS_API_KEY || '').trim();
const getWebhookKey = () => String(process.env.DODO_PAYMENTS_WEBHOOK_KEY || '').trim();
const getProductId = () => String(process.env.DODO_PAYMENTS_PRODUCT_ID || '').trim();

const getEnvironment = () => {
    const explicit = String(
        process.env.DODO_PAYMENTS_ENV || process.env.DODO_PAYMENTS_ENVIRONMENT || ''
    )
        .trim()
        .toLowerCase();

    if (['live', 'live_mode', 'production', 'prod'].includes(explicit)) return 'live_mode';
    if (['test', 'test_mode', 'sandbox'].includes(explicit)) return 'test_mode';
    if (getApiKey().startsWith('dodo_live')) return 'live_mode';
    return 'test_mode';
};

const getBaseUrl = () =>
    getEnvironment() === 'live_mode'
        ? 'https://live.dodopayments.com'
        : 'https://test.dodopayments.com';

const isConfigured = () => Boolean(getApiKey() && getProductId());

const assertDodoConfig = () => {
    if (!isConfigured()) {
        throw new AppError(500, 'Dodo Payments gateway is not configured');
    }
};

const headerValue = (req, name) => {
    const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
    if (Array.isArray(value)) return String(value[0] || '');
    return String(value || '');
};

const mapDodoStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (SUCCESS_STATUSES.has(normalized)) return PAYMENT_STATUS.SUCCESS;
    if (FAILED_STATUSES.has(normalized)) return PAYMENT_STATUS.FAILED;
    return PAYMENT_STATUS.PENDING;
};

const mapEventStatus = (type, paymentStatus) => {
    const event = String(type || '').trim().toLowerCase();
    if (event === 'payment.succeeded') return PAYMENT_STATUS.SUCCESS;
    if (event === 'payment.failed' || event === 'payment.cancelled') return PAYMENT_STATUS.FAILED;
    return mapDodoStatus(paymentStatus);
};

const decodeWebhookSecret = (secret) => {
    const value = String(secret || '').trim();
    const raw = value.startsWith('whsec_') ? value.slice(6) : value;
    return Buffer.from(raw, 'base64');
};

const dodoFetch = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${getBaseUrl()}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${getApiKey()}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const rawText = await response.text();
    let result = {};
    if (rawText) {
        try {
            result = JSON.parse(rawText);
        } catch {
            throw new AppError(502, `Invalid Dodo Payments response: ${rawText.slice(0, 180)}`);
        }
    }

    if (!response.ok) {
        const gatewayMessage = result.message || result.error || result.code || '';
        throw new AppError(
            502,
            gatewayMessage || `Dodo Payments HTTP ${response.status}`
        );
    }

    return result;
};

const createSession = async ({
    orderId,
    amount,
    currency = DEFAULT_CURRENCY,
    customerEmail,
    customerName,
    courseId,
}) => {
    assertDodoConfig();

    const payload = {
        product_cart: [
            {
                product_id: getProductId(),
                quantity: 1,
                amount: toMinorUnits(amount),
            },
        ],
        customer: {
            email: customerEmail,
            name: String(customerName || 'Guest').trim() || 'Guest',
        },
        metadata: {
            orderId: String(orderId),
            courseId: String(courseId || ''),
        },
        return_url: `${getPaymentSuccessUrl()}?orderId=${encodeURIComponent(orderId)}`,
        cancel_url: `${getPaymentFailUrl()}?orderId=${encodeURIComponent(orderId)}`,
        billing_currency: String(currency || DEFAULT_CURRENCY),
        feature_flags: {
            redirect_immediately: true,
        },
    };

    const result = await dodoFetch('/checkouts', { method: 'POST', body: payload });
    const checkoutUrl = result.checkout_url || result.checkoutUrl;
    const sessionId = result.session_id || result.sessionId || result.id;

    if (!checkoutUrl) {
        console.error('[Dodo] checkout session failed:', JSON.stringify(result));
        throw new AppError(502, result.message || 'Dodo Payments session creation failed');
    }

    return {
        checkoutUrl,
        gatewayPaymentId: String(sessionId || ''),
        raw: result,
    };
};

const inquireStatus = async ({ gatewayPaymentId }) => {
    assertDodoConfig();

    if (!gatewayPaymentId) {
        return { status: PAYMENT_STATUS.PENDING, proofId: '', raw: {} };
    }

    const id = String(gatewayPaymentId);
    const result = id.startsWith('pay_')
        ? await dodoFetch(`/payments/${encodeURIComponent(id)}`)
        : await dodoFetch(`/checkouts/${encodeURIComponent(id)}`);

    const status = mapDodoStatus(result.payment_status || result.status);
    const proofId = String(result.payment_id || result.paymentId || (id.startsWith('pay_') ? id : '') || '');

    return {
        status,
        proofId,
        failureReason:
            status === PAYMENT_STATUS.FAILED
                ? result.error_message || result.error_code || result.status || ''
                : '',
        raw: result,
    };
};

const verifyWebhook = (req) => {
    const secret = getWebhookKey();
    if (!secret) {
        console.warn('DODO_PAYMENTS_WEBHOOK_KEY is missing; rejecting Dodo webhook');
        return false;
    }

    const webhookId = headerValue(req, 'webhook-id');
    const webhookTimestamp = headerValue(req, 'webhook-timestamp');
    const webhookSignature = headerValue(req, 'webhook-signature');
    const rawBody = req.rawBody || JSON.stringify(req.body || {});

    if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

    const timestamp = Number(webhookTimestamp);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
        console.warn('[Dodo] webhook timestamp outside tolerance');
        return false;
    }

    let expected;
    try {
        expected = crypto
            .createHmac('sha256', decodeWebhookSecret(secret))
            .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
            .digest();
    } catch (error) {
        console.warn('[Dodo] webhook secret could not be decoded:', error.message);
        return false;
    }

    const candidates = String(webhookSignature)
        .split(/\s+/)
        .map((part) => {
            const separator = part.indexOf(',');
            if (separator === -1) return null;
            const version = part.slice(0, separator).trim();
            const value = part.slice(separator + 1).trim();
            if (version !== 'v1' || !value) return null;
            try {
                return Buffer.from(value, 'base64');
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    return candidates.some(
        (candidate) =>
            candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
    );
};

const parseWebhook = (req) => {
    const body = req.body || {};
    const data = body.data && typeof body.data === 'object' ? body.data : body;
    const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    const status = mapEventStatus(body.type, data.status || data.payment_status);
    const amount = Number(data.amount ?? data.settlement_amount);

    return {
        orderId: metadata.orderId || metadata.order_id || '',
        status,
        proofId: String(data.payment_id || data.paymentId || ''),
        amount: Number.isFinite(amount) ? amount : undefined,
        failureReason:
            status === PAYMENT_STATUS.FAILED
                ? data.error_message || data.error_code || body.type || ''
                : '',
        raw: body,
    };
};

const webhookAck = () => ({ received: true });

export const dodoGateway = {
    name: GATEWAYS.DODO,
    label: 'Dodo Payments',
    isConfigured,
    createSession,
    inquireStatus,
    verifyWebhook,
    parseWebhook,
    webhookAck,
};
