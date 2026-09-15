import mongoose from "mongoose";
import AppError from "../../utils/AppError.js";
import catchAsync from "../../utils/catchAsync.js";
import Course from "../course/course.model.js";
import Review from "./review.model.js";

export const createReview = catchAsync(async (req, res) => {
    const { courseId, rating, comment } = req.body;
    const userId = req.user?.id;

    if (!courseId || !rating || !comment) {
        throw new AppError(400, "Course ID, rating, and comment are required");
    }

    const course = await Course.findById(courseId);
    if (!course) {
        throw new AppError(404, "Course not found");
    }

    const user = await mongoose.connection.collection("user").findOne(
        { _id: new mongoose.Types.ObjectId(userId) }
    );

    if (!user) {
        throw new AppError(404, "User profile not found")
    }

    const existingReview = await Review.findOne({ courseId, userId: userId });

    if (existingReview) {
        throw new AppError(400, "You have already submitted a review for this Course");
    }

    const newReview = await Review.create({
        courseId,
        userId: userId,
        userName: user.name || "Anonymous",
        userEmail: user.email,
        userImage: user.image || "",
        rating: Number(rating),
        comment
    });

    res.status(201).json({
        success: true,
        message: "Review submitted successfully",
        data: newReview
    });
});

export const getCourseReviews = catchAsync(async (req, res) => {
    const { courseyId } = req.params;

    const reviews = await Review.find({ courseyId }).sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        message: "Course reviews fetched successfully",
        count: reviews.length,
        data: reviews
    });
});

export const deleteReview = catchAsync(async (req, res) => {
    const { id } = req.params;
    const userId = req.user?.id;

    const review = await Review.findById(id);
    if (!review) {
        throw new AppError(404, "Review not found");
    }

    if (review.userId.toString() !== userId) {
        throw new AppError(403, "You are not authorized to delete this review");
    }

    await Review.findByIdAndDelete(id);

    res.status(200).json({
        success: true,
        message: "Review deleted successfully"
    });
});

export const getHomePageReviews = catchAsync(async (req, res) => {
    const homePageReviews = await Review.find({ rating: 5 })
        .sort({ createdAt: 1 })
        .limit(8);

    res.status(200).json({
        success: true,
        message: "Home page reviews fetched successfully",
        count: homePageReviews.length,
        data: homePageReviews
    });
});