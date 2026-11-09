const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error(
        "SESSION_SECRET must contain at least 32 characters"
    );
}

const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    // Store sessions in MySQL
    createDatabaseTable: true,

    // Remove expired sessions periodically
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,

    // Session lifetime: 24 hours
    expiration: 24 * 60 * 60 * 1000,

    // Use encrypted connections to Aiven
    ssl: {
        ca: require("fs").readFileSync(
            path.resolve(__dirname, process.env.DB_SSL_CA),
            "utf8"
        ),
        rejectUnauthorized: true
    }
});

const sessionMiddleware = session({
    name: "haven.sid",
    secret: process.env.SESSION_SECRET,
    store: sessionStore,

    resave: false,
    saveUninitialized: false,

    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000
    }
});

module.exports = sessionMiddleware;