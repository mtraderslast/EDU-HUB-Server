import AppError from '../../utils/AppError.js';

const gateways = new Map();

export const registerGateway = (gateway) => {
    if (!gateway?.name || typeof gateway.createSession !== 'function') {
        throw new Error('Invalid payment gateway strategy');
    }

    gateways.set(gateway.name.toUpperCase(), gateway);
};

export const getGateway = (name) => {
    const gateway = gateways.get(String(name || '').toUpperCase());
    if (!gateway) {
        throw new AppError(400, `Unsupported or unregistered payment gateway: ${name}`);
    }
    return gateway;
};

export const listRegisteredGateways = () => [...gateways.keys()];

export const isGatewayRegistered = (name) => gateways.has(String(name || '').toUpperCase());

export const describeGateways = () =>
    [...gateways.values()].map((gateway) => ({
        name: gateway.name,
        label: gateway.label || gateway.name,
        configured: typeof gateway.isConfigured === 'function' ? gateway.isConfigured() : true,
    }));
