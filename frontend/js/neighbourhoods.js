
document.addEventListener("DOMContentLoaded", () => {

    // ==========================================
    // 1. PAGE ELEMENTS
    // ==========================================

    const townSearch = document.getElementById("townSearch");
    const townSort = document.getElementById("townSort");
    const townReset = document.getElementById("townReset");
    const townStatus = document.getElementById("townStatus");
    const townResults = document.getElementById("townResults");

    // ==========================================
    // 2. APPLICATION STATE
    // ==========================================

    let allTowns = [];

    // ==========================================
    // 3. FORMATTING HELPERS
    // ==========================================

    function formatNumber(value) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number.toLocaleString("en-SG")
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

    function createElement(tag, className = "", text = null) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== null && text !== undefined) {
            element.textContent = String(text);
        }

        return element;
    }

    // ==========================================
    // 4. CREATE STATISTIC
    // ==========================================

    function createStatistic(label, value) {
        const statistic = createElement(
            "div",
            "neighbourhood-stat"
        );

        const number = createElement(
            "strong",
            "neighbourhood-stat-value",
            value
        );

        const description = createElement(
            "span",
            "neighbourhood-stat-label",
            label
        );

        statistic.append(number, description);

        return statistic;
    }

    // ==========================================
    // 5. CREATE NEIGHBOURHOOD CARD
    // ==========================================

    function createTownCard(town) {
        const card = createElement(
            "article",
            "neighbourhood-card"
        );

        const header = createElement(
            "div",
            "neighbourhood-card-header"
        );

        const eyebrow = createElement(
            "span",
            "neighbourhood-card-eyebrow",
            "HDB NEIGHBOURHOOD"
        );

        const title = createElement(
            "h3",
            "neighbourhood-card-title",
            town.town_name
        );

        header.append(eyebrow, title);

        // ------------------------------------------
        // TOWN STATISTICS
        // ------------------------------------------

        const statistics = createElement(
            "div",
            "neighbourhood-card-statistics"
        );

        statistics.append(
            createStatistic(
                "HDB blocks",
                formatNumber(town.total_blocks)
            ),
            createStatistic(
                "Resale transactions",
                formatNumber(town.total_transactions)
            ),
            createStatistic(
                "Average resale price",
                formatCurrency(town.average_price)
            )
        );

        // ------------------------------------------
        // RESALE PRICE RANGE
        // ------------------------------------------

        const priceRange = createElement(
            "p",
            "neighbourhood-price-range"
        );

        const hasPriceData =
            town.lowest_price !== null &&
            town.highest_price !== null;

        priceRange.textContent = hasPriceData
            ? `Recorded resale range: ${formatCurrency(town.lowest_price)} – ${formatCurrency(town.highest_price)}`
            : "No resale transactions recorded.";

        // ------------------------------------------
        // BUILD URL PARAMETERS
        // ------------------------------------------

        const params = new URLSearchParams({
            town: town.town_name
        });

        // ------------------------------------------
        // VIEW TOWN DETAILS BUTTON (NEW)
        // ------------------------------------------

        const detailsLink = createElement(
            "a",
            "primary-button neighbourhood-details-button",
            "View Town Details"
        );

        detailsLink.href = `town.html?${params.toString()}`;

        // ------------------------------------------
        // EXPLORE HDB BLOCKS BUTTON (EXISTING)
        // ------------------------------------------

        const exploreLink = createElement(
            "a",
            "primary-button neighbourhood-explore-button",
            "Explore HDB blocks"
        );

        exploreLink.href = `explore.html?${params.toString()}`;

        // ------------------------------------------
        // BUTTON CONTAINER
        // ------------------------------------------

        const actions = createElement(
            "div",
            "neighbourhood-card-actions"
        );

        actions.append(detailsLink, exploreLink);

        // ------------------------------------------
        // ASSEMBLE CARD
        // ------------------------------------------

        card.append(
            header,
            statistics,
            priceRange,
            actions
        );

        return card;
    }

    // ==========================================
    // 6. FILTER AND SORT TOWNS
    // ==========================================

    function getFilteredTowns() {
        const keyword = townSearch.value
            .trim()
            .toLowerCase();

        const sort = townSort.value;

        const filtered = allTowns.filter(town => {
            return String(town.town_name || "")
                .toLowerCase()
                .includes(keyword);
        });

        const numeric = (town, field) => {
            const value = town[field];

            if (value === null || value === undefined) {
                return null;
            }

            const number = Number(value);

            return Number.isFinite(number)
                ? number
                : null;
        };

        filtered.sort((a, b) => {
            switch (sort) {
                case "blocks":
                    return (
                        numeric(b, "total_blocks") -
                        numeric(a, "total_blocks")
                    ) || a.town_name.localeCompare(b.town_name);

                case "transactions":
                    return (
                        numeric(b, "total_transactions") -
                        numeric(a, "total_transactions")
                    ) || a.town_name.localeCompare(b.town_name);

                case "priceLow": {
                    const priceA = numeric(a, "average_price");
                    const priceB = numeric(b, "average_price");

                    if (priceA === null) return 1;
                    if (priceB === null) return -1;

                    return (priceA - priceB) ||
                        a.town_name.localeCompare(b.town_name);
                }

                case "priceHigh": {
                    const priceA = numeric(a, "average_price");
                    const priceB = numeric(b, "average_price");

                    if (priceA === null) return 1;
                    if (priceB === null) return -1;

                    return (priceB - priceA) ||
                        a.town_name.localeCompare(b.town_name);
                }

                default:
                    return a.town_name.localeCompare(
                        b.town_name
                    );
            }
        });

        return filtered;
    }

    // ==========================================
    // 7. RENDER NEIGHBOURHOODS
    // ==========================================

    function renderTowns() {
        const towns = getFilteredTowns();

        townResults.replaceChildren();

        townStatus.textContent =
            `Showing ${formatNumber(towns.length)} of ${formatNumber(allTowns.length)} HDB towns.`;

        if (towns.length === 0) {
            const empty = createElement(
                "div",
                "empty-results"
            );

            empty.append(
                createElement(
                    "h3",
                    "",
                    "No neighbourhoods found"
                ),
                createElement(
                    "p",
                    "",
                    "Try another town name or reset your filters."
                )
            );

            townResults.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();

        towns.forEach(town => {
            fragment.appendChild(
                createTownCard(town)
            );
        });

        townResults.appendChild(fragment);
    }

    // ==========================================
    // 8. LOAD TOWN STATISTICS
    // ==========================================

    async function loadTowns() {
        townStatus.textContent =
            "Loading neighbourhood statistics...";

        try {
            const response = await fetch(
                "/api/towns/statistics"
            );

            if (!response.ok) {
                throw new Error(
                    `Town statistics API returned HTTP ${response.status}`
                );
            }

            const result = await response.json();

            if (
                result.status !== "success" ||
                !Array.isArray(result.data)
            ) {
                throw new Error(
                    "Invalid town statistics response"
                );
            }

            allTowns = result.data;

            renderTowns();

        } catch (error) {
            console.error(
                "Unable to load neighbourhoods:",
                error
            );

            townStatus.textContent =
                "Unable to load neighbourhood statistics.";

            townResults.replaceChildren(
                createElement(
                    "p",
                    "",
                    "Something went wrong while retrieving neighbourhood data. Please try refreshing the page."
                )
            );
        }
    }

    // ==========================================
    // 9. EVENT LISTENERS
    // ==========================================

    townSearch.addEventListener("input", renderTowns);

    townSort.addEventListener("change", renderTowns);

    townReset.addEventListener("click", () => {
        townSearch.value = "";
        townSort.value = "name";

        renderTowns();
    });

    // ==========================================
    // 10. INITIALISE
    // ==========================================

    loadTowns();

});