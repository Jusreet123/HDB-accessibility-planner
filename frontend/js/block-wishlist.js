
document.addEventListener("DOMContentLoaded", async () => {
    // ==========================================
    // HAVEN - BLOCK WISHLIST FUNCTIONALITY
    // ==========================================

    const wishlistButton = document.getElementById(
        "blockWishlistButton"
    );

    const wishlistStatus = document.getElementById(
        "blockWishlistStatus"
    );

    const urlParams = new URLSearchParams(
        window.location.search
    );

    const blockId = Number(urlParams.get("id"));

    let isLoggedIn = false;
    let wishlistId = null;
    let isProcessing = false;
    let isReady = false;

    // ==========================================
    // 1. VALIDATE BLOCK
    // ==========================================

    if (
        !wishlistButton ||
        !Number.isSafeInteger(blockId) ||
        blockId <= 0
    ) {
        return;
    }

    // ==========================================
    // 2. STATUS MESSAGE
    // ==========================================

    function setStatus(message) {
        if (wishlistStatus) {
            wishlistStatus.textContent = message;
        }
    }

    // ==========================================
    // 3. UPDATE HEART BUTTON
    // ==========================================

    function updateHeartButton() {
        const isSaved = wishlistId !== null;

        wishlistButton.textContent = isSaved
            ? "♥"
            : "♡";

        wishlistButton.classList.toggle(
            "is-saved",
            isSaved
        );

        wishlistButton.setAttribute(
            "aria-pressed",
            String(isSaved)
        );

        wishlistButton.setAttribute(
            "aria-label",
            isSaved
                ? "Remove from wishlist"
                : "Save to wishlist"
        );

        wishlistButton.title = isSaved
            ? "Remove from My Wishlist"
            : "Save to My Wishlist";

        wishlistButton.disabled =
            isProcessing || !isReady;
    }

    // ==========================================
    // 4. LOAD EXISTING WISHLIST
    // ==========================================

    async function loadWishlist() {
        isProcessing = true;
        updateHeartButton();

        try {
            const response = await fetch(
                "/api/wishlist",
                {
                    credentials: "same-origin"
                }
            );

            // Guest user
            if (response.status === 401) {
                isLoggedIn = false;
                wishlistId = null;
                setStatus("");

                return;
            }

            if (!response.ok) {
                throw new Error(
                    "Unable to load wishlist."
                );
            }

            const result = await response.json();

            isLoggedIn = true;

            const wishlist = Array.isArray(
                result.wishlist
            )
                ? result.wishlist
                : [];

            const savedBlock = wishlist.find(
                item =>
                    Number(item.block_id) === blockId
            );

            wishlistId = savedBlock
                ? Number(savedBlock.wishlist_id)
                : null;

            setStatus("");

        } catch (error) {
            console.error(
                "Wishlist loading error:",
                error
            );

            isReady = false;

            setStatus(
                "Unable to check your wishlist. Please refresh the page."
            );

        } finally {
            isProcessing = false;
            updateHeartButton();
        }
    }

    // ==========================================
    // 5. SAVE BLOCK TO WISHLIST
    // ==========================================

    async function saveBlock() {
        const response = await fetch(
            "/api/wishlist",
            {
                method: "POST",

                credentials: "same-origin",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    block_id: blockId,
                    priority: "Medium",
                    notes: ""
                })
            }
        );

        if (response.status === 401) {
            isLoggedIn = false;

            throw new Error(
                "LOGIN_REQUIRED"
            );
        }

        if (response.status === 409) {
            await loadWishlist();

            setStatus(
                "This block is already in your wishlist."
            );

            return;
        }

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.message ||
                "Unable to save block."
            );
        }

        wishlistId = Number(
            result.wishlist_id
        );

        setStatus(
            "Block added to My Wishlist."
        );
    }

    // ==========================================
    // 6. REMOVE BLOCK FROM WISHLIST
    // ==========================================

    async function removeBlock() {
        if (wishlistId === null) {
            return;
        }

        const response = await fetch(
            `/api/wishlist/${encodeURIComponent(wishlistId)}`,
            {
                method: "DELETE",
                credentials: "same-origin"
            }
        );

        if (response.status === 401) {
            isLoggedIn = false;

            throw new Error(
                "LOGIN_REQUIRED"
            );
        }

        if (!response.ok) {
            let message =
                "Unable to remove block.";

            try {
                const result = await response.json();

                message = result.message || message;
            } catch {
                // Keep default error message.
            }

            throw new Error(message);
        }

        wishlistId = null;

        setStatus(
            "Block removed from My Wishlist."
        );
    }

    // ==========================================
    // 7. HANDLE HEART BUTTON CLICK
    // ==========================================

    async function toggleWishlist() {
        if (isProcessing || !isReady) {
            return;
        }

        // Redirect guests to login
        if (!isLoggedIn) {
            const returnPage =
                `block.html?id=${encodeURIComponent(blockId)}`;

            window.location.href =
                `login.html?redirect=${encodeURIComponent(returnPage)}`;

            return;
        }

        isProcessing = true;

        updateHeartButton();

        setStatus("");

        try {
            if (wishlistId !== null) {
                await removeBlock();
            } else {
                await saveBlock();
            }

        } catch (error) {
            console.error(
                "Wishlist operation failed:",
                error
            );

            if (error.message === "LOGIN_REQUIRED") {
                const returnPage =
                    `block.html?id=${encodeURIComponent(blockId)}`;

                window.location.href =
                    `login.html?redirect=${encodeURIComponent(returnPage)}`;

                return;
            }

            setStatus(
                error.message ||
                "Something went wrong. Please try again."
            );

        } finally {
            isProcessing = false;
            updateHeartButton();
        }
    }

    // ==========================================
    // 8. INITIALISE WISHLIST
    // ==========================================

    wishlistButton.hidden = false;

    wishlistButton.addEventListener(
        "click",
        toggleWishlist
    );

    // Verify the block exists before enabling the heart.
    try {
        const response = await fetch(
            `/api/blocks/${encodeURIComponent(blockId)}`,
            {
                credentials: "same-origin"
            }
        );

        if (!response.ok) {
            throw new Error(
                "Unable to verify block."
            );
        }

        const result = await response.json();

        if (!result.block) {
            throw new Error(
                "Block not found."
            );
        }

        isReady = true;

        await loadWishlist();

    } catch (error) {
        console.error(
            "Wishlist initialisation failed:",
            error
        );

        isReady = false;

        setStatus(
            "Wishlist is currently unavailable."
        );
    }

    updateHeartButton();
});