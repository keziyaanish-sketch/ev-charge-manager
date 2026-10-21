
const API_URL = "https://ev-charge-manager-l6tj.onrender.com";

let selectedVehicle = null;
let toastTimer;
let isSavingSession = false;

const $ = id => document.getElementById(id);

// ========================================
// GENERAL HELPERS
// ========================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function money(value) {
    return Number(value || 0).toLocaleString("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2
    });
}

// Display only the date, without time.
function formatRecordDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

// ========================================
// MESSAGES AND API REQUESTS
// ========================================

function showMessage(id, message, type = "") {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.className = `message ${type}`;
}

function showToast(message) {
    const toast = $("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3200);
}

async function apiRequest(path, options = {}) {
    let response;

    try {
        response = await fetch(`${API_URL}${path}`, {
            ...options,
            headers: {
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...options.headers
            }
        });
    } catch {
        throw new Error(
            "Cannot reach the backend. Make sure your Node.js server is running at http://127.0.0.1:3000."
        );
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error ||
            data.message ||
            `Request failed (${response.status}).`
        );
    }

    return data;
}

// ========================================
// DASHBOARD
// ========================================

async function loadDashboard() {
    try {
        const data = await apiRequest("/dashboard");

        $("today-sessions").textContent =
            data.todaySessions ??
            data.sessionsToday ??
            data.sessions_today ??
            data.total_sessions ??
            0;

        $("today-revenue").textContent = money(
            data.todayRevenue ??
            data.revenueToday ??
            data.revenue_today ??
            data.total_revenue ??
            0
        );

        const points = data.chargingPoints || data.points || {};

        if (Array.isArray(points)) {
            renderChargingPoints(points);
        }

        $("available-points").textContent =
            data.availablePoints ??
            data.available_points ??
            (Array.isArray(points)
                ? points.filter(point =>
                    String(point.status || "available").toLowerCase()
                    === "available"
                ).length
                : points.available ?? 0);

        $("total-points").textContent =
            data.totalPoints ??
            data.total_points ??
            (Array.isArray(points)
                ? points.length
                : Number(points.available || 0) +
                  Number(points.charging || 0) +
                  Number(points.maintenance || 0));

    } catch (error) {
        $("today-sessions").textContent = "—";
        $("today-revenue").textContent = "—";

        console.error("Dashboard:", error.message);
    }
}

// ========================================
// CHARGING POINTS
// ========================================

async function loadChargingPoints() {
    try {
        const data = await apiRequest("/charging-points");

        renderChargingPoints(
            Array.isArray(data)
                ? data
                : data.chargingPoints || data.points || []
        );

    } catch (error) {
        $("points-grid").innerHTML =
            `<p class="message error">${escapeHTML(error.message)}</p>`;
    }
}

function renderChargingPoints(points) {
    const grid = $("points-grid");

    if (!grid || !Array.isArray(points)) return;

    if (points.length === 0) {
        grid.textContent =
            "No charging points have been registered yet.";

        $("available-points").textContent = "0";
        $("total-points").textContent = "0";

        return;
    }

    grid.innerHTML = points.map(point => {
        const status = String(
            point.status || "available"
        ).toLowerCase();

        const name =
            point.point_name ||
            point.pointName ||
            point.name ||
            `Point ${point.id}`;

        return `
            <div class="point-card">
                <h3>${escapeHTML(name)}</h3>
                <span class="point-status ${escapeHTML(status)}">
                    ${escapeHTML(status)}
                </span>
            </div>
        `;
    }).join("");

    $("available-points").textContent = points.filter(point =>
        String(point.status || "available").toLowerCase()
        === "available"
    ).length;

    $("total-points").textContent = points.length;
}

// ========================================
// VEHICLE LOOKUP
// ========================================

async function lookupVehicle(registration) {
    const reg = registration.trim().toUpperCase();

    if (!reg) {
        showToast("Enter a vehicle registration number.");
        return;
    }

    $("lookup-result").className = "result-box";
    $("lookup-result").textContent = "Searching...";

    $("history-btn").classList.add("hidden");
    $("history-result").innerHTML = "";

    try {
        const data = await apiRequest(
            `/vehicles/${encodeURIComponent(reg)}`
        );

        const vehicle = data.vehicle || data;
        const customer = vehicle.customer || data.customer || {};

        const regNumber =
            vehicle.registration_number ||
            vehicle.registrationNumber;

        if (!vehicle.id || !regNumber) {
            throw new Error(
                "Unexpected vehicle record returned by API."
            );
        }

        selectedVehicle = {
            id: vehicle.id,
            registrationNumber: regNumber,
            name:
                vehicle.name ||
                customer.name ||
                vehicle.customer_name ||
                "",
            phone:
                vehicle.phone ||
                customer.phone ||
                vehicle.customer_phone ||
                "",
            make: vehicle.make || "",
            model: vehicle.model || ""
        };

        $("lookup-result").className = "result-box found";

        $("lookup-result").innerHTML = `
            <strong>✓ Vehicle found</strong>
            <p>Registration:
                <strong>${escapeHTML(regNumber)}</strong>
            </p>
            <p>Customer:
                ${escapeHTML(selectedVehicle.name || "Not available")}
            </p>
            <p>Phone:
                ${escapeHTML(selectedVehicle.phone || "Not available")}
            </p>
            <p>Vehicle:
                ${escapeHTML(
                    [
                        selectedVehicle.make,
                        selectedVehicle.model
                    ].filter(Boolean).join(" ") || "Not available"
                )}
            </p>
        `;

        $("session-registration").value = regNumber;

        $("selected-vehicle").textContent =
            `Selected vehicle: ${regNumber} · ${
                selectedVehicle.name || "Customer details loaded"
            }`;

        $("history-btn").classList.remove("hidden");

        showToast("Vehicle details loaded.");

    } catch (error) {
        selectedVehicle = null;

        $("selected-vehicle").textContent =
            "No vehicle selected. Search for a saved vehicle or register a new one.";

        $("lookup-result").className = "result-box not-found";

        $("lookup-result").textContent =
            /not found|404/i.test(error.message)
                ? "Vehicle not found. Register it first, then search again."
                : error.message;
    }
}

$("lookup-form").addEventListener("submit", async event => {
    event.preventDefault();

    await lookupVehicle($("lookup-registration").value);
});

// ========================================
// REGISTER VEHICLE
// ========================================

$("vehicle-form").addEventListener("submit", async event => {
    event.preventDefault();

    const payload = {
        name: $("customer-name").value.trim(),
        phone: $("customer-phone").value.trim(),
        registrationNumber:
            $("vehicle-registration").value.trim().toUpperCase(),
        make: $("vehicle-make").value.trim(),
        model: $("vehicle-model").value.trim()
    };

    if (
        !payload.name ||
        !payload.phone ||
        !payload.registrationNumber
    ) {
        showMessage(
            "vehicle-message",
            "Complete all required fields.",
            "error"
        );

        return;
    }

    const button = $("vehicle-form").querySelector(
        'button[type="submit"]'
    );

    button.disabled = true;
    button.textContent = "Registering...";

    try {
        await apiRequest("/vehicles", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        showMessage(
            "vehicle-message",
            "Vehicle registered successfully!",
            "success"
        );

        $("lookup-registration").value =
            payload.registrationNumber;

        $("session-registration").value =
            payload.registrationNumber;

        $("vehicle-form").reset();

        await lookupVehicle(payload.registrationNumber);
        await loadDatabaseRecords();

        showToast("New vehicle registered.");

    } catch (error) {
        showMessage("vehicle-message", error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = "+ Register vehicle";
    }
});

// ========================================
// SAVE CHARGING SESSION
// ========================================

$("session-form").addEventListener("submit", async event => {
    event.preventDefault();

    // Prevent accidental duplicate submissions while saving.
    if (isSavingSession) return;

    const registration = $("session-registration")
        .value.trim().toUpperCase();

    const percentageInput = $("starting-percentage").value;
    const amountInput = $("final-amount").value;

    const startingPercentage = Number(percentageInput);
    const finalAmount = Number(amountInput);

    if (!registration) {
        showMessage(
            "session-message",
            "Enter the vehicle registration number.",
            "error"
        );

        return;
    }

    if (
        percentageInput === "" ||
        !Number.isInteger(startingPercentage) ||
        startingPercentage < 0 ||
        startingPercentage > 100
    ) {
        showMessage(
            "session-message",
            "Starting percentage must be a whole number from 0 to 100.",
            "error"
        );

        return;
    }

    if (
        amountInput === "" ||
        !Number.isFinite(finalAmount) ||
        finalAmount < 0
    ) {
        showMessage(
            "session-message",
            "Enter a valid final amount of ₹0 or more.",
            "error"
        );

        return;
    }

    const button = $("session-form").querySelector(
        'button[type="submit"]'
    );

    isSavingSession = true;
    button.disabled = true;
    button.textContent = "Saving session...";

    try {
        let vehicle = selectedVehicle;

        if (
            !vehicle ||
            vehicle.registrationNumber.toUpperCase() !== registration
        ) {
            const data = await apiRequest(
                `/vehicles/${encodeURIComponent(registration)}`
            );

            const record = data.vehicle || data;

            vehicle = {
                id: record.id,
                registrationNumber:
                    record.registration_number ||
                    record.registrationNumber ||
                    registration
            };
        }

        if (!vehicle?.id) {
            throw new Error(
                "Vehicle not found. Register it first."
            );
        }

        const payload = {
            vehicleId: vehicle.id,
            registrationNumber: registration,
            startingPercentage,
            finalAmount
        };

        const result = await apiRequest("/sessions", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        const savedAmount =
            result.session?.amount ??
            result.amount ??
            finalAmount;

        showMessage(
            "session-message",
            `Charging session saved successfully! Final amount: ${money(savedAmount)}.`,
            "success"
        );

        $("session-form").reset();

        selectedVehicle = null;

        $("selected-vehicle").textContent =
            "No vehicle selected. Search for a vehicle or enter its registration number.";

        await Promise.all([
            loadDashboard(),
            loadDatabaseRecords()
        ]);

        showToast("Charging session recorded.");

    } catch (error) {
        showMessage("session-message", error.message, "error");
    } finally {
        isSavingSession = false;
        button.disabled = false;
        button.textContent = "✓ Save charging session";
    }
});

// ========================================
// VEHICLE CHARGING HISTORY
// ========================================

$("history-btn").addEventListener("click", async () => {
    if (!selectedVehicle) {
        showToast("Search for a vehicle first.");
        return;
    }

    const result = $("history-result");
    result.textContent = "Loading charging history...";

    try {
        const data = await apiRequest(
            `/vehicles/${encodeURIComponent(
                selectedVehicle.registrationNumber
            )}/sessions`
        );

        const sessions = Array.isArray(data)
            ? data
            : data.sessions || data.history || [];

        if (sessions.length === 0) {
            result.textContent =
                "No charging history found for this vehicle.";

            return;
        }

        result.innerHTML = sessions.map(session => {
            const date =
                session.started_at ||
                session.startedAt ||
                session.created_at;

            const startingPercentage =
                session.starting_percentage ??
                session.startingPercentage;

            return `
                <div class="history-item">
                    <strong>${escapeHTML(formatRecordDate(date))}</strong>
                    <br>
                    Starting charge:
                    ${
                        startingPercentage == null
                            ? "—"
                            : escapeHTML(startingPercentage) + "%"
                    }
                    <br>
                    Final amount:
                    ${escapeHTML(money(session.amount ?? 0))}
                    <br>
                    Payment status:
                    ${escapeHTML(
                        session.payment_status ||
                        session.paymentStatus ||
                        "Pending"
                    )}
                </div>
            `;
        }).join("");

    } catch (error) {
        result.textContent = error.message;
    }
});

// ========================================
// DATABASE RECORDS
// ========================================

function renderTableRows(elementId, rows, columns, emptyMessage) {
    const body = $(elementId);

    if (!Array.isArray(rows) || rows.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="${columns.length}">
                    ${escapeHTML(emptyMessage)}
                </td>
            </tr>
        `;

        return;
    }

    body.innerHTML = rows.map(row => `
        <tr>
            ${columns.map(column => {
                const value = column.format
                    ? column.format(row[column.key], row)
                    : row[column.key];

                return `<td>${escapeHTML(value ?? "—")}</td>`;
            }).join("")}
        </tr>
    `).join("");
}

async function loadDatabaseRecords() {
    const message = $("records-message");
    const search = $("records-search").value.trim();
    const paymentStatus = $("records-payment-filter").value;

    message.textContent = "Loading records...";
    message.className = "message";

    $("records-refresh").disabled = true;
    $("records-search-btn").disabled = true;

    try {
        const params = new URLSearchParams();

        if (search) {
            params.set("search", search);
        }

        if (paymentStatus) {
            params.set("paymentStatus", paymentStatus);
        }

        const query = params.toString();

        const data = await apiRequest(
            `/records${query ? `?${query}` : ""}`
        );

        const summary = data.summary || {};

        $("records-customers").textContent =
            summary.totalCustomers ?? data.customers?.length ?? 0;

        $("records-vehicles").textContent =
            summary.totalVehicles ?? data.vehicles?.length ?? 0;

        $("records-sessions").textContent =
            summary.totalSessions ?? data.sessions?.length ?? 0;

        $("records-points").textContent =
            summary.totalChargingPoints ??
            data.chargingPoints?.length ??
            0;

        $("records-units").textContent =
            `${Number(summary.totalUnitsKwh || 0).toLocaleString(
                "en-IN",
                { maximumFractionDigits: 3 }
            )} kWh`;

        $("records-revenue").textContent =
            money(summary.totalRevenue);

        $("records-pending").textContent =
            money(summary.pendingAmount);

        renderTableRows("records-customers-body", data.customers, [
            { key: "id" },
            { key: "name" },
            { key: "phone" },
            { key: "created_at", format: formatRecordDate }
        ], "No customers found.");

        renderTableRows("records-vehicles-body", data.vehicles, [
            { key: "id" },
            { key: "registration_number" },
            {
                key: "make",
                format: (_, row) =>
                    [row.make, row.model].filter(Boolean).join(" ") || "—"
            },
            { key: "customer_name" },
            { key: "customer_phone" }
        ], "No vehicles found.");

        renderTableRows("records-points-body", data.chargingPoints, [
            { key: "id" },
            { key: "point_name" },
            {
                key: "status",
                format: value => value ? value.toUpperCase() : "—"
            }
        ], "No charging points found.");

        // Seven columns: date only, not date and time.
        renderTableRows("records-sessions-body", data.sessions, [
            { key: "id" },
            { key: "started_at", format: formatRecordDate },
            { key: "customer_name" },
            { key: "registration_number" },
            {
                key: "starting_percentage",
                format: value =>
                    value == null ? "—" : `${value}%`
            },
            { key: "amount", format: money },
            {
                key: "payment_status",
                format: value => value ? value.toUpperCase() : "—"
            }
        ], "No charging sessions found.");

        message.textContent = search || paymentStatus
            ? "Matching records loaded."
            : "Database records loaded successfully.";

        message.className = "message success";

    } catch (error) {
        message.textContent = error.message;
        message.className = "message error";

        [
            ["records-customers-body", 4],
            ["records-vehicles-body", 5],
            ["records-points-body", 3],
            ["records-sessions-body", 7]
        ].forEach(([id, span]) => {
            $(id).innerHTML = `
                <tr>
                    <td colspan="${span}">Could not load records.</td>
                </tr>
            `;
        });

    } finally {
        $("records-refresh").disabled = false;
        $("records-search-btn").disabled = false;
    }
}

// ========================================
// SEARCH AND FILTER RECORDS
// ========================================

$("records-refresh").addEventListener(
    "click",
    loadDatabaseRecords
);

$("records-search-btn").addEventListener(
    "click",
    loadDatabaseRecords
);

$("records-payment-filter").addEventListener(
    "change",
    loadDatabaseRecords
);

$("records-search").addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        loadDatabaseRecords();
    }
});

$("records-clear-btn").addEventListener("click", () => {
    $("records-search").value = "";
    $("records-payment-filter").value = "";
    loadDatabaseRecords();
});

// ========================================
// NAVIGATION
// ========================================

document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
        document.querySelectorAll(".nav-link").forEach(item => {
            item.classList.remove("active");
        });

        link.classList.add("active");
    });
});

// ========================================
// INITIAL SETUP
// ========================================

$("today-date").textContent = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
});

$("refresh-btn").addEventListener("click", async () => {
    await Promise.all([
        loadDashboard(),
        loadChargingPoints()
    ]);

    showToast("Dashboard refreshed.");
});

async function initializeApp() {
    await Promise.all([
        loadDashboard(),
        loadChargingPoints(),
        loadDatabaseRecords()
    ]);
}

initializeApp();
