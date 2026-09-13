# 🩸 BloodOra — Frontend (presentation layer)

**Ultra-modern blood donation platform for Bangladesh + a complete medical shop.**
Node.js · Express · EJS.

> **This repository contains the FRONTEND ONLY.** There is no database, no JWT
> signing and no backend source code here. The API lives in its own repository:
> **[dmoshiur/bloodora-backend](https://github.com/dmoshiur/bloodora-backend)**.

---

## 🏗️ Architecture — two repositories, two deployments

The two halves are separate repos and separate Vercel projects (they can even
live on different Vercel accounts). They are wired together **only by
environment variables**:

```
┌──────────────────────────────┐          HTTPS (JSON REST)          ┌───────────────────────────────┐
│  FRONTEND  (this repo)       │  ────────────────────────────────►  │  BACKEND  (bloodora-backend)  │
│  Express + EJS views         │        BACKEND_URL env var          │  REST API + JWT + Turso DB    │
│  Vercel project A            │  ◄────────────────────────────────  │  Vercel project B (any acct)  │
└──────────────────────────────┘        FRONTEND_URL env var (CORS)   └───────────────────────────────┘
```

| Deployment | Repository | What it is | Key env var |
|---|---|---|---|
| **Frontend** | `lspk` (this repo — root = project root) | Renders all pages, keeps the shopping cart + login session, forwards every action to the API | `BACKEND_URL` = backend's Vercel URL |
| **Backend** | [`bloodora-backend`](https://github.com/dmoshiur/bloodora-backend) | Complete REST API: auth (JWT), donors, blood requests, shop, orders, messages, admin panel, uploads, Turso DB | `FRONTEND_URL` = frontend's Vercel URL (CORS) |

> The frontend has **no database and none of the backend's secrets**. The
> backend never needs the frontend's session secret. JWT signing stays entirely
> on the backend (`JWT_SECRET`).
>
> ⚠️ Do **not** copy backend source into this repo. `npm test` fails if any
> frontend file reaches outside this repository.

### Features (complete on both halves)

- 🩸 Donor network: verified donor directory with blood group / district / upazila search
- 🚨 Blood requests: urgent flag, filters, fulfill/cancel, urgent contact form
- 🛒 Medical shop: products, cart, checkout with bKash / Nagad / Upay / Rocket / Pathao / Card, Kalai-only delivery (৳10), invoices, stock management
- ✉️ Messaging: user inbox/sent, send to admin or any user, replies
- 👑 Admin panel: dashboard stats, user management (verify / promote / demote / edit / delete / impersonate), site settings, site notice, product & order management, admin mailbox
- 🖼️ Image uploads for profiles & products (stored by the backend, proxied by the frontend)
- 📄 Static content: blood compatibility chart, Anti-D info, resources, guidelines, FAQ, contact
- 💬 Live-chat widget (backend endpoint, frontend widget)

---

## 🚀 Deploy this frontend on Vercel

1. Import this repo (root directory = repo root). Vercel auto-detects Node.
2. Add environment variables (*Project → Settings → Environment Variables*):

   ```
   SESSION_SECRET=<long random string>          # openssl rand -hex 32
   BACKEND_URL=https://<backend-project>.vercel.app
   ```

3. Deploy. Verify the home page renders and `/health` proxies the backend.

Deploy the API separately from its own repository — see
[bloodora-backend](https://github.com/dmoshiur/bloodora-backend) for its env
vars (`FRONTEND_URL`, `JWT_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`SUPER_ADMIN_*`).

> Changing a custom domain later? Just update `BACKEND_URL` here and
> `FRONTEND_URL` on the backend, then redeploy both. Multiple allowed frontend
> origins can be comma-separated in `FRONTEND_URL`.

---

## 💻 Local development

The frontend needs a running backend API. Clone it next to this repo:

```bash
# Terminal 1 — backend API on :4000 (separate repository)
git clone https://github.com/dmoshiur/bloodora-backend
cd bloodora-backend
npm install
cp .env.example .env      # PORT=4000, FRONTEND_URL=http://localhost:3000
npm run dev

# Terminal 2 — frontend on :3000 (this repository)
cd ../lspk
npm install
cp .env.example .env      # BACKEND_URL=http://localhost:4000 (already the default)
npm run dev
```

Open http://localhost:3000.

```bash
npm test          # deployment + session regression guard (node --test)
```

The reference pages (`/antid`, `/compatibility`, `/resources`, `/api/routes`)
fall back to the built-in content in `src/utils/content.js` when the API is
unreachable, so they never render empty.

## 🌐 Localization (en / বাংলা / العربية)

Two layers, both resolved **server-side before the template renders** — no
runtime machine translation, no extra requests:

| Layer | File | Holds |
|-------|------|-------|
| UI strings | `src/i18n.js` | navbar, buttons, labels, forms, errors, empty/loading states |
| Page content | `src/utils/content.js` | the Anti-D / Compatibility / Resources reference material |

Every human-readable string in `content.js` is stored as a translation record
`L("English", "বাংলা", "العربية")`. `src/utils/localize.js` resolves a whole
reference to the visitor's locale:

```js
localizeReference(apiPayload, bundledReference, lang)   // -> one language, plain text
```

- A `{ en, bn, ar }` value from the backend/CMS is honoured directly.
- A plain English string that matches a known source string is translated
  through the bundled record, so **CMS content served in English still renders
  in the visitor's language**.
- Genuinely new, never-translated CMS text is kept as authored and reported by
  a development-time warning (`missingTranslations()`), never silently dropped.
- Fallback is locale → English → source text; a raw key is never shown.
- Text is entity-decoded once (`decodeEntities`) and printed with EJS
  `<%= %>`, which escapes exactly once. Never `<%- %>` / `dangerouslySetInnerHTML`.

Deliberately **not** translated: blood-group symbols (`O−`, `AB+` — also parsed
by the compatibility matrix), doses and units (`1500 IU (300 mcg) IM`), product
and test names (`Rhophylac`, `Kleihauer-Betke`), and the official titles of
published guidelines.

Arabic sets `dir="rtl"` on `<html>` and swaps in the Bootstrap RTL build.
The choice persists in the `lang` cookie + session, so it survives refresh,
navigation and login/logout.

**Rule for views:** print text with `<%= %>`. Do not add a local HTML escaper —
that double-escapes and leaks a literal `&#39;` onto the page.

## 🔐 Auth model

- The backend issues **JWTs** on register/login (7-day expiry) bound to a DB
  session token → single active session per user.
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
├── server.js              # Entry (Express + EJS, no DB) — default-exports the Vercel handler
├── vercel.json            # @vercel/node build + includeFiles (views/, public/, src/)
├── views/                 # All EJS templates
├── public/                # Static assets (logo, favicon)
├── src/
│   ├── api.js             # API client → BACKEND_URL
│   ├── i18n.js            # en / bn / ar UI strings (+ dev warnings for gaps)
│   ├── middleware/
│   │   ├── auth.js        # Session/JWT bridge (loadUser, requireAdmin, …)
│   │   ├── cookieStore.js # Stateless signed-cookie session store
│   │   └── site.js        # Language + branding context
│   ├── routes/            # Frontend page routes (all data via the API)
│   └── utils/
│       ├── content.js     # Built-in reference content (en/bn/ar records)
│       ├── localize.js    # Resolves content to the active locale + entity decoding
│       └── locations.js   # Bangladesh geo data (register fallback)
└── test/
    ├── deploy.test.mjs        # Guards the Vercel handler export + session store
    ├── frontend.test.mjs      # AI/chat/i18n/template + page pipeline guards
    └── i18n-content.test.mjs  # Localized content, entity escaping, RTL guards
```

## ⚠️ Production notes

- `server.js` must keep its `export default function handler(req, res)`. That
  default export is what `@vercel/node` invokes; without it every request fails
  with *"Invalid export found in module /var/task/server.js"*. `app.listen()`
  runs only for `node server.js` locally.
- `vercel.json` ships `views/**`, `public/**` and `src/**` into the function via
  `includeFiles` — EJS templates are read from disk at runtime, so a missing
  entry there shows up as a 500 on every page.
- Always set `SESSION_SECRET` — it signs the session cookie. Without it the
  built-in fallback secret is used and a warning is logged.
- Uploaded images are stored and served by the **backend**; this app proxies
  them at `/uploads/:file`. For permanent storage, attach object storage on the
  backend side.
- Vercel free tier function timeouts apply to long requests (none of the
  current endpoints are long-running).
