import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { createAuth } from "./src/lib/auth.js";
import createApp from "./src/app.js";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Database connected successfully!");

        const auth = createAuth(mongoose.connection.getClient().db());
        const app = createApp(auth);
        app.set("auth", auth);


        app.listen(PORT, () => {
            console.log(`Server is running on port http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start the server:", error);
    }
};

startServer();