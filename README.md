# 🩸 BloodOra — Blood Donation Network & Medical Shop

**Ultra-modern blood donation platform for Bangladesh + a complete medical shop.**
Node.js · Express · EJS · Turso (libSQL) serverless database · JWT auth.

---

## 🏗️ Architecture — separated frontend & backend

The system is split into **two independent deployments** that can live on
**different Vercel projects — even different Vercel accounts**. They are wired
together **only by environment variables**:

```
┌──────────────────────────────┐          HTTPS (JSON REST)          ┌──────────────────────────────┐
│  FRONTEND  (this repo root)  │  ────────────────────────────────►  │  BACKEND  (./backend folder) │
│  Express + EJS views         │        BACKEND_URL env var          │  REST API + JWT + Turso DB   │
│  Vercel project A            │  ◄────────────────────────────────  │  Vercel project B (any acct) │
└──────────────────────────────┘        FRONTEND_URL env var (CORS)   └──────────────────────────────┘
```

| Deployment | Folder | What it is | Key env var |
|---|---|---|---|
| **Frontend** | repo root (`server.js`, `views/`, `public/`) | Renders all pages, keeps the shopping cart + login session, forwards every action to the API | `BACKEND_URL` = backend's Vercel URL |
| **Backend** | `backend/` | Complete REST API: auth (JWT), donors, blood requests, shop, orders, messages, full admin panel, uploads, Turso DB | `FRONTEND_URL` = frontend's Vercel URL (CORS) |

> The frontend has **no database and no secrets of the backend**. The backend
> never needs the frontend's session secret. JWT signing stays entirely on the
> backend (`JWT_SECRET`).

### Features (complete on both halves)

- 🩸 Donor network: verified donor directory with blood group / district / upazila search
- 🚨 Blood requests: urgent flag, filters, fulfill/cancel, urgent contact form
- 🛒 Medical shop: products, cart, checkout with bKash / Nagad / Upay / Rocket / Pathao / Card, Kalai-only delivery (৳10), invoices, stock management
- ✉️ Messaging: user inbox/sent, send to admin or any user, replies
- 👑 Admin panel: dashboard stats, user management (verify / promote / demote / edit / delete / impersonate), site settings, site notice, product & order management, admin mailbox
- 🖼️ Image uploads for profiles & products (served by the backend, proxied by the frontend)
- 📄 Static content: blood compatibility chart, Anti-D info, resources, guidelines, FAQ, contact
- 💬 Live-chat widget + Socket.IO endpoint on the backend

---

## 🚀 Deploy on Vercel (two projects / two accounts)

### 1️⃣ Backend first (the other Vercel account)

1. Import this repo into the second Vercel account (or push only `backend/`
   into a new repo). If you import the whole repo, set **Root Directory = `backend`**
   in *Project → Settings → General*.
2. Add environment variables (*Project → Settings → Environment Variables*, plain values):

   ```
   FRONTEND_URL=https://<frontend-project>.vercel.app
   JWT_SECRET=<long random string>
   TURSO_DATABASE_URL=libsql://<your-db>-<name>.turso.io
   TURSO_AUTH_TOKEN=<turso token>
   SUPER_ADMIN_NAME=Super Admin
   SUPER_ADMIN_EMAIL=<admin email>
   SUPER_ADMIN_PASSWORD=<strong password>
   SUPER_ADMIN_PHONE=+8801XXXXXXXXX
   ```

3. Deploy. Verify: `https://<backend>.vercel.app/api/health` → `{"status":"healthy",...}`
   (DB schema + seeds + super admin are created automatically on first boot.)

Full backend docs: [`backend/README.md`](backend/README.md)

### 2️⃣ Frontend (this repo root, your main Vercel account)

1. Import the repo normally (root directory = repo root). Vercel auto-detects Node.
2. Add environment variables:

   ```
   SESSION_SECRET=<another long random string>
   BACKEND_URL=https://<backend-project>.vercel.app
   ```

3. Deploy. Done — the two deployments now talk to each other via those two URLs.

> Going back to edit `FRONTEND_URL`/`BACKEND_URL` later (e.g. custom domains)?
> Just update the env vars in the respective Vercel project and redeploy.
> Multiple allowed frontend origins can be comma-separated in `FRONTEND_URL`.

---

## 💻 Local development (two terminals)

```bash
# Terminal 1 — backend API on :4000
cd backend
npm install
cp .env.example .env      # optional: add Turso creds, else local SQLite file
npm run dev

# Terminal 2 — frontend on :3000
cd ..                     # repo root
npm install
cp .env.example .env      # BACKEND_URL=http://localhost:4000 (already the default)
npm run dev
```

Open http://localhost:3000 — the first registered user becomes Super Admin
(or use the `SUPER_ADMIN_*` env vars on the backend).

## 🔐 Auth model

- Backend issues **JWTs** on register/login (7-day expiry) bound to a DB
  session token → single active session per user (same behaviour as before).
- The frontend stores the JWT in its session and sends it as
  `Authorization: Bearer <token>` on every API call.
- The frontend session is **stateless**: it lives in a gzip-compressed,
  HMAC-signed `bloodora.session` cookie (`src/middleware/cookieStore.js`)
  instead of express-session's in-memory store. Serverless functions are
  short-lived and not shared, so an in-memory store would log users out at
  random and leaks memory. Nothing sensitive is trusted from the client — the
  cookie cannot be read or altered without `SESSION_SECRET`.
- Admin routes require `is_admin`, super-admin routes `is_super_admin`.
- Impersonation: super admin gets a token for the target user; the frontend
  keeps the admin token to switch back.

## 📁 Repository layout

```
├── server.js              # FRONTEND entry (Express + EJS, no DB)
├── views/                 # All EJS templates (theme intact)
├── public/                # Static assets (logo, favicon)
├── src/
│   ├── api.js             # API client → BACKEND_URL
│   ├── middleware/auth.js # Session/JWT bridge
│   ├── routes/            # Frontend page routes (call the API)
│   └── utils/locations.js # Bangladesh geo data (register fallback)
└── backend/               # ★ SEPARATED BACKEND (own package.json, own deploy)
    ├── index.js           # API entry (Vercel handler + local server)
    ├── src/db.js          # Turso/libSQL layer + schema + seeds
    ├── src/auth.js        # JWT middleware
    ├── src/routes/        # Complete REST API
    ├── uploads/           # Uploaded images (served at /uploads/*)
    └── README.md          # Backend deployment guide
```

## ⚠️ Production notes

- `server.js` must keep its `export default function handler(req, res)`. That
  default export is what `@vercel/node` invokes; without it every request fails
  with *"Invalid export found in module /var/task/server.js"*. `app.listen()`
  runs only for `node server.js` locally.
- `vercel.json` ships `views/**`, `public/**` and `src/**` into the function via
  `includeFiles` — EJS templates are read from disk at runtime, so a missing
  entry there shows up as a 500 on every page.
- Always set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` on the backend —
  without them Vercel falls back to an **ephemeral** /tmp SQLite (dev only).
- Uploaded images live on the backend function filesystem (`/tmp/uploads` on
  Vercel). For permanent storage, attach object storage (e.g. Cloudflare R2)
  behind the same endpoints later.
- Vercel free tier function timeouts apply to long requests (none of the
  current endpoints are long-running).
