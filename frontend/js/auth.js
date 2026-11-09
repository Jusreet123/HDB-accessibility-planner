document.addEventListener("DOMContentLoaded", async () => {

    // ==========================================
    // 1. GET PAGE ELEMENTS
    // ==========================================

    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");

    const authTitle = document.getElementById("authTitle");
    const authDescription = document.getElementById("authDescription");
    const authMessage = document.getElementById("authMessage");

    const authSwitchText = document.getElementById("authSwitchText");
    const authSwitchBtn = document.getElementById("authSwitchBtn");

    let currentMode = "login";

    // ==========================================
    // 2. DISPLAY MESSAGES
    // ==========================================

    function showMessage(message, type = "error") {
        authMessage.textContent = message;
        authMessage.className = `auth-message ${type}`;
        authMessage.hidden = false;
    }

    function clearMessage() {
        authMessage.textContent = "";
        authMessage.hidden = true;
    }

    // ==========================================
    // 3. SWITCH LOGIN / REGISTER
    // ==========================================

    function switchMode(mode) {
        currentMode = mode;
        clearMessage();

        const isLogin = mode === "login";

        loginForm.hidden = !isLogin;
        registerForm.hidden = isLogin;

        authTitle.textContent = isLogin
            ? "Welcome back."
            : "Create your account.";

        authDescription.textContent = isLogin
            ? "Sign in to save your favourite HDB homes."
            : "Join Haven. and start building your HDB wishlist.";

        authSwitchText.textContent = isLogin
            ? "Don't have an account?"
            : "Already have an account?";

        authSwitchBtn.textContent = isLogin
            ? "Create an account"
            : "Sign in instead";
    }

    authSwitchBtn.addEventListener("click", () => {
        switchMode(
            currentMode === "login" ? "register" : "login"
        );
    });

    // ==========================================
    // 4. AUTHENTICATION REQUEST HELPER
    // ==========================================

    async function sendAuthRequest(url, payload) {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || data.message || "Authentication failed."
            );
        }

        return data;
    }

    // ==========================================
    // 5. MANUAL LOGIN
    // ==========================================

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearMessage();

        const submitButton = loginForm.querySelector(
            'button[type="submit"]'
        );

        const email = document.getElementById("loginEmail")
            .value.trim();

        const password = document.getElementById("loginPassword")
            .value;

        submitButton.disabled = true;
        submitButton.textContent = "Signing in...";

        try {
            await sendAuthRequest("/auth/login", {
                email,
                password
            });

            window.location.replace("/");

        } catch (error) {
            showMessage(error.message);

        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Sign In";
        }
    });

    // ==========================================
    // 6. MANUAL REGISTRATION
    // ==========================================

    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearMessage();

        const submitButton = registerForm.querySelector(
            'button[type="submit"]'
        );

        const username = document.getElementById(
            "registerUsername"
        ).value.trim();

        const email = document.getElementById(
            "registerEmail"
        ).value.trim();

        const password = document.getElementById(
            "registerPassword"
        ).value;

        if (password.length < 8) {
            showMessage(
                "Password must contain at least 8 characters."
            );
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Creating account...";

        try {
            await sendAuthRequest("/auth/register", {
                username,
                email,
                password
            });

            registerForm.reset();
            switchMode("login");

            showMessage(
                "Account created successfully! Please sign in.",
                "success"
            );

        } catch (error) {
            showMessage(error.message);

        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Create Account";
        }
    });

    // ==========================================
    // 7. CHECK EXISTING SESSION
    // ==========================================

    try {
        const response = await fetch("/auth/me", {
            credentials: "same-origin",
            cache: "no-store"
        });

        if (response.ok) {
            const data = await response.json();

            if (data.user) {
                window.location.replace("/");
                return;
            }
        }

    } catch (error) {
        console.error(
            "Unable to check existing session:",
            error
        );
    }

    // ==========================================
    // 8. INITIALISE PAGE
    // ==========================================

    const params = new URLSearchParams(
        window.location.search
    );

    // Display the login form by default
    switchMode("login");

    // Show an error if Google authentication failed
    if (params.get("login") === "failed") {
        showMessage(
            "Google sign-in failed. Please try again."
        );
    }
});