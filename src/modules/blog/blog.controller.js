import mongoose from "mongoose";
import AppError from "../../utils/AppError.js";
import catchAsync from "../../utils/catchAsync.js";
import Blog from "./blog.model.js";
import { createBlogZodSchema } from "./blog.validation.js";

export const createBlog = catchAsync(async (req, res) => {
    const body = req.body;

    const parsed = createBlogZodSchema.safeParse(body);

    if (!parsed.success) {
        throw new AppError(400, `Validation failed: ${parsed.error.issues[0]?.message || 'Invalid input'}`);
    }

    const newBlog = await Blog.create({
        ...parsed.data,
        authorName: req.user.name || "Ziaul Hoque",
        authorimage: req.user.image || "",
    });

    return res.status(201).json({
        success: true,
        message: "New Blog Created Successfully",
        data: newBlog,
    });
});

export const getAllBlogs = catchAsync(async (req, res) => {
    const { search, category, page = 1, limit = 12, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const query = {};

    if (search) {
        query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { excerpt: { $regex: search, $options: 'i' } },
            { author: { $regex: search, $options: 'i' } }
        ];
    }

    if (category) {
        query.category = category;
    }

    const pageNumber = Math.max(1, Number(page));
    const limitNumber = Math.max(1, Number(limit));
    const skip = (pageNumber - 1) * limitNumber;

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const blogs = await Blog.find(query)
        .select('_id slug title excerpt category coverImage authorAvatar author publishedDate readTime featured')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNumber);

    const totalBlogs = await Blog.countDocuments(query);
    const totalPages = Math.ceil(totalBlogs / limitNumber);

    return res.status(200).json({
        success: true,
        message: "Blogs fetched successfully",
        meta: {
            page: pageNumber,
            limit: limitNumber,
            total: totalBlogs,
            totalPages: totalPages
        },
        data: blogs
    });
});

export const getBlogDetails = catchAsync(async (req, res) => {
    const { id } = req.params;

    const blog = await Blog.findById(id);

    if (!blog) {
        throw new AppError(404, 'Blog not found with the provided ID');
    }

    return res.status(200).json({
        success: true,
        message: 'Blog details retrieved successfully',
        data: blog
    });
});

export const updateBlog = catchAsync(async (req, res) => {
    const { id } = req.params;
    const body = req.body;

    const isBlogExist = await Blog.findById(id);
    if (!isBlogExist) {
        throw new AppError(404, 'Blog not found to update');
    }

    const updatedBlog = await Blog.findByIdAndUpdate(
        id,
        { $set: body },
        { new: true, runValidators: true }
    );

    return res.status(200).json({
        success: true,
        message: 'Blog updated successfully',
        data: updatedBlog
    });
});

export const deleteBlog = catchAsync(async (req, res) => {
    const { id } = req.params;

    const deletedBlog = await Blog.findByIdAndDelete(id);

    if (!deletedBlog) {
        throw new AppError(404, 'Blog not found to delete');
    }

    return res.status(200).json({
        success: true,
        message: 'Blog deleted successfully',
        data: null
    });
});