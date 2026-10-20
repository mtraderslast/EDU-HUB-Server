import mongoose from 'mongoose';
import { GATEWAYS } from '../payment-services/constants.js';

const paymentGatewaySchema = new mongoose.Schema(
    {
        activeGateway: {
            type: String,
            enum: Object.values(GATEWAYS),
            default: GATEWAYS.ANTOM,
        },
    },
    { timestamps: true }
);

const PaymentGatewayConfig = mongoose.model('PaymentGatewayConfig', paymentGatewaySchema);
export default PaymentGatewayConfig;
