// Offline smoke test of the payment module: node scripts/payment-smoke.mjs
// Database models and gateway HTTP calls are stubbed; the real .env is not loaded.
import crypto from 'crypto';
import assert from 'assert/strict';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

Object.assign(process.env, {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:3000',
    SERVER_BASE_URL: 'https://server.example.com',
    ANTOM_BASE_URL: 'https://antom.example.com',
    ANTOM_CLIENT_ID: 'TEST_CLIENT',
    ANTOM_PRIVATE_KEY: privB64,
    ANTOM_PUBLIC_KEY: pubB64,
    CENTIWISE_ENDPOINT_ID: '107334',
    CENTIWISE_LOGIN: 'test_login',
    CENTIWISE_MERCHANT_CONTROL: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
});

const sha1 = (v) => crypto.createHash('sha1').update(v).digest('hex');

const { default: Enrollment } = await import('../src/modules/enrollment/enrollment.model.js');
const { default: Course } = await import('../src/modules/course/course.model.js');
const { default: PaymentGatewayConfig } = await import('../src/modules/paymentGateway/paymentGateway.model.js');

const store = new Map(); // orderId -> doc
const makeDoc = (data) => {
    const doc = { ...data };
    Object.defineProperty(doc, 'save', { value: async () => { store.set(doc.orderId, doc); return doc; }, enumerable: false });
    return doc;
};
let activeGateway = 'ANTOM';
const COURSE_ID = '507f1f77bcf86cd799439011';

PaymentGatewayConfig.findOne = async () => ({ activeGateway, save: async function () { activeGateway = this.activeGateway; } });
Course.findById = async (id) => (String(id) === COURSE_ID ? { _id: COURSE_ID, title: 'Test Course', price: 50 } : null);
Enrollment.exists = async (q) => [...store.values()].some((d) => d.userEmail === q.userEmail && d.courseId === q.courseId && d.paymentStatus === q.paymentStatus);
Enrollment.create = async (data) => { const d = makeDoc(data); store.set(d.orderId, d); return d; };
Enrollment.findOne = async (q) => store.get(q.orderId) || null;
Enrollment.findOneAndUpdate = async (q, { $set }) => {
    const d = store.get(q.orderId);
    if (!d || d.paymentStatus === 'SUCCESS') return null;
    Object.assign(d, $set);
    return d;
};

const realFetch = globalThis.fetch;
const outgoing = [];
let gatewayReply = () => ({});
globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
    outgoing.push({ url: String(url), init });
    const body = gatewayReply(String(url), init);
    return new Response(JSON.stringify(body), { status: 200 });
};

const { default: createApp } = await import('../src/app.js');
const app = createApp({});
app.set('auth', {
    api: {
        getSession: async ({ headers }) => {
            const role = headers.get('x-test-role');
            return role ? { user: { id: '1', name: 'Tester', email: 't@example.com', role } } : null;
        },
    },
});
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const post = (path, body, headers = {}) =>
    realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

let passed = 0;
const test = async (name, fn) => {
    try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
    catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

const antomSign = async (path, bodyStr) => {
    const { generateAntomSignature, buildSignatureHeader } = await import('../src/modules/payment-services/antom.crypto.js');
    const time = new Date().toISOString();
    const sig = generateAntomSignature('POST', path, 'TEST_CLIENT', time, bodyStr, privB64);
    return { 'Client-Id': 'TEST_CLIENT', 'Request-Time': time, Signature: buildSignatureHeader(sig) };
};

console.log('Payment smoke test');

await test('GET /api/payments/active-gateway lists both gateways', async () => {
    const r = await (await realFetch(`${base}/api/payments/active-gateway`)).json();
    assert.equal(r.activeGateway, 'ANTOM');
    assert.deepEqual(r.availableGateways.sort(), ['ANTOM', 'CENTIWISE']);
});

const adminCall = (method, path, role, body) =>
    realFetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(role && { 'x-test-role': role }) },
        ...(body && { body: JSON.stringify(body) }),
    });

await test('admin gateway list: 401 guest, 403 user, 200 admin with configured flags', async () => {
    assert.equal((await adminCall('GET', '/api/payments/admin/gateways')).status, 401);
    assert.equal((await adminCall('GET', '/api/payments/admin/gateways', 'user')).status, 403);
    const res = await adminCall('GET', '/api/payments/admin/gateways', 'admin');
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.activeGateway, 'ANTOM');
    assert.deepEqual(data.gateways.map((g) => [g.name, g.label, g.configured]), [
        ['ANTOM', 'Antom', true],
        ['CENTIWISE', 'Centiwise', true],
    ]);
});

await test('admin switch gateway: only admin, only known + configured gateways', async () => {
    const body = { gateway: 'centiwise' };
    assert.equal((await adminCall('PATCH', '/api/payments/admin/switch-gateway', 'user', body)).status, 403);
    assert.equal((await adminCall('PATCH', '/api/payments/admin/switch-gateway', 'admin', { gateway: 'PAYPAL' })).status, 400);

    const savedLogin = process.env.CENTIWISE_ENDPOINT_ID;
    delete process.env.CENTIWISE_ENDPOINT_ID;
    assert.equal((await adminCall('PATCH', '/api/payments/admin/switch-gateway', 'admin', body)).status, 400);
    assert.equal(activeGateway, 'ANTOM');
    process.env.CENTIWISE_ENDPOINT_ID = savedLogin;

    const res = await adminCall('PATCH', '/api/payments/admin/switch-gateway', 'admin', body);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).activeGateway, 'CENTIWISE');
    assert.equal(activeGateway, 'CENTIWISE');
    assert.equal((await (await realFetch(`${base}/api/payments/active-gateway`)).json()).activeGateway, 'CENTIWISE');
});

await test('after the switch, a new payment goes to Centiwise; switching back sends it to Antom', async () => {
    gatewayReply = (url) => (url.includes('centiwise')
        ? { 'redirect-url': 'https://gate.centiwise.com/paynet/shop/pay/sw', 'paynet-order-id': '5' }
        : { normalUrl: 'https://antom.example.com/pay/sw' });

    let d = await (await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'switch@example.com', amount: 7 })).json();
    assert.equal(d.gateway, 'CENTIWISE');
    assert.ok(d.checkoutUrl.includes('centiwise'));

    await adminCall('PATCH', '/api/payments/admin/switch-gateway', 'admin', { gateway: 'ANTOM' });
    d = await (await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'switch2@example.com', amount: 7 })).json();
    assert.equal(d.gateway, 'ANTOM');
    assert.ok(d.checkoutUrl.includes('antom'));
});

let antomOrder;
await test('initiate (ANTOM): order + signed session request', async () => {
    gatewayReply = () => ({ normalUrl: 'https://antom.example.com/pay/xyz', result: { resultStatus: 'A' } });
    const res = await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'Student@Example.com', customerName: 'Stu Dent', amount: 49.5 });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.checkoutUrl, 'https://antom.example.com/pay/xyz');
    antomOrder = data.orderId;

    const doc = store.get(antomOrder);
    assert.equal(doc.gateway, 'ANTOM'); assert.equal(doc.amount, 49.5); assert.equal(doc.userEmail, 'student@example.com');

    const call = outgoing.at(-1);
    const sent = JSON.parse(call.init.body);
    assert.equal(sent.paymentAmount.value, '4950');
    assert.equal(sent.paymentRequestId, antomOrder);
    assert.equal(sent.paymentNotifyUrl, 'https://server.example.com/api/payments/webhook/antom');
    assert.equal(sent.paymentRedirectUrl, `http://localhost:3000/payment-return?orderId=${antomOrder}`);

    // our request signature must verify with the matching public key
    const { parseSignatureHeader, verifyAntomSignature } = await import('../src/modules/payment-services/antom.crypto.js');
    const ok = verifyAntomSignature({
        httpMethod: 'POST', requestPath: new URL(call.url).pathname, clientId: call.init.headers['Client-Id'],
        requestTime: call.init.headers['Request-Time'], reqBody: call.init.body,
        signature: parseSignatureHeader(call.init.headers.Signature), publicKey: pubB64,
    });
    assert.ok(ok, 'outgoing Antom signature does not verify');
});

await test('Antom webhook with BAD signature -> 401, order untouched', async () => {
    const body = JSON.stringify({ notifyType: 'PAYMENT_RESULT', paymentRequestId: antomOrder, paymentId: 'P1', result: { resultStatus: 'S' }, paymentAmount: { value: '4950', currency: 'USD' } });
    const res = await post('/api/payments/webhook/antom', body, { 'Client-Id': 'TEST_CLIENT', 'Request-Time': new Date().toISOString(), Signature: 'algorithm=RSA256,keyVersion=1,signature=AAAA' });
    assert.equal(res.status, 401);
    assert.equal(store.get(antomOrder).paymentStatus, 'PENDING');
});

await test('Antom webhook with WRONG amount -> access NOT granted', async () => {
    const body = JSON.stringify({ notifyType: 'PAYMENT_RESULT', paymentRequestId: antomOrder, paymentId: 'P1', result: { resultStatus: 'S' }, paymentAmount: { value: '100', currency: 'USD' } });
    const res = await post('/api/payments/webhook/antom', body, await antomSign('/api/payments/webhook/antom', body));
    assert.equal(res.status, 200);
    assert.equal(store.get(antomOrder).paymentStatus, 'PENDING');
});

await test('Antom webhook, valid signature + amount -> SUCCESS + ack', async () => {
    const body = JSON.stringify({ notifyType: 'PAYMENT_RESULT', paymentRequestId: antomOrder, paymentId: 'P1', result: { resultStatus: 'S', resultCode: 'SUCCESS' }, paymentAmount: { value: '4950', currency: 'USD' } });
    const res = await post('/api/payments/webhook/antom', body, await antomSign('/api/payments/webhook/antom', body));
    const ack = await res.json();
    assert.equal(res.status, 200); assert.equal(ack.result.resultStatus, 'S');
    const doc = store.get(antomOrder);
    assert.equal(doc.paymentStatus, 'SUCCESS'); assert.equal(doc.isAccessGranted, true); assert.equal(doc.proofId, 'P1');
});

await test('already enrolled -> 409', async () => {
    const res = await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'student@example.com' });
    assert.equal(res.status, 409);
});

let cwOrder;
await test('initiate (CENTIWISE): form body + control hash', async () => {
    activeGateway = 'CENTIWISE';
    gatewayReply = () => ({ type: 'async-form-response', 'redirect-url': 'https://gate.centiwise.com/paynet/shop/pay/123', 'paynet-order-id': '9001' });
    const res = await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'cw@example.com', customerName: 'Cw User', amount: 20 });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.checkoutUrl, 'https://gate.centiwise.com/paynet/shop/pay/123');
    cwOrder = data.orderId;
    assert.equal(store.get(cwOrder).gatewayPaymentId, '9001');

    const call = outgoing.at(-1);
    assert.ok(call.url.endsWith('/paynet/api/v2/sale-form/107334'));
    const f = Object.fromEntries(call.init.body);
    assert.equal(f.amount, '20.00');
    assert.equal(f.control, sha1(`107334${cwOrder}2000cw@example.comAAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE`));
    assert.equal(f.server_callback_url, 'https://server.example.com/api/payments/webhook/centiwise');
    assert.equal(f.redirect_success_url, `http://localhost:3000/payment-success?orderId=${cwOrder}`);
    assert.equal(f.redirect_fail_url, `http://localhost:3000/payment-failed?orderId=${cwOrder}`);
});

await test('Centiwise callback with bad control -> 401', async () => {
    const res = await realFetch(`${base}/api/payments/webhook/centiwise`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: 'approved', orderid: '9001', client_orderid: cwOrder, control: 'deadbeef' }),
    });
    assert.equal(res.status, 401);
});

await test('Centiwise callback (POST form, valid control) -> SUCCESS + "OK"', async () => {
    const control = sha1(`approved9001${cwOrder}AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE`);
    const res = await realFetch(`${base}/api/payments/webhook/centiwise`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: 'approved', orderid: '9001', client_orderid: cwOrder, amount: '20.00', control }),
    });
    assert.equal(res.status, 200); assert.equal(await res.text(), 'OK');
    assert.equal(store.get(cwOrder).paymentStatus, 'SUCCESS');
});

await test('Centiwise declined callback (GET query) -> FAILED', async () => {
    activeGateway = 'CENTIWISE';
    gatewayReply = () => ({ 'redirect-url': 'https://gate.centiwise.com/x', 'paynet-order-id': '9002' });
    const d = await (await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'decl@example.com', amount: 10 })).json();
    const control = sha1(`declined9002${d.orderId}AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE`);
    const qs = new URLSearchParams({ status: 'declined', orderid: '9002', client_orderid: d.orderId, control, error_message: 'Card declined' });
    const res = await realFetch(`${base}/api/payments/webhook/centiwise?${qs}`);
    assert.equal(res.status, 200);
    assert.equal(store.get(d.orderId).paymentStatus, 'FAILED');
    assert.equal(store.get(d.orderId).failureReason, 'Card declined');
});

await test('status endpoint: pending order is re-checked with the gateway (Antom inquiry)', async () => {
    activeGateway = 'ANTOM';
    gatewayReply = () => ({ normalUrl: 'https://antom.example.com/pay/poll' });
    const d = await (await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'poll@example.com', amount: 5 })).json();
    gatewayReply = (url) => (url.includes('inquiryPayment') ? { result: { resultStatus: 'S' }, paymentStatus: 'SUCCESS', paymentId: 'P77' } : {});
    const r = await (await realFetch(`${base}/api/payments/status/${d.orderId}`)).json();
    assert.equal(r.data.paymentStatus, 'SUCCESS'); assert.equal(r.data.isAccessGranted, true);
});

await test('status endpoint: unknown order -> 404', async () => {
    const res = await realFetch(`${base}/api/payments/status/NOPE`);
    assert.equal(res.status, 404);
});

await test('invalid input rejected (bad course / email / amount)', async () => {
    assert.equal((await post('/api/payments/initiate', { courseId: 'abc', customerEmail: 'a@b.co' })).status, 400);
    assert.equal((await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'not-an-email' })).status, 400);
    assert.equal((await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'x@y.co', amount: -5 })).status, 400);
    assert.equal((await post('/api/payments/initiate', { courseId: COURSE_ID, customerEmail: 'x@y.co', amount: 1e9 })).status, 400);
});

await test('LEGACY create-pending + confirm-antom-payment (live frontend compatibility)', async () => {
    const orderId = `ORDER_${Date.now()}`;
    let res = await post('/api/orders/create-pending', { orderId, courseId: COURSE_ID, userEmail: 'old@example.com', userName: 'Old', gateway: 'Antom', amount: 30 });
    assert.equal(res.status, 201);
    assert.equal(store.get(orderId).gateway, 'ANTOM');

    // a forged "SUCCESS" must NOT grant access: the order is re-checked with Antom (still unpaid there)
    gatewayReply = () => ({ result: { resultStatus: 'F', resultCode: 'PAYMENT_NOT_EXIST' } });
    res = await post('/api/orders/confirm-antom-payment', { orderId, proofId: 'FAKE', gateway: 'Antom', status: 'SUCCESS' });
    assert.equal(res.status, 200);
    assert.equal(store.get(orderId).paymentStatus, 'PENDING');

    // once Antom really reports success, it is confirmed
    gatewayReply = () => ({ result: { resultStatus: 'S' }, paymentStatus: 'SUCCESS', paymentId: 'REAL1' });
    res = await post('/api/orders/confirm-antom-payment', { orderId, proofId: 'ignored' });
    assert.equal(res.status, 200);
    assert.equal(store.get(orderId).paymentStatus, 'SUCCESS');
});

server.close();
console.log(`\n${passed} passed${process.exitCode ? ', with FAILURES' : ''}`);
process.exit(process.exitCode || 0);
