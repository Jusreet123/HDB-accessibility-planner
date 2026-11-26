
require("dotenv").config();

const pool = require("./db");
const { MongoClient } = require("mongodb");
const { performance } = require("perf_hooks");

const COLLECTIONS = [
    "mrt_exits",
    "bus_stops",
    "hawker_centres",
    "childcare_centres",
    "parks"
];

const RUNS = 30;
const WARMUP = 5;
const RADIUS = 500;

// Existing HDB block ID used in your project examples
const BLOCK_ID = 1715;

function statistics(values) {
    const sorted = [...values].sort((a, b) => a - b);

    const average =
        values.reduce((sum, value) => sum + value, 0) /
        values.length;

    const middle = Math.floor(sorted.length / 2);

    const median = sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];

    const p95 =
        sorted[Math.ceil(sorted.length * 0.95) - 1];

    return {
        average: average.toFixed(2),
        median: median.toFixed(2),
        p95: p95.toFixed(2)
    };
}

async function main() {
    const client = new MongoClient(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000
    });

    try {
        await client.connect();

        const db = client.db("hdb");

        const mysqlTimes = [];
        const mongoTimes = [];
        const totalTimes = [];

        console.log("Starting Haven. Polyglot Benchmark");
        console.log("Block ID:", BLOCK_ID);
        console.log("Radius:", RADIUS, "metres");
        console.log("Warm-up runs:", WARMUP);
        console.log("Measured runs:", RUNS);

        for (let i = 0; i < WARMUP + RUNS; i++) {
            const totalStart = performance.now();

            // =====================================
            // 1. MYSQL: Retrieve HDB coordinates
            // =====================================

            const mysqlStart = performance.now();

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
                [BLOCK_ID]
            );

            const mysqlElapsed =
                performance.now() - mysqlStart;

            if (blocks.length === 0) {
                throw new Error("HDB block not found");
            }

            const block = blocks[0];

            if (block.latitude == null ||
                block.longitude == null) {
                throw new Error("Block has no coordinates");
            }

            const latitude = Number(block.latitude);
            const longitude = Number(block.longitude);

            if (
                !Number.isFinite(latitude) ||
                !Number.isFinite(longitude) ||
                latitude < 1.1 ||
                latitude > 1.5 ||
                longitude < 103.5 ||
                longitude > 104.2
            ) {
                throw new Error("Invalid HDB coordinates");
            }

            const location = {
                type: "Point",
                coordinates: [longitude, latitude]
            };

            // =====================================
            // 2. MONGODB: Search nearby amenities
            // =====================================

            const mongoStart = performance.now();

            const results = await Promise.all(
                COLLECTIONS.map(async (name) => {
                    const pipeline = [
                        {
                            $geoNear: {
                                near: location,
                                key: "location",
                                distanceField: "distance_m",
                                maxDistance: RADIUS,
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

                    return db.collection(name)
                        .aggregate(pipeline)
                        .toArray();
                })
            );

            const mongoElapsed =
                performance.now() - mongoStart;

            const totalElapsed =
                performance.now() - totalStart;

            // Skip warm-up runs
            if (i >= WARMUP) {
                mysqlTimes.push(mysqlElapsed);
                mongoTimes.push(mongoElapsed);
                totalTimes.push(totalElapsed);
            }

            if (i === WARMUP) {
                console.log(
                    "Amenities returned:",
                    results.reduce(
                        (sum, items) => sum + items.length,
                        0
                    )
                );
            }
        }

        const mysql = statistics(mysqlTimes);
        const mongo = statistics(mongoTimes);
        const total = statistics(totalTimes);

        console.log("\n===== BENCHMARK RESULTS =====");

        console.log("\nMySQL Block Lookup");
        console.log("Average:", mysql.average, "ms");
        console.log("Median:", mysql.median, "ms");
        console.log("P95:", mysql.p95, "ms");

        console.log("\nMongoDB Amenity Search");
        console.log("Average:", mongo.average, "ms");
        console.log("Median:", mongo.median, "ms");
        console.log("P95:", mongo.p95, "ms");

        console.log("\nCombined Polyglot Workflow");
        console.log("Average:", total.average, "ms");
        console.log("Median:", total.median, "ms");
        console.log("P95:", total.p95, "ms");

        console.log("\nBenchmark completed successfully!");

    } catch (error) {
        console.error("Benchmark failed:", error.message);
        process.exitCode = 1;

    } finally {
        await client.close();
        await pool.end();
    }
}

main();