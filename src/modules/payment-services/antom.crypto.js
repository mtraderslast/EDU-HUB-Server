import crypto from 'crypto';

const formatPem = (pem, type) => {
    if (!pem) return '';
    const normalized = pem.replace(/\\n/g, '\n').trim();
    if (normalized.includes('-----BEGIN')) return normalized;

    const wrapped = normalized.match(/.{1,64}/g)?.join('\n') || normalized;
    return `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----`;
};

export const formatPrivateKey = (pem) => formatPem(pem, 'RSA PRIVATE KEY');

export const formatPublicKey = (pem) => formatPem(pem, 'PUBLIC KEY');

export const buildSignContent = (httpMethod, requestPath, clientId, requestTime, body) =>
    `${httpMethod} ${requestPath}\n${clientId}.${requestTime}.${body}`;

export const generateAntomSignature = (httpMethod, requestPath, clientId, requestTime, reqBody, privateKey) => {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(buildSignContent(httpMethod, requestPath, clientId, requestTime, reqBody), 'utf8');
    return sign.sign({
        key: formatPrivateKey(privateKey),
        padding: crypto.constants.RSA_PKCS1_PADDING,
    }, 'base64');
};

export const parseSignatureHeader = (headerValue = '') => {
    const match = String(headerValue).match(/signature=([^,]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
};

export const verifyAntomSignature = ({
    httpMethod,
    requestPath,
    clientId,
    requestTime,
    reqBody,
    signature,
    publicKey,
}) => {
    if (!publicKey || !signature) return false;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(buildSignContent(httpMethod, requestPath, clientId, requestTime, reqBody), 'utf8');

    try {
        return verifier.verify({
            key: formatPublicKey(publicKey),
            padding: crypto.constants.RSA_PKCS1_PADDING,
        }, signature, 'base64');
    } catch {
        return false;
    }
};

export const buildSignatureHeader = (signature) =>
    `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(signature)}`;
