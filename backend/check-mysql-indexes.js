
const pool = require("./db");

async function main() {
    const tables = [
        "block",
        "town",
        "resale_transaction"
    ];

    try {
        for (const table of tables) {
            console.log(`\n===== ${table} INDEXES =====`);

            const [indexes] = await pool.query(
                `SHOW INDEX FROM \`${table}\``
            );

            console.table(
                indexes.map((index) => ({
                    Table: index.Table,
                    Index: index.Key_name,
                    Column: index.Column_name,
                    Unique: index.Non_unique === 0,
                    Sequence: index.Seq_in_index
                }))
            );
        }

        console.log("\n===== BLOCK LOOKUP EXPLAIN =====");

        const [blockPlan] = await pool.query(
            `EXPLAIN
             SELECT block_id, blk_no, street_name,
                    latitude, longitude
             FROM block
             WHERE block_id = ?`,
            [1715]
        );

        console.table(blockPlan);

        console.log("\n===== RESALE JOIN EXPLAIN =====");

        const [joinPlan] = await pool.query(
            `EXPLAIN
             SELECT r.*
             FROM resale_transaction r
             JOIN block b
               ON r.block_id = b.block_id
             JOIN town t
               ON b.town_id = t.town_id
             ORDER BY r.sale_date DESC
             LIMIT 12`
        );

        console.table(joinPlan);

    } catch (error) {
        console.error("Check failed:", error.message);
    } finally {
        await pool.end();
    }
}

main();