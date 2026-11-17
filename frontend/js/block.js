
document.addEventListener("DOMContentLoaded", async () => {

    // ==========================================
    // 1. PAGE ELEMENTS
    // ==========================================

    const blockAddress = document.getElementById("blockAddress");
    const blockLocation = document.getElementById("blockLocation");
    const blockOverview = document.getElementById("blockOverview");
    const blockStatistics = document.getElementById("blockStatistics");
    const blockTransactions = document.getElementById("blockTransactions");

    const amenitiesRadius = document.getElementById("amenitiesRadius");
    const amenitiesStatus = document.getElementById("amenitiesStatus");
    const includeCommunityToggle = document.getElementById("includeCommunityPlaces");
    const neighbourhoodMapElement = document.getElementById("neighbourhoodMap");

    const mapLegendShowAll = document.getElementById("mapLegendShowAll");
    const mapLegendStatus = document.getElementById("mapLegendStatus");
    const mapLegendCheckboxes = Array.from(
        document.querySelectorAll("input[data-map-category]")
    );

    const accessibilityReset = document.getElementById("accessibilityReset");
    const accessibilitySliders = Array.from(
        document.querySelectorAll("input[data-weight-category]")
    );

    const urlParams = new URLSearchParams(window.location.search);
    const blockId = urlParams.get("id");

    let amenitiesRequestId = 0;

    // ==========================================
    // 2. MAP AND AMENITY STATE
    // ==========================================

    let neighbourhoodMap = null;
    let blockMarker = null;
    let radiusCircle = null;
    let currentBlock = null;

    const amenityCategories = [
        "mrt_exits",
        "bus_stops",
        "hawker_centres",
        "childcare_centres",
        "parks"
    ];

    const amenityColours = {
        mrt_exits: "#8B5CF6",
        bus_stops: "#2563EB",
        hawker_centres: "#F59E0B",
        childcare_centres: "#EC4899",
        parks: "#16A34A"
    };

    const amenityLabels = {
        mrt_exits: "MRT exit",
        bus_stops: "Bus stop",
        hawker_centres: "Hawker centre",
        childcare_centres: "Childcare centre",
        parks: "Park"
    };

    const amenityLayers = {};
    const amenityMarkers = {};

    const visibleCategories = new Set(
        amenityCategories.filter(category => {
            const checkbox = mapLegendCheckboxes.find(
                item => item.dataset.mapCategory === category
            );

            return checkbox ? checkbox.checked : true;
        })
    );

    // ==========================================
    // 3. ACCESSIBILITY SCORING STATE
    // ==========================================

    const defaultAccessibilityWeights = {
        mrt_exits: 30,
        bus_stops: 25,
        hawker_centres: 20,
        childcare_centres: 15,
        parks: 10
    };

    const accessibilityWeights = {
        ...defaultAccessibilityWeights
    };

    let currentAmenityCategories = null;
    let currentAmenityRadius = null;

    // ==========================================
    // 4. FORMATTING HELPERS
    // ==========================================

    function formatPrice(value) {
        if (value === null || value === undefined) {
            return "N/A";
        }

        const amount = Number(value);

        if (!Number.isFinite(amount)) {
            return "N/A";
        }

        return new Intl.NumberFormat("en-SG", {
            style: "currency",
            currency: "SGD",
            maximumFractionDigits: 0
        }).format(amount);
    }

    function formatDate(value) {
        if (!value) {
            return "Date unavailable";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return date.toLocaleDateString("en-SG", {
            month: "short",
            year: "numeric",
            timeZone: "UTC"
        });
    }

    function formatDistance(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "Distance unavailable";
        }

        const distance = Number(value);

        if (!Number.isFinite(distance) || distance < 0) {
            return "Distance unavailable";
        }

        return `${Math.round(distance).toLocaleString("en-SG")} m`;
    }

    function createTextElement(tag, text, className = "") {
        const element = document.createElement(tag);

        element.textContent = text;

        if (className) {
            element.className = className;
        }

        return element;
    }

    function setAmenitiesStatus(message) {
        if (amenitiesStatus) {
            amenitiesStatus.textContent = message;
        }
    }

    function updateCommunityNote(result) {
        const note = document.getElementById("communityScoreNote");

        if (!note) {
            return;
        }

        if (!includeCommunityToggle || !includeCommunityToggle.checked) {
            note.textContent = "";
            return;
        }

        const count = Number(result?.community_included || 0);

        note.textContent = count > 0
            ? `Includes ${count} unverified community-submitted place${count === 1 ? "" : "s"} in the amenity lists and score.`
            : "No community-submitted places within this radius, so the score is unchanged.";
    }
    
    function setAccessibilityText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }

    // ==========================================
    // 5. ACCESSIBILITY SCORE CALCULATIONS
    // ==========================================

    function clearAccessibilityScore(message) {
        setAccessibilityText("accessibilityScore", "--");
        setAccessibilityText("accessibilityRating", "Not calculated");
        setAccessibilityText("accessibilityStatus", message);

        const overallBar = document.getElementById(
            "accessibilityScoreBar"
        );

        if (overallBar) {
            overallBar.style.width = "0%";
            overallBar.setAttribute("aria-valuenow", "0");
        }

        amenityCategories.forEach(category => {
            setAccessibilityText(
                `score-${category}`,
                "-- / 100"
            );

            const bar = document.getElementById(
                `scoreBar-${category}`
            );

            if (bar) {
                bar.style.width = "0%";
            }
        });
    }

    function calculateCategoryScore(amenities, radius) {
        if (
            !Array.isArray(amenities) ||
            amenities.length === 0 ||
            !Number.isFinite(radius) ||
            radius <= 0
        ) {
            return 0;
        }

        const distances = amenities
            .map(amenity => amenity.distance_m)
            .filter(value =>
                value !== null &&
                value !== undefined &&
                value !== ""
            )
            .map(Number)
            .filter(distance =>
                Number.isFinite(distance) &&
                distance >= 0 &&
                distance <= radius
            );

        if (distances.length === 0) {
            return 0;
        }

        const nearestDistance = Math.min(...distances);

        // Category score:
        // 100 at 0 metres.
        // 0 at the selected radius boundary.

        const score = 100 * (
            1 - nearestDistance / radius
        );

        return Math.max(
            0,
            Math.min(100, score)
        );
    }

    function calculateAccessibilityScore() {
        if (
            !currentAmenityCategories ||
            !currentAmenityRadius
        ) {
            clearAccessibilityScore(
                "Waiting for nearby amenity data..."
            );
            return;
        }

        const totalWeight = amenityCategories.reduce(
            (sum, category) => {
                return sum + accessibilityWeights[category];
            },
            0
        );

        // Prevent division by zero.
        if (totalWeight === 0) {
            clearAccessibilityScore(
                "Select at least one priority above zero to calculate a score."
            );
            return;
        }

        const categoryLookup = new Map(
            currentAmenityCategories.map(item => [
                item.category,
                item
            ])
        );

        let weightedTotal = 0;

        amenityCategories.forEach(category => {
            const amenities =
                categoryLookup.get(category)?.amenities || [];

            const categoryScore = calculateCategoryScore(
                amenities,
                currentAmenityRadius
            );

            weightedTotal += (
                categoryScore * accessibilityWeights[category]
            );

            setAccessibilityText(
                `score-${category}`,
                `${Math.round(categoryScore)} / 100`
            );

            const categoryBar = document.getElementById(
                `scoreBar-${category}`
            );

            if (categoryBar) {
                categoryBar.style.width = `${categoryScore}%`;
            }
        });

        // Automatically normalise the weights.
        const overallScore = Math.round(
            weightedTotal / totalWeight
        );

        setAccessibilityText(
            "accessibilityScore",
            String(overallScore)
        );

        let rating;

        if (overallScore >= 80) {
            rating = "Very close to selected amenities";
        } else if (overallScore >= 60) {
            rating = "Good proximity to selected amenities";
        } else if (overallScore >= 40) {
            rating = "Moderate proximity to selected amenities";
        } else if (overallScore >= 20) {
            rating = "Limited proximity to selected amenities";
        } else {
            rating = "Low proximity to selected amenities";
        }

        setAccessibilityText(
            "accessibilityRating",
            rating
        );

        setAccessibilityText(
            "accessibilityStatus",
            `Calculated from nearest straight-line amenity distances within ${currentAmenityRadius.toLocaleString("en-SG")} m, using your selected priorities.`
        );

        const overallBar = document.getElementById(
            "accessibilityScoreBar"
        );

        if (overallBar) {
            overallBar.style.width = `${overallScore}%`;

            overallBar.setAttribute(
                "aria-valuenow",
                String(overallScore)
            );
        }
    }

    // ==========================================
    // 6. ACCESSIBILITY WEIGHT CONTROLS
    // ==========================================

    function updateAccessibilityWeightsDisplay() {
        const totalWeight = amenityCategories.reduce(
            (sum, category) => {
                return sum + accessibilityWeights[category];
            },
            0
        );

        // Show total as priority points, not percentage.
        setAccessibilityText(
            "accessibilityTotalWeight",
            String(totalWeight)
        );

        // Show each category's priority points and
        // effective normalised percentage.
        amenityCategories.forEach(category => {
            const points = accessibilityWeights[category];

            const effectivePercentage = totalWeight > 0
                ? (points / totalWeight) * 100
                : 0;

            setAccessibilityText(
                `weightValue-${category}`,
                `${points} points (${effectivePercentage.toFixed(1)}%)`
            );
        });
    }

    function initialiseAccessibilityControls() {
        accessibilitySliders.forEach(slider => {
            const category = slider.dataset.weightCategory;

            if (!amenityCategories.includes(category)) {
                return;
            }

            slider.value = String(
                accessibilityWeights[category]
            );

            slider.addEventListener("input", () => {
                accessibilityWeights[category] = Number(
                    slider.value
                );

                updateAccessibilityWeightsDisplay();
                calculateAccessibilityScore();
            });
        });

        if (accessibilityReset) {
            accessibilityReset.addEventListener(
                "click",
                () => {
                    Object.assign(
                        accessibilityWeights,
                        defaultAccessibilityWeights
                    );

                    accessibilitySliders.forEach(slider => {
                        const category =
                            slider.dataset.weightCategory;

                        if (amenityCategories.includes(category)) {
                            slider.value = String(
                                accessibilityWeights[category]
                            );
                        }
                    });

                    updateAccessibilityWeightsDisplay();
                    calculateAccessibilityScore();
                }
            );
        }

        updateAccessibilityWeightsDisplay();

        clearAccessibilityScore(
            "Waiting for nearby amenity data..."
        );
    }

    // ==========================================
    // 7. MYSQL: BLOCK OVERVIEW
    // ==========================================

    function displayBlockOverview(block) {
        blockAddress.textContent =
            `${block.blk_no} ${block.street_name}`;

        blockLocation.textContent =
            `${block.town_name} · Singapore`;

        blockOverview.replaceChildren();

        const grid = document.createElement("div");
        grid.className = "block-overview-grid";

        const details = [
            ["Block number", block.blk_no],
            ["Street", block.street_name],
            ["Town", block.town_name],
            ["Postal code", block.postal || "Not available"],
            ["Year completed", block.year_completed || "Not available"]
        ];

        details.forEach(([label, value]) => {
            const card = document.createElement("div");
            card.className = "block-info-card";

            card.append(
                createTextElement(
                    "p",
                    label,
                    "block-info-label"
                ),
                createTextElement(
                    "h3",
                    String(value)
                )
            );

            grid.appendChild(card);
        });

        blockOverview.appendChild(grid);
    }

    // ==========================================
    // 8. MYSQL: RESALE STATISTICS
    // ==========================================

    function displayStatistics(statistics) {
        blockStatistics.replaceChildren();

        const grid = document.createElement("div");
        grid.className = "block-statistics-grid";

        const items = [
            [
                "Total recorded transactions",
                Number(
                    statistics.total_transactions || 0
                ).toLocaleString("en-SG")
            ],
            [
                "Historical average price",
                formatPrice(statistics.average_price)
            ],
            [
                "Lowest recorded price",
                formatPrice(statistics.lowest_price)
            ],
            [
                "Highest recorded price",
                formatPrice(statistics.highest_price)
            ]
        ];

        items.forEach(([label, value]) => {
            const card = document.createElement("div");
            card.className = "block-stat-card";

            card.append(
                createTextElement(
                    "p",
                    label,
                    "block-stat-label"
                ),
                createTextElement(
                    "h3",
                    value,
                    "block-stat-value"
                )
            );

            grid.appendChild(card);
        });

        blockStatistics.appendChild(grid);
    }

    // ==========================================
    // 9. MYSQL: RECENT TRANSACTIONS
    // ==========================================

    function displayTransactions(transactions) {
        blockTransactions.replaceChildren();

        if (
            !Array.isArray(transactions) ||
            transactions.length === 0
        ) {
            blockTransactions.appendChild(
                createTextElement(
                    "p",
                    "No recorded resale transactions found for this block."
                )
            );

            return;
        }

        transactions.forEach(transaction => {
            const card = document.createElement("article");
            card.className = "transaction-card";

            const flatType = createTextElement(
                "p",
                transaction.flat_type_name ||
                    "Flat type unavailable",
                "transaction-town"
            );

            const price = createTextElement(
                "p",
                formatPrice(transaction.resale_price),
                "transaction-price"
            );

            const area = transaction.floor_area_sqm
                ? `${Number(transaction.floor_area_sqm)} sqm`
                : "Area unavailable";

            const storey = transaction.storey_range ||
                "Storey unavailable";

            const details = createTextElement(
                "p",
                `${area} · ${storey}`,
                "transaction-details"
            );

            const date = createTextElement(
                "p",
                `Resale transaction: ${formatDate(transaction.sale_date)}`,
                "transaction-date"
            );

            card.append(
                flatType,
                price,
                details,
                date
            );

            blockTransactions.appendChild(card);
        });
    }

    // ==========================================
    // 10. COORDINATE HELPERS
    // ==========================================

    function getValidCoordinates(
        latitudeValue,
        longitudeValue
    ) {
        if (
            latitudeValue === null ||
            latitudeValue === undefined ||
            latitudeValue === "" ||
            longitudeValue === null ||
            longitudeValue === undefined ||
            longitudeValue === ""
        ) {
            return null;
        }

        const latitude = Number(latitudeValue);
        const longitude = Number(longitudeValue);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
        ) {
            return null;
        }

        return [latitude, longitude];
    }

    function getAmenityCoordinates(amenity) {
        const location = amenity?.location;

        // MongoDB GeoJSON: [longitude, latitude]
        // Leaflet: [latitude, longitude]

        if (
            !location ||
            location.type !== "Point" ||
            !Array.isArray(location.coordinates) ||
            location.coordinates.length < 2
        ) {
            return null;
        }

        return getValidCoordinates(
            location.coordinates[1],
            location.coordinates[0]
        );
    }

    // ==========================================
    // 11. LEAFLET: INITIALISE MAP
    // ==========================================

    function initialiseNeighbourhoodMap(block) {
        if (!neighbourhoodMapElement) {
            return false;
        }

        if (typeof L === "undefined") {
            neighbourhoodMapElement.textContent =
                "The map library could not be loaded.";

            console.error("Leaflet is not available.");
            return false;
        }

        const coordinates = getValidCoordinates(
            block.latitude,
            block.longitude
        );

        if (!coordinates) {
            if (!neighbourhoodMap) {
                neighbourhoodMapElement.textContent =
                    "Map unavailable: invalid HDB block coordinates.";
            }

            return false;
        }

        if (neighbourhoodMap) {
            return true;
        }

        neighbourhoodMapElement.replaceChildren();

        neighbourhoodMap = L.map(
            "neighbourhoodMap",
            {
                zoomControl: true,
                scrollWheelZoom: false
            }
        ).setView(coordinates, 16);

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19
            }
        ).addTo(neighbourhoodMap);

        // Selected HDB block marker.
        blockMarker = L.circleMarker(
            coordinates,
            {
                radius: 11,
                color: "#FFFFFF",
                weight: 3,
                fillColor: "#102B3F",
                fillOpacity: 1
            }
        ).addTo(neighbourhoodMap);

        const blockPopup = document.createElement("div");

        blockPopup.append(
            createTextElement(
                "strong",
                "Selected HDB block"
            ),
            document.createElement("br"),
            createTextElement(
                "span",
                `${block.blk_no} ${block.street_name}`
            )
        );

        blockMarker.bindPopup(blockPopup);

        // Search radius circle.
        radiusCircle = L.circle(
            coordinates,
            {
                radius: Number(
                    amenitiesRadius?.value || 500
                ),
                color: "#138F80",
                weight: 2,
                opacity: 0.8,
                fillColor: "#138F80",
                fillOpacity: 0.07,
                interactive: false
            }
        ).addTo(neighbourhoodMap);

        // Separate layers for each amenity category.
        amenityCategories.forEach(category => {
            amenityLayers[category] = L.layerGroup();
            amenityMarkers[category] = [];

            if (visibleCategories.has(category)) {
                amenityLayers[category].addTo(
                    neighbourhoodMap
                );
            }
        });

        blockMarker.bringToFront();

        neighbourhoodMap.fitBounds(
            radiusCircle.getBounds(),
            {
                padding: [25, 25],
                maxZoom: 16
            }
        );

        requestAnimationFrame(() => {
            neighbourhoodMap.invalidateSize();
        });

        return true;
    }

    // ==========================================
    // 12. LEAFLET: UPDATE SEARCH RADIUS
    // ==========================================

    function updateMapRadius(radius) {
        if (
            !neighbourhoodMap ||
            !radiusCircle ||
            !Number.isFinite(radius) ||
            radius <= 0
        ) {
            return;
        }

        radiusCircle.setRadius(radius);

        neighbourhoodMap.fitBounds(
            radiusCircle.getBounds(),
            {
                padding: [25, 25],
                maxZoom: 16
            }
        );
    }

    // ==========================================
    // 13. LEAFLET: AMENITY MARKERS
    // ==========================================

    function displayAmenitiesOnMap(categories) {
        if (!neighbourhoodMap) {
            return;
        }

        amenityCategories.forEach(category => {
            amenityLayers[category]?.clearLayers();
            amenityMarkers[category] = [];
        });

        categories.forEach(categoryResult => {
            const category = categoryResult.category;
            const layer = amenityLayers[category];

            if (!layer) {
                return;
            }

            const colour =
                amenityColours[category] || "#64748B";

            const categoryLabel =
                amenityLabels[category] || "Amenity";

            const amenities = Array.isArray(
                categoryResult.amenities
            )
                ? categoryResult.amenities
                : [];

            amenities.forEach((amenity, index) => {
                const coordinates =
                    getAmenityCoordinates(amenity);

                if (!coordinates) {
                    return;
                }

                const isCommunity = amenity.source === "community";

                const marker = L.circleMarker(
                    coordinates,
                    {
                        radius: isCommunity ? 8 : 7,
                        color: isCommunity ? "#0F172A" : "#FFFFFF",
                        weight: isCommunity ? 3 : 2,
                        dashArray: isCommunity ? "3 3" : null,
                        fillColor: colour,
                        fillOpacity: 0.95
                    }
                );

                const popup = document.createElement("div");
                const name = createTextElement(
                    "strong",
                    category === "mrt_exits" && amenity.exit_code
                        ? `${amenity.name} — ${amenity.exit_code}`
                        : (amenity.name || "Unnamed amenity")
                );

                const type = createTextElement(
                    "p",
                    categoryLabel
                );

                const distance = createTextElement(
                    "p",
                    `Distance: ${formatDistance(amenity.distance_m)}`
                );

                popup.append(
                    name,
                    type,
                    distance
                );

                if (isCommunity) {
                    popup.append(
                        createTextElement(
                            "p",
                            "Community-submitted, unverified"
                        )
                    );
                }

                marker.bindPopup(popup);
                marker.addTo(layer);

                // Store marker by category and list index.
                amenityMarkers[category][index] = marker;
            });
        });

        updateVisibleMapLayers();

        if (blockMarker) {
            blockMarker.bringToFront();
        }
    }

    // ==========================================
    // 14. CLICKABLE AMENITIES: FOCUS ON MAP
    // ==========================================

    function focusAmenityOnMap(category, index) {
        if (!neighbourhoodMap) {
            return;
        }

        const marker = amenityMarkers[category]?.[index];

        if (!marker) {
            console.warn(
                "No map marker found for selected amenity:",
                category,
                index
            );

            return;
        }

        // Automatically enable hidden category.
        if (!visibleCategories.has(category)) {
            visibleCategories.add(category);

            const checkbox = mapLegendCheckboxes.find(
                item =>
                    item.dataset.mapCategory === category
            );

            if (checkbox) {
                checkbox.checked = true;
            }

            updateVisibleMapLayers();
        }

        const mapSection = document.getElementById(
            "neighbourhoodMapSection"
        );

        if (mapSection) {
            mapSection.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }

        const coordinates = marker.getLatLng();

        neighbourhoodMap.flyTo(
            coordinates,
            Math.max(neighbourhoodMap.getZoom(), 17),
            {
                animate: true,
                duration: 0.8
            }
        );

        neighbourhoodMap.once("moveend", () => {
            marker.openPopup();
        });

        requestAnimationFrame(() => {
            neighbourhoodMap.invalidateSize();
        });
    }

    // ==========================================
    // 15. INTERACTIVE MAP LEGEND
    // ==========================================

    function updateLegendStatus() {
        if (!mapLegendStatus) {
            return;
        }

        const count = visibleCategories.size;

        if (count === amenityCategories.length) {
            mapLegendStatus.textContent =
                "Showing all five amenity categories.";
        } else if (count === 0) {
            mapLegendStatus.textContent =
                "All amenity layers are hidden. The HDB block remains visible.";
        } else {
            mapLegendStatus.textContent =
                `Showing ${count} of ${amenityCategories.length} amenity categories.`;
        }
    }

    function updateVisibleMapLayers() {
        if (!neighbourhoodMap) {
            updateLegendStatus();
            return;
        }

        amenityCategories.forEach(category => {
            const layer = amenityLayers[category];

            if (!layer) {
                return;
            }

            const shouldShow =
                visibleCategories.has(category);

            const currentlyShown =
                neighbourhoodMap.hasLayer(layer);

            if (shouldShow && !currentlyShown) {
                layer.addTo(neighbourhoodMap);
            } else if (!shouldShow && currentlyShown) {
                neighbourhoodMap.removeLayer(layer);
            }
        });

        if (blockMarker) {
            blockMarker.bringToFront();
        }

        updateLegendStatus();
    }

    function initialiseMapLegend() {
        mapLegendCheckboxes.forEach(checkbox => {
            const category =
                checkbox.dataset.mapCategory;

            if (!amenityCategories.includes(category)) {
                return;
            }

            checkbox.addEventListener(
                "change",
                () => {
                    if (checkbox.checked) {
                        visibleCategories.add(category);
                    } else {
                        visibleCategories.delete(category);
                    }

                    updateVisibleMapLayers();
                }
            );
        });

        if (mapLegendShowAll) {
            mapLegendShowAll.addEventListener(
                "click",
                () => {
                    amenityCategories.forEach(category => {
                        visibleCategories.add(category);
                    });

                    mapLegendCheckboxes.forEach(checkbox => {
                        if (
                            amenityCategories.includes(
                                checkbox.dataset.mapCategory
                            )
                        ) {
                            checkbox.checked = true;
                        }
                    });

                    updateVisibleMapLayers();
                }
            );
        }

        updateLegendStatus();
    }

    // ==========================================
    // 16. MONGODB: AMENITY MESSAGES
    // ==========================================

    function setAllAmenitiesMessage(message) {
        amenityCategories.forEach(category => {
            const container = document.getElementById(
                `amenities-${category}`
            );

            if (!container) {
                return;
            }

            container.replaceChildren(
                createTextElement(
                    "p",
                    message,
                    "amenity-empty-message"
                )
            );
        });
    }

    // ==========================================
    // 17. MONGODB: CLICKABLE AMENITY LISTS
    // ==========================================

    function displayAmenityCategory(categoryResult) {
        const category = categoryResult.category;

        const container = document.getElementById(
            `amenities-${category}`
        );

        if (!container) {
            return;
        }

        container.replaceChildren();

        const amenities = Array.isArray(
            categoryResult.amenities
        )
            ? categoryResult.amenities
            : [];

        if (amenities.length === 0) {
            container.appendChild(
                createTextElement(
                    "p",
                    "No amenities found within this radius.",
                    "amenity-empty-message"
                )
            );

            return;
        }

        const list = document.createElement("ul");
        list.className = "amenity-list";

        amenities.forEach((amenity, index) => {
            const item = document.createElement("li");
            item.className = "amenity-list-item";

            const nameButton = document.createElement(
                "button"
            );

            nameButton.type = "button";
            nameButton.className = "amenity-name";

            nameButton.textContent =
                category === "mrt_exits" && amenity.exit_code
                    ? `${amenity.name} — ${amenity.exit_code}`
                    : (amenity.name || "Unnamed amenity");


            Object.assign(nameButton.style, {
                background: "none",
                border: "none",
                padding: "0",
                margin: "0",
                textAlign: "left",
                color: "#102B3F",
                cursor: "pointer",
                textDecoration: "underline",
                textDecorationColor: "#B6DFD8",
                textUnderlineOffset: "4px",
                fontFamily: "inherit"
            });

            nameButton.title =
                "View this amenity on the map";

            const coordinates =
                getAmenityCoordinates(amenity);

            if (!coordinates) {
                nameButton.disabled = true;
                nameButton.style.cursor = "default";
                nameButton.style.textDecoration = "none";
                nameButton.title =
                    "Map location unavailable";
            } else {
                nameButton.addEventListener(
                    "click",
                    () => {
                        focusAmenityOnMap(
                            category,
                            index
                        );
                    }
                );
            }

            const distanceElement = createTextElement(
                "span",
                formatDistance(amenity.distance_m),
                "amenity-distance"
            );

            if (amenity.source === "community") {
                const nameWrap = document.createElement("span");
                const badge = createTextElement(
                    "span",
                    "Community",
                    "community-badge"
                );

                badge.title = "Added by a resident and not verified";

                nameWrap.append(nameButton, " ", badge);

                item.append(
                    nameWrap,
                    distanceElement
                );
            } else {
                item.append(
                    nameButton,
                    distanceElement
                );
            }

            list.appendChild(item);
        });

        container.appendChild(list);
    }

    // ==========================================
    // 18. MONGODB: LOAD NEARBY AMENITIES
    // ==========================================

    async function loadNearbyAmenities() {
        if (!amenitiesRadius) {
            return;
        }

        const requestId = ++amenitiesRequestId;
        const radius = Number(amenitiesRadius.value);

        currentAmenityCategories = null;
        currentAmenityRadius = null;

        clearAccessibilityScore(
            "Updating accessibility scores for the selected radius..."
        );

        setAmenitiesStatus(
            `Searching for amenities within ${radius.toLocaleString("en-SG")} m...`
        );

        setAllAmenitiesMessage(
            "Loading nearby amenities..."
        );

        amenityCategories.forEach(category => {
            amenityLayers[category]?.clearLayers();
            amenityMarkers[category] = [];
        });

        updateMapRadius(radius);

        try {
                const includeCommunity =
                includeCommunityToggle && includeCommunityToggle.checked
                    ? "&include_community=1"
                    : "";

            const response = await fetch(
                `/api/blocks/${encodeURIComponent(blockId)}/amenities?radius=${radius}${includeCommunity}`
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message ||
                    "Unable to load nearby amenities"
                );
            }

            if (requestId !== amenitiesRequestId) {
                return;
            }

            if (!neighbourhoodMap && result.block) {
                initialiseNeighbourhoodMap({
                    ...currentBlock,
                    ...result.block
                });

                updateMapRadius(radius);
            }

            const categories = Array.isArray(
                result.categories
            )
                ? result.categories
                : [];

            // Update scoring data.
            currentAmenityCategories = categories;
            currentAmenityRadius = radius;

            calculateAccessibilityScore();
            
            updateCommunityNote(result);

            // Create markers before clickable lists.
            displayAmenitiesOnMap(categories);

            categories.forEach(
                displayAmenityCategory
            );

            const returnedCategories = new Set(
                categories.map(
                    category => category.category
                )
            );

            amenityCategories.forEach(category => {
                if (!returnedCategories.has(category)) {
                    displayAmenityCategory({
                        category,
                        amenities: []
                    });
                }
            });

            const totalDisplayed = categories.reduce(
                (sum, category) => {
                    return sum + (
                        Array.isArray(category.amenities)
                            ? category.amenities.length
                            : 0
                    );
                },
                0
            );

            setAmenitiesStatus(
                `Showing ${totalDisplayed} nearby amenities across five categories within ${radius.toLocaleString("en-SG")} m.`
            );

        } catch (error) {
            if (requestId !== amenitiesRequestId) {
                return;
            }

            console.error(
                "Nearby amenities loading failed:",
                error
            );

            currentAmenityCategories = null;
            currentAmenityRadius = null;

            clearAccessibilityScore(
                "Unable to calculate scores: nearby amenity data is unavailable."
            );

            setAllAmenitiesMessage(
                "Nearby amenities are currently unavailable."
            );

            setAmenitiesStatus(
                error.message ||
                "Unable to retrieve nearby amenities."
            );
        }
    }

    // ==========================================
    // 19. LOAD BLOCK DETAILS
    // ==========================================

    async function loadBlockDetails() {
        if (!blockId || !/^[1-9]\d*$/.test(blockId)) {
            blockAddress.textContent =
                "Invalid block";

            blockLocation.textContent =
                "Please select an HDB block from the Explore page.";

            blockOverview.replaceChildren();
            blockStatistics.replaceChildren();
            blockTransactions.replaceChildren();

            setAllAmenitiesMessage(
                "Select a valid HDB block."
            );

            setAmenitiesStatus(
                "Nearby amenities unavailable."
            );

            clearAccessibilityScore(
                "Select a valid HDB block to calculate accessibility."
            );

            if (neighbourhoodMapElement) {
                neighbourhoodMapElement.textContent =
                    "Select a valid HDB block to view the map.";
            }

            return;
        }

        try {
            const response = await fetch(
                `/api/blocks/${encodeURIComponent(blockId)}`
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message ||
                    "Unable to load block details"
                );
            }

            currentBlock = result.block;

            displayBlockOverview(result.block);
            displayStatistics(result.statistics);
            displayTransactions(result.transactions);

            document.title =
                `${result.block.blk_no} ${result.block.street_name} | Haven.`;

            initialiseNeighbourhoodMap(result.block);

            await loadNearbyAmenities();

        } catch (error) {
            console.error(
                "Block details loading failed:",
                error
            );

            blockAddress.textContent =
                "Unable to load block";

            blockLocation.textContent =
                error.message;

            blockOverview.replaceChildren();
            blockStatistics.replaceChildren();
            blockTransactions.replaceChildren();

            setAllAmenitiesMessage(
                "Block information unavailable."
            );

            setAmenitiesStatus(
                "Unable to load nearby amenities."
            );

            clearAccessibilityScore(
                "Unable to calculate accessibility scores."
            );

            if (
                !neighbourhoodMap &&
                neighbourhoodMapElement
            ) {
                neighbourhoodMapElement.textContent =
                    "Neighbourhood map is currently unavailable.";
            }
        }
    }

    // ==========================================
    // 20. EVENT LISTENERS
    // ==========================================

    initialiseMapLegend();
    initialiseAccessibilityControls();

    if (amenitiesRadius) {
        amenitiesRadius.addEventListener(
            "change",
            loadNearbyAmenities
        );
    }
    
    if (includeCommunityToggle) {
        includeCommunityToggle.addEventListener(
            "change",
            loadNearbyAmenities
        );
    }

    // ==========================================
    // 21. START PAGE
    // ==========================================

    await loadBlockDetails();
});