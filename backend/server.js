
const express = require("express");
const cors = require("cors");
const { pool } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: [
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ]
}));

app.use(express.json());

// =========================================
// DATABASE HEALTH CHECK
// =========================================

app.get("/api", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT current_database() AS database_name,
                   current_schema() AS schema_name
        `);

        res.json({
            message: "EV Charge Manager API is running!",
            database: "Connected",
            databaseName: result.rows[0].database_name,
            schema: result.rows[0].schema_name
        });
    } catch (error) {
        console.error("Database connection error:", error.message);
        res.status(500).json({
            message: "Database connection failed."
        });
    }
});

// =========================================
// CHARGING POINTS
// =========================================

app.get("/api/charging-points", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, point_name, status
            FROM public.charging_points
            ORDER BY id
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Charging points error:", error.message);
        res.status(500).json({
            message: "Could not load charging points."
        });
    }
});

// =========================================
// FIND VEHICLE
// =========================================

app.get("/api/vehicles/:registration", async (req, res) => {
    try {
        const registration = req.params.registration.trim().toUpperCase();

        const result = await pool.query(`
            SELECT
                v.id,
                v.registration_number,
                v.make,
                v.model,
                c.id AS customer_id,
                c.name,
                c.phone
            FROM public.vehicles v
            JOIN public.customers c ON c.id = v.customer_id
            WHERE UPPER(v.registration_number) = $1
        `, [registration]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                message: "Vehicle not found. Please register it first."
            });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Vehicle search error:", error.message);
        res.status(500).json({
            message: "Vehicle search failed."
        });
    }
});

// =========================================
// REGISTER CUSTOMER AND VEHICLE
// =========================================

app.post("/api/vehicles", async (req, res) => {
    const { name, phone, registrationNumber, make, model } = req.body;

    if (
        typeof name !== "string" || !name.trim() ||
        typeof phone !== "string" || !phone.trim() ||
        typeof registrationNumber !== "string" ||
        !registrationNumber.trim()
    ) {
        return res.status(400).json({
            message: "Customer name, phone and registration number are required."
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        const customer = await client.query(`
            INSERT INTO public.customers (name, phone)
            VALUES ($1, $2)
            RETURNING id, name, phone
        `, [name.trim(), phone.trim()]);

        const vehicle = await client.query(`
            INSERT INTO public.vehicles
                (customer_id, registration_number, make, model)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [
            customer.rows[0].id,
            registrationNumber.trim().toUpperCase(),
            typeof make === "string" && make.trim() ? make.trim() : null,
            typeof model === "string" && model.trim() ? model.trim() : null
        ]);

        await client.query("COMMIT");

        res.status(201).json({
            message: "Customer and vehicle registered successfully.",
            customer: customer.rows[0],
            vehicle: vehicle.rows[0]
        });
    } catch (error) {
        if (client) {
            await client.query("ROLLBACK");
        }

        console.error("Vehicle registration error:", error.message);

        if (error.code === "23505") {
            return res.status(409).json({
                message: "This registration number already exists."
            });
        }

        res.status(500).json({
            message: "Could not register vehicle."
        });
    } finally {
        if (client) client.release();
    }
});

// =========================================
// RECORD A CHARGING SESSION
// Fields: vehicle, starting percentage, final amount
// PostgreSQL automatically generates started_at.
// =========================================

app.post("/api/sessions", async (req, res) => {
    const {
        vehicleId,
        registrationNumber,
        startingPercentage,
        finalAmount
    } = req.body;

    const percentage = Number(startingPercentage);
    const amount = Number(finalAmount);

    if (
        (!vehicleId && (
            typeof registrationNumber !== "string" ||
            !registrationNumber.trim()
        )) ||
        !Number.isInteger(percentage) ||
        percentage < 0 ||
        percentage > 100 ||
        finalAmount === undefined ||
        finalAmount === null ||
        finalAmount === "" ||
        !Number.isFinite(amount) ||
        amount < 0
    ) {
        return res.status(400).json({
            message: "Provide a vehicle, a starting percentage from 0 to 100, and a valid final amount."
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        let vehicle;

        if (vehicleId !== undefined && vehicleId !== null && vehicleId !== "") {
            const id = Number(vehicleId);

            if (!Number.isInteger(id) || id <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    message: "Invalid vehicle ID."
                });
            }

            vehicle = await client.query(`
                SELECT id, registration_number
                FROM public.vehicles
                WHERE id = $1
            `, [id]);
        } else {
            vehicle = await client.query(`
                SELECT id, registration_number
                FROM public.vehicles
                WHERE UPPER(registration_number) = $1
            `, [registrationNumber.trim().toUpperCase()]);
        }

        if (vehicle.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                message: "Vehicle not found. Please register it first."
            });
        }

        // started_at is intentionally omitted.
        // PostgreSQL supplies its DEFAULT NOW() timestamp.
        const result = await client.query(`
            INSERT INTO public.charging_sessions
                (
                    vehicle_id,
                    charging_point_id,
                    started_at,
                    ended_at,
                    starting_percentage,
                    units_kwh,
                    rate_per_kwh,
                    amount,
                    payment_status,
                    notes
                )
            VALUES ($1, NULL, DEFAULT, NULL, $2, NULL, NULL, $3, 'pending', NULL)
            RETURNING *
        `, [
            vehicle.rows[0].id,
            percentage,
            amount
        ]);

        await client.query("COMMIT");

        res.status(201).json({
            message: "Charging session recorded successfully.",
            session: {
                ...result.rows[0],
                registration_number: vehicle.rows[0].registration_number
            }
        });
    } catch (error) {
        if (client) {
            await client.query("ROLLBACK");
        }

        console.error("Save session error:", error.message);
        res.status(500).json({
            message: "Could not save charging session."
        });
    } finally {
        if (client) client.release();
    }
});

// =========================================
// VEHICLE CHARGING HISTORY
// =========================================

app.get("/api/vehicles/:registration/sessions", async (req, res) => {
    try {
        const registration = req.params.registration.trim().toUpperCase();

        const result = await pool.query(`
            SELECT
                s.*,
                v.registration_number,
                cp.point_name
            FROM public.charging_sessions s
            JOIN public.vehicles v ON v.id = s.vehicle_id
            LEFT JOIN public.charging_points cp
                ON cp.id = s.charging_point_id
            WHERE UPPER(v.registration_number) = $1
            ORDER BY s.started_at DESC
        `, [registration]);

        res.json(result.rows);
    } catch (error) {
        console.error("Charging history error:", error.message);
        res.status(500).json({
            message: "Could not load charging history."
        });
    }
});

// =========================================
// DATABASE RECORDS
// =========================================

app.get("/api/records", async (req, res) => {
    try {
        const search = typeof req.query.search === "string"
            ? req.query.search.trim()
            : "";

        const paymentStatus = typeof req.query.paymentStatus === "string"
            ? req.query.paymentStatus.trim().toLowerCase()
            : "";

        if (
            paymentStatus &&
            !["pending", "paid"].includes(paymentStatus)
        ) {
            return res.status(400).json({
                message: "Payment status must be paid or pending."
            });
        }

        const pattern = `%${search}%`;

        const [customers, vehicles, chargingPoints, sessions] =
            await Promise.all([
                pool.query(`
                    SELECT id, name, phone, created_at
                    FROM public.customers
                    WHERE name ILIKE $1 OR phone ILIKE $1
                    ORDER BY id DESC
                `, [pattern]),

                pool.query(`
                    SELECT
                        v.id,
                        v.registration_number,
                        v.make,
                        v.model,
                        v.created_at,
                        c.id AS customer_id,
                        c.name AS customer_name,
                        c.phone AS customer_phone
                    FROM public.vehicles v
                    JOIN public.customers c ON c.id = v.customer_id
                    WHERE v.registration_number ILIKE $1
                       OR COALESCE(v.make, '') ILIKE $1
                       OR COALESCE(v.model, '') ILIKE $1
                       OR c.name ILIKE $1
                       OR c.phone ILIKE $1
                    ORDER BY v.id DESC
                `, [pattern]),

                pool.query(`
                    SELECT id, point_name, status
                    FROM public.charging_points
                    WHERE point_name ILIKE $1 OR status ILIKE $1
                    ORDER BY id
                `, [pattern]),

                pool.query(`
                    SELECT
                        s.id,
                        s.started_at,
                        s.ended_at,
                        s.starting_percentage,
                        s.units_kwh,
                        s.rate_per_kwh,
                        s.amount,
                        s.payment_status,
                        s.notes,
                        v.registration_number,
                        v.make,
                        v.model,
                        c.name AS customer_name,
                        c.phone AS customer_phone,
                        cp.point_name
                    FROM public.charging_sessions s
                    JOIN public.vehicles v ON v.id = s.vehicle_id
                    JOIN public.customers c ON c.id = v.customer_id
                    LEFT JOIN public.charging_points cp
                        ON cp.id = s.charging_point_id
                    WHERE (
                        $1 = ''
                        OR v.registration_number ILIKE $2
                        OR c.name ILIKE $2
                        OR c.phone ILIKE $2
                        OR COALESCE(cp.point_name, '') ILIKE $2
                    )
                    AND ($3 = '' OR s.payment_status = $3)
                    ORDER BY s.started_at DESC
                `, [search, pattern, paymentStatus])
            ]);

        const totalUnitsKwh = sessions.rows.reduce(
            (sum, row) => sum + Number(row.units_kwh || 0), 0
        );

        const totalRevenue = sessions.rows.reduce(
            (sum, row) => sum + Number(row.amount || 0), 0
        );

        const pendingAmount = sessions.rows
            .filter(row => row.payment_status === "pending")
            .reduce((sum, row) => sum + Number(row.amount || 0), 0);

        res.json({
            summary: {
                totalCustomers: customers.rowCount,
                totalVehicles: vehicles.rowCount,
                totalChargingPoints: chargingPoints.rowCount,
                totalSessions: sessions.rowCount,
                totalUnitsKwh,
                totalRevenue,
                pendingAmount
            },
            customers: customers.rows,
            vehicles: vehicles.rows,
            chargingPoints: chargingPoints.rows,
            sessions: sessions.rows
        });
    } catch (error) {
        console.error("Database records error:", error.message);
        res.status(500).json({
            message: "Could not load database records."
        });
    }
});

// =========================================
// DASHBOARD
// =========================================

app.get("/api/dashboard", async (req, res) => {
    try {
        const [sessions, points] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*)::int AS total_sessions,
                    COALESCE(SUM(amount), 0)::numeric AS total_revenue
                FROM public.charging_sessions
                WHERE started_at >= CURRENT_DATE
                  AND started_at < CURRENT_DATE + INTERVAL '1 day'
            `),
            pool.query(`
                SELECT
                    COUNT(*) FILTER (
                        WHERE status = 'available'
                    )::int AS available,
                    COUNT(*) FILTER (
                        WHERE status = 'charging'
                    )::int AS charging,
                    COUNT(*) FILTER (
                        WHERE status = 'maintenance'
                    )::int AS maintenance
                FROM public.charging_points
            `)
        ]);

        res.json({
            ...sessions.rows[0],
            ...points.rows[0]
        });
    } catch (error) {
        console.error("Dashboard error:", error.message);
        res.status(500).json({
            message: "Could not load dashboard."
        });
    }
});

// =========================================
// START SERVER
// =========================================

app.listen(PORT, async () => {
    console.log(`EV Charge Manager running at http://127.0.0.1:${PORT}`);

    try {
        const result = await pool.query(`
            SELECT current_database() AS database_name,
                   current_schema() AS schema_name
        `);

        console.log("PostgreSQL connection successful!");
        console.log("Database:", result.rows[0].database_name);
        console.log("Schema:", result.rows[0].schema_name);
    } catch (error) {
        console.error("PostgreSQL connection failed:", error.message);
    }
});
