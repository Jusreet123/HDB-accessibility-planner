
const { connectMongoDB } = require("./mongo");

const collections = [
    "mrt_exits",
    "bus_stops",
    "hawker_centres",
    "childcare_centres",
    "parks"
];

async function main() {
    const db = await connectMongoDB();

    if (!db) {
        throw new Error("MongoDB connection failed");
    }

    const location = {
        type: "Point",
        coordinates: [103.7140978842, 1.348241224658]
    };

    try {
        for (const name of collections) {
            console.log(`\n===== ${name} =====`);

            const pipeline = [
                {
                    $geoNear: {
                        near: location,
                        key: "location",
                        distanceField: "distance_m",
                        maxDistance: 500,
                        spherical: true
                    }
                },
                { $limit: 5 }
            ];

            const explain = await db
                .collection(name)
                .aggregate(pipeline)
                .explain("executionStats");

            const plan = JSON.stringify(explain);

            console.log(
                "GEO_NEAR_2DSPHERE:",
                plan.includes("GEO_NEAR_2DSPHERE")
            );

            console.log(
                "IXSCAN:",
                plan.includes("IXSCAN")
            );

            console.log(
                "location_2dsphere:",
                plan.includes("location_2dsphere")
            );
        }

    } finally {
        console.log("\n===== CHECK COMPLETE =====");
        process.exit(0);
    }
}

main().catch(error => {
    console.error("Check failed:", error.message);
    process.exit(1);
});