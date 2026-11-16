const express = require("express");
const { getMongoDB } = require("../mongo");
const { ObjectId } = require("mongodb");

const router = express.Router();
const COLLECTION = "block_notes";

// ==========================================
// 1. COLLECTION SETUP (validator + indexes)
// ==========================================

// The validator is MongoDB's counterpart to a CHECK constraint.
const VALIDATOR = {
    $jsonSchema: {
        bsonType: "object",
        required: ["block_id", "user_id", "note", "created_at"],
        properties: {
            block_id: { bsonType: "number", multipleOf: 1, minimum: 1 },
            user_id: { bsonType: "number", multipleOf: 1, minimum: 1 },
            note: { bsonType: "string", minLength: 1, maxLength: 500 },
            rating: { bsonType: "number", multipleOf: 1, minimum: 1, maximum: 5 },
            tags: { bsonType: "array", maxItems: 10, items: { bsonType: "string" } },
            created_at: { bsonType: "date" },
            updated_at: { bsonType: "date" }
        }
    }
};

async function ensureNotesCollection(db) {
    const existing = await db
        .listCollections({ name: COLLECTION })
        .toArray();

    if (existing.length === 0) {
        await db.createCollection(COLLECTION, { validator: VALIDATOR });
    } else if (!existing[0].options || !existing[0].options.validator) {
        // Only needed when the collection exists without rules. collMod needs the dbAdmin role.
        try {
            await db.command({ collMod: COLLECTION, validator: VALIDATOR });
        } catch (error) {
            console.warn(
                "Notes validator not applied (database user cannot run collMod):",
                error.message
            );
        }
    }

    const notes = db.collection(COLLECTION);
    await notes.createIndex({ block_id: 1, created_at: -1 });
    await notes.createIndex({ user_id: 1, created_at: -1 });

    console.log("MongoDB notes collection ready.");
}

// ==========================================
// 2. VALIDATION AND AUTH HELPERS
// ==========================================

class Invalid extends Error {}

function has(value) {
    return value !== undefined && value !== null && value !== "";
}

// Only plain non-empty strings are accepted, which blocks
// NoSQL injection such as ?tag[$ne]=x
function text(value, name, max = 500) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Invalid(`${name} must be non-empty text.`);
    }

    const trimmed = value.trim();

    if (trimmed.length > max) {
        throw new Invalid(`${name} must contain at most ${max} characters.`);
    }

    return trimmed;
}

function integer(value, name, min, max) {
    const number =
        typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : value;

    if (typeof number !== "number" || !Number.isSafeInteger(number)) {
        throw new Invalid(`${name} must be a whole number.`);
    }

    if ((min !== undefined && number < min) ||
        (max !== undefined && number > max)) {
        throw new Invalid(`${name} must be between ${min} and ${max}.`);
    }

    return number;
}

const ALLOWED_QUERY = new Set(["block_id", "tag", "limit", "skip"]);

// Rejects stray parameters such as block_id[$ne], which some Express versions would otherwise ignore silently
function rejectUnknownQuery(req) {
    for (const key of Object.keys(req.query)) {
        if (!ALLOWED_QUERY.has(key)) {
            throw new Invalid(`Unknown query parameter: ${key}`);
        }
    }
}

function noteId(value) {
    if (typeof value !== "string" || !/^[0-9a-fA-F]{24}$/.test(value)) {
        throw new Invalid("Invalid note ID.");
    }

    return new ObjectId(value);
}

function currentUserId(req) {
    const id = Number(req.session?.userId);

    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requireAuth(req, res, next) {
    const userId = currentUserId(req);

    if (userId === null) {
        return res.status(401).json({
            error: "Please log in to add or manage notes."
        });
    }

    req.userId = userId;
    next();
}

function notesCollection() {
    // Throws "MongoDB is not connected." until the startup connection has finished
    return getMongoDB().collection(COLLECTION);
}

function publicNote(doc, viewerId) {
    // user_id is never sent to the browser, only whether the viewer owns the note
    return {
        id: doc._id.toString(),
        block_id: doc.block_id,
        note: doc.note,
        rating: doc.rating ?? null,
        tags: doc.tags || [],
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        mine: viewerId !== null && doc.user_id === viewerId
    };
}

function fail(res, error) {
    if (error instanceof Invalid) {
        return res.status(400).json({ error: error.message });
    }

    if (error && error.code === 121) {
        return res.status(400).json({
            error: "Rejected by database validation."
        });
    }

    if (error && error.message === "MongoDB is not connected.") {
        return res.status(503).json({ error: "MongoDB is unavailable." });
    }

    console.error("Notes route failed:", error && error.message);

    res.status(500).json({ error: "Unable to process the request." });
}

// ==========================================
// 3. READ - PUBLIC
// ==========================================

// Notes for one block, newest first
router.get("/", async (req, res) => {
    try {
         rejectUnknownQuery(req);

        const filter = {};

        if (has(req.query.block_id)) {
            filter.block_id = integer(req.query.block_id, "block_id", 1);
        }

        if (has(req.query.tag)) {
            filter.tags = text(req.query.tag, "tag", 30).toLowerCase();
        }

        const limit = has(req.query.limit)
            ? integer(req.query.limit, "limit", 1, 100)
            : 20;

        const skip = has(req.query.skip)
            ? integer(req.query.skip, "skip", 0)
            : 0;

        const rows = await notesCollection()
            .find(filter)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        const viewer = currentUserId(req);

        res.json({ notes: rows.map((doc) => publicNote(doc, viewer)) });

    } catch (error) {
        fail(res, error);
    }
});

// Average rating and counts for one block ($group)
router.get("/summary/:blockId", async (req, res) => {
    try {
        const blockId = integer(req.params.blockId, "block_id", 1);

        const [result] = await notesCollection()
            .aggregate([
                { $match: { block_id: blockId } },
                {
                    $group: {
                        _id: "$block_id",
                        notes: { $sum: 1 },
                        ratings: {
                            $sum: {
                                $cond: [{ $ifNull: ["$rating", false] }, 1, 0]
                            }
                        },
                        avg_rating: { $avg: "$rating" }
                    }
                }
            ])
            .toArray();

        res.json({
            block_id: blockId,
            notes: result ? result.notes : 0,
            ratings: result ? result.ratings : 0,
            avg_rating:
                result && result.avg_rating !== null
                    ? Math.round(result.avg_rating * 100) / 100
                    : null
        });

    } catch (error) {
        fail(res, error);
    }
});

// Top-rated blocks: $group, $sort, $lookup into the blocks collection
router.get("/top", async (req, res) => {
    try {
        const minRatings = has(req.query.min)
            ? integer(req.query.min, "min", 1, 100)
            : 2;

        const limit = has(req.query.limit)
            ? integer(req.query.limit, "limit", 1, 20)
            : 5;

        const rows = await notesCollection()
            .aggregate([
                { $match: { rating: { $exists: true } } },
                {
                    $group: {
                        _id: "$block_id",
                        avg_rating: { $avg: "$rating" },
                        n_ratings: { $sum: 1 }
                    }
                },
                { $match: { n_ratings: { $gte: minRatings } } },
                { $sort: { avg_rating: -1, n_ratings: -1 } },
                { $limit: limit },
                {
                    $lookup: {
                        from: "blocks",
                        localField: "_id",
                        foreignField: "block_id",
                        as: "block"
                    }
                },
                { $unwind: "$block" },
                {
                    $project: {
                        _id: 0,
                        block_id: "$_id",
                        n_ratings: 1,
                        avg_rating: { $round: ["$avg_rating", 2] },
                        blk_no: "$block.blk_no",
                        street_name: "$block.street_name",
                        town_name: "$block.town_name"
                    }
                }
            ])
            .toArray();

        res.json({ blocks: rows });

    } catch (error) {
        fail(res, error);
    }
});

// ==========================================
// 4. READ - MY OWN NOTES (LOGIN REQUIRED)
// ==========================================

router.get("/mine", requireAuth, async (req, res) => {
    try {
        const rows = await notesCollection()
            .find({ user_id: req.userId })
            .sort({ created_at: -1 })
            .limit(100)
            .toArray();

        res.json({ notes: rows.map((doc) => publicNote(doc, req.userId)) });

    } catch (error) {
        fail(res, error);
    }
});

// ==========================================
// 5. CREATE (LOGIN REQUIRED)
// ==========================================

router.post("/", requireAuth, async (req, res) => {
    try {
        const body = req.body || {};
        const blockId = integer(body.block_id, "block_id", 1);
        const db = getMongoDB();

        // MongoDB has no foreign keys, so the application confirms the block exists
        const blockExists = await db
            .collection("blocks")
            .countDocuments({ block_id: blockId }, { limit: 1 });

        if (!blockExists) {
            return res.status(404).json({ error: "HDB block not found." });
        }

        const now = new Date();

        const doc = {
            block_id: blockId,
            user_id: req.userId,     // taken from the session, never from the request body
            note: text(body.note, "note"),
            created_at: now,
            updated_at: now
        };

        if (has(body.rating)) {
            doc.rating = integer(body.rating, "rating", 1, 5);
        }

        if (Array.isArray(body.tags) && body.tags.length > 0) {
            if (body.tags.length > 10) {
                throw new Invalid("At most 10 tags are allowed.");
            }

            doc.tags = [
                ...new Set(body.tags.map((tag) => text(tag, "tag", 30).toLowerCase()))
            ].sort();
        }

        const result = await db.collection(COLLECTION).insertOne(doc);

        res.status(201).json({
            message: "Note added successfully.",
            id: result.insertedId.toString()
        });

    } catch (error) {
        fail(res, error);
    }
});

// ==========================================
// 6. UPDATE (AUTHOR ONLY)
// ==========================================

router.put("/:id", requireAuth, async (req, res) => {
    try {
        const _id = noteId(req.params.id);
        const body = req.body || {};
        const changes = {};

        if (has(body.note)) {
            changes.note = text(body.note, "note");
        }

        if (has(body.rating)) {
            changes.rating = integer(body.rating, "rating", 1, 5);
        }

        if (Object.keys(changes).length === 0) {
            throw new Invalid("Nothing to update.");
        }

        changes.updated_at = new Date();

        // Filtering on user_id as well as _id means only the author can edit
        const result = await notesCollection().updateOne(
            { _id, user_id: req.userId },
            { $set: changes }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Note not found." });
        }

        res.json({ message: "Note updated successfully." });

    } catch (error) {
        fail(res, error);
    }
});

// ==========================================
// 7. DELETE (AUTHOR ONLY)
// ==========================================

router.delete("/:id", requireAuth, async (req, res) => {
    try {
        const _id = noteId(req.params.id);

        const result = await notesCollection().deleteOne({
            _id,
            user_id: req.userId
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Note not found." });
        }

        res.json({ message: "Note deleted successfully." });

    } catch (error) {
        fail(res, error);
    }
});

module.exports = { router, ensureNotesCollection };