document.addEventListener("DOMContentLoaded", () => {
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
                const res = await fetch("http://localhost:4000/api/waitlist", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ email })
                });

                let data = {};
                const text = await res.text();

                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch {
                        throw new Error("Invalid server response");
                    }
                }

                if (!res.ok)
                    throw new Error(data.error || "Request failed");

                messageEl.textContent =
                    data.message || "Check your email to verify your address.";

                messageEl.style.color = "green";
                emailInput.value = "";

            } catch (err) {
                console.error("Waitlist request failed:", err);

                messageEl.textContent =
                    err.message || "Unable to send verification email. Please try again later.";
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
});
