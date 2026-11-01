
const express = require("express");
const path = require("path");
const pool = require("./db");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. MIDDLEWARE
// ==========================================

app.use(express.json());

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
// 3. HEALTH CHECK API
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
// 4. HDB TOWNS API
// ==========================================

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
// 5. HDB RESALE SEARCH API
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

        // Validate page number and price range
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

        // Search by block address or town
        const keyword = String(search).trim();

        if (keyword) {
            conditions.push(
                "(CONCAT(b.blk_no, ' ', b.street_name) LIKE ? OR t.town_name LIKE ?)"
            );

            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        // Filter by town
        if (town) {
            conditions.push("t.town_name = ?");
            params.push(town);
        }

        // Filter by flat type
        if (flatType) {
            conditions.push("ft.flat_type_name = ?");
            params.push(flatType);
        }

        // Filter by minimum resale price
        if (min !== null) {
            conditions.push("r.resale_price >= ?");
            params.push(min);
        }

        // Filter by maximum resale price
        if (max !== null) {
            conditions.push("r.resale_price <= ?");
            params.push(max);
        }

        const whereClause = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        // Allowed sorting options
        const sortOptions = {
            newest: "r.sale_date DESC, r.transaction_id DESC",
            oldest: "r.sale_date ASC, r.transaction_id ASC",
            priceLow: "r.resale_price ASC, r.transaction_id DESC",
            priceHigh: "r.resale_price DESC, r.transaction_id DESC"
        };

        const orderBy = sortOptions[sort] || sortOptions.newest;

        // Join resale records with blocks, towns and flat types
        const joins = `
            FROM resale_transaction r
            INNER JOIN block b
                ON r.block_id = b.block_id
            INNER JOIN town t
                ON b.town_id = t.town_id
            INNER JOIN flat_type ft
                ON r.flat_type_id = ft.flat_type_id
        `;

        // Count matching transactions
        const countSql = `
            SELECT COUNT(*) AS total
            ${joins}
            ${whereClause}
        `;

        const [countRows] = await pool.query(countSql, params);
        const total = countRows[0].total;

        // Retrieve matching resale transactions
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
// 6. HDB BLOCK DETAILS API
// ==========================================

app.get("/api/blocks/:blockId", async (req, res) => {
    try {
        const blockId = Number(req.params.blockId);

        // Validate block ID
        if (!Number.isSafeInteger(blockId) || blockId <= 0) {
            return res.status(400).json({
                status: "error",
                message: "Invalid block ID"
            });
        }

        // Retrieve block information
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

        // Retrieve historical resale statistics
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

        // Retrieve 20 most recent resale transactions
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
// 7. START HAVEN SERVER
// ==========================================

app.listen(PORT, () => {
    console.log("-----------------------------------");
    console.log("Haven backend started successfully!");
    console.log(`Website: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
    console.log(`Towns: http://localhost:${PORT}/api/towns`);
    console.log(`Resale: http://localhost:${PORT}/api/resale`);
    console.log(`Block Details: http://localhost:${PORT}/api/blocks/1715`);
    console.log("-----------------------------------");
});