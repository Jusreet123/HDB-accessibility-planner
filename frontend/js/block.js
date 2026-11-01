
document.addEventListener("DOMContentLoaded", async () => {
    const blockAddress = document.getElementById("blockAddress");
    const blockLocation = document.getElementById("blockLocation");
    const blockOverview = document.getElementById("blockOverview");
    const blockStatistics = document.getElementById("blockStatistics");
    const blockTransactions = document.getElementById("blockTransactions");

    // Read the block ID from the website URL
    const urlParams = new URLSearchParams(window.location.search);
    const blockId = urlParams.get("id");

    // Format Singapore dollar amounts
    function formatPrice(value) {
        if (value === null || value === undefined) {
            return "N/A";
        }

        return new Intl.NumberFormat("en-SG", {
            style: "currency",
            currency: "SGD",
            maximumFractionDigits: 0
        }).format(Number(value));
    }

    // Format resale transaction dates
    function formatDate(value) {
        if (!value) return "Date unavailable";

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

    // Create a text element safely
    function createTextElement(tag, text, className = "") {
        const element = document.createElement(tag);
        element.textContent = text;

        if (className) {
            element.className = className;
        }

        return element;
    }

    // Display block information
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
                createTextElement("p", label, "block-info-label"),
                createTextElement("h3", String(value))
            );

            grid.appendChild(card);
        });

        blockOverview.appendChild(grid);
    }

    // Display historical resale statistics
    function displayStatistics(statistics) {
        blockStatistics.replaceChildren();

        const grid = document.createElement("div");
        grid.className = "block-statistics-grid";

        const items = [
            [
                "Total recorded transactions",
                Number(statistics.total_transactions).toLocaleString("en-SG")
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
                createTextElement("p", label, "block-stat-label"),
                createTextElement("h3", value, "block-stat-value")
            );

            grid.appendChild(card);
        });

        blockStatistics.appendChild(grid);
    }

    // Display recent resale transactions
    function displayTransactions(transactions) {
        blockTransactions.replaceChildren();

        if (!transactions.length) {
            blockTransactions.appendChild(
                createTextElement(
                    "p",
                    "No recorded resale transactions found for this block."
                )
            );
            return;
        }

        transactions.forEach((transaction) => {
            const card = document.createElement("article");
            card.className = "transaction-card";

            const flatType = createTextElement(
                "p",
                transaction.flat_type_name,
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

            card.append(flatType, price, details, date);
            blockTransactions.appendChild(card);
        });
    }

    // Load block data from the backend
    async function loadBlockDetails() {
        if (!blockId || !/^[1-9]\d*$/.test(blockId)) {
            blockAddress.textContent = "Invalid block";
            blockLocation.textContent =
                "Please select an HDB block from the Explore page.";

            blockOverview.replaceChildren();
            blockStatistics.replaceChildren();
            blockTransactions.replaceChildren();
            return;
        }

        try {
            const response = await fetch(
                `/api/blocks/${encodeURIComponent(blockId)}`
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message || "Unable to load block details"
                );
            }

            displayBlockOverview(result.block);
            displayStatistics(result.statistics);
            displayTransactions(result.transactions);

            document.title =
                `${result.block.blk_no} ${result.block.street_name} | Haven.`;

        } catch (error) {
            console.error("Block details loading failed:", error);

            blockAddress.textContent = "Unable to load block";
            blockLocation.textContent = error.message;

            blockOverview.replaceChildren();
            blockStatistics.replaceChildren();
            blockTransactions.replaceChildren();
        }
    }

    await loadBlockDetails();
});