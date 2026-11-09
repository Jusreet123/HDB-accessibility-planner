
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const fs = require("fs");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

// ==========================================
// 1. VALIDATE SESSION SETTINGS
// ==========================================

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error(
        "SESSION_SECRET must contain at least 32 characters"
    );
}

if (!process.env.DB_SSL_CA) {
    throw new Error("Missing database setting: DB_SSL_CA");
}

// ==========================================
// 2. LOAD MYSQL SSL CERTIFICATE
// ==========================================

const sslCaSetting = process.env.DB_SSL_CA.trim();

let caCertificate;

// Convert escaped newlines into actual newlines
const normalizedCa = sslCaSetting.replace(/\\n/g, "\n");

if (normalizedCa.includes("BEGIN CERTIFICATE")) {
    // Render: certificate provided directly
    // through the environment variable
    caCertificate = normalizedCa;
} else {
    // Local development: certificate provided
    // as a filename, e.g. ca.pem
    const certificatePath = path.resolve(
        __dirname,
        sslCaSetting
    );

    caCertificate = fs.readFileSync(
        certificatePath,
        "utf8"
    );
}

// ==========================================
// 3. CREATE MYSQL SESSION STORE
// ==========================================

const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    // Automatically create the sessions table
    createDatabaseTable: true,

    // Remove expired sessions periodically
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,

    // Session lifetime: 24 hours
    expiration: 24 * 60 * 60 * 1000,

    // Secure connection to Aiven MySQL
    ssl: {
        ca: caCertificate,
        rejectUnauthorized: true
    }
});

// ==========================================
// 4. CONFIGURE EXPRESS SESSION
// ==========================================

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

// ==========================================
// 5. EXPORT SESSION MIDDLEWARE
// ==========================================

module.exports = sessionMiddleware;