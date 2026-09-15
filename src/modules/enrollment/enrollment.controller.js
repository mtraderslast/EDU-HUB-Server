import mongoose from "mongoose";
import AppError from "../../utils/AppError.js";
import catchAsync from "../../utils/catchAsync.js";
import Enrollment from "./enrollment.model.js";

export const createPendingOrder = catchAsync(async (req, res) => {
    const { orderId, courseId, userEmail, userName, gateway, amount } = req.body;

    if (!orderId || !courseId || !userEmail) {
        throw new AppError(400, "Missing required fields to initialize order");
    }

    const existingEnrollment = await Enrollment.findOne({ orderId });

    if (existingEnrollment) {
        return res.status(200).json({
            success: true,
            message: "Order already initialized",
            data: existingEnrollment,
        });
    }

    const newEnrollment = await Enrollment.create({
        orderId,
        courseId,
        userEmail,
        userName: userName || 'Guest',
        gateway: gateway || 'Antom',
        amount,
        paymentStatus: 'PENDING',
        isAccessGranted: false
    });

    return res.status(201).json({
        success: true,
        message: "Pending order created successfully",
        data: newEnrollment,
    });
});

export const confirmPayment = catchAsync(async (req, res) => {
    const { orderId, proofId, gateway, status } = req.body;

    if (!orderId || !proofId) {
        throw new AppError(400, "Missing required fields for enrollment confirmation");
    }

    const enrollment = await Enrollment.findOne({ orderId });

    if (!enrollment) {
        throw new AppError(404, "Order not found in database");
    }

    if (enrollment.paymentStatus === 'SUCCESS') {
        return res.status(200).json({
            success: true,
            message: "Payment already processed and recorded",
            data: enrollment,
        });
    }

    enrollment.proofId = proofId;
    if (gateway) enrollment.gateway = gateway;

    if (status === 'FAILED') {
        enrollment.paymentStatus = 'FAILED';
        enrollment.isAccessGranted = false;
    } else {
        enrollment.paymentStatus = 'SUCCESS';
        enrollment.isAccessGranted = true;
    }

    await enrollment.save();

    return res.status(200).json({
        success: true,
        message: "Payment status updated successfully",
        data: enrollment,
    });
});

export const getMyEnrolledCourses = catchAsync(async (req, res) => {
    const userEmail = req.user.email;

    const enrolledCourses = await Enrollment.aggregate([
        {
            $match: {
                userEmail: userEmail,
                paymentStatus: 'SUCCESS',
                isAccessGranted: true
            }
        },
        {
            $addFields: {
                courseObjectId: { $toObjectId: "$courseId" }
            }
        },
        {
            $lookup: {
                from: "courses",
                localField: "courseObjectId",
                foreignField: "_id",
                as: "courseDetails"
            }
        },
        {
            $unwind: "$courseDetails"
        },
        {
            $project: {
                _id: 1,
                orderId: 1,
                courseId: 1,
                userEmail: 1,
                userName: 1,
                proofId: 1,
                gateway: 1,
                paymentStatus: 1,
                isAccessGranted: 1,
                createdAt: 1,
                "courseDetails._id": 1,
                "courseDetails.title": 1,
                "courseDetails.category": 1,
                "courseDetails.image": 1,
                "courseDetails.price": 1,
                "courseDetails.duration": 1,
                "courseDetails.tags": 1,
                "courseDetails.level": 1,
                "courseDetails.whatYouWillLearn": 1,
                "courseDetails.certificateProvided": 1,
                "courseDetails.ratingsAverage": 1
            }
        }
    ]);

    if (!enrolledCourses || enrolledCourses.length === 0) {
        return res.status(200).json({
            success: true,
            message: "No enrolled courses found",
            data: [],
        });
    }

    return res.status(200).json({
        success: true,
        message: "Enrolled courses retrieved successfully",
        data: enrolledCourses,
    });
});

export const getAllEnrollmentsForAdmin = catchAsync(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const searchQuery = req.query.search || '';
    const status = req.query.status || 'ALL';

    const skip = (page - 1) * limit;
    const matchStage = {};

    if (searchQuery) {
        matchStage.proofId = { $regex: searchQuery, $options: 'i' };
    }

    if (status !== 'ALL') {
        matchStage.paymentStatus = status;
    }

    const result = await Enrollment.aggregate([
        { $match: matchStage },
        {
            $addFields: {
                courseObjectId: { $toObjectId: "$courseId" }
            }
        },
        {
            $lookup: {
                from: "courses",
                localField: "courseObjectId",
                foreignField: "_id",
                as: "courseDetails"
            }
        },
        {
            $unwind: {
                path: "$courseDetails",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                _id: 1,
                orderId: 1,
                userEmail: 1,
                userName: 1,
                proofId: 1,
                gateway: 1,
                amount: 1,
                paymentStatus: 1,
                isAccessGranted: 1,
                createdAt: 1,
                "courseDetails.title": 1,
                "courseDetails.image": 1,
                "courseDetails.category": 1
            }
        },
        { $sort: { createdAt: -1 } },
        {
            $facet: {
                metadata: [{ $count: "totalDocuments" }],
                data: [{ $skip: skip }, { $limit: limit }]
            }
        }
    ]);

    const total = result[0]?.metadata[0]?.totalDocuments || 0;
    const enrollments = result[0]?.data || [];

    res.status(200).json({
        success: true,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        data: enrollments
    });
});

export const deleteEnrollment = catchAsync(async (req, res) => {
    const { id } = req.params;

    const enrollment = await Enrollment.findById(id);

    if (!enrollment) {
        throw new AppError(404, 'Enrollment not found to delete');
    }

    if (enrollment.status === 'SUCCESS') {
        throw new AppError(400, 'Cannot delete an enrollment with status SUCCESS');
    }

    await Enrollment.findByIdAndDelete(id);

    return res.status(200).json({
        success: true,
        message: 'Enrollment deleted successfully',
        data: null
    });
})