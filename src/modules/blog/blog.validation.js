import { z } from 'zod';

export const createBlogZodSchema = z.object({
    title: z
        .string({
            required_error: 'Title is required'
        })
        .min(3, 'Title should be at least 3 characters')
        .trim(),

    description: z
        .string({
            required_error: 'Excerpt is required'
        })
        .trim(),

    category: z.enum(
        [
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
        {
            required_error: 'Category is required',
            invalid_type_error: 'Select a valid category'
        }
    ),

    coverImage: z
        .string({
            required_error: 'Cover image URL is required'
        })
        .url('Please provide a valid image URL')
        .trim(),

    featured: z.boolean().optional().default(true)
});