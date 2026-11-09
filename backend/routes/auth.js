const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const passport = require("../googleAuth");

const router = express.Router();

// ==========================================
// 1. REGISTER A NEW USER
// POST /auth/register
// ==========================================

router.post("/register", async (req, res) => {
    const { username, email, password } = req.body || {};

    if (
        typeof username !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string"
    ) {
        return res.status(400).json({
            status: "error",
            message: "Username, email and password are required"
        });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (
        cleanUsername.length < 2 ||
        cleanUsername.length > 100 ||
        cleanEmail.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
        password.length < 8 ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        return res.status(400).json({
            status: "error",
            message: "Invalid username, email or password"
        });
    }

    let connection;

    try {
        const passwordHash = await bcrypt.hash(password, 12);

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [result] = await connection.execute(
            `INSERT INTO users (username, email)
             VALUES (?, ?)`,
            [cleanUsername, cleanEmail]
        );

        await connection.execute(
            `INSERT INTO user_auth_methods
                (user_id, provider, password_hash)
             VALUES (?, 'local', ?)`,
            [result.insertId, passwordHash]
        );

        await connection.commit();

        return res.status(201).json({
            status: "success",
            message: "Account created successfully",
            user: {
                user_id: result.insertId,
                username: cleanUsername,
                email: cleanEmail
            }
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error(
                    "Registration rollback failed:",
                    rollbackError.code
                );
            }
        }

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                status: "error",
                message: "An account with this email already exists"
            });
        }

        console.error("Registration failed:", error.code);

        return res.status(500).json({
            status: "error",
            message: "Unable to create account"
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// ==========================================
// 2. LOGIN WITH EMAIL AND PASSWORD
// POST /auth/login
// ==========================================

router.post("/login", async (req, res) => {
    const { email, password } = req.body || {};

    if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !email.trim() ||
        !password
    ) {
        return res.status(400).json({
            status: "error",
            message: "Email and password are required"
        });
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
        const [rows] = await pool.execute(
            `SELECT
                u.user_id,
                u.username,
                u.email,
                a.password_hash
             FROM users u
             INNER JOIN user_auth_methods a
                ON u.user_id = a.user_id
             WHERE u.email = ?
               AND a.provider = 'local'
             LIMIT 1`,
            [cleanEmail]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                status: "error",
                message: "Invalid email or password"
            });
        }

        const user = rows[0];

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                status: "error",
                message: "Invalid email or password"
            });
        }

        // Regenerate the session to prevent session fixation
        req.session.regenerate((sessionError) => {
            if (sessionError) {
                console.error(
                    "Session regeneration failed:",
                    sessionError
                );

                return res.status(500).json({
                    status: "error",
                    message: "Unable to complete login"
                });
            }

            // Store only the user ID in the session
            req.session.userId = user.user_id;

            req.session.save((saveError) => {
                if (saveError) {
                    console.error(
                        "Session save failed:",
                        saveError
                    );

                    return res.status(500).json({
                        status: "error",
                        message: "Unable to complete login"
                    });
                }

                return res.status(200).json({
                    status: "success",
                    message: "Login successful",
                    user: {
                        user_id: user.user_id,
                        username: user.username,
                        email: user.email
                    }
                });
            });
        });

    } catch (error) {
        console.error("Login failed:", error.code);

        return res.status(500).json({
            status: "error",
            message: "Unable to log in"
        });
    }
});
// ==========================================
// 3. GET CURRENT LOGGED-IN USER
// GET /auth/me
// ==========================================

router.get("/me", async (req, res) => {
    if (!req.session?.userId) {
        return res.status(401).json({
            status: "error",
            message: "Not authenticated"
        });
    }

    try {
        const [rows] = await pool.execute(
            `SELECT user_id, username, email
             FROM users
             WHERE user_id = ?
             LIMIT 1`,
            [req.session.userId]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                status: "error",
                message: "User not found"
            });
        }

        return res.status(200).json({
            status: "success",
            user: rows[0]
        });

    } catch (error) {
        console.error("Session verification failed:", error.code);

        return res.status(500).json({
            status: "error",
            message: "Unable to retrieve user"
        });
    }
});

 // ==========================================
 // 4. LOG OUT CURRENT USER
 // POST /auth/logout
 // ==========================================

router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.status(500).json({
            status: "error",
            message: "Session unavailable"
        });
    }

    req.session.destroy((error) => {
        if (error) {
            console.error("Logout failed:", error.code);

            return res.status(500).json({
                status: "error",
                message: "Unable to log out"
            });
        }

        res.clearCookie("haven.sid", {
            path: "/"
        });

        return res.status(200).json({
            status: "success",
            message: "Logged out successfully"
        });
    });
});

 // ==========================================
 // 5. GOOGLE SIGN-IN
 // GET /auth/google
 // ==========================================

router.get(
    "/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
        session: false
    })
);

// ==========================================
// 6. GOOGLE OAUTH CALLBACK
// GET /auth/google/callback
// ==========================================

router.get(
    "/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/?login=failed",
        session: false
    }),
    (req, res) => {
        // Regenerate the session to prevent session fixation
        req.session.regenerate((error) => {
            if (error) {
                console.error("Google session regeneration failed:", error);
                return res.status(500).send("Unable to complete Google login");
            }

            // Reuse the same session identity as manual login
            req.session.userId = req.user.user_id;

            req.session.save((saveError) => {
                if (saveError) {
                    console.error("Google session save failed:", saveError);
                    return res.status(500).send("Unable to complete Google login");
                }

                // Return to Haven homepage after successful sign-in
                return res.redirect("/");
            });
        });
    }
);

module.exports = router;