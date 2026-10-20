import crypto from 'crypto';

const normalizePem = (pem) =>
    String(pem || '')
        .replace(/\\n/g, '\n')
        .replace(/["']/g, '')
        .trim();

const wrapPem = (body, type) => {
    const wrapped = body.match(/.{1,64}/g)?.join('\n') || body;
    return `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----`;
};

const canLoadPrivateKey = (pem) => {
    try {
        crypto.createPrivateKey(pem);
        return true;
    } catch {
        return false;
    }
};

export const formatPrivateKey = (pem) => {
    const normalized = normalizePem(pem);
    if (!normalized) return '';
    if (normalized.includes('-----BEGIN PUBLIC KEY-----') || normalized.startsWith('MIIBIjAN')) {
        throw new Error('ANTOM_PRIVATE_KEY is a public key. Paste the merchant private key (starts with MIIEv).');
    }
    if (normalized.includes('-----BEGIN')) {
        if (!canLoadPrivateKey(normalized)) {
            throw new Error('ANTOM_PRIVATE_KEY could not be parsed. Check the value in .env.');
        }
        return normalized;
    }

    const pkcs8 = wrapPem(normalized, 'PRIVATE KEY');
    if (canLoadPrivateKey(pkcs8)) return pkcs8;

    const pkcs1 = wrapPem(normalized, 'RSA PRIVATE KEY');
    if (canLoadPrivateKey(pkcs1)) return pkcs1;

    throw new Error('ANTOM_PRIVATE_KEY could not be parsed. Check the value in .env.');
};

export const formatPublicKey = (pem) => {
    const normalized = normalizePem(pem);
    if (!normalized) return '';
    if (normalized.includes('-----BEGIN')) return normalized;
    return wrapPem(normalized, 'PUBLIC KEY');
};

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
