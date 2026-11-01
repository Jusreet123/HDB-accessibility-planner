
const pool = require("./db");

async function testDatabase() {
    try {
        console.log("Connecting to Aiven MySQL...");

        // Test the connection
        const [connectionTest] = await pool.query(
            "SELECT DATABASE() AS database_name, VERSION() AS mysql_version"
        );

        console.log("Connection successful!");
        console.log("Database:", connectionTest[0].database_name);
        console.log("MySQL version:", connectionTest[0].mysql_version);

        // Retrieve the tables
        const [tables] = await pool.query("SHOW TABLES");

        console.log("\nTables found:");

        tables.forEach((table) => {
            console.log("-", Object.values(table)[0]);
        });

        console.log("\nDatabase test completed successfully!");

    } catch (error) {
        console.error("\nDatabase connection failed.");
        console.error("Error code:", error.code || "Unknown");
        console.error("Error message:", error.message);
        process.exitCode = 1;

    } finally {
        await pool.end();
    }
}

testDatabase();