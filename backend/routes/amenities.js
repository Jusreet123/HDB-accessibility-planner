
const express = require("express");
const pool = require("../db");
const { getMongoDB } = require("../mongo");

const router = express.Router();

// Nearby amenity categories stored in MongoDB
const AMENITY_COLLECTIONS = [
    "mrt_exits",
    "bus_stops",
    "hawker_centres",
    "childcare_centres",
    "parks"
];

// ==========================================
// GET /api/blocks/:blockId/amenities
// ==========================================

router.get("/:blockId/amenities", async (req, res) => {
    try {
        // 1. Validate HDB block ID
        const blockId = Number(req.params.blockId);

        if (!Number.isSafeInteger(blockId) || blockId <= 0) {
            return res.status(400).json({
                status: "error",
                message: "Invalid block ID"
            });
        }

        // 2. Validate search radius
        const radius = Number(req.query.radius ?? 500);

        if (
            !Number.isFinite(radius) ||
            radius < 100 ||
            radius > 5000
        ) {
            return res.status(400).json({
                status: "error",
                message: "Radius must be between 100 and 5000 metres"
            });
        }

        // 3. Retrieve HDB block coordinates from MySQL
        const [blocks] = await pool.query(
            `
            SELECT
                block_id,
                blk_no,
                street_name,
                latitude,
                longitude
            FROM block
            WHERE block_id = ?
            `,
            [blockId]
        );

        if (blocks.length === 0) {
            return res.status(404).json({
                status: "error",
                message: "HDB block not found"
            });
        }

        const block = blocks[0];

        const latitude = Number(block.latitude);
        const longitude = Number(block.longitude);

        if (
            block.latitude == null ||
            block.longitude == null ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < 1.1 ||
            latitude > 1.5 ||
            longitude < 103.5 ||
            longitude > 104.2
        ) {
            return res.status(422).json({
                status: "error",
                message: "This HDB block has no usable coordinates"
            });
        }

        // 4. Connect to MongoDB
        let mongoDb;

        try {
            mongoDb = getMongoDB();
        } catch (error) {
            return res.status(503).json({
                status: "error",
                message: "MongoDB is not connected"
            });
        }

        const location = {
            type: "Point",
            coordinates: [longitude, latitude]
        };

        // 5. Search each amenity collection
        const results = await Promise.all(
            AMENITY_COLLECTIONS.map(async (collectionName) => {
                const collection = mongoDb.collection(collectionName);

                const pipeline = [
                    {
                        $geoNear: {
                            near: location,
                            key: "location",
                            distanceField: "distance_m",
                            maxDistance: radius,
                            spherical: true
                        }
                    },
                    {
                        $limit: 5
                    },
                    {
                        $project: {
                            _id: 0,
                            location: 1,
                            distance_m: 1,
                            name: 1,
                            station_na: 1,
                            exit_code: 1,
                            bus_stop_num: 1,
                            description: 1,
                            centre_name: 1
                        }
                    }
                ];

                const amenities = await collection
                    .aggregate(pipeline)
                    .toArray();

                return {
                    category: collectionName,
                    count: amenities.length,
                    amenities: amenities.map((item) => ({
                        name:
                            item.name ||
                            item.station_na ||
                            item.centre_name ||
                            (item.bus_stop_num
                                ? `Bus Stop ${item.bus_stop_num}`
                                : "Unnamed amenity"),

                        distance_m: Math.round(item.distance_m),

                        // MRT exit label from MongoDB
                        exit_code: collectionName === "mrt_exits"
                            ? (item.exit_code || null)
                            : null,

                        location: item.location
                    }))
                };
            })
        );

        // 6. Return combined MySQL + MongoDB results
        return res.json({
            status: "success",
            block: {
                block_id: block.block_id,
                address: `${block.blk_no} ${block.street_name}`,
                latitude,
                longitude
            },
            radius_m: radius,
            distance_type: "straight-line",
            categories: results
        });

    } catch (error) {
        console.error(
            "Nearby amenities query failed:",
            error.message
        );

        return res.status(500).json({
            status: "error",
            message: "Unable to retrieve nearby amenities"
        });
    }
});

module.exports = router;