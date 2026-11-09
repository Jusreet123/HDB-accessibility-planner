
"use strict";

const express = require("express");
const pool = require("../db");
const { getMongoDB } = require("../mongo");

const router = express.Router();

// ==========================================
// 1. SHARED HELPER FUNCTIONS
// ==========================================

const SINGAPORE_BOUNDS = {
    minLat: 1.1,
    maxLat: 1.5,
    minLon: 103.5,
    maxLon: 104.2
};

function validCoordinates(latitude, longitude) {
    return (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= SINGAPORE_BOUNDS.minLat &&
        latitude <= SINGAPORE_BOUNDS.maxLat &&
        longitude >= SINGAPORE_BOUNDS.minLon &&
        longitude <= SINGAPORE_BOUNDS.maxLon
    );
}

function getField(document, paths) {
    for (const path of paths) {
        const value = path.split(".").reduce(
            (current, key) =>
                current == null ? undefined : current[key],
            document
        );

        if (
            value !== undefined &&
            value !== null &&
            value !== ""
        ) {
            return value;
        }
    }

    return null;
}

function getCoordinates(document) {
    // GeoJSON stores longitude first, latitude second.
    const coordinatePaths = [
        "location.coordinates",
        "geometry.coordinates",
        "coordinates",
        "properties.location.coordinates"
    ];

    for (const path of coordinatePaths) {
        const value = getField(document, [path]);

        if (
            Array.isArray(value) &&
            value.length >= 2 &&
            !Array.isArray(value[0])
        ) {
            const longitude = Number(value[0]);
            const latitude = Number(value[1]);

            if (validCoordinates(latitude, longitude)) {
                return { latitude, longitude };
            }
        }
    }

    const latitude = Number(getField(document, [
        "latitude",
        "Latitude",
        "LATITUDE",
        "lat",
        "Lat",
        "LAT",
        "y",
        "Y",
        "location.latitude",
        "location.lat",
        "properties.latitude",
        "properties.Latitude",
        "properties.LATITUDE",
        "properties.lat"
    ]));

    const longitude = Number(getField(document, [
        "longitude",
        "Longitude",
        "LONGITUDE",
        "lng",
        "Lng",
        "LNG",
        "lon",
        "Lon",
        "LON",
        "long",
        "Long",
        "LONG",
        "x",
        "X",
        "location.longitude",
        "location.lng",
        "location.lon",
        "properties.longitude",
        "properties.Longitude",
        "properties.LONGITUDE",
        "properties.lng",
        "properties.lon"
    ]));

    if (!validCoordinates(latitude, longitude)) {
        return null;
    }

    return { latitude, longitude };
}

function getMongoConnection() {
    return getMongoDB();
}

async function getTownCoverage(townName) {
    const name = String(townName || "").trim();

    if (!name || name.length > 100) {
        const error = new Error("Invalid town name");
        error.statusCode = 400;
        throw error;
    }

    const [townRows] = await pool.query(
        `
        SELECT town_id, town_name
        FROM town
        WHERE UPPER(town_name) = UPPER(?)
        LIMIT 1
        `,
        [name]
    );

    if (!townRows.length) {
        const error = new Error("HDB town not found");
        error.statusCode = 404;
        throw error;
    }

    const town = townRows[0];

    const [blocks] = await pool.query(
        `
        SELECT latitude, longitude
        FROM block
        WHERE town_id = ?
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
        `,
        [town.town_id]
    );

    const points = blocks
        .map(block => ({
            latitude: Number(block.latitude),
            longitude: Number(block.longitude)
        }))
        .filter(point =>
            validCoordinates(
                point.latitude,
                point.longitude
            )
        );

    if (!points.length) {
        const error = new Error(
            "No usable HDB coordinates found"
        );
        error.statusCode = 422;
        throw error;
    }

    const latitudes = points.map(p => p.latitude);
    const longitudes = points.map(p => p.longitude);

    const padding = 0.009;

    return {
        town,
        bounds: {
            minLatitude: Math.min(...latitudes) - padding,
            maxLatitude: Math.max(...latitudes) + padding,
            minLongitude: Math.min(...longitudes) - padding,
            maxLongitude: Math.max(...longitudes) + padding
        }
    };
}

function insideBounds(point, bounds) {
    return (
        point &&
        validCoordinates(
            point.latitude,
            point.longitude
        ) &&
        point.latitude >= bounds.minLatitude &&
        point.latitude <= bounds.maxLatitude &&
        point.longitude >= bounds.minLongitude &&
        point.longitude <= bounds.maxLongitude
    );
}

function mongoBoundingBox(bounds) {
    return {
        "location.type": "Point",

        "location.coordinates.0": {
            $gte: bounds.minLongitude,
            $lte: bounds.maxLongitude
        },

        "location.coordinates.1": {
            $gte: bounds.minLatitude,
            $lte: bounds.maxLatitude
        }
    };
}

function sendApiError(res, error, label) {
    console.error(`${label}:`, error.message);

    const status = error.statusCode || 500;

    return res.status(status).json({
        status: "error",
        message: status === 500
            ? `Unable to retrieve ${label.toLowerCase()}`
            : error.message
    });
}

function getDatabaseOrThrow() {
    try {
        return getMongoConnection();
    } catch (error) {
        const connectionError = new Error(
            "MongoDB is not connected"
        );

        connectionError.statusCode = 503;
        throw connectionError;
    }
}

// ==========================================
// 2. GET ALL TOWN STATISTICS
// GET /api/towns/statistics
// ==========================================

router.get("/statistics", async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                t.town_id,
                t.town_name,

                COUNT(DISTINCT b.block_id)
                    AS total_blocks,

                COUNT(r.transaction_id)
                    AS total_transactions,

                ROUND(AVG(r.resale_price), 2)
                    AS average_price,

                MIN(r.resale_price)
                    AS lowest_price,

                MAX(r.resale_price)
                    AS highest_price

            FROM town t

            LEFT JOIN block b
                ON t.town_id = b.town_id

            LEFT JOIN resale_transaction r
                ON b.block_id = r.block_id

            GROUP BY
                t.town_id,
                t.town_name

            ORDER BY
                t.town_name ASC
        `);

        return res.json({
            status: "success",
            count: rows.length,
            data: rows
        });

    } catch (error) {
        return sendApiError(
            res,
            error,
            "Town statistics"
        );
    }
});

// ==========================================
// 3. GET DETAILS FOR ONE HDB TOWN
// GET /api/towns/details/ANG%20MO%20KIO
// ==========================================

router.get("/details/:townName", async (req, res) => {
    try {
        const townName = String(
            req.params.townName || ""
        ).trim();

        if (!townName) {
            return res.status(400).json({
                status: "error",
                message: "Town name is required"
            });
        }

        // A. TOWN OVERVIEW

        const [townRows] = await pool.query(
            `
            SELECT
                t.town_id,
                t.town_name,

                COUNT(DISTINCT b.block_id)
                    AS total_blocks,

                COUNT(r.transaction_id)
                    AS total_transactions,

                ROUND(AVG(r.resale_price), 2)
                    AS average_price,

                MIN(r.resale_price)
                    AS lowest_price,

                MAX(r.resale_price)
                    AS highest_price

            FROM town t

            LEFT JOIN block b
                ON t.town_id = b.town_id

            LEFT JOIN resale_transaction r
                ON b.block_id = r.block_id

            WHERE UPPER(t.town_name) = UPPER(?)

            GROUP BY
                t.town_id,
                t.town_name
            `,
            [townName]
        );

        if (!townRows.length) {
            return res.status(404).json({
                status: "error",
                message: "HDB town not found"
            });
        }

        const town = townRows[0];

        // B. RESALE STATISTICS BY FLAT TYPE

        const [flatTypes] = await pool.query(
            `
            SELECT
                ft.flat_type_name,

                COUNT(r.transaction_id)
                    AS total_transactions,

                ROUND(AVG(r.resale_price), 2)
                    AS average_price,

                MIN(r.resale_price)
                    AS lowest_price,

                MAX(r.resale_price)
                    AS highest_price

            FROM resale_transaction r

            INNER JOIN block b
                ON r.block_id = b.block_id

            INNER JOIN town t
                ON b.town_id = t.town_id

            INNER JOIN flat_type ft
                ON r.flat_type_id = ft.flat_type_id

            WHERE t.town_id = ?

            GROUP BY
                ft.flat_type_id,
                ft.flat_type_name

            ORDER BY
                ft.flat_type_name ASC
            `,
            [town.town_id]
        );

        // C. ALL HDB BLOCKS IN THIS TOWN

        const [blocks] = await pool.query(
            `
            SELECT
                b.block_id,
                b.blk_no,
                b.street_name,
                b.postal,
                b.year_completed,
                b.latitude,
                b.longitude

            FROM block b

            WHERE b.town_id = ?

            ORDER BY
                b.street_name ASC,
                b.blk_no ASC
            `,
            [town.town_id]
        );

        return res.json({
            status: "success",
            town,
            flatTypes,
            totalBlocks: blocks.length,
            blocks
        });

    } catch (error) {
        return sendApiError(
            res,
            error,
            "Town details"
        );
    }
});

// ==========================================
// 4. GET MRT/LRT STATIONS
// GET /api/towns/ANG%20MO%20KIO/mrt
// ==========================================

router.get("/:townName/mrt", async (req, res) => {
    try {
        const { town, bounds } =
            await getTownCoverage(req.params.townName);

        const mongoDb = getDatabaseOrThrow();

        const exits = await mongoDb
            .collection("mrt_exits")
            .find(
                mongoBoundingBox(bounds),
                {
                    projection: {
                        _id: 0,
                        station_name: 1,
                        station_na: 1,
                        exit_code: 1,
                        location: 1
                    }
                }
            )
            .toArray();

        const stationMap = new Map();

        exits.forEach(exit => {
            const name = String(
                exit.station_name ||
                exit.station_na ||
                ""
            ).trim();

            const point = getCoordinates(exit);

            if (!name || !point) {
                return;
            }

            const key = name.toUpperCase();

            if (!stationMap.has(key)) {
                stationMap.set(key, {
                    name,
                    latitudeSum: 0,
                    longitudeSum: 0,
                    exitCount: 0
                });
            }

            const station = stationMap.get(key);

            station.latitudeSum += point.latitude;
            station.longitudeSum += point.longitude;
            station.exitCount++;
        });

        const stations = Array.from(
            stationMap.values()
        ).map(station => ({
            name: station.name,

            latitude:
                station.latitudeSum /
                station.exitCount,

            longitude:
                station.longitudeSum /
                station.exitCount,

            exit_count: station.exitCount
        }));

        stations.sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        return res.json({
            status: "success",
            town: town.town_name,
            count: stations.length,

            location_method:
                "Average coordinates of MRT/LRT exits",

            coverage:
                "HDB block bounding box with approximately 1 km padding",

            stations
        });

    } catch (error) {
        return sendApiError(
            res,
            error,
            "Town MRT"
        );
    }
});

// ==========================================
// 5. GET BUS STOPS
// GET /api/towns/ANG%20MO%20KIO/bus-stops
// ==========================================

router.get("/:townName/bus-stops", async (req, res) => {
    try {
        const { town, bounds } =
            await getTownCoverage(req.params.townName);

        const mongoDb = getDatabaseOrThrow();

        const documents = await mongoDb
            .collection("bus_stops")
            .find(
                mongoBoundingBox(bounds),
                {
                    projection: {
                        _id: 0,
                        bus_stop_num: 1,
                        bus_roof_num: 1,
                        location: 1
                    }
                }
            )
            .toArray();

        const busStopMap = new Map();

        documents.forEach(document => {
            const point = getCoordinates(document);

            const number = String(
                document.bus_stop_num || ""
            ).trim();

            if (!point || !number) {
                return;
            }

            if (busStopMap.has(number)) {
                return;
            }

            busStopMap.set(number, {
                bus_stop_num: number,

                bus_roof_num:
                    document.bus_roof_num
                        ? String(document.bus_roof_num)
                        : null,

                latitude: point.latitude,
                longitude: point.longitude
            });
        });

        const busStops = Array.from(
            busStopMap.values()
        );

        busStops.sort((a, b) =>
            a.bus_stop_num.localeCompare(
                b.bus_stop_num,
                undefined,
                { numeric: true }
            )
        );

        return res.json({
            status: "success",
            town: town.town_name,
            count: busStops.length,

            coverage:
                "HDB block bounding box with approximately 1 km padding",

            bus_stops: busStops
        });

    } catch (error) {
        return sendApiError(
            res,
            error,
            "Town bus stop"
        );
    }
});

// ==========================================
// 6. GET HAWKER CENTRES
// GET /api/towns/ANG%20MO%20KIO/hawkers
// ==========================================

router.get("/:townName/hawkers", async (req, res) => {
    try {
        const { town, bounds } =
            await getTownCoverage(req.params.townName);

        const mongoDb = getDatabaseOrThrow();

        const documents = await mongoDb
            .collection("hawker_centres")
            .find(
                mongoBoundingBox(bounds),
                {
                    projection: {
                        _id: 0,
                        objectid: 1,
                        name: 1,
                        address_myenv: 1,
                        addresspostalcode: 1,
                        number_of_cooked_food_stalls: 1,
                        status: 1,
                        photourl: 1,
                        location: 1
                    }
                }
            )
            .toArray();

        const hawkerMap = new Map();

        documents.forEach(document => {
            const point = getCoordinates(document);

            const name = String(
                document.name || ""
            ).trim();

            if (!point || !name) {
                return;
            }

            const objectId = String(
                document.objectid || ""
            ).trim();

            const key = objectId ||
                `${name.toUpperCase()}|` +
                `${point.latitude.toFixed(6)}|` +
                `${point.longitude.toFixed(6)}`;

            if (hawkerMap.has(key)) {
                return;
            }

            const rawStalls =
                document.number_of_cooked_food_stalls;

            const stalls = Number(rawStalls);

            hawkerMap.set(key, {
                objectid: objectId || null,
                name,

                address:
                    document.address_myenv
                        ? String(document.address_myenv).trim()
                        : null,

                postal_code:
                    document.addresspostalcode
                        ? String(document.addresspostalcode).trim()
                        : null,

                number_of_cooked_food_stalls:
                    rawStalls !== null &&
                    rawStalls !== undefined &&
                    rawStalls !== "" &&
                    Number.isFinite(stalls)
                        ? stalls
                        : null,

                status:
                    document.status
                        ? String(document.status).trim()
                        : null,

                photo_url:
                    document.photourl
                        ? String(document.photourl).trim()
                        : null,

                latitude: point.latitude,
                longitude: point.longitude
            });
        });

        const hawkers = Array.from(
            hawkerMap.values()
        );

        hawkers.sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        return res.json({
            status: "success",
            town: town.town_name,
            count: hawkers.length,

            coverage:
                "HDB block bounding box with approximately 1 km padding",

            hawkers
        });

    } catch (error) {
        return sendApiError(
            res,
            error,
            "Town hawker centre"
        );
    }
});

// ==========================================
// 7. SHARED PARKS AND CHILDCARE HELPERS
// ==========================================

function normaliseAmenity(document, type) {
    const point = getCoordinates(document);

    if (!point) {
        return null;
    }

    const parkNames = [
        "name",
        "Name",
        "NAME",
        "park_name",
        "parkName",
        "PARK_NAME",
        "parkname",
        "properties.name",
        "properties.NAME",
        "properties.park_name",
        "properties.PARK_NAME"
    ];

    const childcareNames = [
        "name",
        "Name",
        "NAME",
        "centre_name",
        "center_name",
        "childcare_name",
        "child_care_name",
        "organisation_name",
        "organisation",
        "preschool_name",
        "school_name",
        "CENTRE_NAME",
        "CENTRE_NAME_1",
        "centreName",
        "properties.name",
        "properties.NAME",
        "properties.centre_name"
    ];

    const name = getField(
        document,
        type === "parks"
            ? parkNames
            : childcareNames
    );

    if (!name || !String(name).trim()) {
        return null;
    }

    const address = getField(document, [
        "address",
        "Address",
        "ADDRESS",
        "address_myenv",
        "full_address",
        "fullAddress",
        "location_address",
        "centre_address",
        "street_address",
        "streetAddress",
        "properties.address",
        "properties.ADDRESS",
        "properties.address_myenv"
    ]);

    const postalCode = getField(document, [
        "postal_code",
        "postalcode",
        "postal",
        "POSTAL_CODE",
        "POSTALCODE",
        "postcode",
        "addresspostalcode",
        "properties.postal_code",
        "properties.POSTAL_CODE"
    ]);

    const id = getField(document, [
        "objectid",
        "OBJECTID",
        "id",
        "ID",
        "centre_code",
        "centre_id",
        "park_id",
        "properties.OBJECTID"
    ]);

    return {
        id: id == null ? null : String(id),
        name: String(name).trim(),

        address:
            address == null
                ? null
                : String(address).trim(),

        postal_code:
            postalCode == null
                ? null
                : String(postalCode).trim(),

        latitude: point.latitude,
        longitude: point.longitude,
        type
    };
}

async function serveTownAmenities(req, res, type) {
    try {
        const { town, bounds } =
            await getTownCoverage(req.params.townName);

        const mongoDb = getDatabaseOrThrow();

        // Both collections are relatively small.
        // Fetching their records allows us to support
        // several coordinate formats without requiring
        // a fixed MongoDB document schema.

        const documents = await mongoDb
            .collection(type)
            .find({})
            .toArray();

        const unique = new Map();

        documents.forEach(document => {
            const amenity = normaliseAmenity(
                document,
                type
            );

            if (
                !amenity ||
                !insideBounds(amenity, bounds)
            ) {
                return;
            }

            const key = amenity.id ||
                `${amenity.name.toUpperCase()}|` +
                `${amenity.latitude.toFixed(6)}|` +
                `${amenity.longitude.toFixed(6)}`;

            if (!unique.has(key)) {
                unique.set(key, amenity);
            }
        });

        const items = Array.from(
            unique.values()
        );

        items.sort((a, b) =>
            a.name.localeCompare(b.name)
        );

        const responseKey =
            type === "parks"
                ? "parks"
                : "childcare_centres";

        return res.json({
            status: "success",
            town: town.town_name,
            count: items.length,

            coverage:
                "HDB block bounding box with approximately 1 km padding",

            [responseKey]: items
        });

    } catch (error) {
        return sendApiError(
            res,
            error,
            `Town ${type}`
        );
    }
}

// ==========================================
// 8. GET PARKS
// GET /api/towns/ANG%20MO%20KIO/parks
// ==========================================

router.get("/:townName/parks", async (req, res) => {
    return serveTownAmenities(
        req,
        res,
        "parks"
    );
});

// ==========================================
// 9. GET CHILDCARE CENTRES
// GET /api/towns/ANG%20MO%20KIO/childcare
// ==========================================

router.get("/:townName/childcare", async (req, res) => {
    return serveTownAmenities(
        req,
        res,
        "childcare_centres"
    );
});

// ==========================================
// 10. EXPORT ROUTER
// ==========================================

module.exports = router;