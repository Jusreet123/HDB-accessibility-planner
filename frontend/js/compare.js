
document.addEventListener("DOMContentLoaded", () => {

    // ==========================================
    // 1. PAGE ELEMENTS
    // ==========================================

    const $ = id => document.getElementById(id);

    const searchA = $("compareSearchA");
    const searchB = $("compareSearchB");
    const resultsA = $("compareResultsA");
    const resultsB = $("compareResultsB");
    const selectedA = $("compareSelectedA");
    const selectedB = $("compareSelectedB");

    const compareButton = $("compareButton");
    const resetButton = $("compareReset");
    const selectionStatus = $("compareSelectionStatus");
    const compareStatus = $("compareStatus");
    const comparisonResults = $("comparisonResults");

    const mapSection = $("compareMapSection");
    const mapElement = $("compareMap");
    const mapStatus = $("compareMapStatus");
    const mapShowAll = $("compareMapShowAll");

    const mapCheckboxes = Array.from(
        document.querySelectorAll(
            "[data-compare-map-category]"
        )
    );

    // ==========================================
    // 2. CONFIGURATION
    // ==========================================

    const CATEGORIES = [
        {
            key: "mrt_exits",
            label: "MRT exits",
            icon: "🚇",
            color: "#8B5CF6"
        },
        {
            key: "bus_stops",
            label: "Bus stops",
            icon: "🚌",
            color: "#2563EB"
        },
        {
            key: "hawker_centres",
            label: "Hawker centres",
            icon: "🍜",
            color: "#F59E0B"
        },
        {
            key: "childcare_centres",
            label: "Childcare centres",
            icon: "🏫",
            color: "#EC4899"
        },
        {
            key: "parks",
            label: "Parks",
            icon: "🌳",
            color: "#16A34A"
        }
    ];

    const DEFAULT_WEIGHTS = {
        mrt_exits: 30,
        bus_stops: 25,
        hawker_centres: 20,
        childcare_centres: 15,
        parks: 10
    };

    const weights = { ...DEFAULT_WEIGHTS };
    const RADIUS_OPTIONS = [500, 1000, 2000];

    let selectedRadius = 500;

    // ==========================================
    // 3. APPLICATION STATE
    // ==========================================

    let blockA = null;
    let blockB = null;

    let detailsA = null;
    let detailsB = null;

    let amenitiesA = null;
    let amenitiesB = null;

    let comparisonRequestId = 0;
    let isComparing = false;

    const searchTimers = {
        A: null,
        B: null
    };

    const searchRequests = {
        A: 0,
        B: 0
    };

    // Leaflet map state

    let map = null;
    let blockLayer = null;
    let radiusLayer = null;

    const amenityLayers = {};

    const visibleCategories = new Set(
        CATEGORIES.map(category => category.key)
    );

    // ==========================================
    // 4. GENERAL HELPERS
    // ==========================================

    function el(tag, className = "", text = null) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== null && text !== undefined) {
            element.textContent = String(text);
        }

        return element;
    }

    function append(parent, ...children) {
        parent.append(...children);
        return parent;
    }

    function address(block) {
        return `${block.blk_no} ${block.street_name}`;
    }

    function blockLabel(block) {
        const postal = block.postal
            ? ` · ${block.postal}`
            : "";

        return `${address(block)} · ${block.town_name || "Unknown town"}${postal}`;
    }

    function formatNumber(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "N/A";
        }

        const n = Number(value);

        return Number.isFinite(n)
            ? n.toLocaleString("en-SG")
            : "N/A";
    }

    function formatCurrency(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "N/A";
        }

        const n = Number(value);

        if (!Number.isFinite(n)) {
            return "N/A";
        }

        return new Intl.NumberFormat("en-SG", {
            style: "currency",
            currency: "SGD",
            maximumFractionDigits: 0
        }).format(n);
    }

    function getSide(side) {
        return side === "A"
            ? {
                input: searchA,
                results: resultsA,
                selected: selectedA
            }
            : {
                input: searchB,
                results: resultsB,
                selected: selectedB
            };
    }

    function findCategory(data, key) {
        return data?.categories?.find(
            category => category.category === key
        );
    }

    function getAmenities(data, key) {
        const items = findCategory(data, key)?.amenities;

        return Array.isArray(items)
            ? items
            : [];
    }

    function validDistance(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        const distance = Number(value);

        return Number.isFinite(distance) && distance >= 0
            ? distance
            : null;
    }

    function bothSelected() {
        return Boolean(blockA && blockB);
    }

    function sameBlock() {
        return bothSelected() &&
            String(blockA.block_id) === String(blockB.block_id);
    }

    // ==========================================
    // 5. SELECTION MANAGEMENT
    // ==========================================

    function updateSelectionStatus() {
        compareButton.disabled =
            !bothSelected() || sameBlock() || isComparing;

        if (sameBlock()) {
            selectionStatus.textContent =
                "Please select two different HDB blocks.";
        } else if (bothSelected()) {
            selectionStatus.textContent =
                "Both blocks selected. Ready to compare.";
        } else if (blockA || blockB) {
            selectionStatus.textContent =
                "Select one more HDB block to continue.";
        } else {
            selectionStatus.textContent =
                "Select two different HDB blocks to begin.";
        }
    }

    function showEmptyComparison() {
        compareStatus.textContent =
            "Your comparison will appear here.";

        const empty = el("div", "empty-results");

        append(
            empty,
            el("div", "empty-results-icon", "⌂"),
            el("h3", "", "Your comparison starts here"),
            el(
                "p",
                "",
                "Choose two different HDB blocks to compare their resale history, nearby amenities and accessibility."
            )
        );

        comparisonResults.replaceChildren(empty);
    }

    function hideMap() {
        if (mapSection) {
            mapSection.hidden = true;
        }

        if (mapStatus) {
            mapStatus.textContent =
                "Map will appear after comparing two HDB blocks.";
        }
    }

    function invalidateComparison() {
        comparisonRequestId++;
        isComparing = false;

        detailsA = null;
        detailsB = null;
        amenitiesA = null;
        amenitiesB = null;

        compareButton.textContent = "Compare blocks";

        $("compareRadiusWrapper")?.remove();

        hideMap();
        showEmptyComparison();
        updateSelectionStatus();
    }

    // ==========================================
    // 6. BLOCK SEARCH
    // ==========================================

    function clearSearchResults(side) {
        const { input, results } = getSide(side);

        results.replaceChildren();
        input.setAttribute("aria-expanded", "false");
    }

    function invalidateSearch(side) {
        searchRequests[side]++;

        clearTimeout(searchTimers[side]);
        searchTimers[side] = null;
    }

    function selectBlock(side, block) {
        const { input, selected } = getSide(side);

        invalidateSearch(side);

        if (side === "A") {
            blockA = block;
        } else {
            blockB = block;
        }

        input.value = address(block);
        selected.textContent = `Selected: ${blockLabel(block)}`;

        clearSearchResults(side);
        invalidateComparison();
    }

    function displaySearchResults(side, blocks) {
        const { input, results } = getSide(side);

        results.replaceChildren();

        if (!blocks.length) {
            results.appendChild(
                el("p", "", "No matching HDB blocks found.")
            );

            input.setAttribute("aria-expanded", "true");
            return;
        }

        const list = el("div", "compare-search-list");

        blocks.forEach(block => {
            const button = el(
                "button",
                "compare-search-option",
                blockLabel(block)
            );

            button.type = "button";

            button.addEventListener("click", () => {
                selectBlock(side, block);
            });

            list.appendChild(button);
        });

        results.appendChild(list);
        input.setAttribute("aria-expanded", "true");
    }

    async function searchBlocks(side, keyword) {
        const { input, results } = getSide(side);
        const id = ++searchRequests[side];

        results.replaceChildren(
            el("p", "", "Searching HDB blocks...")
        );

        input.setAttribute("aria-expanded", "true");

        try {
            const params = new URLSearchParams({
                search: keyword
            });

            const response = await fetch(
                `/api/blocks?${params.toString()}`
            );

            if (!response.ok) {
                throw new Error(
                    `Block search failed (${response.status})`
                );
            }

            const result = await response.json();

            if (id !== searchRequests[side]) {
                return;
            }

            if (
                result.status !== "success" ||
                !Array.isArray(result.data)
            ) {
                throw new Error("Invalid search response");
            }

            displaySearchResults(side, result.data);

        } catch (error) {
            if (id !== searchRequests[side]) {
                return;
            }

            console.error("Block search failed:", error);

            results.replaceChildren(
                el(
                    "p",
                    "",
                    "Unable to search blocks. Please try again."
                )
            );

            input.setAttribute("aria-expanded", "true");
        }
    }

    function initialiseSearch(side) {
        const { input, selected } = getSide(side);

        input.addEventListener("input", () => {
            const keyword = input.value.trim();

            invalidateSearch(side);

            if (side === "A") {
                blockA = null;
            } else {
                blockB = null;
            }

            selected.textContent = "No block selected.";

            invalidateComparison();
            clearSearchResults(side);

            if (keyword.length < 2) {
                return;
            }

            searchTimers[side] = setTimeout(() => {
                searchBlocks(side, keyword);
            }, 300);
        });

        input.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                invalidateSearch(side);
                clearSearchResults(side);
            }
        });
    }

    function resetSelections() {
        invalidateSearch("A");
        invalidateSearch("B");

        blockA = null;
        blockB = null;

        searchA.value = "";
        searchB.value = "";

        selectedA.textContent = "No block selected.";
        selectedB.textContent = "No block selected.";

        clearSearchResults("A");
        clearSearchResults("B");

        invalidateComparison();
    }

    // ==========================================
    // 7. API REQUESTS
    // ==========================================

    async function fetchDetails(blockId) {
        const response = await fetch(
            `/api/blocks/${encodeURIComponent(blockId)}`
        );

        if (!response.ok) {
            throw new Error(
                `Unable to retrieve HDB block ${blockId}`
            );
        }

        const result = await response.json();

        if (
            result.status !== "success" ||
            !result.block
        ) {
            throw new Error("Invalid block details response");
        }

        return result;
    }

    async function fetchAmenities(blockId, radius) {
        const response = await fetch(
            `/api/blocks/${encodeURIComponent(blockId)}/amenities?radius=${radius}`
        );

        if (!response.ok) {
            throw new Error(
                `Unable to retrieve amenities for block ${blockId}`
            );
        }

        const result = await response.json();

        if (
            result.status !== "success" ||
            !Array.isArray(result.categories)
        ) {
            throw new Error("Invalid amenities response");
        }

        return result;
    }

    // ==========================================
    // 8. MYSQL COMPARISON CARDS
    // ==========================================

    function createStatRow(label, value, highlight = false) {
        const row = el("div", "compare-stat-row");

        append(
            row,
            el("span", "compare-stat-label", label),
            el(
                "strong",
                highlight
                    ? "compare-stat-value highlight"
                    : "compare-stat-value",
                value
            )
        );

        return row;
    }

    function createComparisonCard(result, side) {
        const block = result.block;
        const stats = result.statistics || {};

        const count = Number(
            stats.total_transactions || 0
        );

        const card = el("article", "compare-block-card");
        const statsBox = el("div", "compare-stats");

        append(
            statsBox,
            createStatRow("Town", block.town_name || "N/A"),
            createStatRow("Postal code", block.postal || "N/A"),
            createStatRow(
                "Year completed",
                block.year_completed ?? "N/A"
            ),
            createStatRow(
                "Total resale transactions",
                formatNumber(count)
            ),
            createStatRow(
                "Average resale price",
                count
                    ? formatCurrency(stats.average_price)
                    : "No resale data",
                count > 0
            ),
            createStatRow(
                "Lowest resale price",
                count
                    ? formatCurrency(stats.lowest_price)
                    : "No resale data"
            ),
            createStatRow(
                "Highest resale price",
                count
                    ? formatCurrency(stats.highest_price)
                    : "No resale data"
            )
        );

        const link = el(
            "a",
            "compare-view-link",
            "View block details"
        );

        link.href =
            `block.html?id=${encodeURIComponent(block.block_id)}`;

        append(
            card,
            el("span", "compare-block-label", `BLOCK ${side}`),
            el("h3", "", address(block)),
            el(
                "p",
                "compare-block-town",
                block.town_name || "Unknown town"
            ),
            statsBox,
            link
        );

        return card;
    }

    // ==========================================
    // 9. AMENITIES COMPARISON TABLE
    // ==========================================

    function createAmenityCell(category) {
        const cell = el("div", "compare-amenity-cell");

        const items = Array.isArray(category?.amenities)
            ? category.amenities
            : [];

        const count = Number(
            category?.count ?? items.length
        );

        cell.appendChild(
            el(
                "strong",
                "compare-amenity-count",
                `${formatNumber(count)} nearby`
            )
        );

        if (!items.length) {
            cell.appendChild(
                el(
                    "p",
                    "compare-amenity-nearest",
                    "None found within radius"
                )
            );

            return cell;
        }

        const sorted = items
            .filter(item =>
                validDistance(item.distance_m) !== null
            )
            .sort(
                (a, b) =>
                    Number(a.distance_m) - Number(b.distance_m)
            );

        if (!sorted.length) {
            cell.appendChild(
                el(
                    "p",
                    "compare-amenity-nearest",
                    "Distance unavailable"
                )
            );

            return cell;
        }

        const nearest = sorted[0];

        append(
            cell,
            el(
                "p",
                "compare-amenity-nearest",
                `Nearest: ${nearest.name || "Unnamed amenity"}`
            ),
            el(
                "span",
                "compare-amenity-distance",
                `${Math.round(Number(nearest.distance_m))} m away`
            )
        );

        return cell;
    }

    function createAmenityComparison() {
        const section = el(
            "section",
            "compare-amenities-section"
        );

        const table = el("div", "compare-amenities-table");

        const header = el(
            "div",
            "compare-amenities-row compare-amenities-header"
        );

        append(
            header,
            el("strong", "", "Amenity category"),
            el("strong", "", "Block A"),
            el("strong", "", "Block B")
        );

        table.appendChild(header);

        CATEGORIES.forEach(category => {
            const row = el(
                "div",
                "compare-amenities-row"
            );

            append(
                row,
                el(
                    "div",
                    "compare-amenity-category",
                    `${category.icon} ${category.label}`
                ),
                createAmenityCell(
                    findCategory(amenitiesA, category.key)
                ),
                createAmenityCell(
                    findCategory(amenitiesB, category.key)
                )
            );

            table.appendChild(row);
        });

        append(
            section,
            el("h2", "", "Nearby amenities comparison"),
            el(
                "p",
                "block-section-description",
                `Compare amenities within ${formatNumber(selectedRadius)} metres of each HDB block. Distances are straight-line estimates.`
            ),
            table
        );

        return section;
    }

    // ==========================================
    // 10. ACCESSIBILITY CALCULATIONS
    // ==========================================

    function calculateCategoryScore(items, radius) {
        if (
            !Array.isArray(items) ||
            !Number.isFinite(radius) ||
            radius <= 0
        ) {
            return 0;
        }

        const distances = items
            .map(item => validDistance(item.distance_m))
            .filter(distance =>
                distance !== null &&
                distance <= radius
            );

        if (!distances.length) {
            return 0;
        }

        const nearest = Math.min(...distances);

        return Math.max(
            0,
            Math.min(
                100,
                100 * (1 - nearest / radius)
            )
        );
    }

    function calculateAccessibility(data) {
        if (!data?.categories) {
            return null;
        }

        const totalWeight = CATEGORIES.reduce(
            (sum, category) =>
                sum + weights[category.key],
            0
        );

        if (totalWeight === 0) {
            return null;
        }

        let weightedTotal = 0;
        const categoryScores = {};

        CATEGORIES.forEach(category => {
            const score = calculateCategoryScore(
                getAmenities(data, category.key),
                selectedRadius
            );

            categoryScores[category.key] = score;

            weightedTotal += (
                score * weights[category.key]
            );
        });

        return {
            overall: Math.round(
                weightedTotal / totalWeight
            ),
            categoryScores
        };
    }

    function accessibilityRating(score) {
        if (score >= 80) {
            return "Very close to selected amenities";
        }

        if (score >= 60) {
            return "Good proximity to selected amenities";
        }

        if (score >= 40) {
            return "Moderate proximity to selected amenities";
        }

        if (score >= 20) {
            return "Limited proximity to selected amenities";
        }

        return "Low proximity to selected amenities";
    }

    // ==========================================
    // 11. ACCESSIBILITY SCORE CARDS
    // ==========================================

    function createScoreCard(side, data) {
        const card = el(
            "article",
            "compare-accessibility-card"
        );

        const score = data?.overall;

        const scoreValue = el(
            "div",
            "compare-accessibility-score",
            score === undefined || score === null
                ? "--"
                : String(score)
        );

        scoreValue.appendChild(
            el(
                "span",
                "compare-accessibility-score-total",
                " / 100"
            )
        );

        const progress = el(
            "div",
            "compare-accessibility-progress"
        );

        const fill = el(
            "div",
            "compare-accessibility-progress-fill"
        );

        fill.style.width = `${score ?? 0}%`;

        progress.appendChild(fill);

        append(
            card,
            el(
                "span",
                "compare-block-label",
                `BLOCK ${side}`
            ),
            scoreValue,
            el(
                "p",
                "compare-accessibility-rating",
                score === undefined || score === null
                    ? "Not calculated"
                    : accessibilityRating(score)
            ),
            progress
        );

        return card;
    }

    // ==========================================
    // 12. PRIORITY SLIDERS
    // ==========================================

    function createPriorityControls() {
        const panel = el(
            "div",
            "compare-priority-panel"
        );

        const header = el(
            "div",
            "compare-priority-header"
        );

        const heading = el("div");

        append(
            heading,
            el(
                "h3",
                "",
                "Your accessibility priorities"
            ),
            el(
                "p",
                "",
                "Adjust the importance of each amenity. Both blocks use the same priorities."
            )
        );

        const reset = el(
            "button",
            "accessibility-reset",
            "Reset priorities"
        );

        reset.type = "button";

        reset.addEventListener("click", () => {
            Object.assign(weights, DEFAULT_WEIGHTS);
            updateAccessibilityDisplay();
        });

        append(header, heading, reset);

        const sliders = el(
            "div",
            "compare-priority-sliders"
        );

        CATEGORIES.forEach(category => {
            const field = el(
                "div",
                "compare-priority-field"
            );

            const headingRow = el(
                "div",
                "compare-priority-label"
            );

            const label = el(
                "label",
                "",
                `${category.icon} ${category.label}`
            );

            const value = el(
                "span",
                "compare-priority-value"
            );

            value.dataset.weightValue = category.key;

            const slider = el(
                "input",
                "compare-priority-slider"
            );

            slider.type = "range";
            slider.min = "0";
            slider.max = "100";
            slider.step = "1";

            slider.value = String(
                weights[category.key]
            );

            slider.id = `compareWeight-${category.key}`;

            slider.dataset.weightCategory =
                category.key;

            label.htmlFor = slider.id;

            slider.addEventListener("input", () => {
                weights[category.key] =
                    Number(slider.value);

                updateAccessibilityDisplay();
            });

            append(headingRow, label, value);
            append(field, headingRow, slider);

            sliders.appendChild(field);
        });

        const total = el(
            "div",
            "compare-priority-total"
        );

        const totalValue = el("strong");
        totalValue.id = "compareTotalWeight";

        append(
            total,
            el("span", "", "Total priority points"),
            totalValue
        );

        append(panel, header, sliders, total);

        return panel;
    }

    // ==========================================
    // 13. SCORE BREAKDOWN
    // ==========================================

    function createScoreBreakdown() {
        const container = el(
            "div",
            "compare-score-breakdown"
        );

        const table = el(
            "div",
            "compare-score-table"
        );

        const header = el(
            "div",
            "compare-score-row compare-score-header"
        );

        append(
            header,
            el("strong", "", "Category"),
            el("strong", "", "Block A"),
            el("strong", "", "Block B")
        );

        table.appendChild(header);

        CATEGORIES.forEach(category => {
            const row = el(
                "div",
                "compare-score-row"
            );

            const scoreA = el(
                "strong",
                "",
                "-- / 100"
            );

            const scoreB = el(
                "strong",
                "",
                "-- / 100"
            );

            scoreA.dataset.scoreSide = "A";
            scoreA.dataset.scoreCategory = category.key;

            scoreB.dataset.scoreSide = "B";
            scoreB.dataset.scoreCategory = category.key;

            append(
                row,
                el(
                    "span",
                    "",
                    `${category.icon} ${category.label}`
                ),
                scoreA,
                scoreB
            );

            table.appendChild(row);
        });

        append(
            container,
            el(
                "h3",
                "",
                "Accessibility score breakdown"
            ),
            table
        );

        return container;
    }

    // ==========================================
    // 14. UPDATE ACCESSIBILITY
    // ==========================================

    function updateAccessibilityDisplay() {
        const total = CATEGORIES.reduce(
            (sum, category) =>
                sum + weights[category.key],
            0
        );

        if ($("compareTotalWeight")) {
            $("compareTotalWeight").textContent =
                String(total);
        }

        CATEGORIES.forEach(category => {
            const slider = document.querySelector(
                `[data-weight-category="${category.key}"]`
            );

            const value = document.querySelector(
                `[data-weight-value="${category.key}"]`
            );

            if (slider) {
                slider.value = String(
                    weights[category.key]
                );
            }

            if (value) {
                const percentage = total > 0
                    ? weights[category.key] / total * 100
                    : 0;

                value.textContent =
                    `${weights[category.key]} points (${percentage.toFixed(1)}%)`;
            }
        });

        const scoreA = calculateAccessibility(amenitiesA);
        const scoreB = calculateAccessibility(amenitiesB);

        const cards = $("compareAccessibilityCards");

        if (cards) {
            cards.replaceChildren(
                createScoreCard("A", scoreA),
                createScoreCard("B", scoreB)
            );
        }

        CATEGORIES.forEach(category => {
            ["A", "B"].forEach(side => {
                const data = side === "A"
                    ? scoreA
                    : scoreB;

                const target = document.querySelector(
                    `[data-score-side="${side}"][data-score-category="${category.key}"]`
                );

                if (!target) {
                    return;
                }

                const score =
                    data?.categoryScores?.[category.key];

                target.textContent =
                    score === undefined
                        ? "-- / 100"
                        : `${Math.round(score)} / 100`;
            });
        });

        const verdict = $("compareAccessibilityVerdict");

        if (!verdict) {
            return;
        }

        if (total === 0) {
            verdict.textContent =
                "Select at least one priority above zero to calculate accessibility scores.";

        } else if (!scoreA || !scoreB) {
            verdict.textContent =
                "Accessibility comparison unavailable until both blocks' amenity data is loaded.";

        } else if (scoreA.overall === scoreB.overall) {
            verdict.textContent =
                "Both blocks have the same accessibility score based on your selected priorities.";

        } else {
            const winner =
                scoreA.overall > scoreB.overall
                    ? "Block A"
                    : "Block B";

            const difference = Math.abs(
                scoreA.overall - scoreB.overall
            );

            verdict.textContent =
                `${winner} has a higher accessibility score by ${difference} points based on your selected priorities.`;
        }
    }

    // ==========================================
    // 15. ACCESSIBILITY SECTION
    // ==========================================

    function createAccessibilitySection() {
        const section = el(
            "section",
            "compare-accessibility-section"
        );

        const cards = el(
            "div",
            "compare-accessibility-grid"
        );

        cards.id = "compareAccessibilityCards";

        const verdict = el(
            "p",
            "compare-accessibility-verdict"
        );

        verdict.id = "compareAccessibilityVerdict";

        append(
            section,
            el(
                "h2",
                "",
                "Accessibility score comparison"
            ),
            el(
                "p",
                "block-section-description",
                `Scores are calculated using the nearest straight-line amenity distances within ${formatNumber(selectedRadius)} metres.`
            ),
            cards,
            verdict,
            createPriorityControls(),
            createScoreBreakdown(),
            el(
                "p",
                "accessibility-disclaimer",
                "Accessibility scores represent proximity to selected amenities, not actual walking time or travel convenience. The same weights and search radius are applied to both blocks."
            )
        );

        return section;
    }

    // ==========================================
    // 16. SHARED RADIUS CONTROL
    // ==========================================

    function createRadiusControl() {
        const wrapper = el(
            "div",
            "compare-radius-control"
        );

        const label = el(
            "label",
            "",
            "Shared search radius"
        );

        label.htmlFor = "compareRadius";

        const select = el("select");
        select.id = "compareRadius";

        RADIUS_OPTIONS.forEach(radius => {
            const option = el(
                "option",
                "",
                `${formatNumber(radius)} metres`
            );

            option.value = String(radius);

            select.appendChild(option);
        });

        select.value = String(selectedRadius);

        select.addEventListener("change", async () => {
            if (isComparing) {
                select.value = String(selectedRadius);
                return;
            }

            selectedRadius = Number(select.value);

            if (detailsA && detailsB) {
                await reloadAmenities();
            }
        });

        append(wrapper, label, select);

        return wrapper;
    }

    // ==========================================
    // 17. MAP COORDINATES
    // ==========================================

    function coordinates(latitude, longitude) {
        if (
            latitude === null ||
            latitude === undefined ||
            latitude === "" ||
            longitude === null ||
            longitude === undefined ||
            longitude === ""
        ) {
            return null;
        }

        const lat = Number(latitude);
        const lng = Number(longitude);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            return null;
        }

        if (
            lat < -90 ||
            lat > 90 ||
            lng < -180 ||
            lng > 180
        ) {
            return null;
        }

        return [lat, lng];
    }

    function amenityCoordinates(amenity) {
        const point =
            amenity?.location?.coordinates;

        if (
            !Array.isArray(point) ||
            point.length < 2
        ) {
            return null;
        }

        // MongoDB GeoJSON:
        // [longitude, latitude]

        return coordinates(
            point[1],
            point[0]
        );
    }

    // ==========================================
    // 18. INITIALISE LEAFLET MAP
    // ==========================================

    function initialiseMap(initialCoords) {
        if (map) {
            return true;
        }

        if (
            !mapElement ||
            typeof L === "undefined"
        ) {
            if (mapStatus) {
                mapStatus.textContent =
                    "Unable to load Leaflet. Check your internet connection.";
            }

            return false;
        }

        map = L.map("compareMap", {
            zoomControl: true,
            scrollWheelZoom: false
        });

        // IMPORTANT:
        // Establish a map view before drawing circles.
        map.setView(initialCoords, 13);

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        ).addTo(map);

        radiusLayer = L.layerGroup().addTo(map);
        blockLayer = L.layerGroup().addTo(map);

        CATEGORIES.forEach(category => {
            amenityLayers[category.key] =
                L.layerGroup();

            if (
                visibleCategories.has(category.key)
            ) {
                amenityLayers[category.key].addTo(map);
            }
        });

        return true;
    }

    // ==========================================
    // 19. BLOCK MARKERS AND RADIUS CIRCLES
    // ==========================================

    function addBlockMarker(block, side, coords) {
        const color = side === "A"
            ? "#102B3F"
            : "#138F80";

        const circle = L.circle(coords, {
            radius: selectedRadius,
            color,
            weight: 2,
            opacity: 0.8,
            fillColor: color,
            fillOpacity: 0.06,
            interactive: false
        });

        radiusLayer.addLayer(circle);

        const marker = L.circleMarker(coords, {
            radius: 11,
            color: "#FFFFFF",
            weight: 3,
            fillColor: color,
            fillOpacity: 1
        });

        const popup = el("div");

        append(
            popup,
            el("strong", "", `Block ${side}`),
            el("p", "", address(block)),
            el(
                "p",
                "",
                block.town_name || "Unknown town"
            ),
            el(
                "p",
                "",
                `Search radius: ${formatNumber(selectedRadius)} m`
            )
        );

        marker.bindPopup(popup);

        blockLayer.addLayer(marker);
    }

    // ==========================================
    // 20. DEDUPLICATE MONGODB AMENITIES
    // ==========================================

    function combinedAmenities() {
        const combined = new Map();

        for (const [side, data] of [
            ["A", amenitiesA],
            ["B", amenitiesB]
        ]) {
            CATEGORIES.forEach(category => {
                const items = getAmenities(
                    data,
                    category.key
                );

                items.forEach(amenity => {
                    const coords =
                        amenityCoordinates(amenity);

                    if (!coords) {
                        return;
                    }

                    const name = String(
                        amenity.name || "Unnamed amenity"
                    );

                    const normalizedName =
                        name.trim().toLowerCase();

                    const key = [
                        category.key,
                        normalizedName,
                        coords[0].toFixed(6),
                        coords[1].toFixed(6)
                    ].join("|");

                    if (!combined.has(key)) {
                        combined.set(key, {
                            category: category.key,
                            name,
                            coords,
                            distances: {}
                        });
                    }

                    const entry = combined.get(key);

                    const distance = validDistance(
                        amenity.distance_m
                    );

                    if (distance !== null) {
                        entry.distances[side] = distance;
                    }
                });
            });
        }

        return Array.from(
            combined.values()
        );
    }

    // ==========================================
    // 21. MAP CATEGORY FILTERS
    // ==========================================

    function updateVisibleLayers() {
        if (!map) {
            return;
        }

        CATEGORIES.forEach(category => {
            const layer =
                amenityLayers[category.key];

            if (!layer) {
                return;
            }

            if (
                visibleCategories.has(category.key)
            ) {
                if (!map.hasLayer(layer)) {
                    map.addLayer(layer);
                }
            } else {
                if (map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            }
        });
    }

    // ==========================================
    // 22. GEOGRAPHICAL MAP BOUNDS
    // ==========================================

    function calculateMapBounds(coordsA, coordsB) {
        // FIX:
        // Do not use circle.getBounds() here.
        // Calculate the geographical boundaries directly.

        const bounds = L.latLngBounds([
            coordsA,
            coordsB
        ]);

        const earthRadius = 6371000;

        [coordsA, coordsB].forEach(coords => {
            const lat = coords[0];
            const lng = coords[1];

            const latitudeOffset =
                (selectedRadius / earthRadius) *
                (180 / Math.PI);

            const longitudeOffset =
                latitudeOffset /
                Math.max(
                    Math.cos(lat * Math.PI / 180),
                    0.000001
                );

            bounds.extend([
                lat - latitudeOffset,
                lng - longitudeOffset
            ]);

            bounds.extend([
                lat + latitudeOffset,
                lng + longitudeOffset
            ]);
        });

        return bounds;
    }

    // ==========================================
    // 23. RENDER COMPARISON MAP
    // ==========================================

    function renderMap() {
        if (!mapSection) {
            return;
        }

        if (!detailsA || !detailsB) {
            hideMap();
            return;
        }

        const coordsA = coordinates(
            detailsA.block.latitude,
            detailsA.block.longitude
        );

        const coordsB = coordinates(
            detailsB.block.latitude,
            detailsB.block.longitude
        );

        mapSection.hidden = false;

        if (!coordsA || !coordsB) {
            if (mapElement) {
                mapElement.style.display = "none";
            }

            if (mapStatus) {
                mapStatus.textContent =
                    "Map unavailable: one or both HDB blocks have invalid coordinates.";
            }

            return;
        }

        if (mapElement) {
            mapElement.style.display = "";
        }

        // Initialise the map using Block A's coordinates.
        if (!initialiseMap(coordsA)) {
            return;
        }

        blockLayer.clearLayers();
        radiusLayer.clearLayers();

        CATEGORIES.forEach(category => {
            amenityLayers[category.key].clearLayers();
        });

        // Add both HDB blocks.
        addBlockMarker(
            detailsA.block,
            "A",
            coordsA
        );

        addBlockMarker(
            detailsB.block,
            "B",
            coordsB
        );

        // Add nearby amenities.
        const amenities = combinedAmenities();

        amenities.forEach(item => {
            const category = CATEGORIES.find(
                category =>
                    category.key === item.category
            );

            if (!category) {
                return;
            }

            const marker = L.circleMarker(
                item.coords,
                {
                    radius: 7,
                    color: "#FFFFFF",
                    weight: 2,
                    fillColor: category.color,
                    fillOpacity: 0.95
                }
            );

            const popup = el("div");

            append(
                popup,
                el("strong", "", item.name),
                el("p", "", category.label)
            );

            ["A", "B"].forEach(side => {
                const distance =
                    item.distances[side];

                if (distance !== undefined) {
                    popup.appendChild(
                        el(
                            "p",
                            "",
                            `From Block ${side}: ${formatNumber(Math.round(distance))} m`
                        )
                    );
                }
            });

            marker.bindPopup(popup);

            amenityLayers[item.category].addLayer(
                marker
            );
        });

        updateVisibleLayers();

        // Calculate bounds without circle.getBounds().
        const bounds = calculateMapBounds(
            coordsA,
            coordsB
        );

        // Update map size after revealing its container.
        requestAnimationFrame(() => {
            if (
                mapSection.hidden ||
                !map
            ) {
                return;
            }

            map.invalidateSize();

            if (bounds.isValid()) {
                map.fitBounds(bounds, {
                    padding: [30, 30],
                    maxZoom: 16
                });
            }
        });

        if (mapStatus) {
            const complete = Boolean(
                amenitiesA && amenitiesB
            );

            mapStatus.textContent = complete
                ? `Showing ${formatNumber(amenities.length)} unique amenity locations within ${formatNumber(selectedRadius)} m of either block.`
                : `Showing available amenities within ${formatNumber(selectedRadius)} m. Some amenity data could not be loaded.`;
        }
    }

    // ==========================================
    // 24. MAP EVENT LISTENERS
    // ==========================================

    mapCheckboxes.forEach(checkbox => {
        checkbox.addEventListener(
            "change",
            () => {
                const category =
                    checkbox.dataset.compareMapCategory;

                if (checkbox.checked) {
                    visibleCategories.add(category);
                } else {
                    visibleCategories.delete(category);
                }

                updateVisibleLayers();
            }
        );
    });

    if (mapShowAll) {
        mapShowAll.addEventListener(
            "click",
            () => {
                CATEGORIES.forEach(category => {
                    visibleCategories.add(category.key);
                });

                mapCheckboxes.forEach(checkbox => {
                    checkbox.checked = true;
                });

                updateVisibleLayers();
            }
        );
    }

    // ==========================================
    // 25. RENDER COMPARISON RESULTS
    // ==========================================

    function renderComparison() {
        if (!detailsA || !detailsB) {
            return;
        }

        const grid = el(
            "div",
            "compare-grid"
        );

        append(
            grid,
            createComparisonCard(detailsA, "A"),
            createComparisonCard(detailsB, "B")
        );

        comparisonResults.replaceChildren(grid);

        if (amenitiesA && amenitiesB) {
            comparisonResults.appendChild(
                createAmenityComparison()
            );
        } else {
            comparisonResults.appendChild(
                el(
                    "p",
                    "compare-amenities-warning",
                    "Nearby amenities are currently unavailable for one or both blocks."
                )
            );
        }

        comparisonResults.appendChild(
            createAccessibilitySection()
        );

        updateAccessibilityDisplay();

        compareStatus.textContent =
            "Resale statistics from MySQL and nearby amenities from MongoDB.";

        // Keep map errors separate from comparison results.
        try {
            renderMap();
        } catch (error) {
            console.error(
                "Comparison map failed:",
                error
            );

            if (mapSection) {
                mapSection.hidden = false;
            }

            if (mapElement) {
                mapElement.style.display = "none";
            }

            if (mapStatus) {
                mapStatus.textContent =
                    "The comparison results loaded, but the map could not be displayed. Check the browser Console.";
            }
        }
    }

    // ==========================================
    // 26. RELOAD AMENITIES ON RADIUS CHANGE
    // ==========================================

    async function reloadAmenities() {
        if (
            !blockA ||
            !blockB ||
            isComparing
        ) {
            return;
        }

        const id = ++comparisonRequestId;
        const radius = selectedRadius;

        isComparing = true;
        updateSelectionStatus();

        compareStatus.textContent =
            `Updating nearby amenities within ${formatNumber(radius)} m...`;

        try {
            const results = await Promise.allSettled([
                fetchAmenities(
                    blockA.block_id,
                    radius
                ),
                fetchAmenities(
                    blockB.block_id,
                    radius
                )
            ]);

            if (id !== comparisonRequestId) {
                return;
            }

            amenitiesA =
                results[0].status === "fulfilled"
                    ? results[0].value
                    : null;

            amenitiesB =
                results[1].status === "fulfilled"
                    ? results[1].value
                    : null;

            renderComparison();

        } catch (error) {
            if (id !== comparisonRequestId) {
                return;
            }

            console.error(
                "Radius update failed:",
                error
            );

            compareStatus.textContent =
                "Unable to update nearby amenities.";

        } finally {
            if (id === comparisonRequestId) {
                isComparing = false;
                updateSelectionStatus();
            }
        }
    }

    // ==========================================
    // 27. COMPARE TWO HDB BLOCKS
    // ==========================================

    async function compareBlocks() {
        if (
            !bothSelected() ||
            sameBlock() ||
            isComparing
        ) {
            updateSelectionStatus();
            return;
        }

        const id = ++comparisonRequestId;

        const idA = blockA.block_id;
        const idB = blockB.block_id;

        isComparing = true;

        compareButton.disabled = true;
        compareButton.textContent = "Comparing...";

        compareStatus.textContent =
            "Loading comparison results...";

        hideMap();

        comparisonResults.replaceChildren(
            el(
                "p",
                "",
                "Please wait while Haven retrieves both blocks."
            )
        );

        try {
            // Fetch MySQL block details.
            const [resultA, resultB] =
                await Promise.all([
                    fetchDetails(idA),
                    fetchDetails(idB)
                ]);

            if (id !== comparisonRequestId) {
                return;
            }

            detailsA = resultA;
            detailsB = resultB;

            // Fetch MongoDB amenities.
            const amenityResults =
                await Promise.allSettled([
                    fetchAmenities(
                        idA,
                        selectedRadius
                    ),
                    fetchAmenities(
                        idB,
                        selectedRadius
                    )
                ]);

            if (id !== comparisonRequestId) {
                return;
            }

            amenitiesA =
                amenityResults[0].status === "fulfilled"
                    ? amenityResults[0].value
                    : null;

            amenitiesB =
                amenityResults[1].status === "fulfilled"
                    ? amenityResults[1].value
                    : null;

            // Render comparison and map.
            renderComparison();

            // Recreate shared radius control.
            $("compareRadiusWrapper")?.remove();

            const radiusWrapper = el(
                "div",
                "compare-radius-wrapper"
            );

            radiusWrapper.id =
                "compareRadiusWrapper";

            radiusWrapper.appendChild(
                createRadiusControl()
            );

            comparisonResults.before(
                radiusWrapper
            );

            comparisonResults.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

        } catch (error) {
            if (id !== comparisonRequestId) {
                return;
            }

            console.error(
                "Comparison failed:",
                error
            );

            compareStatus.textContent =
                "Unable to complete comparison.";

            hideMap();

            comparisonResults.replaceChildren(
                el(
                    "p",
                    "",
                    "Something went wrong while retrieving or displaying the HDB comparison. Please try again."
                )
            );

        } finally {
            if (id === comparisonRequestId) {
                isComparing = false;

                compareButton.textContent =
                    "Compare blocks";

                updateSelectionStatus();
            }
        }
    }

    // ==========================================
    // 28. INITIALISE
    // ==========================================

    initialiseSearch("A");
    initialiseSearch("B");

    resetButton.addEventListener(
        "click",
        resetSelections
    );

    compareButton.addEventListener(
        "click",
        compareBlocks
    );

    hideMap();
    showEmptyComparison();
    updateSelectionStatus();

});