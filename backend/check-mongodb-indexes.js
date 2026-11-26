
const {
    connectMongoDB,
    getMongoDB
} = require("./mongo");

const collections = [
    "mrt_exits",
    "bus_stops",
    "hawker_centres",
    "childcare_centres",
    "parks"
];

async function main() {
    console.log("===== HAVEN. MONGODB INDEX CHECK =====");

    // Use Haven.'s existing MongoDB connection
    const db = await connectMongoDB();

    if (!db) {
        throw new Error("Unable to connect to MongoDB");
    }

    for (const name of collections) {
        const collection = db.collection(name);

        console.log(`\n===== ${name} =====`);

        // Retrieve indexes
        const indexes = await collection.indexes();

        console.table(
            indexes.map(index => ({
                name: index.name,
                fields: JSON.stringify(index.key)
            }))
        );

        // Retrieve document count
        const count =
            await collection.estimatedDocumentCount();

        console.log("Documents:", count);

        // Check 2dsphere index
        const geoIndex = indexes.find(
            index => index.key.location === "2dsphere"
        );

        console.log(
            "Geospatial index:",
            geoIndex ? "YES" : "NO"
        );
    }

    console.log("\n===== CHECK COMPLETE =====");

    // The standalone script can exit once its checks finish.
    // The MongoDB driver connection does not need to stay open.
    process.exit(0);
}

main().catch(error => {
    console.error("Check failed:", error.message);
    process.exitCode = 1;
    process.exit();
});