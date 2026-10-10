# Inspect Funnel

Role-based property operations command center — Phase 1: four-role auth skeleton.

## What's here (Phase 1 scope)

- Cloudflare D1 schema: `users` (role-constrained: admin, regional_manager, superintendent, property_manager) and `sessions` (with admin-impersonation support via `actor_user_id`).
- Cloudflare Worker API (`worker/`): login, logout, session check, role-gated dashboard data, and admin account listing/impersonation/return.
- Vite frontend (`src/`): login screen + one dashboard per role, sharing the card-grid/color-coded-urgency visual style. Admin's dashboard lists every account and can impersonate any of them.

Not built yet (later phases, on purpose): real inspection entry, parameters/red-yellow-green flagging, Property Manager's real inspection view, AI photo-reading extraction, building registration, WhatsApp/SMS reminders.

## Live deployment

- **App:** https://power-log-command.pages.dev
- **API:** https://fhg-command-api.douglasmrgarcia.workers.dev

Both live on Cloudflare (Pages + Workers + D1) under account `Douglasmrgarcia@gmail.com`. Log in at the app URL with any seed account below.

## Seed accounts (test credentials — change before any real rollout)

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `FHG-Admin-2026!` |
| Regional Operations Manager | `alex.kim` | `FHG-Manager-2026!` |
| Superintendent | `jordan.lee` | `FHG-Super-2026!` |
| Property Manager | `taylor.morgan` | `FHG-Property-2026!` |

Passwords are hashed with PBKDF2-SHA256, 120,000 iterations, 32-byte output — this must match `worker/security.js`'s `verifyPassword`. If you ever regenerate seed hashes, use those exact parameters or logins will silently fail.

## Run it locally

Two servers run side by side — the Worker API and the Vite frontend, which proxies `/api/*` to the Worker.

```bash
npm install

# one-time: create the local D1 database from the migration
npm run db:migrate:local

# terminal 1 — the API
npm run dev:api      # http://localhost:8787

# terminal 2 — the frontend
npm run dev           # http://localhost:5173
```

Open http://localhost:5173 and log in with any of the seed accounts above. As Admin, you can jump into any other account from the dashboard without needing their password.

**Verified working (2026-08-28):** all four logins, wrong-password rejection (401), role-gating (a Superintendent hitting `/api/admin/accounts` correctly gets 403), admin impersonation switching `user` while preserving `actor`, and the Vite→Worker API proxy — tested directly against the running local servers, not just asserted.

## Deploy

```bash
# create the real D1 database once, then put its id in wrangler.toml
npx wrangler d1 create fhg-command-db

# apply the schema to the real database
npm run db:migrate:remote

# deploy the API
npm run deploy:api

# build and deploy the frontend
npm run build
npm run deploy:web
```

Before deploying for real: replace the seed passwords with real ones (regenerate hashes with the same PBKDF2 parameters above), and set `VITE_API_URL` (see `.env.example`) to the deployed Worker's URL so the built frontend knows where to call.
