
const pool = require("./db");

async function main() {
    try {
        console.log("===== SALE DATE INDEX =====");

        const [indexes] = await pool.query(
            "SHOW INDEX FROM resale_transaction"
        );

        console.table(
            indexes
                .filter(index => index.Column_name === "sale_date")
                .map(index => ({
                    Index: index.Key_name,
                    Column: index.Column_name,
                    Unique: index.Non_unique === 0
                }))
        );

        console.log("\n===== RESALE TABLE STRUCTURE =====");

        const [resale] = await pool.query(
            "SHOW CREATE TABLE resale_transaction"
        );

        console.log(resale[0]["Create Table"]);

        console.log("\n===== AUTH METHODS TABLE STRUCTURE =====");

        const [auth] = await pool.query(
            "SHOW CREATE TABLE user_auth_methods"
        );

        console.log(auth[0]["Create Table"]);

        console.log("\n===== BLOCK UNIT COUNT =====");

        const [count] = await pool.query(
            "SELECT COUNT(*) AS total FROM block_unit_count"
        );

        console.table(count);

    } catch (error) {
        console.error("Check failed:", error.message);
    } finally {
        await pool.end();
    }
}

main();