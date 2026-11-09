
document.addEventListener("DOMContentLoaded", () => {

    // ==========================================
    // 1. PAGE ELEMENTS
    // ==========================================

    const status = document.getElementById("insightsStatus");
    const filterStatus = document.getElementById("insightsFilterStatus");

    const overview = document.getElementById("marketOverview");
    const flatTypeTable = document.getElementById("flatTypeTable");
    const townRankingsTable = document.getElementById("townRankingsTable");

    const townSelect = document.getElementById("insightsTown");
    const flatTypeSelect = document.getElementById("insightsFlatType");
    const startYearSelect = document.getElementById("insightsStartYear");
    const endYearSelect = document.getElementById("insightsEndYear");

    const applyButton = document.getElementById("insightsApply");
    const resetButton = document.getElementById("insightsReset");

    // ==========================================
    // 2. APPLICATION STATE
    // ==========================================

    let trendsChart = null;
    let flatTypeChart = null;
    let townRankingsChart = null;

    let requestNumber = 0;

    // ==========================================
    // 3. FORMATTING HELPERS
    // ==========================================

    function formatNumber(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "N/A";
        }

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

        return Number.isFinite(number)
            ? new Intl.NumberFormat("en-SG", {
                style: "currency",
                currency: "SGD",
                maximumFractionDigits: 0
            }).format(number)
            : "N/A";
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
    // 4. API HELPERS
    // ==========================================

    async function fetchJSON(url) {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(
                `${url} returned HTTP ${response.status}`
            );
        }

        const result = await response.json();

        if (result.status !== "success") {
            throw new Error(
                `Unable to retrieve data from ${url}`
            );
        }

        return result;
    }

    function buildQuery(filters) {
        const params = new URLSearchParams();

        if (filters.town) {
            params.set("town", filters.town);
        }

        if (filters.flatType) {
            params.set("flatType", filters.flatType);
        }

        if (filters.startYear) {
            params.set("startYear", filters.startYear);
        }

        if (filters.endYear) {
            params.set("endYear", filters.endYear);
        }

        const query = params.toString();

        return query ? `?${query}` : "";
    }

    async function fetchInsights(endpoint, filters) {
        const query = buildQuery(filters);

        const result = await fetchJSON(
            `/api/insights/${endpoint}${query}`
        );

        return result.data;
    }

    // ==========================================
    // 5. FILTER HELPERS
    // ==========================================

    function getSelectedFilters() {
        return {
            town: townSelect.value,
            flatType: flatTypeSelect.value,
            startYear: startYearSelect.value,
            endYear: endYearSelect.value
        };
    }

    function emptyFilters() {
        return {
            town: "",
            flatType: "",
            startYear: "",
            endYear: ""
        };
    }

    function validateFilters(filters) {
        if (
            filters.startYear &&
            filters.endYear &&
            Number(filters.startYear) >
            Number(filters.endYear)
        ) {
            filterStatus.textContent =
                "Start Year cannot be later than End Year.";

            return false;
        }

        return true;
    }

    function describeFilters(filters) {
        const descriptions = [];

        if (filters.town) {
            descriptions.push(filters.town);
        } else {
            descriptions.push("All Towns");
        }

        if (filters.flatType) {
            descriptions.push(filters.flatType);
        } else {
            descriptions.push("All Flat Types");
        }

        if (filters.startYear || filters.endYear) {
            descriptions.push(
                `${filters.startYear || "Earliest"} – ${filters.endYear || "Latest"}`
            );
        } else {
            descriptions.push("All Years");
        }

        return descriptions.join(" | ");
    }

    // ==========================================
    // 6. POPULATE FILTER DROPDOWNS
    // ==========================================

    function populateSelect(select, values) {
        const firstOption = select.options[0].cloneNode(true);

        select.replaceChildren(firstOption);

        values.forEach(value => {
            const option = document.createElement("option");

            option.value = String(value);
            option.textContent = String(value);

            select.appendChild(option);
        });
    }

    async function loadFilterOptions() {
        try {
            const [
                townsResult,
                flatTypesResult,
                trendsResult
            ] = await Promise.all([
                fetchJSON("/api/towns"),
                fetchJSON("/api/insights/flat-types"),
                fetchJSON("/api/insights/trends")
            ]);

            const towns = townsResult.data
                .map(row => row.town_name)
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));

            const flatTypes = flatTypesResult.data
                .map(row => row.flat_type_name)
                .filter(Boolean);

            const years = trendsResult.data
                .map(row => Number(row.sale_year))
                .filter(Number.isFinite)
                .sort((a, b) => a - b);

            populateSelect(townSelect, towns);
            populateSelect(flatTypeSelect, flatTypes);
            populateSelect(startYearSelect, years);
            populateSelect(endYearSelect, years);

        } catch (error) {
            console.error(
                "Unable to load filter options:",
                error
            );

            filterStatus.textContent =
                "Unable to load filter options. Please refresh the page.";
        }
    }

    // ==========================================
    // 7. MARKET OVERVIEW
    // ==========================================

    function renderOverview(data) {
        overview.replaceChildren();

        const statistics = [
            {
                label: "Total Resale Transactions",
                value: formatNumber(data.total_transactions)
            },
            {
                label: "Average Resale Price",
                value: formatCurrency(data.average_price)
            },
            {
                label: "Lowest Resale Price",
                value: formatCurrency(data.lowest_price)
            },
            {
                label: "Highest Resale Price",
                value: formatCurrency(data.highest_price)
            },
            {
                label: "Towns with Transactions",
                value: formatNumber(data.total_towns)
            }
        ];

        statistics.forEach(stat => {
            const card = createElement(
                "article",
                "insights-stat-card"
            );

            const label = createElement(
                "span",
                "insights-stat-label",
                stat.label
            );

            const value = createElement(
                "strong",
                "insights-stat-value",
                stat.value
            );

            card.append(label, value);
            overview.appendChild(card);
        });
    }

    // ==========================================
    // 8. CHART CONFIGURATION
    // ==========================================

    function chartOptions(horizontal = false) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: horizontal ? "y" : "x",

            plugins: {
                legend: {
                    display: false
                },

                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = horizontal
                                ? context.parsed.x
                                : context.parsed.y;

                            return formatCurrency(value);
                        }
                    }
                }
            },

            scales: {
                x: {
                    ticks: horizontal
                        ? {
                            callback: value =>
                                "$" + Number(value).toLocaleString("en-SG")
                        }
                        : {}
                },

                y: {
                    beginAtZero: horizontal,

                    ticks: horizontal
                        ? {}
                        : {
                            callback: value =>
                                "$" + Number(value).toLocaleString("en-SG")
                        }
                }
            }
        };
    }

    // ==========================================
    // 9. ANNUAL PRICE TRENDS
    // ==========================================

    function renderTrends(data) {
        const canvas = document.getElementById(
            "priceTrendsChart"
        );

        if (trendsChart) {
            trendsChart.destroy();
        }

        trendsChart = new Chart(canvas, {
            type: "line",

            data: {
                labels: data.map(row => row.sale_year),

                datasets: [{
                    label: "Average Resale Price",

                    data: data.map(row =>
                        row.average_price === null
                            ? null
                            : Number(row.average_price)
                    ),

                    borderColor: "#0f766e",
                    backgroundColor: "rgba(15,118,110,0.12)",
                    borderWidth: 3,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.3,
                    fill: true
                }]
            },

            options: chartOptions()
        });
    }

    // ==========================================
    // 10. FLAT-TYPE COMPARISON
    // ==========================================

    function renderFlatTypes(data) {
        const valid = data.filter(
            row => row.average_price !== null
        );

        const canvas = document.getElementById(
            "flatTypeChart"
        );

        if (flatTypeChart) {
            flatTypeChart.destroy();
        }

        flatTypeChart = new Chart(canvas, {
            type: "bar",

            data: {
                labels: valid.map(
                    row => row.flat_type_name
                ),

                datasets: [{
                    label: "Average Resale Price",

                    data: valid.map(
                        row => Number(row.average_price)
                    ),

                    backgroundColor: "#0f766e",
                    borderRadius: 6
                }]
            },

            options: chartOptions()
        });

        renderTable(
            flatTypeTable,
            [
                "Flat Type",
                "Transactions",
                "Average Price",
                "Average Floor Area"
            ],
            valid.map(row => [
                row.flat_type_name,
                formatNumber(row.total_transactions),
                formatCurrency(row.average_price),

                row.average_floor_area_sqm === null
                    ? "N/A"
                    : `${Number(row.average_floor_area_sqm).toFixed(1)} m²`
            ])
        );
    }

    // ==========================================
    // 11. TOWN PRICE RANKINGS
    // ==========================================

    function renderTownRankings(data) {
        const valid = data.filter(
            row => row.average_price !== null
        );

        const topTen = valid.slice(0, 10);

        const canvas = document.getElementById(
            "townRankingsChart"
        );

        if (townRankingsChart) {
            townRankingsChart.destroy();
        }

        townRankingsChart = new Chart(canvas, {
            type: "bar",

            data: {
                labels: topTen.map(
                    row => row.town_name
                ),

                datasets: [{
                    label: "Average Resale Price",

                    data: topTen.map(
                        row => Number(row.average_price)
                    ),

                    backgroundColor: "#0f766e",
                    borderRadius: 6
                }]
            },

            options: chartOptions(true)
        });

        renderTable(
            townRankingsTable,
            [
                "Rank",
                "Town",
                "Transactions",
                "Average Price"
            ],
            valid.map((row, index) => [
                String(index + 1),
                row.town_name,
                formatNumber(row.total_transactions),
                formatCurrency(row.average_price)
            ])
        );
    }

    // ==========================================
    // 12. REUSABLE DATA TABLE
    // ==========================================

    function renderTable(container, headers, rows) {
        container.replaceChildren();

        if (rows.length === 0) {
            container.appendChild(
                createElement(
                    "p",
                    "",
                    "No transactions match the selected filters."
                )
            );

            return;
        }

        const table = createElement(
            "table",
            "insights-data-table"
        );

        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");

        headers.forEach(header => {
            headerRow.appendChild(
                createElement("th", "", header)
            );
        });

        thead.appendChild(headerRow);

        const tbody = document.createElement("tbody");

        rows.forEach(row => {
            const tr = document.createElement("tr");

            row.forEach(value => {
                tr.appendChild(
                    createElement("td", "", value)
                );
            });

            tbody.appendChild(tr);
        });

        table.append(thead, tbody);
        container.appendChild(table);
    }

    // ==========================================
    // 13. LOAD MARKET INSIGHTS
    // ==========================================

    async function loadInsights(filters = emptyFilters()) {
        if (!validateFilters(filters)) {
            return;
        }

        const currentRequest = ++requestNumber;

        status.textContent =
            "Loading market statistics...";

        filterStatus.textContent =
            "Applying selected filters...";

        applyButton.disabled = true;
        resetButton.disabled = true;

        try {
            if (typeof Chart === "undefined") {
                throw new Error(
                    "Chart.js could not be loaded"
                );
            }

            const [
                overviewData,
                trendsData,
                flatTypesData,
                townRankingsData
            ] = await Promise.all([
                fetchInsights("overview", filters),
                fetchInsights("trends", filters),
                fetchInsights("flat-types", filters),
                fetchInsights("town-rankings", filters)
            ]);

            if (currentRequest !== requestNumber) {
                return;
            }

            renderOverview(overviewData);
            renderTrends(trendsData);
            renderFlatTypes(flatTypesData);
            renderTownRankings(townRankingsData);

            status.textContent =
                "Market statistics loaded successfully.";

            filterStatus.textContent =
                `Showing: ${describeFilters(filters)}`;

        } catch (error) {
            console.error(
                "Market Insights loading failed:",
                error
            );

            status.textContent =
                "Unable to load market insights. Please try again.";

            filterStatus.textContent =
                "The selected filters could not be applied.";

        } finally {
            if (currentRequest === requestNumber) {
                applyButton.disabled = false;
                resetButton.disabled = false;
            }
        }
    }

    // ==========================================
    // 14. FILTER EVENT LISTENERS
    // ==========================================

    applyButton.addEventListener("click", () => {
        const filters = getSelectedFilters();

        loadInsights(filters);
    });

    resetButton.addEventListener("click", () => {
        townSelect.value = "";
        flatTypeSelect.value = "";
        startYearSelect.value = "";
        endYearSelect.value = "";

        loadInsights(emptyFilters());
    });

    // ==========================================
    // 15. INITIALISE
    // ==========================================

    async function initialise() {
        await loadFilterOptions();
        await loadInsights();
    }

    initialise();

});