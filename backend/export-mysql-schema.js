
const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function main() {
    try {
        console.log("===== HAVEN. MYSQL SCHEMA EXPORT =====");

        // Get all tables from the connected database
        const [tables] = await pool.query("SHOW FULL TABLES");

        const tableNames = tables
            .filter(row =>
                Object.values(row).includes("BASE TABLE")
            )
            .map(row => Object.values(row)[0]);

        console.log("Tables found:", tableNames.length);

        const definitions = [];

        definitions.push(
            "-- Haven. MySQL Database Schema",
            "-- Exported from Aiven MySQL",
            "-- Structure only: no records included",
            "-- Identifiers use backticks so this file runs on any MySQL 8 server",
            "",
            "SET FOREIGN_KEY_CHECKS = 0;",
            ""
        );

        for (const table of tableNames) {
            console.log("Exporting:", table);

            const escapedName = table.replace(/`/g, "``");

            const [rows] = await pool.query(
                `SHOW CREATE TABLE \`${escapedName}\``
            );

            // Aiven runs MySQL in ANSI mode, so SHOW CREATE TABLE quotes names
            // with "double quotes". Standard MySQL rejects that, so switch
            // them to `backticks` to keep schema.sql runnable anywhere.
            const createStatement = rows[0]["Create Table"].replace(/"/g, "`");

            definitions.push(
                `-- Table: ${table}`,
                `${createStatement};`,
                ""
            );
        }

        definitions.push(
            "SET FOREIGN_KEY_CHECKS = 1;",
            ""
        );

        // Save outside backend, inside database folder
        const outputDir = path.join(__dirname, "..", "database");

        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(
            outputDir,
            "schema.sql"
        );

        fs.writeFileSync(
            outputPath,
            definitions.join("\n"),
            "utf8"
        );

        console.log("\n===== EXPORT COMPLETE =====");
        console.log("Tables exported:", tableNames.length);
        console.log("Saved to:", outputPath);

    } catch (error) {
        console.error("Export failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();