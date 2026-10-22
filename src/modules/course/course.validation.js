import { z } from 'zod';

const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com'
]);

const isYouTubeUrl = (value) => {
    try {
        const parsed = new URL(value);
        const host = parsed.hostname.toLowerCase();

        if (!YOUTUBE_HOSTS.has(host)) {
            return false;
        }

        const normalizedHost = host.replace(/^www\./, '');
        const path = parsed.pathname;

        if (normalizedHost === 'youtu.be') {
            return path.replace(/^\//, '').length > 0;
        }

        return (
            parsed.searchParams.has('v') ||
            path.startsWith('/embed/') ||
            path.startsWith('/live/') ||
            path.startsWith('/shorts/') ||
            path.startsWith('/watch')
        );
    } catch {
        return false;
    }
};

const videoUrlSchema = z
    .string({
        required_error: 'YouTube video URL is required'
    })
    .trim()
    .url('Please provide a valid video URL')
    .refine(isYouTubeUrl, 'Please provide a valid YouTube video URL');

export const createCourseZodSchema = z.object({
    title: z
        .string({
            required_error: 'Course title is required'
        })
        .min(3, 'Title should be at least 3 characters')
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

    description: z
        .string({
            required_error: 'Description is required'
        })
        .min(10, 'Description should be at least 10 characters'),

    image: z
        .string({
            required_error: 'Course thumbnail image URL is required'
        })
        .url('Please provide a valid image URL'),

    videoUrl: videoUrlSchema,

    price: z
        .number({
            required_error: 'Price is required',
            invalid_type_error: 'Price must be a number'
        })
        .min(0, 'Price cannot be negative'),

    duration: z.string({
        required_error: 'Duration is required'
    }),

    targetAudience: z
        .array(z.string().min(1, 'Target audience item cannot be empty'))
        .min(1, 'At least one target audience is required'),

    tags: z.array(z.string().trim()).optional().default([]),

    level: z
        .enum(['Beginner', 'Intermediate', 'Advanced', 'All Levels'], {
            invalid_type_error: 'Select a valid level'
        })
        .default('Beginner'),

    whatYouWillLearn: z
        .array(z.string().min(1, 'Learning point cannot be empty'))
        .min(1, 'At least one "what you will learn" point is required'),

    requirements: z
        .array(z.string().min(1, 'Requirement item cannot be empty'))
        .min(1, 'At least one requirement is required'),

    status: z.enum(['Draft', 'Published', 'Archived']).optional(),

    certificateProvided: z.boolean().default(true),

    ratingsAverage: z
        .number()
        .min(0, 'Rating cannot be negative')
        .max(5, 'Rating cannot exceed 5')
        .default(0)
        .optional()
});

export const updateCourseZodSchema = createCourseZodSchema.partial();
