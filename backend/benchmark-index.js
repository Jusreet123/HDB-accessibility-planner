
require("dotenv").config();

const { MongoClient } = require("mongodb");
const { performance } = require("perf_hooks");

// ==========================================
// BENCHMARK CONFIGURATION
// ==========================================

const RUNS = 30;
const WARMUP = 5;
const RADIUS = 500;

const longitude = 103.849;
const latitude = 1.369;

const location = {
    type: "Point",
    coordinates: [longitude, latitude]
};

// ==========================================
// CALCULATE STATISTICS
// ==========================================

function stats(values) {
    const sorted = [...values].sort((a, b) => a - b);

    const average =
        values.reduce((a, b) => a + b, 0) /
        values.length;

    const median =
        (sorted[14] + sorted[15]) / 2;

    const p95 =
        sorted[Math.ceil(values.length * 0.95) - 1];

    return {
        average: average.toFixed(2),
        median: median.toFixed(2),
        p95: p95.toFixed(2)
    };
}

// ==========================================
// CALCULATE DISTANCE (HAVERSINE)
// ==========================================

function distanceMeters(point) {
    const [lng, lat] = point.coordinates;

    const toRad = Math.PI / 180;

    const dLat = (lat - latitude) * toRad;
    const dLng = (lng - longitude) * toRad;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(latitude * toRad) *
        Math.cos(lat * toRad) *
        Math.sin(dLng / 2) ** 2;

    return 6371008.8 * 2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );
}

// ==========================================
// MAIN BENCHMARK
// ==========================================

async function main() {
    const client = new MongoClient(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000
    });

    try {
        await client.connect();

        const collection = client
            .db("hdb")
            .collection("bus_stops");

        console.log("\n===== HAVEN. BENCHMARK =====");
        console.log("Collection: bus_stops");
        console.log("Radius:", RADIUS, "metres");
        console.log("Warm-up runs:", WARMUP);
        console.log("Measured runs:", RUNS);

        // ======================================
        // 1. INDEXED MONGODB GEOSPATIAL QUERY
        // ======================================

        const indexedPipeline = [
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
            }
        ];

        // ======================================
        // 2. MONGODB EXECUTION PLAN
        // ======================================

        console.log(
            "\n===== MONGODB EXECUTION PLAN ====="
        );

        const explain = await collection
            .aggregate(indexedPipeline)
            .explain("executionStats");

        function findStages(value, matches = []) {
            if (!value || typeof value !== "object") {
                return matches;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    findStages(item, matches);
                }
                return matches;
            }

            if (
                typeof value.stage === "string" &&
                (
                    value.stage.includes("GEO_NEAR") ||
                    value.stage === "IXSCAN" ||
                    value.stage === "COLLSCAN"
                )
            ) {
                matches.push({
                    stage: value.stage,
                    indexName: value.indexName ?? null,
                    keysExamined: value.keysExamined ?? null,
                    docsExamined: value.docsExamined ?? null
                });
            }

            for (const child of Object.values(value)) {
                findStages(child, matches);
            }

            return matches;
        }

        console.log(
            "Relevant query stages:",
            JSON.stringify(findStages(explain), null, 2)
        );

        const executionStats =
            explain.executionStats ||
            explain.stages?.find(
                stage => stage.$cursor
            )?.$cursor?.executionStats;

        if (executionStats) {
            console.log(
                "Server execution time:",
                executionStats.executionTimeMillis,
                "ms"
            );

            console.log(
                "Documents examined:",
                executionStats.totalDocsExamined
            );

            console.log(
                "Index keys examined:",
                executionStats.totalKeysExamined
            );
        } else {
            console.log(
                "Execution statistics not found at the expected location."
            );
        }

        // ======================================
        // 3. LOAD DOCUMENTS FOR IN-MEMORY SCAN
        // ======================================

        const documents = await collection.find(
            {},
            {
                projection: {
                    location: 1
                }
            }
        ).toArray();

        console.log(
            "\nDocuments loaded:",
            documents.length
        );

        // ======================================
        // 4. RUN PERFORMANCE BENCHMARK
        // ======================================

        const indexedTimes = [];
        const scanTimes = [];

        let indexedCount = 0;
        let scanCount = 0;

        for (let i = 0; i < WARMUP + RUNS; i++) {

            // Indexed MongoDB query
            const indexedStart = performance.now();

            const indexedResults = await collection
                .aggregate(indexedPipeline)
                .toArray();

            const indexedElapsed =
                performance.now() - indexedStart;

            // JavaScript in-memory full scan
            const scanStart = performance.now();

            const scannedResults = documents
                .filter(doc =>
                    doc.location &&
                    doc.location.type === "Point" &&
                    Array.isArray(
                        doc.location.coordinates
                    )
                )
                .map(doc => ({
                    ...doc,
                    distance_m:
                        distanceMeters(doc.location)
                }))
                .filter(doc =>
                    doc.distance_m <= RADIUS
                )
                .sort((a, b) =>
                    a.distance_m - b.distance_m
                )
                .slice(0, 5);

            const scanElapsed =
                performance.now() - scanStart;

            if (i >= WARMUP) {
                indexedTimes.push(indexedElapsed);
                scanTimes.push(scanElapsed);
            }

            indexedCount = indexedResults.length;
            scanCount = scannedResults.length;
        }

        // ======================================
        // 5. CALCULATE BENCHMARK RESULTS
        // ======================================

        const indexed = stats(indexedTimes);
        const scan = stats(scanTimes);

        console.log(
            "\n===== PERFORMANCE RESULTS ====="
        );

        console.log(
            "\nIndexed MongoDB Query"
        );
        console.log("Results:", indexedCount);
        console.log("Average:", indexed.average, "ms");
        console.log("Median:", indexed.median, "ms");
        console.log("P95:", indexed.p95, "ms");

        console.log(
            "\nJavaScript In-Memory Scan"
        );
        console.log("Results:", scanCount);
        console.log("Average:", scan.average, "ms");
        console.log("Median:", scan.median, "ms");
        console.log("P95:", scan.p95, "ms");

        console.log(
            "\nBenchmark completed successfully!"
        );

    } catch (error) {
        console.error(
            "Benchmark failed:",
            error.message
        );
        process.exitCode = 1;

    } finally {
        await client.close();
    }
}

main();