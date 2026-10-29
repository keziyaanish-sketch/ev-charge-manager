const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { pool } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Home route
app.get("/", (req, res) => {
    res.json({
        message: "EV Charge Manager API is running!",
        database: "Connected",
        databaseName: "voltcare_db",
        schema: "public"
    });
});

// API status
app.get("/api", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            message: "EV Charge Manager API is running!",
            database: "Connected",
            databaseName: "voltcare_db",
            schema: "public"
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);

        res.status(500).json({
            message: "Database connection failed",
            error: error.message
        });
    }
});

// Get all charging points
app.get("/api/charging-points", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM charging_points ORDER BY id"
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching charging points:", error.message);
        res.status(500).json({ error: "Failed to fetch charging points" });
    }
});

// Get vehicle details by registration number
app.get("/api/vehicles/:registration", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM vehicles WHERE registration_number = $1",
            [req.params.registration]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Vehicle not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching vehicle:", error.message);
        res.status(500).json({ error: "Failed to fetch vehicle" });
    }
});

// Add a vehicle
app.post("/api/vehicles", async (req, res) => {
    try {
        const {
            registration_number,
            owner_name,
            vehicle_model
        } = req.body;

        if (!registration_number || !owner_name || !vehicle_model) {
            return res.status(400).json({
                error: "Registration number, owner name, and vehicle model are required"
            });
        }

        const result = await pool.query(
            `INSERT INTO vehicles
             (registration_number, owner_name, vehicle_model)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [registration_number, owner_name, vehicle_model]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Error adding vehicle:", error.message);
        res.status(500).json({ error: "Failed to add vehicle" });
    }
});

// Create a charging session
app.post("/api/sessions", async (req, res) => {
    try {
        const {
            vehicle_registration,
            charging_point_id,
            start_time,
            end_time,
            energy_consumed,
            cost
        } = req.body;

        if (!vehicle_registration || !charging_point_id) {
            return res.status(400).json({
                error: "Vehicle registration and charging point ID are required"
            });
        }

        const result = await pool.query(
            `INSERT INTO sessions
             (vehicle_registration, charging_point_id, start_time,
              end_time, energy_consumed, cost)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                vehicle_registration,
                charging_point_id,
                start_time || null,
                end_time || null,
                energy_consumed ?? 0,
                cost ?? 0
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Error creating session:", error.message);
        res.status(500).json({ error: "Failed to create charging session" });
    }
});

// Get sessions for a vehicle
app.get("/api/vehicles/:registration/sessions", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT *
             FROM sessions
             WHERE vehicle_registration = $1
             ORDER BY start_time DESC`,
            [req.params.registration]
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching vehicle sessions:", error.message);
        res.status(500).json({ error: "Failed to fetch vehicle sessions" });
    }
});

// Get all session records
app.get("/api/records", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM sessions ORDER BY start_time DESC"
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching records:", error.message);
        res.status(500).json({ error: "Failed to fetch records" });
    }
});

// Dashboard summary
app.get("/api/dashboard", async (req, res) => {
    try {
        const [
            vehiclesResult,
            chargingPointsResult,
            sessionsResult,
            energyResult,
            revenueResult
        ] = await Promise.all([
            pool.query("SELECT COUNT(*)::int AS total FROM vehicles"),
            pool.query("SELECT COUNT(*)::int AS total FROM charging_points"),
            pool.query("SELECT COUNT(*)::int AS total FROM sessions"),
            pool.query(
                "SELECT COALESCE(SUM(energy_consumed), 0) AS total FROM sessions"
            ),
            pool.query(
                "SELECT COALESCE(SUM(cost), 0) AS total FROM sessions"
            )
        ]);

        res.json({
            totalVehicles: vehiclesResult.rows[0].total,
            totalChargingPoints: chargingPointsResult.rows[0].total,
            totalSessions: sessionsResult.rows[0].total,
            totalEnergyConsumed: Number(energyResult.rows[0].total),
            totalRevenue: Number(revenueResult.rows[0].total)
        });
    } catch (error) {
        console.error("Error loading dashboard:", error.message);
        res.status(500).json({
            error: "Failed to load dashboard data"
        });
    }
});

app.get("/api/check-tables", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Table check failed:", error.message);
        res.status(500).json({ error: error.message });
    }
});
// Unknown routes
app.use((req, res) => {
    res.status(404).json({
        error: "Route not found",
        requestedPath: req.originalUrl
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`EV Charge Manager running on port ${PORT}`);
});