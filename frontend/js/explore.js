
document.addEventListener("DOMContentLoaded", async () => {
    const searchInput = document.getElementById("blockSearch");
    const townFilter = document.getElementById("townFilter");
    const flatTypeFilter = document.getElementById("flatTypeFilter");
    const minPriceInput = document.getElementById("minPrice");
    const maxPriceInput = document.getElementById("maxPrice");
    const sortResults = document.getElementById("sortResults");
    const exploreForm = document.getElementById("exploreForm");
    const resultsContainer = document.getElementById("resultsContainer");
    const resultsCount = document.getElementById("resultsCount");
    const pagination = document.getElementById("pagination");

    let currentPage = 1;

    // Read search terms passed from the homepage
    const urlParams = new URLSearchParams(window.location.search);
    const searchTerm = urlParams.get("search");

    if (searchInput && searchTerm) {
        searchInput.value = searchTerm;
    }

    // ==========================================
    // 1. LOAD HDB TOWNS
    // ==========================================

    async function loadTowns() {
        if (!townFilter) return;

        try {
            const response = await fetch("/api/towns");

            if (!response.ok) {
                throw new Error("Unable to load towns");
            }

            const result = await response.json();

            townFilter.innerHTML = "";

            const defaultOption = document.createElement("option");
            defaultOption.value = "";
            defaultOption.textContent = "All Towns";
            townFilter.appendChild(defaultOption);

            result.data.forEach((town) => {
                const option = document.createElement("option");

                option.value = town.town_name;
                option.textContent = town.town_name;

                townFilter.appendChild(option);
            });

        } catch (error) {
            console.error("Town loading failed:", error);
        }
    }

    // ==========================================
    // 2. FORMATTING FUNCTIONS
    // ==========================================

    function formatPrice(price) {
        return new Intl.NumberFormat("en-SG", {
            style: "currency",
            currency: "SGD",
            maximumFractionDigits: 0
        }).format(Number(price));
    }

    function formatDate(dateString) {
        if (!dateString) return "Date unavailable";

        const date = new Date(dateString);

        if (Number.isNaN(date.getTime())) {
            return String(dateString);
        }

        return date.toLocaleDateString("en-SG", {
            month: "short",
            year: "numeric",
            timeZone: "UTC"
        });
    }

    // ==========================================
    // 3. CREATE CLICKABLE TRANSACTION CARDS
    // ==========================================

    function createTransactionCard(transaction) {
        const card = document.createElement("article");
        card.className = "transaction-card";

        // Make the card interactive
        card.setAttribute("role", "link");
        card.setAttribute("tabindex", "0");

        card.setAttribute(
            "aria-label",
            `View details for ${transaction.blk_no} ${transaction.street_name}`
        );

        const blockUrl =
            `block.html?id=${encodeURIComponent(transaction.block_id)}`;

        function openBlockDetails() {
            window.location.href = blockUrl;
        }

        // Open block details when clicked
        card.addEventListener("click", openBlockDetails);

        // Keyboard accessibility
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openBlockDetails();
            }
        });

        // Block address
        const address = document.createElement("h3");
        address.textContent =
            `${transaction.blk_no} ${transaction.street_name}`;

        // Town
        const town = document.createElement("p");
        town.className = "transaction-town";
        town.textContent = transaction.town_name;

        // Resale price
        const price = document.createElement("p");
        price.className = "transaction-price";
        price.textContent = formatPrice(transaction.resale_price);

        // Flat information
        const details = document.createElement("p");
        details.className = "transaction-details";

        const area = transaction.floor_area_sqm
            ? `${transaction.floor_area_sqm} sqm`
            : "Area unavailable";

        details.textContent =
            `${transaction.flat_type_name} · ${area} · ${transaction.storey_range || "Storey unavailable"}`;

        // Transaction date
        const date = document.createElement("p");
        date.className = "transaction-date";
        date.textContent =
            `Resale transaction: ${formatDate(transaction.sale_date)}`;

        // View details indicator
        const viewDetails = document.createElement("p");
        viewDetails.className = "transaction-view-details";
        viewDetails.textContent = "View block details →";

        card.append(
            address,
            town,
            price,
            details,
            date,
            viewDetails
        );

        return card;
    }

    // ==========================================
    // 4. LOAD RESALE TRANSACTIONS
    // ==========================================

    async function loadResaleTransactions() {
        resultsContainer.replaceChildren();
        resultsCount.textContent = "Loading transactions...";
        pagination.replaceChildren();

        const params = new URLSearchParams({
            search: searchInput.value.trim(),
            town: townFilter.value,
            flatType: flatTypeFilter.value,
            minPrice: minPriceInput.value,
            maxPrice: maxPriceInput.value,
            sort: sortResults.value,
            page: String(currentPage)
        });

        try {
            const response = await fetch(`/api/resale?${params}`);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message || "Unable to load transactions"
                );
            }

            resultsCount.textContent =
                `${Number(result.total).toLocaleString("en-SG")} historical resale transactions found`;

            if (result.data.length === 0) {
                const empty = document.createElement("p");
                empty.textContent =
                    "No transactions found. Try adjusting your filters.";

                resultsContainer.appendChild(empty);
                return;
            }

            // Display transaction cards
            result.data.forEach((transaction) => {
                resultsContainer.appendChild(
                    createTransactionCard(transaction)
                );
            });

            // ==========================================
            // 5. PAGINATION
            // ==========================================

            const previousButton = document.createElement("button");
            previousButton.type = "button";
            previousButton.textContent = "Previous";
            previousButton.disabled = currentPage <= 1;

            previousButton.addEventListener("click", () => {
                currentPage--;
                loadResaleTransactions();
            });

            const pageLabel = document.createElement("span");
            pageLabel.textContent =
                `Page ${currentPage} of ${result.totalPages}`;

            const nextButton = document.createElement("button");
            nextButton.type = "button";
            nextButton.textContent = "Next";
            nextButton.disabled =
                currentPage >= result.totalPages;

            nextButton.addEventListener("click", () => {
                currentPage++;
                loadResaleTransactions();
            });

            pagination.append(
                previousButton,
                pageLabel,
                nextButton
            );

        } catch (error) {
            console.error("Resale loading failed:", error);

            resultsCount.textContent =
                "Unable to load transactions.";

            const message = document.createElement("p");
            message.textContent = error.message;

            resultsContainer.appendChild(message);
        }
    }

    // ==========================================
    // 6. SEARCH AND FILTER EVENTS
    // ==========================================

    exploreForm.addEventListener("submit", (event) => {
        event.preventDefault();

        currentPage = 1;
        loadResaleTransactions();
    });

    sortResults.addEventListener("change", () => {
        currentPage = 1;
        loadResaleTransactions();
    });

    exploreForm.addEventListener("reset", () => {
        setTimeout(() => {
            currentPage = 1;
            loadResaleTransactions();
        }, 0);
    });

    // ==========================================
    // 7. INITIALISE EXPLORE PAGE
    // ==========================================

    await loadTowns();
    await loadResaleTransactions();
});