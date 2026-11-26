require("dotenv").config();

const pool = require("./db");
const { performance } = require("perf_hooks");

async function benchmark() {
    const times = [];

    const sql = `
        SELECT
            r.transaction_id,
            r.resale_price,
            t.town_name
        FROM resale_transaction r
        INNER JOIN block b
            ON r.block_id = b.block_id
        INNER JOIN town t
            ON b.town_id = t.town_id
        ORDER BY r.sale_date DESC
        LIMIT 12
    `;

    try {
        // Warm up the connection and query
        for (let i = 0; i < 5; i++) {
            await pool.query(sql);
        }

        for (let i = 0; i < 30; i++) {
            const start = performance.now();

            const [rows] = await pool.query(sql);

            const elapsed = performance.now() - start;
            times.push(elapsed);

            if (i === 0) {
                console.log("Results found:", rows.length);
            }
        }

        times.sort((a, b) => a - b);

        const average =
            times.reduce((a, b) => a + b, 0) / times.length;

        const median = (times[14] + times[15]) / 2;

        const p95 = times[Math.ceil(times.length * 0.95) - 1];

        console.log("Average:", average.toFixed(2), "ms");
        console.log("Median:", median.toFixed(2), "ms");
        console.log("P95:", p95.toFixed(2), "ms");

    } catch (error) {
        console.error("Benchmark failed:", error.message);
    } finally {
        await pool.end();
    }
}

benchmark();