
const pool = require("./db");

async function main() {
    try {
        const [rows] = await pool.query(`
            SELECT COUNT(*) AS invalid_prices
            FROM resale_transaction
            WHERE resale_price <= 0
        `);

        console.log("===== RESALE PRICE VALIDATION =====");
        console.log("Invalid resale prices:", rows[0].invalid_prices);

    } catch (error) {
        console.error("Check failed:", error.message);
    } finally {
        await pool.end();
    }
}

main();