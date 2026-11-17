const express = require("express");
const { ObjectId } = require("mongodb");
const { getMongoDB } = require("../mongo");

const router = express.Router();
const COLLECTION = "community_places";
const MAX_PLACES_PER_USER = 20;

const CATEGORIES = [
    "mrt_exits",
    "bus_stops",
    "hawker_centres",
    "childcare_centres",
    "parks"
];

// Each category accepts a different set of optional attributes.
// This is the flexible-schema part that a fixed SQL table handles awkwardly.
const ATTRIBUTE_RULES = {
    mrt_exits: { lift_access: "boolean", description: "text:200" },
    bus_stops: { sheltered: "boolean", services: "list", description: "text:200" },
    hawker_centres: {
        cuisine: "text:50",
        halal: "boolean",
        opening_hours: "text:60",
        description: "text:200"
    },
    childcare_centres: {
        programmes: "list",
        opening_hours: "text:60",
        description: "text:200"
    },
    parks: { facilities: "list", description: "text:200" }
};

const ALLOWED_QUERY = new Set(["radius", "category", "limit"]);

// Singapore bounding box (the same limits the data loader uses)
const LNG_MIN = 103.5;
const LNG_MAX = 104.2;
const LAT_MIN = 1.1;
const LAT_MAX = 1.5;

// ==========================================
// 1. COLLECTION SETUP (validator + indexes)
// ==========================================

const VALIDATOR = {
    $jsonSchema: {
        bsonType: "object",
        required: ["name", "category", "location", "user_id", "created_at"],
        properties: {
            name: { bsonType: "string", minLength: 1, maxLength: 100 },
            category: { enum: CATEGORIES },
            location: {
                bsonType: "object",
                required: ["type", "coordinates"],
                properties: {
                    type: { enum: ["Point"] },
                    coordinates: {
                        bsonType: "array",
                        minItems: 2,
                        maxItems: 2,
                        items: { bsonType: "number" }
                    }
                }
            },
            attributes: { bsonType: "object" },
            user_id: { bsonType: "number", multipleOf: 1, minimum: 1 },
            created_at: { bsonType: "date" },
            updated_at: { bsonType: "date" }
        }
    }
};

async function ensureCommunityPlaces(db) {
    const existing = await db
        .listCollections({ name: COLLECTION }, { nameOnly: true })
        .toArray();

    if (existing.length > 0) {
        // Refreshing the validator needs the collMod privilege. If the database user lacks it,
        // the validator attached when the collection was created stays in place.
        try {
            await db.command({ collMod: COLLECTION, validator: VALIDATOR });
        } catch (error) {
            console.warn("Could not refresh the community places validator:", error.message);
        }
    } else {
        await db.createCollection(COLLECTION, { validator: VALIDATOR });
    }

    const places = db.collection(COLLECTION);

    // The 2dsphere index is what makes $geoNear possible
    await places.createIndex({ location: "2dsphere" });
    await places.createIndex({ user_id: 1, created_at: -1 });
    await places.createIndex({ category: 1 });

    console.log("MongoDB community places collection ready.");
}

// ==========================================
// 2. VALIDATION AND AUTH HELPERS
// ==========================================

class Invalid extends Error {}

function has(value) {
    return value !== undefined && value !== null && value !== "";
}

// Only plain non-empty strings are accepted, which blocks operator injection
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

function oneOf(value, allowed, name) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new Invalid(`${name} must be one of: ${allowed.join(", ")}.`);
    }

    return value;
}

function coordinates(lat, lng) {
    const la = typeof lat === "string" && lat.trim() !== "" ? Number(lat) : lat;
    const lo = typeof lng === "string" && lng.trim() !== "" ? Number(lng) : lng;

    if (typeof la !== "number" || typeof lo !== "number" ||
        !Number.isFinite(la) || !Number.isFinite(lo)) {
        throw new Invalid("Latitude and longitude must be numbers.");
    }

    if (la < LAT_MIN || la > LAT_MAX || lo < LNG_MIN || lo > LNG_MAX) {
        throw new Invalid("The location must be inside Singapore.");
    }

    return [lo, la];     // GeoJSON order: longitude first
}

function cleanAttributes(category, raw) {
    if (raw === undefined || raw === null) return {};

    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new Invalid("attributes must be an object.");
    }

    const rules = ATTRIBUTE_RULES[category];
    const clean = {};

    for (const key of Object.keys(raw)) {
        // hasOwnProperty stops keys such as "constructor" or "__proto__"
        if (!Object.prototype.hasOwnProperty.call(rules, key)) {
            throw new Invalid(`"${key}" is not an allowed attribute for ${category}.`);
        }

        const rule = rules[key];
        const value = raw[key];

        if (rule === "boolean") {
            if (typeof value !== "boolean") {
                throw new Invalid(`${key} must be true or false.`);
            }
            clean[key] = value;
        } else if (rule === "list") {
            if (!Array.isArray(value) || value.length > 10) {
                throw new Invalid(`${key} must be a list of at most 10 items.`);
            }
            clean[key] = [...new Set(value.map((item) => text(item, key, 30)))];
        } else {
            clean[key] = text(value, key, Number(rule.split(":")[1]));
        }
    }

    return clean;
}

function placeId(value) {
    if (typeof value !== "string" || !/^[0-9a-fA-F]{24}$/.test(value)) {
        throw new Invalid("Invalid place ID.");
    }

    return new ObjectId(value);
}

function currentUserId(req) {
    const id = Number(req.session?.userId ?? req.user?.user_id);

    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requireAuth(req, res, next) {
    const userId = currentUserId(req);

    if (userId === null) {
        return res.status(401).json({
            error: "Please log in to add or manage community places."
        });
    }

    req.userId = userId;
    next();
}

function collection() {
    // Throws "MongoDB is not connected." until the startup connection has finished
    return getMongoDB().collection(COLLECTION);
}

function publicPlace(doc, viewerId) {
    // user_id is never sent to the browser, only whether the viewer owns the place
    return {
        id: doc._id.toString(),
        name: doc.name,
        category: doc.category,
        attributes: doc.attributes || {},
        lat: doc.location.coordinates[1],
        lng: doc.location.coordinates[0],
        distance_m: doc.dist_m !== undefined ? Math.round(doc.dist_m) : null,
        created_at: doc.created_at,
        mine: viewerId !== null && doc.user_id === viewerId,
        source: "community"
    };
}

// Rejects stray parameters such as radius[$ne]
function rejectUnknownQuery(req) {
    for (const key of Object.keys(req.query)) {
        if (!ALLOWED_QUERY.has(key)) {
            throw new Invalid(`Unknown query parameter: ${key}`);
        }
    }
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

    console.error("Community places route failed:", error && error.message);

    res.status(500).json({ error: "Unable to process the request." });
}

// ==========================================
// REUSABLE: NEAREST COMMUNITY PLACES BY CATEGORY
// ==========================================

async function communityByCategory(db, location, radius, perCategory = 5) {
    const rows = await db
        .collection(COLLECTION)
        .aggregate([
            {
                $geoNear: {
                    near: location,
                    distanceField: "dist_m",
                    maxDistance: radius,
                    spherical: true
                }
            },
            { $sort: { dist_m: 1 } },
            {
                $group: {
                    _id: "$category",
                    places: {
                        $push: {
                            id: { $toString: "$_id" },
                            name: "$name",
                            attributes: "$attributes",
                            lng: { $arrayElemAt: ["$location.coordinates", 0] },
                            lat: { $arrayElemAt: ["$location.coordinates", 1] },
                            dist_m: "$dist_m"
                        }
                    }
                }
            },
            { $project: { places: { $slice: ["$places", perCategory] } } }
        ])
        .toArray();

    const result = {};

    for (const category of CATEGORIES) result[category] = [];

    for (const row of rows) {
        result[row._id] = row.places.map((p) => ({
            id: p.id,
            name: p.name,
            category: row._id,
            attributes: p.attributes || {},
            lat: p.lat,
            lng: p.lng,
            distance_m: Math.round(p.dist_m),
            source: "community"
        }));
    }

    return result;
}

router.get("/by-category/:blockId", async (req, res) => {
    try {
        rejectUnknownQuery(req);

        const blockId = integer(req.params.blockId, "block_id", 1);

        const radius = has(req.query.radius)
            ? integer(req.query.radius, "radius", 50, 5000)
            : 500;

        const db = getMongoDB();

        const block = await db
            .collection("blocks")
            .findOne({ block_id: blockId }, { projection: { location: 1 } });

        if (!block || !block.location) {
            return res.status(404).json({ error: "HDB block or its coordinates not found." });
        }

        res.json({
            block_id: blockId,
            radius_m: radius,
            categories: await communityByCategory(db, block.location, radius, 5)
        });

    } catch (error) {
        fail(res, error);
    }
});

// ==========================================
// 3. READ - PLACES NEAR A BLOCK (PUBLIC)
// ==========================================

router.get("/near-block/:blockId", async (req, res) => {
    try {
        rejectUnknownQuery(req);

        const blockId = integer(req.params.blockId, "block_id", 1);

        const radius = has(req.query.radius)
            ? integer(req.query.radius, "radius", 50, 5000)
            : 500;

        const limit = has(req.query.limit)
            ? integer(req.query.limit, "limit", 1, 50)
            : 10;

        const db = getMongoDB();

        // The block's coordinates come from the server's own blocks collection, never from the client
        const block = await db
            .collection("blocks")
            .findOne({ block_id: blockId }, { projection: { location: 1 } });

        if (!block) {
            return res.status(404).json({ error: "HDB block not found." });
        }

        if (!block.location) {
            return res.status(404).json({ error: "This block has no coordinates." });
        }

        const near = {
            near: block.location,
            distanceField: "dist_m",
            maxDistance: radius,
            spherical: true
        };

        if (has(req.query.category)) {
            near.query = { category: oneOf(req.query.category, CATEGORIES, "category") };
        }

        // $geoNear must be the first stage, and it uses the 2dsphere index
        const rows = await db
            .collection(COLLECTION)
            .aggregate([{ $geoNear: near }, { $limit: limit }])
            .toArray();

        const viewer = currentUserId(req);

        res.json({
            block_id: blockId,
            radius_m: radius,
            places: rows.map((doc) => publicPlace(doc, viewer))
        });

    } catch (error) {
        fail(res, error);
    }
});

// ==========================================
// 4. READ - MY PLACES (LOGIN REQUIRED)
// ==========================================

router.get("/mine", requireAuth, async (req, res) => {
    try {
        const rows = await collection()
            .find({ user_id: req.userId })
            .sort({ created_at: -1 })
            .limit(100)
            .toArray();

        res.json({ places: rows.map((doc) => publicPlace(doc, req.userId)) });

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
        const places = collection();

        // A simple spam limit per user
        const count = await places.countDocuments({ user_id: req.userId });

        if (count >= MAX_PLACES_PER_USER) {
            return res.status(429).json({
                error: `You can add at most ${MAX_PLACES_PER_USER} places.`
            });
        }

        const category = oneOf(body.category, CATEGORIES, "category");
        const [lng, lat] = coordinates(body.lat, body.lng);
        const now = new Date();

        const doc = {
            name: text(body.name, "name", 100),
            category,
            location: { type: "Point", coordinates: [lng, lat] },
            attributes: cleanAttributes(category, body.attributes),
            user_id: req.userId,       // taken from the session, never from the request body
            created_at: now,
            updated_at: now
        };

        const result = await places.insertOne(doc);

        res.status(201).json({
            message: "Place added successfully.",
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
        const _id = placeId(req.params.id);
        const body = req.body || {};
        const places = collection();

        // Ownership is checked here and again in the update filter below
        const existing = await places.findOne({ _id, user_id: req.userId });

        if (!existing) {
            return res.status(404).json({ error: "Place not found." });
        }

        const changes = {};
        let category = existing.category;

        if (has(body.name)) {
            changes.name = text(body.name, "name", 100);
        }

        if (has(body.category)) {
            category = oneOf(body.category, CATEGORIES, "category");

            if (category !== existing.category) {
                changes.category = category;
                changes.attributes = {};     // attributes depend on the category
            }
        }

        if (body.attributes !== undefined) {
            changes.attributes = cleanAttributes(category, body.attributes);
        }

        if (has(body.lat) || has(body.lng)) {
            const [lng, lat] = coordinates(body.lat, body.lng);
            changes.location = { type: "Point", coordinates: [lng, lat] };
        }

        if (Object.keys(changes).length === 0) {
            throw new Invalid("Nothing to update.");
        }

        changes.updated_at = new Date();

        // Filtering on user_id as well as _id means only the author can edit
        const result = await places.updateOne(
            { _id, user_id: req.userId },
            { $set: changes }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Place not found." });
        }

        res.json({ message: "Place updated successfully." });

    } catch (error) {
        fail(res, error);
    }
});

// ==========================================
// 7. DELETE (AUTHOR ONLY)
// ==========================================

router.delete("/:id", requireAuth, async (req, res) => {
    try {
        const _id = placeId(req.params.id);

        const result = await collection().deleteOne({
            _id,
            user_id: req.userId
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Place not found." });
        }

        res.json({ message: "Place deleted successfully." });

    } catch (error) {
        fail(res, error);
    }
});

module.exports = { router, ensureCommunityPlaces, communityByCategory};