
const { performance } = require("perf_hooks");

const BASE_URL = "https://haven-hdb.onrender.com";
const BLOCK_ID = 1715;
const RUNS = 30;

function stats(values) {
    const sorted = [...values].sort((a, b) => a - b);

    return {
        average: (
            values.reduce((a, b) => a + b, 0) /
            values.length
        ).toFixed(2),

        median: (
            (sorted[14] + sorted[15]) / 2
        ).toFixed(2),

        p95: sorted[Math.ceil(values.length * 0.95) - 1]
            .toFixed(2)
    };
}

async function measure(radius) {
    const url =
        `${BASE_URL}/api/blocks/${BLOCK_ID}/amenities` +
        `?radius=${radius}&include_community=0`;

    const start = performance.now();

    const response = await fetch(url);
    const data = await response.json();

    const elapsed = performance.now() - start;

    if (!response.ok || data.status !== "success") {
        throw new Error(`HTTP ${response.status}`);
    }

    return {
        elapsed,
        cache: response.headers.get("x-cache")
    };
}

async function main() {
    const missTimes = [];
    const hitTimes = [];

    console.log("===== HAVEN. CACHE BENCHMARK =====");

    // Warm up HTTP connection
    await measure(500);

    // Each unique radius creates a new cache entry
    console.log("\nTesting cache MISS...");

    for (let i = 0; i < RUNS; i++) {
        const radius = 1000 + i;

        const result = await measure(radius);

        if (result.cache !== "MISS") {
            throw new Error(
                `Expected MISS, got ${result.cache}`
            );
        }

        missTimes.push(result.elapsed);
    }

    // Repeat the same radii to test cache HIT
    console.log("Testing cache HIT...");

    for (let i = 0; i < RUNS; i++) {
        const radius = 1000 + i;

        const result = await measure(radius);

        if (result.cache !== "HIT") {
            throw new Error(
                `Expected HIT, got ${result.cache}`
            );
        }

        hitTimes.push(result.elapsed);
    }

    const miss = stats(missTimes);
    const hit = stats(hitTimes);

    const improvement =
        (1 - Number(hit.average) / Number(miss.average)) * 100;

    console.log("\n===== RESULTS =====");

    console.log("\nCache MISS");
    console.log("Average:", miss.average, "ms");
    console.log("Median:", miss.median, "ms");
    console.log("P95:", miss.p95, "ms");

    console.log("\nCache HIT");
    console.log("Average:", hit.average, "ms");
    console.log("Median:", hit.median, "ms");
    console.log("P95:", hit.p95, "ms");

    console.log(
        "\nAverage latency reduction:",
        improvement.toFixed(2) + "%"
    );
}

main().catch(console.error);