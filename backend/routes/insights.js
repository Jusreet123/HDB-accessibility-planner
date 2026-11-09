
const express = require("express");
const pool = require("../db");

const router = express.Router();

// ==========================================
// 1. FILTER HELPERS
// ==========================================

function getFilters(req) {
    const {
        town = "",
        flatType = "",
        startYear = "",
        endYear = ""
    } = req.query;

    const validText = value =>
        typeof value === "string" &&
        value.length <= 100;

    if (!validText(town) || !validText(flatType)) {
        throw new Error("Invalid town or flat type");
    }

    const parseYear = value => {
        if (value === "") return null;

        if (
            typeof value !== "string" ||
            !/^\d{4}$/.test(value)
        ) {
            throw new Error("Invalid year");
        }

        const year = Number(value);

        if (year < 1900 || year > 2100) {
            throw new Error("Year out of range");
        }

        return year;
    };

    const start = parseYear(startYear);
    const end = parseYear(endYear);

    if (
        start !== null &&
        end !== null &&
        start > end
    ) {
        throw new Error(
            "Start year cannot exceed end year"
        );
    }

    return {
        town: town.trim(),
        flatType: flatType.trim(),
        startYear: start,
        endYear: end
    };
}

function buildConditions(filters, options = {}) {
    const {
        includeTown = true,
        includeFlatType = true
    } = options;

    const conditions = [];
    const params = [];

    if (includeTown && filters.town) {
        conditions.push("t.town_name = ?");
        params.push(filters.town);
    }

    if (includeFlatType && filters.flatType) {
        conditions.push("ft.flat_type_name = ?");
        params.push(filters.flatType);
    }

    if (filters.startYear !== null) {
        conditions.push("r.sale_date >= ?");
        params.push(`${filters.startYear}-01-01`);
    }

    if (filters.endYear !== null) {
        conditions.push("r.sale_date < ?");
        params.push(`${filters.endYear + 1}-01-01`);
    }

    return {
        whereClause: conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "",
        conditions,
        params
    };
}

function handleError(error, res, message) {
    if (
        error.message === "Invalid town or flat type" ||
        error.message === "Invalid year" ||
        error.message === "Year out of range" ||
        error.message === "Start year cannot exceed end year"
    ) {
        return res.status(400).json({
            status: "error",
            message: error.message
        });
    }

    console.error(message, error.code, error.message);

    return res.status(500).json({
        status: "error",
        message
    });
}

// ==========================================
// 2. MARKET OVERVIEW
// ==========================================

// GET /api/insights/overview

router.get("/overview", async (req, res) => {
    try {
        const filters = getFilters(req);

        const {
            whereClause,
            params
        } = buildConditions(filters);

        const [rows] = await pool.query(`
            SELECT
                COUNT(r.transaction_id)
                    AS total_transactions,

                ROUND(AVG(r.resale_price), 2)
                    AS average_price,

                MIN(r.resale_price)
                    AS lowest_price,

                MAX(r.resale_price)
                    AS highest_price,

                COUNT(DISTINCT t.town_id)
                    AS total_towns,

                MIN(r.sale_date)
                    AS earliest_transaction,

                MAX(r.sale_date)
                    AS latest_transaction

            FROM resale_transaction r

            INNER JOIN block b
                ON r.block_id = b.block_id

            INNER JOIN town t
                ON b.town_id = t.town_id

            INNER JOIN flat_type ft
                ON r.flat_type_id = ft.flat_type_id

            ${whereClause}
        `, params);

        res.json({
            status: "success",
            data: rows[0]
        });

    } catch (error) {
        handleError(
            error,
            res,
            "Unable to retrieve market overview"
        );
    }
});

// ==========================================
// 3. ANNUAL RESALE PRICE TRENDS
// ==========================================

// GET /api/insights/trends

router.get("/trends", async (req, res) => {
    try {
        const filters = getFilters(req);

        const {
            conditions,
            params
        } = buildConditions(filters);

        const whereClause = [
            "r.sale_date IS NOT NULL",
            ...conditions
        ].join(" AND ");

        const [rows] = await pool.query(`
            SELECT
                YEAR(r.sale_date)
                    AS sale_year,

                COUNT(r.transaction_id)
                    AS total_transactions,

                ROUND(AVG(r.resale_price), 2)
                    AS average_price,

                MIN(r.resale_price)
                    AS lowest_price,

                MAX(r.resale_price)
                    AS highest_price

            FROM resale_transaction r

            INNER JOIN block b
                ON r.block_id = b.block_id

            INNER JOIN town t
                ON b.town_id = t.town_id

            INNER JOIN flat_type ft
                ON r.flat_type_id = ft.flat_type_id

            WHERE ${whereClause}

            GROUP BY YEAR(r.sale_date)

            ORDER BY sale_year ASC
        `, params);

        res.json({
            status: "success",
            count: rows.length,
            data: rows
        });

    } catch (error) {
        handleError(
            error,
            res,
            "Unable to retrieve resale price trends"
        );
    }
});

// ==========================================
// 4. FLAT-TYPE RESALE COMPARISON
// ==========================================

// GET /api/insights/flat-types
//
// Town and year filters apply.
// Flat-type filter is intentionally ignored
// so users can compare all flat types.

router.get("/flat-types", async (req, res) => {
    try {
        const filters = getFilters(req);

        const {
            conditions,
            params
        } = buildConditions(filters, {
            includeFlatType: false
        });

        const joinConditions = [
            "ft.flat_type_id = r.flat_type_id"
        ];

        if (filters.startYear !== null) {
            joinConditions.push("r.sale_date >= ?");
        }

        if (filters.endYear !== null) {
            joinConditions.push("r.sale_date < ?");
        }

        const joinParams = [];

        if (filters.startYear !== null) {
            joinParams.push(
                `${filters.startYear}-01-01`
            );
        }

        if (filters.endYear !== null) {
            joinParams.push(
                `${filters.endYear + 1}-01-01`
            );
        }

        // If a town is selected, restrict transactions
        // to blocks belonging to that town.
        if (filters.town) {
            joinConditions.push(`
                EXISTS (
                    SELECT 1
                    FROM block b
                    INNER JOIN town t
                        ON b.town_id = t.town_id
                    WHERE b.block_id = r.block_id
                      AND t.town_name = ?
                )
            `);

            joinParams.push(filters.town);
        }

        const [rows] = await pool.query(`
            SELECT
                ft.flat_type_id,
                ft.flat_type_name,

                COUNT(r.transaction_id)
                    AS total_transactions,

                ROUND(AVG(r.resale_price), 2)
                    AS average_price,

                MIN(r.resale_price)
                    AS lowest_price,

                MAX(r.resale_price)
                    AS highest_price,

                ROUND(AVG(r.floor_area_sqm), 2)
                    AS average_floor_area_sqm

            FROM flat_type ft

            LEFT JOIN resale_transaction r
                ON ${joinConditions.join(" AND ")}

            GROUP BY
                ft.flat_type_id,
                ft.flat_type_name

            ORDER BY
                average_price ASC,
                ft.flat_type_name ASC
        `, joinParams);

        res.json({
            status: "success",
            count: rows.length,
            data: rows
        });

    } catch (error) {
        handleError(
            error,
            res,
            "Unable to retrieve flat-type resale statistics"
        );
    }
});

// ==========================================
// 5. TOWN PRICE RANKINGS
// ==========================================

// GET /api/insights/town-rankings
//
// Flat-type and year filters apply.
// Town filter is intentionally ignored
// so all towns remain comparable.

router.get("/town-rankings", async (req, res) => {
    try {
        const filters = getFilters(req);

        const joinConditions = [
            "b.block_id = r.block_id"
        ];

        const params = [];

        if (filters.flatType) {
            joinConditions.push(`
                EXISTS (
                    SELECT 1
                    FROM flat_type ft
                    WHERE ft.flat_type_id = r.flat_type_id
                      AND ft.flat_type_name = ?
                )
            `);

            params.push(filters.flatType);
        }

        if (filters.startYear !== null) {
            joinConditions.push("r.sale_date >= ?");
            params.push(
                `${filters.startYear}-01-01`
            );
        }

        if (filters.endYear !== null) {
            joinConditions.push("r.sale_date < ?");
            params.push(
                `${filters.endYear + 1}-01-01`
            );
        }

        const [rows] = await pool.query(`
            SELECT
                t.town_id,
                t.town_name,

                COUNT(r.transaction_id)
                    AS total_transactions,

                ROUND(AVG(r.resale_price), 2)
                    AS average_price,

                MIN(r.resale_price)
                    AS lowest_price,

                MAX(r.resale_price)
                    AS highest_price

            FROM town t

            LEFT JOIN block b
                ON t.town_id = b.town_id

            LEFT JOIN resale_transaction r
                ON ${joinConditions.join(" AND ")}

            GROUP BY
                t.town_id,
                t.town_name

            ORDER BY
                average_price DESC,
                t.town_name ASC
        `, params);

        res.json({
            status: "success",
            count: rows.length,
            data: rows
        });

    } catch (error) {
        handleError(
            error,
            res,
            "Unable to retrieve town price rankings"
        );
    }
});

// ==========================================
// 6. EXPORT ROUTER
// ==========================================

module.exports = router;