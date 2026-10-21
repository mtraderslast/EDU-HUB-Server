const stripTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

export const DEFAULT_CURRENCY = 'USD';

export const getFrontendUrl = () =>
    stripTrailingSlash(process.env.FRONTEND_URL || 'http://localhost:3000');

export const getServerUrl = () =>
    stripTrailingSlash(process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 5000}`);

export const getPaymentReturnUrl = (orderId) =>
    `${getFrontendUrl()}/payment-return?orderId=${encodeURIComponent(orderId)}`;

export const getPaymentSuccessUrl = (orderId) =>
    `${getFrontendUrl()}/payment-success?orderId=${encodeURIComponent(orderId)}`;

export const getPaymentFailUrl = (orderId) =>
    `${getFrontendUrl()}/payment-failed?orderId=${encodeURIComponent(orderId)}`;

export const getWebhookUrl = (gatewayName) =>
    `${getServerUrl()}/api/payments/webhook/${String(gatewayName).toLowerCase()}`;

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

export const isPublicHttpUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !PRIVATE_HOST.test(url.hostname);
    } catch {
        return false;
    }
};

export const getPublicWebhookUrl = (gatewayName) => {
    const webhookUrl = getWebhookUrl(gatewayName);
    return isPublicHttpUrl(webhookUrl) ? webhookUrl : '';
};

export const toMinorUnits = (amount) => Math.round(Number(amount) * 100);

export const toMajorAmount = (amount) => Math.round(Number(amount) * 100) / 100;

export const getMaxPaymentAmount = () => Number(process.env.PAYMENT_MAX_AMOUNT) || 100000;

export const splitName = (fullName = '') => {
    const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: 'Guest', lastName: 'User' };
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

export const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const raw =
        typeof forwarded === 'string' && forwarded.length > 0
            ? forwarded.split(',')[0].trim()
            : req.ip || req.socket?.remoteAddress || '';

    const ip = String(raw).replace(/^::ffff:/i, '');
    return ip && ip.length >= 7 ? ip : '127.0.0.1';
};
