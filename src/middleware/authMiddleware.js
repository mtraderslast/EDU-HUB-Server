import { fromNodeHeaders } from "better-auth/node";

const hasSessionCookie = (req) =>
    Boolean(req.headers.cookie && /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(req.headers.cookie));

export const optionalAuth = async (req, res, next) => {
    try {
        if (!hasSessionCookie(req)) {
            return next();
        }

        const auth = req.app.get("auth");

        if (auth) {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(req.headers),
            });

            if (session?.user) {
                req.user = {
                    id: session.user.id,
                    name: session.user.name,
                    email: session.user.email,
                    role: session.user.role,
                    image: session.user.image,
                };
            }
        }
    } catch (error) {
        console.error("Optional auth error:", error.message);
    }

    next();
};

export const verifyToken = async (req, res, next) => {
    try {
        const auth = req.app.get("auth");

        if (!auth) {
            throw new Error("Better Auth instance not found in app configuration.");
        }

        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });

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