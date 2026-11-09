
"use strict";

document.addEventListener("DOMContentLoaded", async () => {

    // ==========================================
    // 1. PAGE ELEMENTS AND STATE
    // ==========================================

    const townTitle = document.getElementById("townTitle");
    const townDescription = document.getElementById("townDescription");
    const townExploreLink = document.getElementById("townExploreLink");
    const townStatus = document.getElementById("townStatus");
    const townStats = document.getElementById("townStats");
    const townFlatTypes = document.getElementById("townFlatTypes");
    const townMapElement = document.getElementById("townMap");
    const townBlockCount = document.getElementById("townBlockCount");
    const townBlockSearch = document.getElementById("townBlockSearch");
    const townBlockResults = document.getElementById("townBlockResults");

    const selectedTown = new URLSearchParams(
        window.location.search
    ).get("town");

    let allBlocks = [];
    let townMap = null;

    const layers = {
        blocks: null,
        mrt: null,
        buses: null,
        hawkers: null,
        parks: null,
        childcare: null
    };

    // ==========================================
    // 2. FORMATTING AND VALIDATION
    // ==========================================

    function formatNumber(value) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number.toLocaleString("en-SG")
            : "N/A";
    }

    function formatPrice(value) {
        if (value === null || value === undefined || value === "") {
            return "N/A";
        }

        const number = Number(value);

        if (!Number.isFinite(number)) {
            return "N/A";
        }

        return new Intl.NumberFormat("en-SG", {
            style: "currency",
            currency: "SGD",
            maximumFractionDigits: 0
        }).format(number);
    }

    function createElement(tag, className = "", content = null) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (content !== null && content !== undefined) {
            element.textContent = String(content);
        }

        return element;
    }

    function validCoordinates(latitude, longitude) {
        return (
            Number.isFinite(latitude) &&
            Number.isFinite(longitude) &&
            latitude >= 1.1 &&
            latitude <= 1.5 &&
            longitude >= 103.5 &&
            longitude <= 104.2
        );
    }

    function addPopupLine(container, label, value) {
        if (value === null || value === undefined || value === "") {
            return;
        }

        const paragraph = createElement(
            "p",
            "",
            label ? `${label}: ${value}` : value
        );

        paragraph.style.margin = "6px 0";
        container.appendChild(paragraph);
    }

    function makePopup(title, subtitle, details = []) {
        const popup = document.createElement("div");

        popup.style.minWidth = "180px";
        popup.style.maxWidth = "260px";

        const heading = createElement("strong", "", title);
        heading.style.display = "block";
        heading.style.marginBottom = "8px";

        popup.appendChild(heading);

        if (subtitle) {
            addPopupLine(popup, "", subtitle);
        }

        details.forEach(detail => {
            addPopupLine(
                popup,
                detail.label,
                detail.value
            );
        });

        return popup;
    }

    // ==========================================
    // 3. TOWN OVERVIEW
    // ==========================================

    function renderTownOverview(town) {
        townTitle.textContent = town.town_name;

        townDescription.textContent =
            `Discover HDB resale transactions, housing prices ` +
            `and residential blocks in ${town.town_name}.`;

        townExploreLink.href =
            `explore.html?town=${encodeURIComponent(town.town_name)}`;

        const statistics = [
            ["HDB Blocks", formatNumber(town.total_blocks)],
            ["Resale Transactions", formatNumber(town.total_transactions)],
            ["Average Resale Price", formatPrice(town.average_price)],
            ["Lowest Resale Price", formatPrice(town.lowest_price)],
            ["Highest Resale Price", formatPrice(town.highest_price)]
        ];

        townStats.replaceChildren();

        statistics.forEach(([label, value]) => {
            const card = createElement(
                "article",
                "town-stat-card"
            );

            card.append(
                createElement("p", "town-stat-label", label),
                createElement("h3", "town-stat-value", value)
            );

            townStats.appendChild(card);
        });
    }

    // ==========================================
    // 4. FLAT TYPE PRICE BREAKDOWN
    // ==========================================

    function renderFlatTypes(flatTypes) {
        townFlatTypes.replaceChildren();

        if (!flatTypes.length) {
            const row = document.createElement("tr");
            const cell = createElement(
                "td",
                "",
                "No resale transactions available."
            );

            cell.colSpan = 5;
            row.appendChild(cell);
            townFlatTypes.appendChild(row);
            return;
        }

        flatTypes.forEach(flat => {
            const row = document.createElement("tr");

            const values = [
                flat.flat_type_name,
                formatNumber(flat.total_transactions),
                formatPrice(flat.average_price),
                formatPrice(flat.lowest_price),
                formatPrice(flat.highest_price)
            ];

            values.forEach(value => {
                row.appendChild(
                    createElement("td", "", value)
                );
            });

            townFlatTypes.appendChild(row);
        });
    }

    // ==========================================
    // 5. CUSTOM MAP ICONS
    // ==========================================

    function createBlockIcon() {
        return L.divIcon({
            className: "haven-block-marker",
            html: `
                <span style="
                    display:block;
                    width:12px;
                    height:12px;
                    border-radius:50%;
                    background:#14b8a6;
                    border:2px solid #0f766e;
                    box-shadow:0 1px 4px rgba(0,0,0,.25);
                "></span>
            `,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
            popupAnchor: [0, -8]
        });
    }

    function createAmenityIcon(symbol, colour, shape = "circle") {
        const radius = shape === "square" ? "7px" : "50%";

        return L.divIcon({
            className: "haven-amenity-marker",
            html: `
                <span style="
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    width:28px;
                    height:28px;
                    border-radius:${radius};
                    background:${colour};
                    color:#ffffff;
                    font-size:15px;
                    font-weight:700;
                    font-family:Arial,sans-serif;
                    border:3px solid white;
                    box-shadow:0 2px 8px rgba(0,0,0,.3);
                    box-sizing:content-box;
                ">${symbol}</span>
            `,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            popupAnchor: [0, -17]
        });
    }

    const iconSettings = {
        mrt: ["M", "#2563eb", "circle"],
        buses: ["B", "#f59e0b", "square"],
        hawkers: ["🍴", "#dc2626", "circle"],
        parks: ["🌳", "#16a34a", "circle"],
        childcare: ["C", "#9333ea", "circle"]
    };

    function getIcon(type) {
        return createAmenityIcon(...iconSettings[type]);
    }

    // ==========================================
    // 6. CUSTOM CLUSTER ICON
    // ==========================================

    function createClusterIcon(cluster, colour, border, textColour) {
        const count = cluster.getChildCount();

        const diameter =
            count >= 100 ? 48 :
            count >= 10 ? 42 : 36;

        return L.divIcon({
            className: "haven-custom-cluster",
            html: `
                <div style="
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    width:${diameter}px;
                    height:${diameter}px;
                    border-radius:50%;
                    background:${colour};
                    border:4px solid ${border};
                    box-sizing:border-box;
                    color:${textColour};
                    font-family:Arial,sans-serif;
                    font-weight:700;
                    font-size:13px;
                    box-shadow:0 2px 8px rgba(0,0,0,.25);
                ">${count}</div>
            `,
            iconSize: [diameter, diameter],
            iconAnchor: [diameter / 2, diameter / 2]
        });
    }

    function createClusterLayer(colour, border, textColour) {
        return L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            removeOutsideVisibleBounds: true,
            chunkedLoading: true,
            maxClusterRadius: 40,
            disableClusteringAtZoom: 18,
            iconCreateFunction: cluster =>
                createClusterIcon(
                    cluster,
                    colour,
                    border,
                    textColour
                )
        });
    }

    // ==========================================
    // 7. INITIALISE INTERACTIVE MAP
    // ==========================================

    function initialiseTownMap() {
        if (typeof L === "undefined") {
            townMapElement.textContent =
                "Unable to load the interactive map.";
            return false;
        }

        if (typeof L.markerClusterGroup !== "function") {
            townMapElement.textContent =
                "Unable to load map clustering. Please refresh.";
            return false;
        }

        if (townMap) {
            return true;
        }

        townMap = L.map("townMap").setView(
            [1.3521, 103.8198],
            11
        );

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution: "&copy; OpenStreetMap contributors",
                maxZoom: 19
            }
        ).addTo(townMap);

        // Existing HDB cluster styling
        layers.blocks = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            removeOutsideVisibleBounds: true,
            chunkedLoading: true,
            maxClusterRadius: 45,
            disableClusteringAtZoom: 18
        });

        // Existing MRT/LRT layer
        layers.mrt = L.layerGroup();

        // Existing bus stop clustering
        layers.buses = createClusterLayer(
            "#f59e0b",
            "#fde68a",
            "#78350f"
        );

        // Existing hawker centre layer
        layers.hawkers = L.layerGroup();

        // NEW: Parks layer
        layers.parks = L.layerGroup();

        // NEW: Childcare centres cluster layer
        layers.childcare = createClusterLayer(
            "#9333ea",
            "#e9d5ff",
            "#ffffff"
        );

        // Default ON
        townMap.addLayer(layers.blocks);
        townMap.addLayer(layers.mrt);

        // All remaining layers start OFF
        const overlays = {
            "HDB Blocks": layers.blocks,
            "MRT/LRT Stations": layers.mrt,
            "Bus Stops": layers.buses,
            "Hawker Centres": layers.hawkers,
            "Parks": layers.parks,
            "Childcare Centres": layers.childcare
        };

        L.control.layers(
            null,
            overlays,
            {
                collapsed: false,
                position: "topright"
            }
        ).addTo(townMap);

        return true;
    }

    // ==========================================
    // 8. RENDER HDB BLOCK MARKERS
    // ==========================================

    function renderTownMap(blocks) {
        if (!initialiseTownMap()) {
            return;
        }

        layers.blocks.clearLayers();

        const bounds = [];
        const blockIcon = createBlockIcon();

        blocks.forEach(block => {
            const latitude = Number(block.latitude);
            const longitude = Number(block.longitude);

            if (!validCoordinates(latitude, longitude)) {
                return;
            }

            const address =
                `${block.blk_no} ${block.street_name}`;

            const marker = L.marker(
                [latitude, longitude],
                {
                    icon: blockIcon,
                    title: address
                }
            );

            const popup = document.createElement("div");

            popup.appendChild(
                createElement("strong", "", address)
            );

            popup.appendChild(
                document.createElement("br")
            );

            const link = document.createElement("a");

            link.href =
                `block.html?id=${encodeURIComponent(block.block_id)}`;

            link.textContent = "View Block Details";

            popup.appendChild(link);

            marker.bindPopup(popup);
            layers.blocks.addLayer(marker);

            bounds.push([latitude, longitude]);
        });

        if (bounds.length) {
            townMap.fitBounds(bounds, {
                padding: [30, 30],
                maxZoom: 15
            });
        } else {
            townMap.setView(
                [1.3521, 103.8198],
                11
            );
        }

        setTimeout(() => {
            if (townMap) {
                townMap.invalidateSize();
            }
        }, 100);
    }

    // ==========================================
    // 9. SHARED AMENITY API LOADER
    // ==========================================

    async function fetchAmenityData(endpoint, responseKey) {
        const response = await fetch(
            `/api/towns/${encodeURIComponent(selectedTown)}/${endpoint}`
        );

        if (!response.ok) {
            throw new Error(
                `${endpoint} API returned HTTP ${response.status}`
            );
        }

        const result = await response.json();

        if (
            result.status !== "success" ||
            !Array.isArray(result[responseKey])
        ) {
            throw new Error(
                result.message ||
                `Invalid ${endpoint} API response`
            );
        }

        return result[responseKey];
    }

    function addAmenityMarker(
        layer,
        latitude,
        longitude,
        name,
        icon,
        popup,
        zIndexOffset = 0
    ) {
        if (!validCoordinates(latitude, longitude)) {
            return;
        }

        const marker = L.marker(
            [latitude, longitude],
            {
                icon,
                title: name,
                zIndexOffset
            }
        );

        marker.bindPopup(popup);
        layer.addLayer(marker);
    }

    // ==========================================
    // 10. LOAD MRT/LRT STATIONS
    // ==========================================

    async function loadMrtStations() {
        try {
            const stations = await fetchAmenityData(
                "mrt",
                "stations"
            );

            layers.mrt.clearLayers();

            const icon = getIcon("mrt");

            stations.forEach(station => {
                const name = String(
                    station.name || "Unknown Station"
                );

                const popup = makePopup(
                    name,
                    "MRT/LRT Station",
                    [{
                        label: "Recorded exits in map coverage",
                        value: formatNumber(station.exit_count || 0)
                    }]
                );

                addAmenityMarker(
                    layers.mrt,
                    Number(station.latitude),
                    Number(station.longitude),
                    name,
                    icon,
                    popup,
                    1000
                );
            });

            console.log(
                `Loaded ${stations.length} MRT/LRT stations.`
            );

        } catch (error) {
            console.error(
                "Unable to load MRT/LRT stations:",
                error
            );
        }
    }

    // ==========================================
    // 11. LOAD BUS STOPS
    // ==========================================

    async function loadBusStops() {
        try {
            const busStops = await fetchAmenityData(
                "bus-stops",
                "bus_stops"
            );

            layers.buses.clearLayers();

            const icon = getIcon("buses");

            busStops.forEach(busStop => {
                const number = String(
                    busStop.bus_stop_num || ""
                ).trim();

                if (!number) {
                    return;
                }

                const roofNumber =
                    busStop.bus_roof_num;

                const showRoof =
                    roofNumber !== null &&
                    roofNumber !== undefined &&
                    String(roofNumber).trim() !== "" &&
                    String(roofNumber).trim().toUpperCase() !== "NIL";

                const popup = makePopup(
                    `Bus Stop ${number}`,
                    "Public Bus Stop",
                    showRoof
                        ? [{
                            label: "Shelter reference",
                            value: roofNumber
                        }]
                        : []
                );

                addAmenityMarker(
                    layers.buses,
                    Number(busStop.latitude),
                    Number(busStop.longitude),
                    `Bus Stop ${number}`,
                    icon,
                    popup
                );
            });

            console.log(
                `Loaded ${busStops.length} bus stops.`
            );

        } catch (error) {
            console.error(
                "Unable to load bus stops:",
                error
            );
        }
    }

    // ==========================================
    // 12. LOAD HAWKER CENTRES
    // ==========================================

    async function loadHawkerCentres() {
        try {
            const hawkers = await fetchAmenityData(
                "hawkers",
                "hawkers"
            );

            layers.hawkers.clearLayers();

            const icon = getIcon("hawkers");

            hawkers.forEach(hawker => {
                const name = String(
                    hawker.name || "Unknown Hawker Centre"
                );

                const stallCount =
                    hawker.number_of_cooked_food_stalls;

                const details = [
                    {
                        label: "Address",
                        value: hawker.address
                    },
                    {
                        label: "Cooked food stalls",
                        value:
                            stallCount !== null &&
                            stallCount !== undefined &&
                            stallCount !== ""
                                ? formatNumber(stallCount)
                                : null
                    },
                    {
                        label: "Status",
                        value: hawker.status
                    }
                ];

                const popup = makePopup(
                    name,
                    "Hawker Centre / Food Centre",
                    details
                );

                addAmenityMarker(
                    layers.hawkers,
                    Number(hawker.latitude),
                    Number(hawker.longitude),
                    name,
                    icon,
                    popup,
                    500
                );
            });

            console.log(
                `Loaded ${hawkers.length} hawker centres.`
            );

        } catch (error) {
            console.error(
                "Unable to load hawker centres:",
                error
            );
        }
    }

    // ==========================================
    // 13. NEW: LOAD PARKS
    // ==========================================

    async function loadParks() {
        try {
            const parks = await fetchAmenityData(
                "parks",
                "parks"
            );

            layers.parks.clearLayers();

            const icon = getIcon("parks");

            parks.forEach(park => {
                const name = String(
                    park.name || "Unknown Park"
                );

                const popup = makePopup(
                    name,
                    "Park / Green Space",
                    [
                        {
                            label: "Address",
                            value: park.address
                        },
                        {
                            label: "Postal code",
                            value: park.postal_code
                        }
                    ]
                );

                addAmenityMarker(
                    layers.parks,
                    Number(park.latitude),
                    Number(park.longitude),
                    name,
                    icon,
                    popup,
                    400
                );
            });

            console.log(
                `Loaded ${parks.length} parks near ${selectedTown}.`
            );

        } catch (error) {
            console.error(
                "Unable to load parks:",
                error
            );
        }
    }

    // ==========================================
    // 14. NEW: LOAD CHILDCARE CENTRES
    // ==========================================

    async function loadChildcareCentres() {
        try {
            const centres = await fetchAmenityData(
                "childcare",
                "childcare_centres"
            );

            layers.childcare.clearLayers();

            const icon = getIcon("childcare");

            centres.forEach(centre => {
                const name = String(
                    centre.name || "Unknown Childcare Centre"
                );

                const popup = makePopup(
                    name,
                    "Childcare / Preschool Centre",
                    [
                        {
                            label: "Address",
                            value: centre.address
                        },
                        {
                            label: "Postal code",
                            value: centre.postal_code
                        }
                    ]
                );

                addAmenityMarker(
                    layers.childcare,
                    Number(centre.latitude),
                    Number(centre.longitude),
                    name,
                    icon,
                    popup,
                    600
                );
            });

            console.log(
                `Loaded ${centres.length} childcare centres near ${selectedTown}.`
            );

        } catch (error) {
            console.error(
                "Unable to load childcare centres:",
                error
            );
        }
    }

    // ==========================================
    // 15. HDB BLOCK DIRECTORY
    // ==========================================

    function renderBlockDirectory(blocks) {
        townBlockResults.replaceChildren();

        townBlockCount.textContent =
            `${formatNumber(blocks.length)} blocks displayed ` +
            `out of ${formatNumber(allBlocks.length)}`;

        if (!blocks.length) {
            townBlockResults.appendChild(
                createElement(
                    "p",
                    "",
                    "No HDB blocks match your search."
                )
            );
            return;
        }

        const fragment = document.createDocumentFragment();

        blocks.forEach(block => {
            const card = createElement(
                "article",
                "town-block-card"
            );

            const address = createElement(
                "h3",
                "",
                `${block.blk_no} ${block.street_name}`
            );

            const postal = createElement(
                "p",
                "",
                block.postal
                    ? `Postal code: ${block.postal}`
                    : "Postal code unavailable"
            );

            const year = createElement(
                "p",
                "",
                block.year_completed
                    ? `Completed: ${block.year_completed}`
                    : "Completion year unavailable"
            );

            const link = document.createElement("a");

            link.href =
                `block.html?id=${encodeURIComponent(block.block_id)}`;

            link.textContent = "View Block Details →";

            card.append(
                address,
                postal,
                year,
                link
            );

            fragment.appendChild(card);
        });

        townBlockResults.appendChild(fragment);
    }

    // ==========================================
    // 16. SEARCH HDB BLOCKS
    // ==========================================

    townBlockSearch.addEventListener("input", () => {
        const searchTerm = townBlockSearch.value
            .trim()
            .toLowerCase();

        const filteredBlocks = allBlocks.filter(block => {
            const address =
                `${block.blk_no} ${block.street_name}`
                    .toLowerCase();

            const postal = String(block.postal || "");

            return (
                address.includes(searchTerm) ||
                postal.includes(searchTerm)
            );
        });

        renderBlockDirectory(filteredBlocks);
    });

    // ==========================================
    // 17. LOAD TOWN DETAILS
    // ==========================================

    async function loadTownDetails() {
        if (!selectedTown) {
            townTitle.textContent = "Town not specified";

            townStatus.textContent =
                "Please select a town from the Neighbourhoods page.";

            return;
        }

        try {
            townStatus.textContent =
                "Loading town information...";

            const response = await fetch(
                `/api/towns/details/${encodeURIComponent(selectedTown)}`
            );

            const result = await response.json();

            if (
                !response.ok ||
                result.status !== "success"
            ) {
                throw new Error(
                    result.message ||
                    "Unable to load town details"
                );
            }

            // A. Town overview
            renderTownOverview(result.town);

            // B. Resale statistics by flat type
            renderFlatTypes(result.flatTypes || []);

            // C. Block directory
            allBlocks = result.blocks || [];
            renderBlockDirectory(allBlocks);

            // D. Interactive HDB map
            renderTownMap(allBlocks);

            // E. Load all five amenity datasets
            // independently. One failure does not
            // stop the other layers from loading.
            if (townMap) {
                await Promise.all([
                    loadMrtStations(),
                    loadBusStops(),
                    loadHawkerCentres(),
                    loadParks(),
                    loadChildcareCentres()
                ]);
            }

            townStatus.textContent = "";

            document.title =
                `${result.town.town_name} | Haven.`;

        } catch (error) {
            console.error(
                "Town details loading failed:",
                error
            );

            townTitle.textContent =
                "Unable to load town";

            townStatus.textContent = error.message;
        }
    }

    // ==========================================
    // 18. INITIALISE PAGE
    // ==========================================

    await loadTownDetails();

});