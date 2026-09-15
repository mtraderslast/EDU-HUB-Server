import mongoose, { Schema, model } from 'mongoose';

const blogSchema = new Schema(
    {
        title: {
            type: String,
            required: [true, 'Title is required'],
            trim: true
        },
        description: {
            type: String,
            required: [true, 'Excerpt is required'],
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
        coverImage: {
            type: String,
            required: [true, 'Cover image URL is required'],
            trim: true
        },
        authorimage: {
            type: String,
            required: [true, 'Author avatar URL is required'],
            trim: true
        },
        authorName: {
            type: String,
            required: [true, 'Author name is required'],
            trim: true
        },
        featured: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

const Blog = model('Blog', blogSchema);
export default Blog;