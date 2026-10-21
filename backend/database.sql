
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vehicles (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL
        REFERENCES customers(id),
    registration_number VARCHAR(20) NOT NULL UNIQUE,
    make VARCHAR(80),
    model VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE charging_points (
    id SERIAL PRIMARY KEY,
    point_name VARCHAR(50) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'charging', 'maintenance'))
);

CREATE TABLE charging_sessions (
    id SERIAL PRIMARY KEY,
    vehicle_id INTEGER NOT NULL
        REFERENCES vehicles(id),
    charging_point_id INTEGER
        REFERENCES charging_points(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    units_kwh NUMERIC(10, 3) NOT NULL
        CHECK (units_kwh > 0),
    rate_per_kwh NUMERIC(10, 2) NOT NULL
        CHECK (rate_per_kwh >= 0),
    amount NUMERIC(12, 2) NOT NULL
        CHECK (amount >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid')),
    notes TEXT,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX idx_vehicles_registration
ON vehicles(registration_number);

CREATE INDEX idx_sessions_vehicle
ON charging_sessions(vehicle_id);

CREATE INDEX idx_sessions_started_at
ON charging_sessions(started_at);

-- Example charging points; change these to match your station.
INSERT INTO charging_points (point_name)
VALUES ('Point 1'), ('Point 2'), ('Point 3');
