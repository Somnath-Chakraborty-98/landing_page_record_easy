document.addEventListener("DOMContentLoaded", () => {
    const API_BASE_URL = (() => {
        if (window.RECORDEASY_API_BASE_URL) {
            return window.RECORDEASY_API_BASE_URL.replace(/\/$/, "");
        }

        const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

        if (window.location.protocol === "file:" || (isLocalHost && window.location.port !== "4000")) {
            return "http://localhost:4000";
        }

        return "";
    })();

    function apiUrl(path) {
        return `${API_BASE_URL}${path}`;
    }

    async function parseJsonResponse(res, fallbackErrorMessage) {
        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();
        let data = {};

        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                const responseType = contentType.includes("text/html")
                    ? "HTML"
                    : contentType || "non-JSON";

                throw new Error(
                    `Invalid server response from ${res.url} (${res.status} ${responseType}). Please check the API deployment URL.`
                );
            }
        }

        if (!res.ok) {
            throw new Error(data.error || fallbackErrorMessage);
        }

        return data;
    }

    function getConnectionErrorMessage(context) {
        const localHint = API_BASE_URL.includes("localhost")
            ? " Make sure the backend is running on port 4000."
            : "";

        return `Could not reach the ${context} server. Please try again later.${localHint}`;
    }

    // ====================================================
    // WAITLIST FORM LOGIC
    // ====================================================

    const form = document.getElementById("waitlistForm");
    const emailInput = document.getElementById("emailInput");
    const messageEl = document.getElementById("formMessage");

    function isValidEmail(email) {
        // Practical RFC-lite regex (UX-level validation)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
        return emailRegex.test(email);
    }

    if (form && emailInput && messageEl) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            const email = emailInput.value.trim();

            if (!email) {
                messageEl.textContent = "Email is required.";
                messageEl.style.color = "red";
                return;
            }

            if (!isValidEmail(email)) {
                messageEl.textContent = "Please enter a valid email address.";
                messageEl.style.color = "red";
                return;
            }

            messageEl.textContent = "Sending verification email...";
            messageEl.style.color = "#666";

            try {
                const res = await fetch(apiUrl("/api/waitlist"), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ email })
                });

                const data = await parseJsonResponse(
                    res,
                    "Unable to send verification email. Please try again later."
                );

                messageEl.textContent =
                    data.message || "Check your email to verify your address.";

                messageEl.style.color = "green";
                emailInput.value = "";

            } catch (err) {
                console.error("Waitlist request failed:", err);

                messageEl.textContent =
                    err instanceof TypeError
                        ? getConnectionErrorMessage("waitlist")
                        : err.message || "Unable to send verification email. Please try again later.";
                messageEl.style.color = "red";
            }
        });
    }

    // ====================================================
    // HERO BUTTON BEHAVIOR
    // ====================================================

    // Smooth scroll to waitlist + focus email input
    const joinBtn = document.getElementById("heroJoinWaitlistBtn");
    const waitlistSection = document.getElementById("waitlist");

    if (joinBtn && waitlistSection && emailInput) {
        joinBtn.addEventListener("click", (e) => {
            e.preventDefault();

            waitlistSection.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

            // Focus input after scroll settles
            setTimeout(() => {
                emailInput.focus();
            }, 500);
        });
    }

    // Chrome Extension – Coming soon message
    const chromeBtn = document.getElementById("chromeExtensionBtn");
    const heroMessage = document.getElementById("heroMessage");

    if (chromeBtn && heroMessage) {
        chromeBtn.addEventListener("click", (e) => {
            e.preventDefault();

            heroMessage.textContent =
                "Chrome extension is coming soon. Join the waitlist to get early access.";
            heroMessage.style.color = "#666";

            setTimeout(() => {
                heroMessage.textContent = "";
            }, 4000);
        });
    }

    // ====================================================
    // RAZORPAY DONATION CHECKOUT
    // ====================================================

    const donateBtn = document.getElementById("donateBtn");
    const donationMessage = document.getElementById("donationMessage");
    let selectedDonationAmount = 99;

    function setDonationMessage(message, color = "#666") {
        if (!donationMessage) return;

        donationMessage.textContent = message;
        donationMessage.style.color = color;
    }

    async function verifyDonationPayment(response) {
        const res = await fetch(apiUrl("/api/donations/verify"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(response)
        });

        return parseJsonResponse(res, "Payment verification failed.");
    }

    if (donateBtn) {
        donateBtn.addEventListener("click", async () => {
            if (!window.Razorpay) {
                setDonationMessage("Razorpay checkout could not load. Please try again.", "red");
                return;
            }

            donateBtn.disabled = true;
            setDonationMessage("Opening Razorpay checkout...");

            try {
                const res = await fetch(apiUrl("/api/donations/order"), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ amount: selectedDonationAmount })
                });

                const order = await parseJsonResponse(res, "Unable to create payment order.");

                const checkout = new window.Razorpay({
                    key: order.keyId,
                    amount: order.amount,
                    currency: order.currency,
                    name: order.name,
                    description: order.description,
                    order_id: order.orderId,
                    handler: async (response) => {
                        try {
                            const result = await verifyDonationPayment(response);
                            setDonationMessage(result.message || "Thank you for supporting RecordEasy.", "green");
                        } catch (err) {
                            console.error("Donation verification failed:", err);
                            setDonationMessage(err.message || "Payment verification failed.", "red");
                        }
                    },
                    theme: {
                        color: "#4f46e5"
                    },
                    modal: {
                        ondismiss: () => {
                            setDonationMessage("Payment cancelled.");
                        }
                    }
                });

                checkout.open();
            } catch (err) {
                console.error("Donation checkout failed:", err);
                setDonationMessage(
                    err instanceof TypeError
                        ? getConnectionErrorMessage("payment")
                        : err.message || "Unable to open Razorpay checkout.",
                    "red"
                );
            } finally {
                donateBtn.disabled = false;
            }
        });
    }
});
