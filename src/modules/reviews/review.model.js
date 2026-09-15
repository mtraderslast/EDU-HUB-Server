import mongoose, { Schema, model } from 'mongoose';

const reviewSchema = new Schema(
    {
        courseId: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: [true, 'Course ID is required']
        },
        userId: {
            type: String,
            required: true
        },
        userName: {
            type: String,
            require: true
        },
        userEmail: {
            type: String,
            require: true
        },
        userImage: {
            type: String,
            require: true
        },
        rating: {
            type: Number,
            required: [true, 'Rating is required'],
            min: [1, 'Rating must be at least 1'],
            max: [5, 'Rating cannot be more than 5']
        },
        comment: {
            type: String,
            required: [true, 'Comment is required']
        }
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const Review = mongoose.model('Review', reviewSchema);
export default Review;