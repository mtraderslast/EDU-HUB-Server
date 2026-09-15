import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

export const createAuth = (db) => {

    const origins = [
        process.env.FRONTEND_URL,
        "http://localhost:3000"
    ]

    return betterAuth({
        database: mongodbAdapter(db),

        baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",

        emailAndPassword: {
            enabled: true,
        },

        socialProviders: {
            google: {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
        },

        session: {
            fields: {
                user: ["role", "image", "phone", "address"]
            }
        },

        advanced: {
            defaultCookieAttributes: {
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                secure: process.env.NODE_ENV === "production" ? true : false,
                httpOnly: true,
            }
        },

        user: {
            additionalFields: {
                role: {
                    type: "string",
                    defaultValue: "user",
                },
                phone: {
                    type: "string",
                    defaultValue: "",
                },
                image: {
                    type: "string",
                    default: "",
                },
                address: {
                    type: "string",
                    defaultValue: "",
                },
            },
        },

        trustedOrigins: origins
    });
};