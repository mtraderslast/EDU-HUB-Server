import { fromNodeHeaders } from "better-auth/node";

export const verifyToken = async (req, res, next) => {
    try {
        const auth = req.app.get("auth");

        if (!auth) {
            throw new Error("Better Auth instance not found in app configuration.");
        }

        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });

        console.log(session);

        if (!session || !session.user) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized! Please login first."
            });
        };

        req.user = {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            role: session.user.role,
            image: session.user.image,
        };

        next();

    } catch (error) {
        console.error("Auth Middleware Error:", error);
        return res.status(401).json({
            success: false,
            message: "Session invalid or expired."
        });
    }
}