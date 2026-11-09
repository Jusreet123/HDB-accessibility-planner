const express = require("express");
const pool = require("../db");

const router = express.Router();

// ==========================================
// 1. REQUIRE LOGIN
// ==========================================

function requireAuth(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({
            error: "Please log in to manage your wishlist."
        });
    }

    next();
}

router.use(requireAuth);

// ==========================================
// 2. VALIDATION HELPERS
// ==========================================

const validPriorities = ["Low", "Medium", "High"];

function validId(value) {
    const number = Number(value);

    return Number.isSafeInteger(number) && number > 0;
}

// ==========================================
// 3. READ - GET MY WISHLIST
// ==========================================

router.get("/", async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `
            SELECT
                w.wishlist_id,
                w.block_id,
                b.blk_no,
                b.street_name,
                b.town_id,
                b.postal,
                w.priority,
                w.notes,
                w.created_at,
                w.updated_at
            FROM user_wishlist w
            INNER JOIN block b
                ON w.block_id = b.block_id
            WHERE w.user_id = ?
            ORDER BY
                FIELD(w.priority, 'High', 'Medium', 'Low'),
                w.created_at DESC
            `,
            [req.session.userId]
        );

        res.json({
            wishlist: rows
        });

    } catch (error) {
        console.error("Wishlist retrieval failed:", error);

        res.status(500).json({
            error: "Unable to retrieve wishlist."
        });
    }
});

// ==========================================
// 4. CREATE - SAVE AN HDB BLOCK
// ==========================================

router.post("/", async (req, res) => {
    const { block_id, priority = "Medium", notes = "" } =
        req.body || {};

    if (!validId(block_id)) {
        return res.status(400).json({
            error: "A valid HDB block ID is required."
        });
    }

    if (!validPriorities.includes(priority)) {
        return res.status(400).json({
            error: "Invalid priority."
        });
    }

    if (typeof notes !== "string" || notes.length > 2000) {
        return res.status(400).json({
            error: "Notes must contain at most 2000 characters."
        });
    }

    try {
        const [result] = await pool.execute(
            `
            INSERT INTO user_wishlist
                (user_id, block_id, priority, notes)
            VALUES (?, ?, ?, ?)
            `,
            [
                req.session.userId,
                Number(block_id),
                priority,
                notes
            ]
        );

        res.status(201).json({
            message: "HDB block saved successfully.",
            wishlist_id: result.insertId
        });

    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "This HDB block is already in your wishlist."
            });
        }

        if (error.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(404).json({
                error: "HDB block not found."
            });
        }

        console.error("Wishlist creation failed:", error);

        res.status(500).json({
            error: "Unable to save HDB block."
        });
    }
});

// ==========================================
// 5. UPDATE - EDIT PRIORITY AND NOTES
// ==========================================

router.put("/:id", async (req, res) => {
    const wishlistId = req.params.id;
    const { priority, notes } = req.body || {};

    if (!validId(wishlistId)) {
        return res.status(400).json({
            error: "Invalid wishlist ID."
        });
    }

    if (!validPriorities.includes(priority)) {
        return res.status(400).json({
            error: "Please select a valid priority."
        });
    }

    if (typeof notes !== "string" || notes.length > 2000) {
        return res.status(400).json({
            error: "Notes must contain at most 2000 characters."
        });
    }

    try {
        const [result] = await pool.execute(
            `
            UPDATE user_wishlist
            SET priority = ?, notes = ?
            WHERE wishlist_id = ?
              AND user_id = ?
            `,
            [
                priority,
                notes,
                Number(wishlistId),
                req.session.userId
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Wishlist entry not found."
            });
        }

        res.json({
            message: "Wishlist updated successfully."
        });

    } catch (error) {
        console.error("Wishlist update failed:", error);

        res.status(500).json({
            error: "Unable to update wishlist."
        });
    }
});

// ==========================================
// 6. DELETE - REMOVE SAVED HDB BLOCK
// ==========================================

router.delete("/:id", async (req, res) => {
    const wishlistId = req.params.id;

    if (!validId(wishlistId)) {
        return res.status(400).json({
            error: "Invalid wishlist ID."
        });
    }

    try {
        const [result] = await pool.execute(
            `
            DELETE FROM user_wishlist
            WHERE wishlist_id = ?
              AND user_id = ?
            `,
            [
                Number(wishlistId),
                req.session.userId
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Wishlist entry not found."
            });
        }

        res.json({
            message: "HDB block removed from wishlist."
        });

    } catch (error) {
        console.error("Wishlist deletion failed:", error);

        res.status(500).json({
            error: "Unable to remove HDB block."
        });
    }
});

module.exports = router;