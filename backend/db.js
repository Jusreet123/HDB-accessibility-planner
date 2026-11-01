
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

// Check that the required settings exist
const requiredSettings = [
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
    "DB_SSL_CA"
];

for (const setting of requiredSettings) {
    if (!process.env[setting]) {
        throw new Error(`Missing database setting: ${setting}`);
    }
}

// Read Aiven's CA certificate
const certificatePath = path.resolve(
    __dirname,
    process.env.DB_SSL_CA
);

const caCertificate = fs.readFileSync(
    certificatePath,
    "utf8"
);

// Create a reusable MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    ssl: {
        ca: caCertificate,
        rejectUnauthorized: true
    },

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;