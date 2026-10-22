import mongoose from "mongoose";
import AppError from "../../utils/AppError.js";
import catchAsync from "../../utils/catchAsync.js";
import { ROLES } from "../../utils/roles.js";
import { FREE_GATEWAY, PAYMENT_STATUS } from "../payment-services/constants.js";
import { syncPendingPayment } from "../payment-services/paymentManager.js";
import Enrollment from "../enrollment/enrollment.model.js";
import { createCourseZodSchema, updateCourseZodSchema } from "./course.validation.js";
import Course from "./course.model.js";

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasCourseVideoAccess = async (user, courseId) => {
    if (!user?.email) {
        return false;
    }

    if (user.role === ROLES.ADMIN) {
        return true;
    }

    const email = String(user.email).trim();
    const enrollment = await Enrollment.findOne({
        courseId: String(courseId),
        userEmail: { $in: [email, email.toLowerCase()] },
        paymentStatus: PAYMENT_STATUS.SUCCESS,
        isAccessGranted: true
    }).select("_id");

    return Boolean(enrollment);
};

const toCoursePayload = (course, includeVideoUrl) => {
    const data = typeof course.toObject === "function" ? course.toObject() : { ...course };

    if (!includeVideoUrl) {
        delete data.videoUrl;
    }

    return data;
};

export const createCourse = catchAsync(async (req, res) => {
    const body = req.body;

    const parsed = createCourseZodSchema.safeParse(body);

    if (!parsed.success) {
        throw new AppError(400, `Validation failed: ${parsed.error.issues[0]?.message || 'Invalid input'}`);
    }

    const newCourse = await Course.create({
        ...parsed.data,
        status: "Published",
        ratingsAverage: 5,
    });

    return res.status(201).json({
        success: true,
        message: "New Course Created Successfully",
        data: newCourse,
    });
});

export const getAllCourses = catchAsync(async (req, res) => {
    const { search, category, minPrice, maxPrice, page = 1, limit = 12, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const query = {
        status: 'Published'
    };

    if (search) {
        query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }

    if (category) {
        query.category = category;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
        query.price = {};
        if (minPrice !== undefined) query.price.$gte = Number(minPrice);
        if (maxPrice !== undefined) query.price.$lte = Number(maxPrice);
    }

    const pageNumber = Math.max(1, Number(page));
    const limitNumber = Math.max(1, Number(limit));
    const skip = (pageNumber - 1) * limitNumber;

    const sortOptions = { createdAt: -1 };
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const courses = await Course.find(query)
        .select('_id title category description image price level')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNumber);

    const totalCourses = await Course.countDocuments(query);
    const totalPages = Math.ceil(totalCourses / limitNumber);

    return res.status(200).json({
        success: true,
        message: "Courses fetched successfully",
        meta: {
            page: pageNumber,
            limit: limitNumber,
            total: totalCourses,
            totalPages: totalPages
        },
        data: courses
    });
});

export const getMyCourses = catchAsync(async (req, res) => {
    const userEmail = String(req.user?.email || '').trim();

    if (!userEmail) {
        throw new AppError(401, 'Please login to view your enrolled courses');
    }

    const enrollmentQuery = {
        userEmail: { $regex: `^${escapeRegex(userEmail)}$`, $options: 'i' },
        paymentStatus: { $in: [PAYMENT_STATUS.SUCCESS, PAYMENT_STATUS.PENDING] }
    };

    let enrollments = await Enrollment.find(enrollmentQuery).sort({ createdAt: -1 });

    const pendingToSync = enrollments.filter(
        (enrollment) =>
            enrollment.paymentStatus === PAYMENT_STATUS.PENDING &&
            enrollment.gateway &&
            enrollment.gateway !== FREE_GATEWAY
    );

    if (pendingToSync.length) {
        await Promise.all(pendingToSync.map((enrollment) => syncPendingPayment(enrollment, { silent: true })));
        enrollments = await Enrollment.find(enrollmentQuery).sort({ createdAt: -1 });
    }

    enrollments = enrollments.map((enrollment) =>
        typeof enrollment.toObject === 'function' ? enrollment.toObject() : enrollment
    );

    if (!enrollments.length) {
        return res.status(200).json({
            success: true,
            message: 'No enrolled courses found',
            data: []
        });
    }

    const courseObjectIds = enrollments
        .map((enrollment) => enrollment.courseId)
        .filter((courseId) => mongoose.isValidObjectId(courseId))
        .map((courseId) => new mongoose.Types.ObjectId(courseId));

    const courses = courseObjectIds.length
        ? await Course.find({ _id: { $in: courseObjectIds } }).lean()
        : [];

    const courseMap = new Map(courses.map((course) => [String(course._id), course]));

    const enrolledCourses = enrollments.map((enrollment) => {
        const course = courseMap.get(String(enrollment.courseId));

        return {
            _id: enrollment._id,
            orderId: enrollment.orderId,
            courseId: enrollment.courseId,
            userEmail: enrollment.userEmail,
            userName: enrollment.userName,
            proofId: enrollment.proofId,
            gateway: enrollment.gateway,
            paymentStatus: enrollment.paymentStatus,
            isAccessGranted: enrollment.isAccessGranted,
            createdAt: enrollment.createdAt,
            courseDetails: course
                ? {
                    _id: course._id,
                    title: course.title,
                    category: course.category,
                    image: course.image,
                    price: course.price,
                    duration: course.duration,
                    tags: course.tags,
                    level: course.level,
                    whatYouWillLearn: course.whatYouWillLearn,
                    certificateProvided: course.certificateProvided,
                    ratingsAverage: course.ratingsAverage,
                    videoUrl: course.videoUrl
                }
                : {
                    _id: enrollment.courseId,
                    title: 'Course unavailable',
                    category: '',
                    image: '',
                    price: enrollment.amount || 0
                }
        };
    });

    return res.status(200).json({
        success: true,
        message: enrolledCourses.length
            ? 'Enrolled courses retrieved successfully'
            : 'No enrolled courses found',
        data: enrolledCourses
    });
});

export const getCourseById = catchAsync(async (req, res) => {
    const { id } = req.params;

    const course = await Course.findById(id);

    if (!course) {
        throw new AppError(404, 'Course not found with the provided ID');
    }

    const includeVideoUrl = await hasCourseVideoAccess(req.user, course._id);

    return res.status(200).json({
        success: true,
        message: 'Course details retrieved successfully',
        data: toCoursePayload(course, includeVideoUrl)
    });
});

export const getEnrolledCourseContent = catchAsync(async (req, res) => {
    const { id } = req.params;

    const course = await Course.findById(id);

    if (!course) {
        throw new AppError(404, 'Course not found with the provided ID');
    }

    const includeVideoUrl = await hasCourseVideoAccess(req.user, course._id);

    if (!includeVideoUrl) {
        throw new AppError(403, 'Enroll in this course to access the video');
    }

    return res.status(200).json({
        success: true,
        message: 'Course content retrieved successfully',
        data: toCoursePayload(course, true)
    });
});

export const updateCourse = catchAsync(async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    const isCourseExist = await Course.findById(id);
    if (!isCourseExist) {
        throw new AppError(404, 'Course not found to update');
    }

    const parsed = updateCourseZodSchema.safeParse(body);

    if (!parsed.success) {
        throw new AppError(400, `Validation failed: ${parsed.error.issues[0]?.message || 'Invalid input'}`);
    }

    const updates = Object.fromEntries(
        Object.entries(parsed.data).filter(([key]) => Object.prototype.hasOwnProperty.call(body, key))
    );

    const updatedCourse = await Course.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
    );

    return res.status(200).json({
        success: true,
        message: 'Course updated successfully',
        data: updatedCourse
    });
});

export const deleteCourse = catchAsync(async (req, res) => {
    const { id } = req.params;

    const deletedCourse = await Course.findByIdAndDelete(id);

    if (!deletedCourse) {
        throw new AppError(404, 'Course not found to delete');
    }

    return res.status(200).json({
        success: true,
        message: 'Course deleted successfully',
        data: null
    });
});
