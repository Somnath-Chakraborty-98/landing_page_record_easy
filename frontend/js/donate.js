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

    const DEFAULT_MIN = 99;
    const DEFAULT_MAX = 100000;

    let minInr = DEFAULT_MIN;
    let maxInr = DEFAULT_MAX;

    const slider = document.getElementById("amountSlider");
    const amountDisplay = document.getElementById("amountDisplay");
    const payBtnAmount = document.getElementById("payBtnAmount");
    const payBtn = document.getElementById("payBtn");
    const donateMessage = document.getElementById("donateMessage");
    const minLabel = document.getElementById("minLabel");
    const maxLabel = document.getElementById("maxLabel");

    function apiUrl(path) {
        return `${API_BASE_URL}${path}`;
    }

    async function parseJsonResponse(res, fallbackErrorMessage) {
        const text = await res.text();
        let data = {};

        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error(
                    `Invalid server response (${res.status}). Please check the API deployment.`
                );
            }
        }

        if (!res.ok) {
            throw new Error(data.error || fallbackErrorMessage);
        }

        return data;
    }

    function formatInr(amount) {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0
        }).format(amount);
    }

    function setMessage(message, type = "") {
        if (!donateMessage) return;
        donateMessage.textContent = message;
        donateMessage.className = `donate-message${type ? ` ${type}` : ""}`;
    }

    function updateSliderFill() {
        if (!slider) return;
        const min = Number(slider.min);
        const max = Number(slider.max);
        const val = Number(slider.value);
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        slider.style.setProperty("--slider-pct", `${pct}%`);
        slider.setAttribute("aria-valuenow", String(val));
    }

    function updateAmountUi(amount) {
        const formatted = formatInr(amount);
        if (amountDisplay) amountDisplay.textContent = formatted;
        if (payBtnAmount) payBtnAmount.textContent = formatted;
        updateSliderFill();
    }

    function getSelectedAmount() {
        const amount = Number(slider?.value);

        if (!Number.isFinite(amount)) {
            throw new Error("Please select a valid amount.");
        }

        if (amount < minInr || amount > maxInr) {
            throw new Error(
                `Amount must be between ${formatInr(minInr)} and ${formatInr(maxInr)}.`
            );
        }

        return Math.round(amount);
    }

    async function loadDonationLimits() {
        try {
            const res = await fetch(apiUrl("/api/donation-limits"));
            const data = await parseJsonResponse(res, "Unable to load donation limits.");
            minInr = Number(data.min) || DEFAULT_MIN;
            maxInr = Number(data.max) || DEFAULT_MAX;
        } catch (err) {
            console.warn("Using default donation limits:", err);
        }

        if (slider) {
            slider.min = String(minInr);
            slider.max = String(maxInr);
            slider.value = String(Math.max(minInr, Math.min(maxInr, Number(slider.value) || minInr)));
        }

        if (minLabel) minLabel.textContent = formatInr(minInr);
        if (maxLabel) maxLabel.textContent = formatInr(maxInr);
        updateAmountUi(Number(slider?.value || minInr));
    }

    async function verifyPayment(response) {
        const res = await fetch(apiUrl("/api/verify-payment"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response)
        });

        return parseJsonResponse(res, "Payment verification failed.");
    }

    if (slider) {
        slider.addEventListener("input", () => {
            updateAmountUi(Number(slider.value));
            setMessage("");
        });
    }

    if (payBtn) {
        payBtn.addEventListener("click", async () => {
            if (!window.Razorpay) {
                setMessage("Razorpay checkout could not load. Please refresh and try again.", "error");
                return;
            }

            payBtn.disabled = true;
            setMessage("Creating secure payment...");

            try {
                const amountInRupees = getSelectedAmount();

                const res = await fetch(apiUrl("/api/create-order"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ amount: amountInRupees * 100 })
                });

                const order = await parseJsonResponse(res, "Unable to create payment order.");
                setMessage("");

                const checkout = new window.Razorpay({
                    key: order.key_id,
                    amount: order.amount,
                    currency: order.currency,
                    name: "RecordEasy",
                    description: "Support RecordEasy development",
                    order_id: order.order_id,
                    handler: async (response) => {
                        try {
                            const result = await verifyPayment(response);
                            setMessage(result.message || "Thank you for your support!", "success");
                        } catch (err) {
                            setMessage(err.message || "Payment verification failed.", "error");
                        }
                    },
                    theme: { color: "#528ff0" },
                    modal: {
                        ondismiss: () => setMessage("Payment cancelled.")
                    }
                });

                checkout.on("payment.failed", (response) => {
                    const message =
                        response?.error?.description || "Payment failed. Please try again.";
                    setMessage(message, "error");
                });

                checkout.open();
            } catch (err) {
                setMessage(err.message || "Unable to start checkout.", "error");
            } finally {
                payBtn.disabled = false;
            }
        });
    }

    loadDonationLimits();
});
