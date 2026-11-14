# Clinic Booking — Koya Cohort 4 Assessment

A portable clinic appointment application with a React/TypeScript browser client, an Express/TypeScript REST API, and PostgreSQL storage. The frontend and backend can be installed, run, tested, and deployed independently. The application has no dependency on Lovable, Lovable Cloud, Supabase Auth, Edge Functions, or platform-specific database APIs.

## Architecture

```text
Browser (React + Vite + TypeScript + Tailwind)
        |  Fetch API + X-API-Key
        v
Node.js / Express REST API (TypeScript)
        |  pg + DATABASE_URL
        v
PostgreSQL (Supabase PostgreSQL or another provider)
```

The frontend is a client only. It does not access PostgreSQL directly. The backend owns validation, availability decisions, booking writes, cancellation, idempotency, rate limiting, and pagination. The API is described by the supplied `openapi.json` file in this repository.

### Technology

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, Lucide icons, browser Fetch API.
- Backend: Node.js, Express 4, TypeScript, `pg`, Helmet, CORS.
- Database: PostgreSQL.
- Tests: Vitest and Supertest; PostgreSQL integration tests use a separately configured test database.
- Deployment targets: Vercel (frontend), Render (backend), Supabase PostgreSQL (database), GitHub (source control).

## Project layout

```text
clinic-booking/
├── backend/
│   ├── migrations/                 # Versioned PostgreSQL SQL migrations
│   ├── src/
│   │   ├── config/                 # Environment configuration
│   │   ├── controllers/            # HTTP request/response handlers
│   │   ├── database/               # PostgreSQL pool and migration runner
│   │   ├── middleware/             # API key, error handling
│   │   ├── routes/                 # Assessment routes
│   │   ├── services/               # Transactional booking and slot operations
│   │   ├── utils/                  # Hashing, cursors, HTTP helpers
│   │   └── server.ts
│   ├── tests/
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/                  # Available for additional page extraction
│   │   ├── services/               # Central API client
│   │   ├── types/
│   │   ├── utils/
│   │   ├── App.tsx
│   │   └── styles.css
│   ├── .env.example
│   └── package.json
├── openapi.json
├── package.json
└── README.md
```

## Requirements

- Node.js 20 or newer (Node 22 LTS is suitable).
- npm 10 or newer.
- A reachable PostgreSQL database (PostgreSQL 14+ recommended).
- Git for source control.

## Local setup

### 1. Get the code and install dependencies

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd clinic-booking
npm install
```

The root npm workspace installs the frontend and backend dependencies together. Each application also has its own `package.json`, so either can be installed separately:

```bash
cd backend && npm install
# or
cd frontend && npm install
```

### Windows PowerShell quick setup

From the project root in PowerShell, create the local environment files:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
notepad backend/.env
notepad frontend/.env
```

Fill in the database URI and API key in `backend/.env`, then copy the same assessment API key into `VITE_API_KEY` in `frontend/.env`. Save both files before continuing.

### 2. Configure PostgreSQL and backend environment

Create a PostgreSQL database. Supabase users can use the project's standard PostgreSQL connection URI; no Supabase application services are used.

Copy `backend/.env.example` to `backend/.env` and set:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URI. Keep private on the backend only. |
| `DATABASE_SSL` | Optional `true` when TLS is required but not enabled in the connection URI. |
| `API_KEY` | Backend API key. Use a long random value. |
| `PORT` | Backend port; defaults to `3000`. |
| `FRONTEND_URL` | Exact frontend origin, e.g. `http://localhost:5173`. Multiple comma-separated origins are supported. |
| `NODE_ENV` | `development` locally and `production` when deployed. |

Example local backend configuration (replace the placeholders):

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/clinic_booking
DATABASE_SSL=false
API_KEY=replace-with-a-long-random-key
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

Never commit `.env` files, database credentials, or real API keys.

### 3. Apply database migrations

From the repository root:

```bash
npm run migrate
```

Or from `backend/`:

```bash
npm run migrate
```

The migration runner creates a `schema_migrations` ledger and applies each unapplied SQL migration in a transaction. The first migration creates slots, bookings, idempotency records, and persistent rate-limit attempts, including indexes and the partial unique index that prevents more than one confirmed booking per slot.

Run migrations after deploying a new backend version that introduces a new migration. Migrations are safe to re-run; already-applied files are skipped.

### 4. Configure the frontend

Copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_API_KEY=the-same-assessment-key-configured-in-backend
```

**Security note:** Vite variables prefixed with `VITE_` are embedded in the browser bundle and can be inspected by users. The frontend key is therefore a public assessment/demo key, exactly as described in the assessment brief. It is not a production secret or a substitute for user authentication. Never put `DATABASE_URL` or server-only secrets in the frontend.

### 5. Start the applications

Run both from the repository root:

```bash
npm run dev
```

Or run them independently in two terminals:

```bash
# Terminal 1
cd backend
npm run dev

# Terminal 2
cd frontend
npm run dev
```

The API listens at `http://localhost:3000` by default. The Vite frontend is available at `http://localhost:5173`. The backend exposes `GET /health` for hosting health checks; assessment endpoints require `X-API-Key`.

### 6. Build for production

From the repository root:

```bash
npm run build
```

Or independently:

```bash
cd backend && npm run build
cd frontend && npm run build
```

Backend output is written to `backend/dist`. Frontend static output is written to `frontend/dist`.

## API contract

All assessment endpoints require the `X-API-Key` header. The backend checks the key before routing and responds with HTTP 401 for a missing or incorrect key. Responses and errors are JSON. Error response shape:

```json
{ "error": "descriptive error message" }
```

| Method | Endpoint | Behavior |
|---|---|---|
| `POST` | `/reset` | Transactionally deletes existing bookings and replaces the slot set. Accepts past slots. Also clears idempotency and rate-limit records so an assessment reset starts cleanly. |
| `GET` | `/slots` | Lists slots by earliest start; `?provider=` applies an exact provider match. Each item includes `available`. |
| `POST` | `/bookings` | Validates and creates a confirmed booking. Supports optional `Idempotency-Key`. |
| `GET` | `/bookings/:id` | Retrieves one booking by ID. |
| `DELETE` | `/bookings/:id` | Cancels a confirmed booking; a cancelled booking releases its slot. |
| `GET` | `/bookings?email=...` | Returns one patient's bookings, oldest first, with `limit` and cursor pagination. |

### Booking safeguards

- Required fields are trimmed; stored email addresses are lowercase and validated.
- The API rejects unknown slots (404), started slots (400), and already-confirmed slots (409).
- A row lock serializes application booking attempts for the selected slot; a PostgreSQL partial unique index is the final database-level exclusivity guarantee.
- Idempotency records are persisted in PostgreSQL. The request body is hashed canonically, a same-key/same-body retry receives its original result, and a same-key/different-body request receives 422. Idempotency is checked before rate limiting so a legitimate retry does not consume an extra attempt.
- The email limiter uses PostgreSQL attempt records and transaction-scoped advisory locks. The first five attempts in a rolling minute are allowed; the sixth receives 429 and an integer `Retry-After` header. Failed attempts count, and email buckets are independent.
- History pagination uses `(created_at, id)` as a compound cursor boundary and preserves PostgreSQL timestamp microseconds in the opaque cursor, so rows with equal timestamps or sub-millisecond differences do not cause repeated or skipped records.

### Pagination example

First page:

```http
GET /bookings?email=ada%40example.com&limit=10
X-API-Key: <assessment-key>
```

Use the returned `next_cursor` unchanged on the next request:

```http
GET /bookings?email=ada%40example.com&limit=10&cursor=<next_cursor>
X-API-Key: <assessment-key>
```

The final page returns `"next_cursor": null`.

## Testing

Utility tests can run without a database:

```bash
cd backend
npm test
```

The API integration suite is enabled only when `TEST_DATABASE_URL` is configured. **Use a dedicated test database, not a production or personal data database.** It clears test tables between test cases.

Linux/macOS:

```bash
cd backend
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/clinic_booking_test npm test
```

PowerShell:

```powershell
cd backend
$env:TEST_DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/clinic_booking_test"
npm test
```

The integration suite applies the initial schema and exercises API-key enforcement, reset, exact provider filtering, chronological ordering, validation, cancellation and slot release, simultaneous booking protection, idempotency, rate limiting, and cursor pagination. It is deliberately skipped when no dedicated test database is provided. Do not interpret a skipped integration suite as a passing database test.

## Deployment

### Supabase PostgreSQL

1. Create a Supabase project and obtain its PostgreSQL connection URI from the database connection settings.
2. Configure `DATABASE_URL` on the backend host with that URI. Prefer a connection mode intended for persistent server connections (the session pooler is suitable when direct IPv6 connectivity is not available).
3. Configure SSL according to the URI/provider requirements. Set `DATABASE_SSL=true` only when TLS needs to be explicitly enabled by this application.
4. Run the migration command against that database before directing traffic to the backend.
5. Do not enable Supabase Auth or Edge Functions for this application; it uses standard PostgreSQL and the assessment API key.

### Render — backend

Create a new Web Service connected to the GitHub repository:

- Root directory: `backend`
- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Add environment variables: `DATABASE_URL`, `API_KEY`, `FRONTEND_URL` (the deployed Vercel origin), `NODE_ENV=production`, and `DATABASE_SSL` if required.
- Before serving assessment traffic, run the migration command from the backend service shell or a one-off deployment job: `npm run migrate:prod` after the backend has been built. The source migration files are present in the deployed backend package.
- Render supplies `PORT`; the server reads it automatically.
- Health check path: `/health`.

### Vercel — frontend

Create a Vercel project from the same GitHub repository:

- Root directory: `frontend`
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: `VITE_API_BASE_URL` set to the deployed Render API base URL and `VITE_API_KEY` set to the public assessment/demo key.
- Redeploy after changing Vite environment variables; they are compiled into the frontend build.

The `frontend/vercel.json` file rewrites client-side routes to `index.html`. The current interface uses client-side section navigation and does not require a backend rewrite.

### GitHub

```bash
git init
git add .
git commit -m "Build clinic booking assessment application"
git branch -M main
git remote add origin <YOUR_GITHUB_REPOSITORY_URL>
git push -u origin main
```

The `.gitignore` excludes environment files, dependencies, build output, logs, and local editor settings.

## Operational notes and known contract boundary

The supplied API does not include an endpoint to list all bookings across every email address. The frontend therefore displays the total number of slots and available slots from the full slots API, but confirmed/cancelled booking counts are explicitly scoped to booking records loaded during the current browser session (booking creation, lookup, or patient history). It does not invent a global bookings total or add an unrequested endpoint to the assessment API.

`GET /health` is a hosting health check and is not one of the assessment endpoints. All six assessment routes above are protected by the required API key.

## Troubleshooting

- **401 on all calls:** check `API_KEY` in `backend/.env` and `VITE_API_KEY` in `frontend/.env`; they must match. Restart Vite after changing its environment.
- **Network error / CORS:** confirm the backend is running and `FRONTEND_URL` exactly matches the browser origin, including protocol and port.
- **Database connection error:** verify `DATABASE_URL`, database allow-list/network policy, credentials, and provider TLS settings.
- **Missing tables:** run `npm run migrate` from the repository root or backend directory.
- **No slots:** the API starts with an empty schedule. Seed slots through the assessment's authenticated `POST /reset` endpoint; the app intentionally does not use fake appointment data.

Example schedule seed (replace the key with the value in `backend/.env`):

```bash
curl -X POST http://localhost:3000/reset \
  -H "Content-Type: application/json" \
  -H "X-API-Key: replace-with-your-key" \
  -d '{"slots":[{"id":"s1","provider":"Dr Ade","start":"2026-12-10T09:00:00Z","end":"2026-12-10T09:30:00Z"},{"id":"s2","provider":"Dr Bello","start":"2026-12-10T10:00:00Z","end":"2026-12-10T10:30:00Z"}]}'
```

Use `POST /reset` deliberately: it replaces the whole slot schedule and clears existing bookings and assessment attempt/idempotency state.
- **Rate limited:** wait for the integer duration in the `Retry-After` response header before retrying with that email address.
- **Frontend still uses old environment values:** restart local Vite or redeploy the Vercel frontend after updating `VITE_*` variables.
