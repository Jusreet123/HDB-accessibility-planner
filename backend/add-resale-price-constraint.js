
const pool = require("./db");

async function main() {
    try {
        // Check whether the constraint already exists
        const [existing] = await pool.query(`
            SELECT CONSTRAINT_NAME
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'resale_transaction'
              AND CONSTRAINT_TYPE = 'CHECK'
        `);

        if (existing.some(row =>
            row.CONSTRAINT_NAME === "chk_resale_price_positive"
        )) {
            console.log("Constraint already exists.");
            return;
        }

        // Add a positive resale price constraint
        await pool.query(`
            ALTER TABLE resale_transaction
            ADD CONSTRAINT chk_resale_price_positive
            CHECK (resale_price > 0)
        `);

        console.log("CHECK constraint added successfully.");

    } catch (error) {
        console.error("Operation failed:", error.message);
    } finally {
        await pool.end();
    }
}

main();