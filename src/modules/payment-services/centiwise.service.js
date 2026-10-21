import crypto from 'crypto';
import AppError from '../../utils/AppError.js';
import { GATEWAYS, PAYMENT_STATUS } from './constants.js';
import {
    DEFAULT_CURRENCY,
    getFrontendUrl,
    getPaymentReturnUrl,
    getPublicWebhookUrl,
    splitName,
    toMajorAmount,
    toMinorUnits,
} from './config.js';

/*
 * control formulas (amount in cents):
 *   sale-form : SHA1(endpointId + client_orderid + amount + email + merchant_control)
 *   status    : SHA1(login + client_orderid + orderid + merchant_control)
 *   callback  : SHA1(status + orderid + client_orderid + merchant_control)
 */

const ACCEPT_HEADER = 'application/vnd.pay+json';

const getEndpointId = () => String(process.env.CENTIWISE_ENDPOINT_ID || '').trim();
const getLogin = () => String(process.env.CENTIWISE_LOGIN || '').trim();
const getBaseUrl = () => {
    const explicit = (process.env.CENTIWISE_BASE_URL || '').replace(/\/$/, '');
    if (explicit) return explicit;
    const sandboxLogin = getLogin().toLowerCase().includes('sand');
    return sandboxLogin ? 'https://sandbox.centiwise.com' : 'https://gate.centiwise.com';
};
const getMerchantControl = () =>
    String(process.env.CENTIWISE_MERCHANT_CONTROL || process.env.CENTIWISE_API_KEY || '').trim();

const sha1Hex = (value) => crypto.createHash('sha1').update(String(value), 'utf8').digest('hex');

const safeDecode = (value) => {
    try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
        return value;
    }
};

const parseFormEncoded = (text = '') => {
    const params = {};
    String(text)
        .trim()
        .split('&')
        .filter(Boolean)
        .forEach((part) => {
            const [rawKey, ...rest] = part.split('=');
            const key = safeDecode((rawKey || '').replace(/\r?\n/g, '').trim());
            const value = safeDecode(rest.join('=').replace(/\r?\n/g, '').trim());
            if (key) params[key] = value;
        });
    return params;
};

const parseGatewayResponse = (rawText = '') => {
    const text = String(rawText).trim();
    if (!text) return {};
    if (text.startsWith('{')) {
        try {
            return JSON.parse(text);
        } catch {
            return parseFormEncoded(text);
        }
    }
    return parseFormEncoded(text);
};

// While polling (inquiry) an "error" answer stays PENDING: the customer may not have paid yet.
const mapCentiwiseStatus = (status, { inquiry = false } = {}) => {
    const normalized = String(status || '').toLowerCase();

    if (normalized === 'approved') return PAYMENT_STATUS.SUCCESS;

    const failed = ['declined', 'filtered', 'voided', 'chargeback', 'chain_declined'];
    if (!inquiry) failed.push('error');
    if (failed.includes(normalized)) return PAYMENT_STATUS.FAILED;

    return PAYMENT_STATUS.PENDING;
};

const isConfigured = () => Boolean(getEndpointId() && getMerchantControl());

const assertCentiwiseConfig = () => {
    if (!isConfigured()) {
        throw new AppError(500, 'Centiwise gateway is not configured');
    }
};

const postForm = async (url, fields) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: ACCEPT_HEADER,
        },
        body: new URLSearchParams(fields),
    });

    const rawText = await response.text();
    const result = parseGatewayResponse(rawText);

    if (!response.ok && !result['error-message']) {
        throw new AppError(502, `Centiwise HTTP ${response.status}: ${rawText.slice(0, 180)}`);
    }

    return result;
};

const createSession = async ({
    orderId,
    amount,
    currency = DEFAULT_CURRENCY,
    title,
    customerEmail,
    customerName,
    customer = {},
    ipAddress,
}) => {
    assertCentiwiseConfig();

    const { firstName, lastName } = splitName(customerName || customer.name);
    const majorAmount = toMajorAmount(amount);
    const control = sha1Hex(
        `${getEndpointId()}${orderId}${toMinorUnits(majorAmount)}${customerEmail}${getMerchantControl()}`
    );

    const returnUrl = getPaymentReturnUrl(orderId);

    const fields = {
        client_orderid: orderId,
        order_desc: String(title || 'Course Payment').slice(0, 1000),
        first_name: customer.firstName || firstName,
        last_name: customer.lastName || lastName,
        address1: customer.address1 || process.env.CENTIWISE_DEFAULT_ADDRESS || 'N/A',
        city: customer.city || process.env.CENTIWISE_DEFAULT_CITY || 'Hong Kong',
        zip_code: customer.zipCode || process.env.CENTIWISE_DEFAULT_ZIP || '00000',
        country: customer.country || process.env.CENTIWISE_DEFAULT_COUNTRY || 'HK',
        phone: customer.phone || process.env.CENTIWISE_DEFAULT_PHONE || '+85200000000',
        email: customerEmail,
        amount: majorAmount.toFixed(2),
        currency,
        ipaddress: ipAddress || '127.0.0.1',
        site_url: getFrontendUrl().slice(0, 100),
        control,
        redirect_success_url: returnUrl,
        redirect_fail_url: returnUrl,
    };

    const callbackUrl = getPublicWebhookUrl(GATEWAYS.CENTIWISE);
    if (callbackUrl) {
        fields.server_callback_url = callbackUrl;
    }

    if (customer.state) fields.state = customer.state;

    const result = await postForm(`${getBaseUrl()}/paynet/api/v2/sale-form/${getEndpointId()}`, fields);
    const checkoutUrl =
        result['redirect-url'] || result['redirect-to'] || result.redirectUrl || result.redirect_url;

    if (!checkoutUrl) {
        console.error('[Centiwise] sale-form failed:', JSON.stringify(result));
        if (result['error-message'] === 'INVALID_CONTROL_CODE') {
            console.error('[Centiwise] Check CENTIWISE_ENDPOINT_ID and CENTIWISE_MERCHANT_CONTROL in .env (copy them from the Centiwise dashboard).');
        }
        throw new AppError(502, result['error-message'] || 'Centiwise payment session creation failed');
    }

    return {
        checkoutUrl,
        gatewayPaymentId: String(result['paynet-order-id'] || ''),
        raw: result,
    };
};

const inquireStatus = async ({ orderId, gatewayPaymentId }) => {
    assertCentiwiseConfig();
    const login = getLogin();
    if (!login) {
        throw new AppError(500, 'Centiwise login is not configured');
    }

    const control = sha1Hex(`${login}${orderId}${gatewayPaymentId || ''}${getMerchantControl()}`);

    const fields = {
        login,
        client_orderid: orderId,
        control,
    };
    if (gatewayPaymentId) fields.orderid = gatewayPaymentId;

    const result = await postForm(`${getBaseUrl()}/paynet/api/v2/status/${getEndpointId()}`, fields);

    return {
        status: mapCentiwiseStatus(result.status, { inquiry: true }),
        proofId: String(result['paynet-order-id'] || result.orderid || gatewayPaymentId || ''),
        raw: result,
    };
};

const getWebhookPayload = (req) => ({ ...(req.query || {}), ...(req.body || {}) });

const verifyWebhook = (req) => {
    const payload = getWebhookPayload(req);
    const control = payload.control;
    const merchantControl = getMerchantControl();
    if (!control || !merchantControl) return false;

    const expected = sha1Hex(
        `${payload.status || ''}${payload.orderid || ''}${payload.client_orderid || payload.merchant_order || ''}${merchantControl}`
    );

    const received = String(control).toLowerCase();
    if (expected.length !== received.length) return false;

    try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
    } catch {
        return false;
    }
};

const parseWebhook = (req) => {
    const payload = getWebhookPayload(req);
    const status = mapCentiwiseStatus(payload.status);
    const amount = Number(payload.amount);

    return {
        orderId: payload.client_orderid || payload.merchant_order,
        status,
        proofId: String(payload.orderid || ''),
        amount: Number.isFinite(amount) ? amount : undefined,
        failureReason:
            status === PAYMENT_STATUS.FAILED
                ? payload.error_message || payload['error-message'] || payload.status || ''
                : '',
        raw: payload,
    };
};

const webhookAck = () => 'OK';

export const centiwiseGateway = {
    name: GATEWAYS.CENTIWISE,
    label: 'Centiwise',
    isConfigured,
    createSession,
    inquireStatus,
    verifyWebhook,
    parseWebhook,
    webhookAck,
};
