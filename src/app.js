import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { toNodeHandler } from "better-auth/node";
import ContactRoute from "./modules/contact/contact.route.js";
import CourseRoute from "./modules/course/course.route.js";
import RveiewRoute from "./modules/reviews/review.route.js";
import BlogRoutes from "./modules/blog/blog.route.js";
import EnrollmentRoutes from "./modules/enrollment/enrollment.route.js";
import PaymentRoutes from "./modules/paymentGateway/payment.routes.js";
import globalErrorHandler from "./utils/globalErrorHandler.js";

const createApp = (auth) => {
    const app = express();

    app.use(cors({
        origin: [
            process.env.FRONTEND_URL,
            "http://localhost:3000",
        ].filter(Boolean),
        credentials: true
    }));

    app.use(cookieParser());
    app.use(express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf.toString('utf8');
        }
    }));
    app.use(express.urlencoded({ extended: true }));

    app.all("/api/auth/*splat", toNodeHandler(auth));
    app.use("/api/course", CourseRoute);
    app.use("/api/reviews/", RveiewRoute);
    app.use("/api/contact", ContactRoute);
    app.use('/api/blogs', BlogRoutes);
    app.use('/api/orders', EnrollmentRoutes);
    app.use('/api/payments', PaymentRoutes);

    app.get("/", (req, res) => {
        res.send("EduHub server is running successfully");
    });

    app.use(globalErrorHandler);

    return app;
}

export default createApp;