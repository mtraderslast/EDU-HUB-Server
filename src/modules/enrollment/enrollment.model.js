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
            default: 'Antom'
        },
        amount: {
            type: Number,
            required: true
        },
        paymentStatus: {
            type: String,
            enum: ['PENDING', 'SUCCESS', 'FAILED'],
            default: 'PENDING'
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

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

export default Enrollment;