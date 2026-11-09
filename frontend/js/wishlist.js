"use strict";

// ==========================================
// HAVEN. - PERSONALISED HDB WISHLIST
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    // ======================================
    // HTML ELEMENTS
    // ======================================

    const searchForm = document.getElementById("wishlistSearchForm");
    const searchInput = document.getElementById("wishlistSearchInput");
    const searchStatus = document.getElementById("wishlistSearchStatus");
    const searchResults = document.getElementById("wishlistSearchResults");

    const wishlistItems = document.getElementById("wishlistItems");
    const wishlistEmpty = document.getElementById("wishlistEmpty");
    const wishlistCount = document.getElementById("wishlistCount");
    const wishlistMessage = document.getElementById("wishlistMessage");

    let savedWishlist = [];

    // ======================================
    // HELPER FUNCTIONS
    // ======================================

    function setMessage(element, message, isError = false) {
        if (!element) return;

        element.textContent = message;
        element.style.color = isError ? "#DC2626" : "#138F80";
    }

    function createElement(tag, className = "", text = "") {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== null && text !== undefined) {
            element.textContent = String(text);
        }

        return element;
    }

    function formatAddress(block) {
        return `${block.blk_no} ${block.street_name}`;
    }

    function isBlockSaved(blockId) {
        return savedWishlist.some(
            item => Number(item.block_id) === Number(blockId)
        );
    }

    async function readResponse(response) {
        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Something went wrong. Please try again."
            );
        }

        return data;
    }

    // ======================================
    // LOAD SAVED WISHLIST
    // ======================================

    async function loadWishlist() {

        setMessage(wishlistMessage, "Loading your wishlist...");

        try {

            const response = await fetch("/api/wishlist", {
                credentials: "same-origin"
            });

            if (response.status === 401) {
                window.location.href =
                    "login.html?redirect=wishlist.html";
                return;
            }

            const data = await readResponse(response);

            savedWishlist = Array.isArray(data.wishlist)
                ? data.wishlist
                : [];

            renderWishlist();

            setMessage(wishlistMessage, "");

        } catch (error) {

            console.error("Wishlist loading error:", error);

            setMessage(
                wishlistMessage,
                error.message || "Unable to load your wishlist.",
                true
            );
        }
    }

    // ======================================
    // RENDER SAVED WISHLIST
    // ======================================

    function renderWishlist() {

        if (!wishlistItems) return;

        wishlistItems.replaceChildren();

        wishlistCount.textContent =
            `${savedWishlist.length} saved`;

        if (savedWishlist.length === 0) {
            wishlistEmpty.hidden = false;
            return;
        }

        wishlistEmpty.hidden = true;

        savedWishlist.forEach(item => {

            const card = createElement(
                "article",
                "wishlist-card"
            );

            // Header
            const header = createElement(
                "div",
                "wishlist-card-header"
            );

            const titleGroup = createElement("div");

            const title = createElement(
                "h3",
                "",
                formatAddress(item)
            );

            const location = createElement(
                "p",
                "wishlist-card-location",
                item.postal
                    ? `Singapore ${item.postal}`
                    : "Singapore"
            );

            titleGroup.append(title, location);

            const priorityBadge = createElement(
                "span",
                `wishlist-priority-badge priority-${item.priority.toLowerCase()}`,
                `${item.priority} Priority`
            );

            header.append(titleGroup, priorityBadge);

            // Priority field
            const priorityLabel = createElement(
                "label",
                "wishlist-field-label",
                "Priority"
            );

            const prioritySelect = createElement(
                "select",
                "wishlist-priority-select"
            );

            ["Low", "Medium", "High"].forEach(priority => {

                const option = createElement(
                    "option",
                    "",
                    priority
                );

                option.value = priority;

                prioritySelect.appendChild(option);
            });

            prioritySelect.value = item.priority;

            priorityLabel.appendChild(prioritySelect);

            // Notes field
            const notesLabel = createElement(
                "label",
                "wishlist-field-label",
                "Personal Notes"
            );

            const notesInput = createElement(
                "textarea",
                "wishlist-notes"
            );

            notesInput.rows = 3;
            notesInput.maxLength = 2000;
            notesInput.placeholder =
                "Add notes about this HDB block...";

            notesInput.value = item.notes || "";

            notesLabel.appendChild(notesInput);

            // Action buttons
            const actions = createElement(
                "div",
                "wishlist-card-actions"
            );

            const viewButton = createElement(
                "a",
                "wishlist-view-btn",
                "View Block"
            );

            viewButton.href =
                `explore.html?block=${encodeURIComponent(item.block_id)}`;

            const saveButton = createElement(
                "button",
                "wishlist-save-btn",
                "Save Changes"
            );

            saveButton.type = "button";

            saveButton.addEventListener("click", async () => {

                saveButton.disabled = true;
                saveButton.textContent = "Saving...";

                try {

                    const response = await fetch(
                        `/api/wishlist/${item.wishlist_id}`,
                        {
                            method: "PUT",
                            credentials: "same-origin",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                priority: prioritySelect.value,
                                notes: notesInput.value
                            })
                        }
                    );

                    await readResponse(response);

                    await loadWishlist();

                    setMessage(
                        wishlistMessage,
                        "Wishlist updated successfully."
                    );

                } catch (error) {

                    setMessage(
                        wishlistMessage,
                        error.message,
                        true
                    );

                } finally {

                    saveButton.disabled = false;
                    saveButton.textContent = "Save Changes";
                }
            });

            const removeButton = createElement(
                "button",
                "wishlist-remove-btn",
                "Remove"
            );

            removeButton.type = "button";

            removeButton.addEventListener("click", async () => {

                const confirmed = window.confirm(
                    `Remove ${formatAddress(item)} from your wishlist?`
                );

                if (!confirmed) return;

                removeButton.disabled = true;

                try {

                    const response = await fetch(
                        `/api/wishlist/${item.wishlist_id}`,
                        {
                            method: "DELETE",
                            credentials: "same-origin"
                        }
                    );

                    await readResponse(response);

                    await loadWishlist();

                    setMessage(
                        wishlistMessage,
                        "HDB block removed from your wishlist."
                    );

                } catch (error) {

                    removeButton.disabled = false;

                    setMessage(
                        wishlistMessage,
                        error.message,
                        true
                    );
                }
            });

            actions.append(
                viewButton,
                saveButton,
                removeButton
            );

            card.append(
                header,
                priorityLabel,
                notesLabel,
                actions
            );

            wishlistItems.appendChild(card);
        });
    }

    // ======================================
    // SEARCH HDB BLOCKS
    // ======================================

    async function searchBlocks(query) {

        searchResults.replaceChildren();

        setMessage(
            searchStatus,
            "Searching for HDB blocks..."
        );

        try {

            const response = await fetch(
                `/api/blocks?search=${encodeURIComponent(query)}`,
                {
                    credentials: "same-origin"
                }
            );

            const data = await readResponse(response);

            // Backend returns:
            // { status: "success", count: 50, data: [...] }

            const blocks = Array.isArray(data.data)
                ? data.data
                : [];

            if (blocks.length === 0) {

                setMessage(
                    searchStatus,
                    "No HDB blocks found. Try another search."
                );

                return;
            }

            setMessage(
                searchStatus,
                `${blocks.length} HDB blocks found.`
            );

            blocks.forEach(block => {

                const result = createElement(
                    "div",
                    "wishlist-search-result"
                );

                const details = createElement(
                    "div",
                    "wishlist-search-result-info"
                );

                const address = createElement(
                    "h3",
                    "",
                    formatAddress(block)
                );

                const subtitle = createElement(
                    "p",
                    "",
                    `${block.town_name || "Singapore"}${
                        block.postal
                            ? ` · Singapore ${block.postal}`
                            : ""
                    }`
                );

                details.append(address, subtitle);

                const saveButton = createElement(
                    "button",
                    "wishlist-add-btn",
                    ""
                );

                saveButton.type = "button";

                if (isBlockSaved(block.block_id)) {

                    saveButton.textContent = "Saved ✓";
                    saveButton.disabled = true;

                } else {

                    saveButton.textContent = "♡ Save";

                    saveButton.addEventListener("click", async () => {

                        saveButton.disabled = true;
                        saveButton.textContent = "Saving...";

                        try {

                            const response = await fetch(
                                "/api/wishlist",
                                {
                                    method: "POST",
                                    credentials: "same-origin",
                                    headers: {
                                        "Content-Type": "application/json"
                                    },
                                    body: JSON.stringify({
                                        block_id: block.block_id,
                                        priority: "Medium",
                                        notes: ""
                                    })
                                }
                            );

                            await readResponse(response);

                            saveButton.textContent = "Saved ✓";

                            await loadWishlist();

                            setMessage(
                                searchStatus,
                                `${formatAddress(block)} added to your wishlist.`
                            );

                        } catch (error) {

                            saveButton.disabled = false;
                            saveButton.textContent = "♡ Save";

                            setMessage(
                                searchStatus,
                                error.message,
                                true
                            );
                        }
                    });
                }

                result.append(details, saveButton);

                searchResults.appendChild(result);
            });

        } catch (error) {

            console.error("HDB block search error:", error);

            setMessage(
                searchStatus,
                error.message || "Unable to search HDB blocks.",
                true
            );
        }
    }

    // ======================================
    // SEARCH FORM EVENT
    // ======================================

    if (searchForm && searchInput) {

        searchForm.addEventListener("submit", async event => {

            event.preventDefault();

            const query = searchInput.value.trim();

            if (!query) {

                setMessage(
                    searchStatus,
                    "Please enter a town, street, block number, or postal code.",
                    true
                );

                return;
            }

            await searchBlocks(query);
        });
    }

    // ======================================
    // INITIALISE WISHLIST
    // ======================================

    loadWishlist();

});