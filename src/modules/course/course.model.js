import mongoose, { Schema, model } from 'mongoose';

const courseSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, 'Course title is required'],
            trim: true
        },
        category: {
            type: String,
            required: [true, 'Category is required'],
            trim: true,
            enum: {
                values: [
                    'Development',
                    'Technology',
                    'Creativity & Design',
                    'Professional Development',
                    'Sales & Marketing',
                    'Freelance Marketplace',
                    'Business',
                    'Personal Development',
                    'Language Learning',
                    'Teaching & Academic',
                    'Workshop & Live'
                ],
                message: '{VALUE} is not a valid category'
            }
        },
        description: {
            type: String,
            required: [true, 'Description is required']
        },
        image: {
            type: String,
            required: [true, 'Course thumbnail image URL is required']
        },
        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: [0, 'Price cannot be negative']
        },
        duration: {
            type: String,
            required: [true, 'Duration is required']
        },
        targetAudience: [
            {
                type: String,
                required: true
            }
        ],
        tags: [
            {
                type: String,
                trim: true
            }
        ],
        level: {
            type: String,
            enum: {
                values: ['Beginner', 'Intermediate', 'Advanced', 'All Levels'],
                message: '{VALUE} is not a valid level'
            },
            default: 'Beginner'
        },
        whatYouWillLearn: [
            {
                type: String,
                required: true
            }
        ],
        requirements: [
            {
                type: String,
                required: true
            }
        ],
        status: {
            type: String,
            enum: {
                values: ['Draft', 'Published', 'Archived'],
                message: '{VALUE} is not a valid status'
            },
            default: 'Published'
        },
        certificateProvided: {
            type: Boolean,
            default: true
        },
        ratingsAverage: {
            type: Number,
            default: 5,
            min: [0, 'Rating must be at least 0'],
            max: [5, 'Rating cannot be more than 5']
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

const Course = mongoose.model('Course', courseSchema);
export default Course;