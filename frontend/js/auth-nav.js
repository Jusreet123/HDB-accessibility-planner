
document.addEventListener("DOMContentLoaded", async () => {

    // ==========================================
    // 1. GET NAVIGATION ELEMENTS
    // ==========================================

    const loginButton = document.getElementById("loginNavBtn");
    const userMenu = document.getElementById("userNavMenu");
    const usernameDisplay = document.getElementById("navUsername");
    const logoutButton = document.getElementById("logoutNavBtn");

    const dropdownToggle = document.getElementById(
        "profileDropdownToggle"
    );

    const dropdown = document.getElementById(
        "profileDropdown"
    );

    if (!loginButton || !userMenu) {
        return;
    }

    // Hide both navigation states while checking session
    loginButton.hidden = true;
    userMenu.hidden = true;

    // ==========================================
    // 2. PROFILE DROPDOWN
    // ==========================================

    function closeDropdown() {
        if (!dropdown || !dropdownToggle) return;

        dropdown.hidden = true;
        dropdownToggle.setAttribute(
            "aria-expanded",
            "false"
        );
    }

    function toggleDropdown() {
        if (!dropdown || !dropdownToggle) return;

        const isOpen = !dropdown.hidden;

        dropdown.hidden = isOpen;

        dropdownToggle.setAttribute(
            "aria-expanded",
            String(!isOpen)
        );
    }

    if (dropdownToggle && dropdown) {

        dropdownToggle.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleDropdown();
        });

        // Close when clicking outside the profile menu
        document.addEventListener("click", (event) => {
            if (!userMenu.contains(event.target)) {
                closeDropdown();
            }
        });

        // Close when pressing Escape
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeDropdown();
            }
        });
    }

    // ==========================================
    // 3. LOGOUT
    // ==========================================

    if (logoutButton) {

        logoutButton.addEventListener("click", async () => {

            logoutButton.disabled = true;
            logoutButton.textContent = "Logging out...";

            try {
                const response = await fetch("/auth/logout", {
                    method: "POST",
                    credentials: "same-origin"
                });

                if (!response.ok) {
                    throw new Error("Logout failed");
                }

                window.location.replace("/");

            } catch (error) {
                console.error("Logout failed:", error);

                alert("Unable to log out. Please try again.");

                logoutButton.disabled = false;
                logoutButton.textContent = "Logout";
            }
        });
    }

    // ==========================================
    // 4. CHECK LOGIN SESSION
    // ==========================================

    try {
        const response = await fetch("/auth/me", {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store"
        });

        if (response.status === 401) {
            loginButton.hidden = false;
            userMenu.hidden = true;
            return;
        }

        if (!response.ok) {
            throw new Error("Unable to check session");
        }

        const data = await response.json();

        if (data.user) {

            // Logged-in user
            loginButton.hidden = true;
            userMenu.hidden = false;

            if (usernameDisplay) {
                usernameDisplay.textContent =
                    data.user.username || "My Account";
            }

        } else {

            // Guest visitor
            loginButton.hidden = false;
            userMenu.hidden = true;
        }

    } catch (error) {

        console.error(
            "Authentication session check failed:",
            error
        );

        loginButton.hidden = false;
        userMenu.hidden = true;
    }
});