
"use strict";

document.addEventListener("DOMContentLoaded", async () => {

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

    // ==========================================
    // WISHLIST STATE
    // ==========================================

    let isLoggedIn = false;
    const savedBlocks = new Map();

    // Homepage search is mapped to a town when possible.
    // Non-town terms (street/block numbers) remain supported as an internal search.
    const urlParams = new URLSearchParams(window.location.search);
    const homepageSearch = (urlParams.get("search") || "").trim();
    let addressSearch = "";

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

            townFilter.replaceChildren();

            const defaultOption = document.createElement("option");
            defaultOption.value = "";
            defaultOption.textContent = "All Towns";
            townFilter.appendChild(defaultOption);

            (result.data || []).forEach((town) => {
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
    // 2. HOMEPAGE SEARCH TO TOWN FILTER
    // ==========================================

    function normalizeLocation(value) {
        return String(value || "")
            .trim()
            .replace(/\s+/g, " ")
            .toUpperCase();
    }

    function selectTownFromURL() {
        const requestedTown = (
            urlParams.get("town") || homepageSearch
        ).trim();

        if (!requestedTown || !townFilter) return;

        const normalizedSearch = normalizeLocation(requestedTown);

        const matchingTown = Array.from(townFilter.options).find(
            (option) =>
                option.value &&
                normalizeLocation(option.value) === normalizedSearch
        );

        if (matchingTown) {
            townFilter.value = matchingTown.value;
            addressSearch = "";
        } else if (homepageSearch) {
            // Preserve homepage street and block-number searches.
            addressSearch = homepageSearch;
        }
    }

    // ==========================================
    // 3. FORMATTING FUNCTIONS
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
    // 4. LOAD USER WISHLIST
    // ==========================================

    async function loadWishlist() {
        try {
            const response = await fetch("/api/wishlist", {
                credentials: "same-origin"
            });

            if (response.status === 401) {
                isLoggedIn = false;
                savedBlocks.clear();
                return;
            }

            if (!response.ok) {
                throw new Error("Unable to load wishlist.");
            }

            const data = await response.json();

            isLoggedIn = true;
            savedBlocks.clear();

            (data.wishlist || []).forEach((item) => {
                savedBlocks.set(
                    Number(item.block_id),
                    Number(item.wishlist_id)
                );
            });

        } catch (error) {
            console.error("Wishlist loading failed:", error);
        }
    }

    // ==========================================
    // 5. WISHLIST HEART BUTTON
    // ==========================================

    function updateHeartButton(button, blockId) {
        const saved = savedBlocks.has(Number(blockId));

        button.textContent = saved ? "♥" : "♡";

        button.classList.toggle("is-saved", saved);

        button.setAttribute("aria-pressed", String(saved));

        button.setAttribute(
            "aria-label",
            saved ? "Remove from wishlist" : "Save to wishlist"
        );

        button.title = saved
            ? "Remove from My Wishlist"
            : "Save to My Wishlist";
    }

    function refreshHeartButtons() {
        document.querySelectorAll(
            ".explore-wishlist-btn"
        ).forEach((button) => {
            updateHeartButton(
                button,
                Number(button.dataset.blockId)
            );
        });
    }

    async function toggleWishlist(blockId, button) {

        if (!isLoggedIn) {
            window.location.href =
                "login.html?redirect=explore.html";
            return;
        }

        const numericBlockId = Number(blockId);
        const alreadySaved = savedBlocks.has(numericBlockId);

        button.disabled = true;

        try {
            let response;

            if (alreadySaved) {
                const wishlistId = savedBlocks.get(numericBlockId);

                response = await fetch(
                    `/api/wishlist/${wishlistId}`,
                    {
                        method: "DELETE",
                        credentials: "same-origin"
                    }
                );

            } else {
                response = await fetch("/api/wishlist", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        block_id: numericBlockId,
                        priority: "Medium",
                        notes: ""
                    })
                });
            }

            if (response.status === 401) {
                window.location.href =
                    "login.html?redirect=explore.html";
                return;
            }

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Unable to update wishlist."
                );
            }

            if (alreadySaved) {
                savedBlocks.delete(numericBlockId);
            } else {
                savedBlocks.set(
                    numericBlockId,
                    Number(data.wishlist_id)
                );
            }

            refreshHeartButtons();

        } catch (error) {
            console.error("Wishlist action failed:", error);
            window.alert(error.message);
        } finally {
            button.disabled = false;
        }
    }

    function createWishlistButton(transaction) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "explore-wishlist-btn";
        button.dataset.blockId = transaction.block_id;

        updateHeartButton(button, transaction.block_id);

        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await toggleWishlist(transaction.block_id, button);
        });

        button.addEventListener("keydown", (event) => {
            event.stopPropagation();
        });

        return button;
    }

    // ==========================================
    // 6. CREATE TRANSACTION CARDS
    // ==========================================

    function createTransactionCard(transaction) {
        const card = document.createElement("article");
        card.className = "transaction-card";

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

        card.addEventListener("click", (event) => {
            if (event.target.closest("button")) return;
            openBlockDetails();
        });

        card.addEventListener("keydown", (event) => {
            if (event.target !== card) return;

            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openBlockDetails();
            }
        });

        // Card header with wishlist heart
        const header = document.createElement("div");
        header.className = "explore-card-header";

        const address = document.createElement("h3");
        address.textContent =
            `${transaction.blk_no} ${transaction.street_name}`;

        const heartButton = createWishlistButton(transaction);

        header.append(address, heartButton);

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
            header,
            town,
            price,
            details,
            date,
            viewDetails
        );

        return card;
    }

    // ==========================================
    // 7. LOAD RESALE TRANSACTIONS
    // ==========================================

    async function loadResaleTransactions() {
        resultsContainer.replaceChildren();
        resultsCount.textContent = "Loading transactions...";
        pagination.replaceChildren();

        const params = new URLSearchParams({
            search: addressSearch,
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

            if (!result.data || result.data.length === 0) {
                const empty = document.createElement("p");
                empty.textContent =
                    "No transactions found. Try adjusting your filters.";

                resultsContainer.appendChild(empty);
                return;
            }

            result.data.forEach((transaction) => {
                resultsContainer.appendChild(
                    createTransactionCard(transaction)
                );
            });

            // Pagination
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
    // 8. SEARCH AND FILTER EVENTS
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
        addressSearch = "";

        // Clear any previous homepage search from the URL.
        window.history.replaceState(
            null,
            "",
            window.location.pathname
        );

        setTimeout(() => {
            currentPage = 1;
            loadResaleTransactions();
        }, 0);
    });

    // ==========================================
    // 9. INITIALISE EXPLORE PAGE
    // ==========================================

    await loadTowns();
    selectTownFromURL();

    // Changing the town manually clears a previous
    // street/block search inherited from the homepage.
    townFilter.addEventListener("change", () => {
        addressSearch = "";
    });

    await loadWishlist();
    await loadResaleTransactions();

});