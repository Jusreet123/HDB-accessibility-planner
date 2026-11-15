
const express = require("express");
const path = require("path");
const pool = require("./db");
const { connectMongoDB, getMongoDB } = require("./mongo");

const amenitiesRouter = require("./routes/amenities");
const townsRouter = require("./routes/towns");
const insightsRouter = require("./routes/insights");
const authRouter = require("./routes/auth");
const wishlistRouter = require("./routes/wishlist");
const { router: notesRouter, ensureNotesCollection } = require("./routes/notes");

const sessionMiddleware = require("./session");
const passport = require("./googleAuth");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

const app = express();

// ==========================================
// RENDER HTTPS / GOOGLE LOGIN FIX
// ==========================================

// Trust Render's reverse proxy so secure
// session cookies work correctly over HTTPS.
if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

const PORT = process.env.PORT || 3000;

// ==========================================
// 1. MIDDLEWARE
// ==========================================

app.use(express.json());

// Enable user sessions
app.use(sessionMiddleware);

// Initialize Google Passport authentication
app.use(passport.initialize());
app.use(passport.session());

// Haven authentication routes
app.use("/auth", authRouter);

// Authenticated HDB wishlist CRUD routes
app.use("/api/wishlist", wishlistRouter);

// MongoDB community notes CRUD (reading is public, writing needs login)
app.use("/api/notes", notesRouter);

// Serve Haven frontend
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

// ==========================================
// 2. HOMEPAGE
// ==========================================

app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
});

// ==========================================
// 3. MYSQL HEALTH CHECK API
// ==========================================

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            status: "success",
            message: "Haven backend is running!",
            database: "Connected to Aiven MySQL"
        });

    } catch (error) {
        console.error("Health check failed:", error.code);

        res.status(503).json({
            status: "error",
            message: "Database connection unavailable"
        });
    }
});

// ==========================================
// 4. MONGODB HEALTH CHECK API
// ==========================================

app.get("/api/mongodb/health", async (req, res) => {
    if (!process.env.MONGO_URI) {
        return res.status(503).json({
            status: "unavailable",
            message: "MongoDB URI is not configured"
        });
    }

    try {
        const mongoDb = getMongoDB();
        await mongoDb.command({ ping: 1 });

        res.json({
            status: "success",
            message: "Connected to MongoDB Atlas",
            database: "hdb"
        });

    } catch (error) {
        console.error(
            "MongoDB health check failed:",
            error.message
        );

        res.status(503).json({
            status: "error",
            message: "MongoDB connection unavailable"
        });
    }
});

// ==========================================
// 5. HDB TOWNS API
// ==========================================

app.use("/api/towns", townsRouter);
app.use("/api/insights", insightsRouter);

app.get("/api/towns", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM town ORDER BY town_name"
        );

        res.json({
            status: "success",
            count: rows.length,
            data: rows
        });

    } catch (error) {
        console.error("Town query failed:", error.code);

        res.status(500).json({
            status: "error",
            message: "Unable to retrieve towns"
        });
    }
});

// ==========================================
// 6. HDB RESALE SEARCH API
// ==========================================

app.get("/api/resale", async (req, res) => {
    try {
        const {
            search = "",
            town = "",
            flatType = "",
            minPrice = "",
            maxPrice = "",
            sort = "newest",
            page = "1"
        } = req.query;

        const pageNumber = Number(page);
        const min = minPrice === "" ? null : Number(minPrice);
        const max = maxPrice === "" ? null : Number(maxPrice);

        if (
            !Number.isSafeInteger(pageNumber) ||
            pageNumber < 1 ||
            (min !== null && (!Number.isFinite(min) || min < 0)) ||
            (max !== null && (!Number.isFinite(max) || max < 0)) ||
            (min !== null && max !== null && min > max)
        ) {
            return res.status(400).json({
                status: "error",
                message: "Invalid page or price range"
            });
        }

        const limit = 12;
        const offset = (pageNumber - 1) * limit;

        const conditions = [];
        const params = [];

        const keyword = String(search).trim();

        if (keyword) {
            conditions.push(
                "(CONCAT(b.blk_no, ' ', b.street_name) LIKE ? OR t.town_name LIKE ?)"
            );

            params.push(
                `%${keyword}%`,
                `%${keyword}%`
            );
        }

        if (town) {
            conditions.push("t.town_name = ?");
            params.push(town);
        }

        if (flatType) {
            conditions.push("ft.flat_type_name = ?");
            params.push(flatType);
        }

        if (min !== null) {
            conditions.push("r.resale_price >= ?");
            params.push(min);
        }

        if (max !== null) {
            conditions.push("r.resale_price <= ?");
            params.push(max);
        }

        const whereClause = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const sortOptions = {
            newest: "r.sale_date DESC, r.transaction_id DESC",
            oldest: "r.sale_date ASC, r.transaction_id ASC",
            priceLow: "r.resale_price ASC, r.transaction_id DESC",
            priceHigh: "r.resale_price DESC, r.transaction_id DESC"
        };

        const orderBy =
            sortOptions[sort] || sortOptions.newest;

        const joins = `
            FROM resale_transaction r
            INNER JOIN block b
                ON r.block_id = b.block_id
            INNER JOIN town t
                ON b.town_id = t.town_id
            INNER JOIN flat_type ft
                ON r.flat_type_id = ft.flat_type_id
        `;

        const countSql = `
            SELECT COUNT(*) AS total
            ${joins}
            ${whereClause}
        `;

        const [countRows] = await pool.query(
            countSql,
            params
        );

        const total = countRows[0].total;

        const dataSql = `
            SELECT
                r.transaction_id,
                r.block_id,
                r.sale_date,
                r.resale_price,
                r.floor_area_sqm,
                r.storey_range,
                r.remaining_lease_months,
                b.blk_no,
                b.street_name,
                b.postal,
                t.town_name,
                ft.flat_type_name
            ${joins}
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `;

        const [rows] = await pool.query(
            dataSql,
            [...params, limit, offset]
        );

        res.json({
            status: "success",
            total,
            page: pageNumber,
            pageSize: limit,
            totalPages: Math.ceil(total / limit),
            data: rows
        });

    } catch (error) {
        console.error(
            "Resale query failed:",
            error.code,
            error.message
        );

        res.status(500).json({
            status: "error",
            message: "Unable to retrieve resale transactions"
        });
    }
});

// ==========================================
// 7. HDB BLOCK SEARCH API
// ==========================================

app.get("/api/blocks", async (req, res) => {
    try {
        const search = String(
            req.query.search || ""
        ).trim();

        if (search.length > 100) {
            return res.status(400).json({
                status: "error",
                message: "Search term is too long"
            });
        }

        const keyword = `%${search}%`;

        const [rows] = await pool.query(
            `
            SELECT
                b.block_id,
                b.blk_no,
                b.street_name,
                b.postal,
                t.town_name
            FROM block b
            INNER JOIN town t
                ON b.town_id = t.town_id
            WHERE
                CONCAT(
                    b.blk_no,
                    ' ',
                    b.street_name
                ) LIKE ?
                OR t.town_name LIKE ?
                OR b.postal LIKE ?
            ORDER BY
                t.town_name,
                b.street_name,
                b.blk_no
            LIMIT 50
            `,
            [
                keyword,
                keyword,
                keyword
            ]
        );

        res.json({
            status: "success",
            count: rows.length,
            data: rows
        });

    } catch (error) {
        console.error(
            "Block search failed:",
            error.code,
            error.message
        );

        res.status(500).json({
            status: "error",
            message: "Unable to search HDB blocks"
        });
    }
});

// ==========================================
// 8. HDB BLOCK DETAILS API
// ==========================================

app.get("/api/blocks/:blockId", async (req, res) => {
    try {
        const blockId = Number(req.params.blockId);

        if (
            !Number.isSafeInteger(blockId) ||
            blockId <= 0
        ) {
            return res.status(400).json({
                status: "error",
                message: "Invalid block ID"
            });
        }

        const [blocks] = await pool.query(
            `
            SELECT
                b.block_id,
                b.blk_no,
                b.street_name,
                b.postal,
                b.year_completed,
                b.latitude,
                b.longitude,
                t.town_name
            FROM block b
            INNER JOIN town t
                ON b.town_id = t.town_id
            WHERE b.block_id = ?
            `,
            [blockId]
        );

        if (blocks.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "HDB block not found"
            });
        }

        const [statistics] = await pool.query(
            `
            SELECT
                COUNT(*) AS total_transactions,
                MIN(resale_price) AS lowest_price,
                MAX(resale_price) AS highest_price,
                ROUND(AVG(resale_price), 2) AS average_price
            FROM resale_transaction
            WHERE block_id = ?
            `,
            [blockId]
        );

        const [transactions] = await pool.query(
            `
            SELECT
                r.transaction_id,
                r.sale_date,
                r.resale_price,
                r.floor_area_sqm,
                r.storey_range,
                ft.flat_type_name
            FROM resale_transaction r
            INNER JOIN flat_type ft
                ON r.flat_type_id = ft.flat_type_id
            WHERE r.block_id = ?
            ORDER BY
                r.sale_date DESC,
                r.transaction_id DESC
            LIMIT 20
            `,
            [blockId]
        );

        res.json({
            status: "success",
            block: blocks[0],
            statistics: statistics[0],
            transactions
        });

    } catch (error) {
        console.error(
            "Block details query failed:",
            error.code,
            error.message
        );

        res.status(500).json({
            status: "error",
            message: "Unable to retrieve block details"
        });
    }
});

// ==========================================
// 9. MONGODB COLLECTIONS CHECK API
// ==========================================

app.get("/api/mongodb/collections", async (req, res) => {
    try {
        const mongoDb = getMongoDB();

        const collectionNames = [
            "childcare_centres",
            "hawker_centres",
            "bus_stops",
            "mrt_exits",
            "parks",
            "blocks"
        ];

        const collections = await Promise.all(
            collectionNames.map(async (name) => ({
                name,
                count: await mongoDb
                    .collection(name)
                    .countDocuments({})
            }))
        );

        res.json({
            status: "success",
            database: "hdb",
            collections
        });

    } catch (error) {
        console.error(
            "MongoDB collections check failed:",
            error.message
        );

        res.status(503).json({
            status: "error",
            message: "Unable to retrieve MongoDB collections"
        });
    }
});

// ==========================================
// 10. NEARBY AMENITIES API
// ==========================================

app.use("/api/blocks", amenitiesRouter);

// ==========================================
// 11. TEMPORARY BUS STOP DATA INSPECTION
// ==========================================

// DEVELOPMENT ONLY
// Restricted to requests from the local machine.

app.get("/api/debug/bus-stop-sample", async (req, res) => {

    const remoteAddress = req.socket.remoteAddress || "";

    const isLocal =
        remoteAddress === "127.0.0.1" ||
        remoteAddress === "::1" ||
        remoteAddress === "::ffff:127.0.0.1";

    if (!isLocal) {
        return res.status(403).json({
            status: "error",
            message: "This debugging endpoint is only available locally"
        });
    }

    try {
        const mongoDb = getMongoDB();

        const sample = await mongoDb
            .collection("bus_stops")
            .findOne(
                {},
                {
                    projection: {
                        _id: 0
                    }
                }
            );

        if (!sample) {
            return res.status(404).json({
                status: "error",
                message: "No bus stop records found"
            });
        }

        res.json({
            status: "success",
            sample
        });

    } catch (error) {
        console.error(
            "Bus stop inspection failed:",
            error.message
        );

        res.status(500).json({
            status: "error",
            message: "Unable to inspect bus stop data"
        });
    }
});

// ==========================================
// 12. TEMPORARY HAWKER CENTRE DATA INSPECTION
// ==========================================

// DEVELOPMENT ONLY
// Restricted to requests from the local machine.

app.get("/api/debug/hawker-sample", async (req, res) => {

    const remoteAddress = req.socket.remoteAddress || "";

    const isLocal =
        remoteAddress === "127.0.0.1" ||
        remoteAddress === "::1" ||
        remoteAddress === "::ffff:127.0.0.1";

    if (!isLocal) {
        return res.status(403).json({
            status: "error",
            message: "This debugging endpoint is only available locally"
        });
    }

    try {
        const mongoDb = getMongoDB();

        const sample = await mongoDb
            .collection("hawker_centres")
            .findOne(
                {},
                {
                    projection: {
                        _id: 0
                    }
                }
            );

        if (!sample) {
            return res.status(404).json({
                status: "error",
                message: "No hawker centre records found"
            });
        }

        return res.json({
            status: "success",
            sample
        });

    } catch (error) {
        console.error(
            "Hawker centre inspection failed:",
            error.message
        );

        return res.status(500).json({
            status: "error",
            message: "Unable to inspect hawker centre data"
        });
    }
});

// ==========================================
// 13. START HAVEN SERVER
// ==========================================

app.listen(PORT, () => {
    console.log("-----------------------------------");
    console.log("Haven backend started successfully!");
    console.log(`Website: http://localhost:${PORT}`);
    console.log(`MySQL Health: http://localhost:${PORT}/api/health`);
    console.log(`MongoDB Health: http://localhost:${PORT}/api/mongodb/health`);
    console.log(`MongoDB Collections: http://localhost:${PORT}/api/mongodb/collections`);
    console.log(`Towns: http://localhost:${PORT}/api/towns`);
    console.log(`Resale: http://localhost:${PORT}/api/resale`);
    console.log(`Block Search: http://localhost:${PORT}/api/blocks?search=ang%20mo%20kio`);
    console.log(`Block Details: http://localhost:${PORT}/api/blocks/1715`);
    console.log(`Nearby Amenities: http://localhost:${PORT}/api/blocks/1715/amenities?radius=500`);
    console.log(`Wishlist: http://localhost:${PORT}/api/wishlist`);
    console.log(`Bus Stop Sample: http://localhost:${PORT}/api/debug/bus-stop-sample`);
    console.log(`Hawker Sample: http://localhost:${PORT}/api/debug/hawker-sample`);
    console.log("-----------------------------------");

        connectMongoDB()
        .then((mongoDb) => (mongoDb ? ensureNotesCollection(mongoDb) : null))
        .catch((error) => {
            console.error(
                "Unexpected MongoDB startup error:",
                error.message
            );
        });
});