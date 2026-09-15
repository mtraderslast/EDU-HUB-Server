import mongoose from "mongoose";
import AppError from "../../utils/AppError.js";
import catchAsync from "../../utils/catchAsync.js";
import { createCourseZodSchema } from "./course.validation.js";
import Course from "./course.model.js";


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

export const getCourseById = catchAsync(async (req, res) => {
    const { id } = req.params;

    const course = await Course.findById(id);

    if (!course) {
        throw new AppError(404, 'Course not found with the provided ID');
    }

    return res.status(200).json({
        success: true,
        message: 'Course details retrieved successfully',
        data: course
    });
});

export const updateCourse = catchAsync(async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    const isCourseExist = await Course.findById(id);
    if (!isCourseExist) {
        throw new AppError(404, 'Course not found to update');
    }

    const updatedCourse = await Course.findByIdAndUpdate(
        id,
        { $set: body },
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