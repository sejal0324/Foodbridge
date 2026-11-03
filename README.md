# FoodBridge AI

### Predict. Match. Redistribute.

FoodBridge AI is an intelligent food redistribution platform connecting food donors with NGOs through surplus prediction, intelligent matching, automated coordination, and verified food collection.

Donors (restaurants, hotels, caterers) list surplus food **for free** and earn recognition. NGOs post their actual food requirements and pay a transparent service fee for coordination. FoodBridge matches both sides, verifies who collects the food, tracks it to its destination and measures the impact.

> **Project status:** Phase 0 complete (architecture, database design, development environment).
> Application features are being built phase by phase. See
> [docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md) for what is implemented and tested.

## Core Modules

- Donor Management
- NGO Management
- AI Surplus Prediction
- Intelligent Food Matching (two-way: donor → NGOs and NGO request → donors)
- Partial Fulfilment and Atomic Quantity Reservation
- Smart Notifications
- Pickup Verification (QR + OTP + two-way handover confirmation)
- LiveTrack GPS
- Route Optimization
- Donor Rewards
- NGO Billing
- Analytics Dashboard
- AI Assistant (LLM with authorised, backend-validated tools)

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, Recharts, Socket.IO client, Google Maps JS API |
| Backend | Node.js 24, TypeScript, Express, node-postgres, Zod, Socket.IO, node-pg-migrate, pino |
| Database | PostgreSQL 18 + PostGIS 3.6 |
| AI Service | Python 3.12, FastAPI, scikit-learn, pandas, NumPy, OR-Tools, Pydantic |
| Integrations (optional) | Google Maps Routes/Geocoding, Gemini or OpenAI, SMTP email, SMS, Razorpay |
| Tooling | Docker Compose, uv, Vitest, pytest |

## Documentation

| Document | Contents |
|---|---|
| [System Architecture](docs/SYSTEM_ARCHITECTURE.md) | Components, authority boundaries, key flows, auth design, failure handling, decisions |
| [Database Design](docs/DATABASE_DESIGN.md) | Tables, constraints, concurrency strategy, state machines, retention |
| [ER Diagram](docs/ER_DIAGRAM.md) | Entity-relationship diagrams by domain |
| [Implementation Progress](docs/IMPLEMENTATION_PROGRESS.md) | Phase-by-phase status with test evidence |

## Project Structure

```
frontend/      React + TypeScript web app (Phase 4)
backend/       Node.js + Express API: auth, workflows, transactions
ai-service/    Python FastAPI service: prediction, matching, optimisation, LLM steps
database/      Docker Compose for PostgreSQL/PostGIS, migrations, seeds
docs/          Architecture and design documentation
tests/         Cross-service integration and end-to-end tests
deployment/    Deployment scripts and configuration
```

## Local Development Setup

### Prerequisites

- Node.js 24 (`.nvmrc`)
- Docker with Docker Compose v2.20+
- [uv](https://docs.astral.sh/uv/) for the Python AI service (it installs Python 3.12 itself)

### 1. Configure the environment

```bash
cp .env.example .env
# Replace every "replace-with-…" value. For example:
#   openssl rand -hex 24      → POSTGRES_PASSWORD (also update DATABASE_URL / TEST_DATABASE_URL)
#   openssl rand -base64 48   → JWT_ACCESS_SECRET, OTP_HMAC_SECRET, INTERNAL_SERVICE_TOKEN
```

`.env` is gitignored. Never commit real secrets.

### 2. Start the database

```bash
docker compose up -d db
docker compose ps          # wait for "healthy"
```

PostgreSQL listens on `127.0.0.1:5433` (5433 avoids clashing with a local PostgreSQL on 5432).
Two databases are created: `foodbridge` (development) and `foodbridge_test` (automated tests).

### 3. Backend

```bash
cd backend
npm install
```

The server, migrations and tests arrive in Phase 1.

### 4. AI service

```bash
cd ai-service
uv venv --python 3.12 .venv
```

Dependencies and the FastAPI app arrive in Phase 5.

### Local ports

| Service | Port |
|---|---|
| PostgreSQL (Docker) | 5433 |
| Backend API | 5001 |
| AI service | 8001 |
| Frontend | 5173 |
