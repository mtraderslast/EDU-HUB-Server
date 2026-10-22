import AppError from '../../utils/AppError.js';
import { GATEWAYS, PAYMENT_STATUS } from './constants.js';
import { DEFAULT_CURRENCY, getFrontendUrl, getWebhookUrl, splitName, toMinorUnits } from './config.js';
import {
    generateAntomSignature,
    buildSignatureHeader,
    parseSignatureHeader,
    verifyAntomSignature,
} from './antom.crypto.js';

/*
 * Same request the live Next.js /api/antom-pay route used:
 *   POST {ANTOM_BASE_URL}/ams/api/v1/payments/createPaymentSession
 * Do not switch to /ams/sandbox/api — that creates a session checkout.antom.com immediately expires.
 */

const FAILED_STATUSES = ['FAIL', 'FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED'];

const getClientId = () => process.env.ANTOM_CLIENT_ID;
const getPrivateKey = () => process.env.ANTOM_PRIVATE_KEY;
const getPublicKey = () => process.env.ANTOM_PUBLIC_KEY;

const getBaseUrl = () =>
    (process.env.ANTOM_BASE_URL || '').replace(/\/+$/, '').replace(/\/ams\/(sandbox\/)?api$/i, '');

const getCreatePath = () => '/ams/api/v1/payments/createPaymentSession';
const getInquiryPath = () => '/ams/api/v1/payments/inquiryPayment';

const getCreateEndpoint = () => ({ url: `${getBaseUrl()}${getCreatePath()}`, requestPath: getCreatePath() });
const getInquiryEndpoint = () => ({ url: `${getBaseUrl()}${getInquiryPath()}`, requestPath: getInquiryPath() });

const isConfigured = () => Boolean(getBaseUrl() && getClientId() && getPrivateKey());

const getPaymentReturnUrl = () => `${getFrontendUrl()}/api/payment-return`;

const pickCheckoutUrl = (result = {}) => {
    const raw = [result.paymentUrl, result.redirectUrl, result.normalUrl, result.actionForm, result.paymentSessionData?.redirectUrl]
        .find((value) => typeof value === 'string' && /^https?:\/\//i.test(value));
    if (!raw) return '';
    try {
        const url = new URL(raw);
        url.searchParams.delete('shadow');
        return url.toString();
    } catch {
        return raw;
    }
};

const buildBuyer = ({ orderId, customerEmail, customerName }) => {
    const { firstName, lastName } = splitName(customerName);
    return {
        referenceBuyerId: customerEmail || `GUEST_${orderId}`,
        ...(customerEmail && { buyerEmail: customerEmail }),
        ...(customerName && {
            buyerName: {
                firstName,
                lastName,
                fullName: customerName,
            },
        }),
    };
};

const mapAntomStatus = (payload = {}) => {
    const paymentStatus = String(payload.paymentStatus || payload.captureStatus || '').toUpperCase();
    const resultStatus = String(payload.result?.resultStatus || payload.paymentResult?.resultStatus || '').toUpperCase();
    const isPaymentNotify = ['PAYMENT_RESULT', 'CAPTURE_RESULT'].includes(payload.notifyType);

    if (paymentStatus === 'SUCCESS' || paymentStatus === 'S') return PAYMENT_STATUS.SUCCESS;
    if (FAILED_STATUSES.includes(paymentStatus)) return PAYMENT_STATUS.FAILED;
    if (['PROCESSING', 'PENDING'].includes(paymentStatus)) return PAYMENT_STATUS.PENDING;

    if (isPaymentNotify) {
        if (resultStatus === 'F') return PAYMENT_STATUS.FAILED;
        if (resultStatus === 'S') return PAYMENT_STATUS.SUCCESS;
    }

    return PAYMENT_STATUS.PENDING;
};

const callAntom = async (endpoint, payload) => {
    if (!isConfigured()) {
        throw new AppError(500, 'Antom gateway is not configured');
    }

    const { url, requestPath } = endpoint;
    const clientId = getClientId();
    const requestTime = new Date().toISOString();
    const jsonBody = JSON.stringify(payload);
    const signature = generateAntomSignature('POST', requestPath, clientId, requestTime, jsonBody, getPrivateKey());

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'Client-Id': clientId,
            'Request-Time': requestTime,
            Signature: buildSignatureHeader(signature),
        },
        body: jsonBody,
    });

    const rawText = await response.text();
    try {
        return JSON.parse(rawText);
    } catch {
        throw new AppError(502, `Invalid Antom response: ${rawText.slice(0, 180)}`);
    }
};

const createSession = async ({
    orderId,
    amount,
    currency = DEFAULT_CURRENCY,
    title,
    courseId,
    customerEmail,
    customerName,
}) => {
    const amountString = String(toMinorUnits(amount));
    const buyer = buildBuyer({ orderId, customerEmail, customerName });

    const payload = {
        productCode: 'CASHIER_PAYMENT',
        productScene: 'CHECKOUT_PAYMENT',
        paymentRequestId: orderId,
        is3DSAuthentication: true,
        paymentAmount: {
            currency: String(currency),
            value: amountString,
        },
        order: {
            referenceOrderId: String(courseId || orderId),
            orderDescription: String(title || 'Course Purchase'),
            orderAmount: {
                currency: String(currency),
                value: amountString,
            },
            buyer,
        },
        availablePaymentMethod: {
            paymentMethodTypeList: [
                { paymentMethodType: 'CARD' },
                { paymentMethodType: 'GOOGLEPAY', expressCheckout: false },
                { paymentMethodType: 'APPLEPAY', expressCheckout: false },
                { paymentMethodType: 'ALIPAY_HK' },
            ],
        },
        buyer,
        settlementStrategy: {
            settlementCurrency: String(currency),
        },
        env: {
            terminalType: 'WEB',
        },
        paymentRedirectUrl: getPaymentReturnUrl(),
        paymentNotifyUrl: getWebhookUrl(GATEWAYS.ANTOM),
        passThroughInfo: JSON.stringify({ courseId, customerEmail, customerName }),
    };

    const endpoint = getCreateEndpoint();
    const result = await callAntom(endpoint, payload);
    const checkoutUrl = pickCheckoutUrl(result);

    if (!checkoutUrl) {
        console.error('[Antom] createPaymentSession failed:', JSON.stringify(result));
        throw new AppError(502, result?.result?.resultMessage || 'Antom payment session creation failed');
    }

    console.log(
        `[Antom] session created path=${endpoint.requestPath} expiry=${result.paymentSessionExpiryTime || 'n/a'} urlHost=${(() => {
            try {
                return new URL(checkoutUrl).host;
            } catch {
                return 'invalid-url';
            }
        })()}`
    );

    return { checkoutUrl, gatewayPaymentId: '', raw: result };
};

const inquireStatus = async ({ orderId, gatewayPaymentId }) => {
    const payload = gatewayPaymentId
        ? { paymentId: gatewayPaymentId, paymentRequestId: orderId }
        : { paymentRequestId: orderId };

    const result = await callAntom(getInquiryEndpoint(), payload);
    const status = result?.result?.resultStatus === 'F' ? PAYMENT_STATUS.PENDING : mapAntomStatus(result);

    return {
        status,
        proofId: result.paymentId || gatewayPaymentId || '',
        failureReason:
            status === PAYMENT_STATUS.FAILED
                ? result.paymentResultMessage || result.result?.resultMessage || ''
                : '',
        raw: result,
    };
};

const verifyWebhook = (req) => {
    const publicKey = getPublicKey();
    if (!publicKey) {
        console.warn('ANTOM_PUBLIC_KEY is missing; rejecting Antom webhook');
        return false;
    }

    const clientId = req.headers['client-id'];
    const requestTime = req.headers['request-time'];
    const signature = parseSignatureHeader(req.headers.signature);
    const requestPath =
        process.env.ANTOM_WEBHOOK_PATH || req.originalUrl?.split('?')[0] || '/api/payments/webhook/antom';
    const reqBody = req.rawBody || JSON.stringify(req.body || {});

    const valid = verifyAntomSignature({
        httpMethod: 'POST',
        requestPath,
        clientId,
        requestTime,
        reqBody,
        signature,
        publicKey,
    });

    if (!valid) {
        console.warn(
            `[Antom] webhook signature mismatch (path=${requestPath}, clientId=${clientId}, hasRawBody=${Boolean(req.rawBody)})`
        );
    }

    return valid;
};

const parseWebhook = (req) => {
    const body = req.body || {};
    const status = mapAntomStatus(body);
    const minor = Number(body.paymentAmount?.value);

    return {
        orderId: body.paymentRequestId,
        status,
        proofId: body.paymentId || body.captureId || body.transactionId || '',
        amount: Number.isFinite(minor) ? minor / 100 : undefined,
        failureReason:
            status === PAYMENT_STATUS.FAILED ? body.result?.resultMessage || body.result?.resultCode || '' : '',
        raw: body,
    };
};

const webhookAck = () => ({
    result: {
        resultStatus: 'S',
        resultCode: 'SUCCESS',
        resultMessage: 'success',
    },
});

export const antomGateway = {
    name: GATEWAYS.ANTOM,
    label: 'Antom',
    isConfigured,
    createSession,
    inquireStatus,
    verifyWebhook,
    parseWebhook,
    webhookAck,
};
