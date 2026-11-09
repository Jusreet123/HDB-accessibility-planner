const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const pool = require("./db");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

// ==========================================
// 1. GOOGLE OAUTH STRATEGY
// ==========================================

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
            state: true
        },

        async (accessToken, refreshToken, profile, done) => {
            let connection;
            let transactionStarted = false;

            try {
                // ==========================================
                // 2. EXTRACT GOOGLE ACCOUNT DETAILS
                // ==========================================

                const googleId = profile.id;

                const googleEmail = profile.emails?.[0]?.value
                    ?.trim()
                    .toLowerCase();

                const displayName =
                    profile.displayName?.trim() || "Haven User";

                // Check Google's email verification status
                const emailVerified =
                    profile._json?.email_verified === true ||
                    profile._json?.verified_email === true;

                if (!googleId || !googleEmail || !emailVerified) {
                    return done(null, false, {
                        message: "Google email verification is required"
                    });
                }

                // ==========================================
                // 3. CONNECT TO AIVEN MYSQL
                // ==========================================

                connection = await pool.getConnection();

                await connection.beginTransaction();
                transactionStarted = true;

                // ==========================================
                // 4. CHECK EXISTING GOOGLE ACCOUNT
                // ==========================================

                const [existingGoogleUsers] =
                    await connection.execute(
                        `SELECT
                            u.user_id,
                            u.username,
                            u.email
                         FROM users u
                         INNER JOIN user_auth_methods a
                            ON u.user_id = a.user_id
                         WHERE a.provider = 'google'
                           AND a.provider_user_id = ?
                         LIMIT 1`,
                        [googleId]
                    );

                if (existingGoogleUsers.length > 0) {
                    await connection.commit();
                    transactionStarted = false;

                    return done(null, existingGoogleUsers[0]);
                }

                // ==========================================
                // 5. PREVENT UNSAFE ACCOUNT LINKING
                // ==========================================

                const [existingEmailUsers] =
                    await connection.execute(
                        `SELECT user_id
                         FROM users
                         WHERE email = ?
                         LIMIT 1`,
                        [googleEmail]
                    );

                if (existingEmailUsers.length > 0) {
                    await connection.rollback();
                    transactionStarted = false;

                    return done(null, false, {
                        message:
                            "An account with this email already exists"
                    });
                }

                // ==========================================
                // 6. CREATE NEW HAVEN USER
                // ==========================================

                const cleanUsername =
                    displayName.slice(0, 100);

                const [result] =
                    await connection.execute(
                        `INSERT INTO users
                            (username, email)
                         VALUES (?, ?)`,
                        [cleanUsername, googleEmail]
                    );

                const newUserId = result.insertId;

                // ==========================================
                // 7. SAVE GOOGLE AUTHENTICATION METHOD
                // ==========================================

                await connection.execute(
                    `INSERT INTO user_auth_methods
                        (user_id, provider, provider_user_id)
                     VALUES (?, 'google', ?)`,
                    [newUserId, googleId]
                );

                // ==========================================
                // 8. COMMIT ACCOUNT CREATION
                // ==========================================

                await connection.commit();
                transactionStarted = false;

                return done(null, {
                    user_id: newUserId,
                    username: cleanUsername,
                    email: googleEmail
                });

            } catch (error) {

                // Roll back unfinished database changes
                if (connection && transactionStarted) {
                    try {
                        await connection.rollback();
                    } catch (rollbackError) {
                        console.error(
                            "Google OAuth rollback failed:",
                            rollbackError.code
                        );
                    }
                }

                console.error(
                    "Google OAuth authentication failed:",
                    error.code || error.message
                );

                return done(error);

            } finally {

                // Always release the MySQL connection
                if (connection) {
                    connection.release();
                }
            }
        }
    )
);

// ==========================================
// 9. PASSPORT SESSION SERIALIZATION
// ==========================================

// Store only the Haven user ID
passport.serializeUser((user, done) => {
    done(null, user.user_id);
});

// ==========================================
// 10. PASSPORT SESSION DESERIALIZATION
// ==========================================

passport.deserializeUser(async (userId, done) => {
    try {
        const [rows] = await pool.execute(
            `SELECT
                user_id,
                username,
                email
             FROM users
             WHERE user_id = ?
             LIMIT 1`,
            [userId]
        );

        if (rows.length === 0) {
            return done(null, false);
        }

        return done(null, rows[0]);

    } catch (error) {
        console.error(
            "Google user deserialization failed:",
            error.code || error.message
        );

        return done(error);
    }
});

// ==========================================
// 11. EXPORT PASSPORT
// ==========================================

module.exports = passport;