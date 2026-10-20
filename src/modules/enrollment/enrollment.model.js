import mongoose from 'mongoose';

const enrollmentSchema = new mongoose.Schema(
    {
        orderId: {
            type: String,
            required: true,
            unique: true
        },
        courseId: {
            type: String,
            required: true
        },
        userEmail: {
            type: String,
            required: true
        },
        userName: {
            type: String,
            default: 'Guest'
        },
        proofId: {
            type: String,
            default: ''
        },
        gateway: {
            type: String,
            default: ''
        },
        gatewayPaymentId: {
            type: String,
            default: ''
        },
        amount: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            default: 'USD'
        },
        paymentStatus: {
            type: String,
            enum: ['PENDING', 'SUCCESS', 'FAILED'],
            default: 'PENDING'
        },
        failureReason: {
            type: String,
            default: ''
        },
        isAccessGranted: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

enrollmentSchema.index({ userEmail: 1, courseId: 1, paymentStatus: 1 });

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

export default Enrollment;
