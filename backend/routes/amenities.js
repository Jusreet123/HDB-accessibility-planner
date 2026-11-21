
const express = require("express");
const pool = require("../db");
const { getMongoDB } = require("../mongo");
const { communityByCategory } = require("./community");

// Server-side caching
const {
    getCachedAmenities,
    setCachedAmenities
} = require("../amenities-cache");

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

        // ======================================
        // 1. VALIDATE HDB BLOCK ID
        // ======================================

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

        // ======================================
        // 2. VALIDATE SEARCH RADIUS
        // ======================================

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

        // ======================================
        // 3. CHECK SERVER-SIDE CACHE
        // ======================================

        // Community places are excluded from caching
        // to avoid returning outdated submissions.
        const includeCommunity =
            req.query.include_community === "1";

        if (!includeCommunity) {

            const cached = getCachedAmenities(
                blockId,
                radius
            );

            if (cached) {

                // Cache hit: skip MySQL and MongoDB
                res.set("X-Cache", "HIT");

                return res.json(cached);
            }
        }

        // ======================================
        // 4. RETRIEVE HDB BLOCK FROM MYSQL
        // ======================================

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

        // ======================================
        // 5. CONNECT TO MONGODB
        // ======================================

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

        // ======================================
        // 6. SEARCH MONGODB AMENITY COLLECTIONS
        // ======================================

        // Run five geospatial queries concurrently
        const results = await Promise.all(
            AMENITY_COLLECTIONS.map(
                async (collectionName) => {

                    const collection =
                        mongoDb.collection(collectionName);

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

                        amenities: amenities.map(
                            (item) => ({
                                name:
                                    item.name ||
                                    item.station_na ||
                                    item.centre_name ||
                                    (item.bus_stop_num
                                        ? `Bus Stop ${item.bus_stop_num}`
                                        : "Unnamed amenity"),

                                distance_m:
                                    Math.round(item.distance_m),

                                exit_code:
                                    collectionName === "mrt_exits"
                                        ? (item.exit_code || null)
                                        : null,

                                location: item.location
                            })
                        )
                    };
                }
            )
        );

        // ======================================
        // 7. OPTIONAL COMMUNITY AMENITIES
        // ======================================

        let communityIncluded = 0;

        if (includeCommunity) {

            try {

                const community =
                    await communityByCategory(
                        mongoDb,
                        location,
                        radius,
                        5
                    );

                for (const entry of results) {

                    const extra = (
                        community[entry.category] || []
                    ).map((place) => ({
                        name: place.name,

                        distance_m: place.distance_m,

                        exit_code: null,

                        location: {
                            type: "Point",
                            coordinates: [
                                place.lng,
                                place.lat
                            ]
                        },

                        source: "community"
                    }));

                    const merged = [
                        ...entry.amenities.map(
                            (item) => ({
                                ...item,
                                source: "official"
                            })
                        ),
                        ...extra
                    ]
                        .sort(
                            (a, b) =>
                                a.distance_m - b.distance_m
                        )
                        .slice(0, 5);

                    communityIncluded += merged.filter(
                        (item) =>
                            item.source === "community"
                    ).length;

                    entry.amenities = merged;
                    entry.count = merged.length;
                }

            } catch (error) {

                // Official amenities remain available
                // if community lookup fails.
                console.error(
                    "Community places could not be merged:",
                    error.message
                );
            }
        }

        // ======================================
        // 8. PREPARE API RESPONSE
        // ======================================

        const responseData = {
            status: "success",

            block: {
                block_id: block.block_id,

                address:
                    `${block.blk_no} ${block.street_name}`,

                latitude,
                longitude
            },

            radius_m: radius,

            distance_type: "straight-line",

            categories: results,

            include_community: includeCommunity,

            community_included: communityIncluded
        };

        // ======================================
        // 9. SAVE RESULTS TO CACHE
        // ======================================

        if (!includeCommunity) {

            setCachedAmenities(
                blockId,
                radius,
                responseData
            );
        }

        // Cache miss means database queries were run
        res.set("X-Cache", "MISS");

        // ======================================
        // 10. RETURN API RESPONSE
        // ======================================

        return res.json(responseData);

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