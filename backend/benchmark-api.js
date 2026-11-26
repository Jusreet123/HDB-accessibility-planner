
require("dotenv").config();

const { performance } = require("perf_hooks");

// ==========================================
// HAVEN. API BENCHMARK CONFIGURATION
// ==========================================

// Deployed Haven. application on Render
const BASE_URL = "https://haven-hdb.onrender.com";

// Test configuration
const BLOCK_ID = 1715;
const RADIUS = 500;
const RUNS = 30;
const WARMUP = 5;

// Exclude community places for consistency
const API_URL =
    `${BASE_URL}/api/blocks/${BLOCK_ID}/amenities` +
    `?radius=${RADIUS}&include_community=0`;

// ==========================================
// STATISTICS
// ==========================================

function calculateStats(values) {
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
        p95: p95.toFixed(2),
        minimum: sorted[0].toFixed(2),
        maximum: sorted[sorted.length - 1].toFixed(2)
    };
}

// ==========================================
// API REQUEST
// ==========================================

async function measureRequest() {
    const start = performance.now();

    const response = await fetch(API_URL, {
        method: "GET",
        headers: {
            Accept: "application/json"
        },
        signal: AbortSignal.timeout(30000)
    });

    const data = await response.json();

    const elapsed = performance.now() - start;

    if (!response.ok || data.status !== "success") {
        throw new Error(
            `API request failed: HTTP ${response.status} - ` +
            JSON.stringify(data)
        );
    }

    const totalAmenities = data.categories.reduce(
        (sum, category) => sum + category.count,
        0
    );

    return {
        elapsed,
        totalAmenities,
        categories: data.categories.length
    };
}

// ==========================================
// MAIN BENCHMARK
// ==========================================

async function main() {
    const times = [];

    console.log("\n===== HAVEN. API BENCHMARK =====");
    console.log("Endpoint:", API_URL);
    console.log("Warm-up runs:", WARMUP);
    console.log("Measured runs:", RUNS);

    try {
        console.log("\nWarming up API...");

        for (let i = 0; i < WARMUP; i++) {
            await measureRequest();
        }

        console.log("Warm-up completed.");
        console.log("\nStarting measured requests...");

        let amenityCount = 0;
        let categoryCount = 0;

        for (let i = 0; i < RUNS; i++) {
            const result = await measureRequest();

            times.push(result.elapsed);

            amenityCount = result.totalAmenities;
            categoryCount = result.categories;

            console.log(
                `Request ${i + 1}: ` +
                `${result.elapsed.toFixed(2)} ms`
            );
        }

        const stats = calculateStats(times);

        console.log("\n===== API PERFORMANCE RESULTS =====");

        console.log("Successful requests:", times.length);
        console.log("Amenity categories:", categoryCount);
        console.log("Amenities returned:", amenityCount);

        console.log("\nAverage:", stats.average, "ms");
        console.log("Median:", stats.median, "ms");
        console.log("P95:", stats.p95, "ms");
        console.log("Minimum:", stats.minimum, "ms");
        console.log("Maximum:", stats.maximum, "ms");

        console.log("\nBenchmark completed successfully!");

    } catch (error) {
        console.error(
            "\nBenchmark failed:",
            error.message
        );
        process.exitCode = 1;
    }
}

main();