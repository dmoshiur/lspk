# BloodOra authenticated frontend audit and implementation

**Status:** implemented and browser-tested locally; **not a claim that production is fixed**.

Repository: `dmoshiur/lspk`, branch `arena/01a09b85-lspk`, starting commit
`c7fe7fa4b22d5113e436593615418f8ea03c7d12`. Audit/verification: 13 September 2026.
Only the frontend was changed. Backend contracts were inspected read-only; no
backend code, database, API routes or deployment was modified.

## 1. Why `/dashboard` was returning 404

The reported production 404 **cannot be attributed to missing registration in
this checkout**. At the starting commit:

- `server.js` already imported `src/routes/dashboard.js` and mounted it at
  `/dashboard`, before the custom 404 handler.
- `GET /` in that router already used `requireLogin` and rendered
  `views/dashboard/home.ejs`.
- There was no public-router catch-all shadowing it.

An external, unauthenticated page fetch of the repository's linked deployment,
`https://lspk.vercel.app/dashboard`, followed a redirect to `/login`, not 404.
This is a page-fetch observation, **not authenticated browser verification**.
The exact deployment/session that produced the user's earlier 404 was not
available, so its historical cause remains unconfirmed.

The audit did find actual frontend authentication defects: missing HTTPS proxy
recognition could prevent Express's Secure `connect.sid` cookie from being
issued, and multipart callbacks could lose the request context needed to persist
the signed session cookie. The latter was reproduced in Chromium: registration
redirected toward the dashboard but then returned to Login. Both are addressed.

## 2. Why `/admin` was returning 404

`/admin` was also already mounted before the 404 handler and had a dashboard
controller/template. An external logged-out fetch of
`https://lspk.vercel.app/admin` ended at Home, matching the old guard's redirect.
The reported 404 was not reproduced against that linked deployment.

Confirmed defects were different and are corrected:

- The old guard redirected anonymous/non-admin users to Home instead of
  distinguishing Login from Forbidden.
- Login accepted superadmins, but the guard checked only `is_admin`.
- A failed primary admin-dashboard API call redirected to Home, hiding the
  authenticated application instead of displaying an unavailable state.
- `/admin/dashboard` had no compatibility alias.
- Admin live-chat SSE requests omitted the bearer token upstream, producing a
  401 in the browser console. Chromium exposed this during section navigation.

## 3. Did dashboard components already exist?

**Yes.** `views/dashboard/home.ejs`, `_sidebar.ejs`, `orders.ejs`, `requests.ejs`
and `security.ejs`, backed by `src/routes/dashboard.js`.

These are reused. The hub contains the greeting, account/donor status, real
order/request aggregates and lists, unread inbox messages, shortcuts and logout.
A donation-status card now uses the existing `last_donation` field; an absent
value gets an empty state, not a fabricated history or statistic. Failed or
malformed activity payloads render unavailable states rather than empty success.

## 4. Did profile components already exist?

**Yes.** `views/my_profile.ejs`, `views/edit_profile.ejs` and the public
`views/profile_view.ejs` existed. Self-service views were under
`/donors/profile/my` and `/donors/profile/edit`. **The canonical `/profile` route
was genuinely missing**, and an external production fetch confirmed its 404.

`src/routes/profile.js` now owns `/profile` and `/profile/edit`, reusing those
views. Name, email, phone, blood group, address/location, account role and existing
account fields come from `/api/auth/me`. Editable fields remain exactly those
supported by the existing profile API: name, phone, holding/address, birth
certificate, date of birth and an optional photo. Other fields are view-only.

Saving forwards multipart data to `PUT /api/users/me`, requires an updated user
with the matching account ID, and shows success only after that response.
Validation, missing endpoint, malformed response and other failure paths never
replace the account cache with submitted data. Submitted text is retained on
failure; a photo must be selected again. The next profile load re-reads `/me`.

## 5. Did admin components already exist?

**Yes.** The frontend already had templates/controllers for overview, users,
products/orders/invoices, messages, reviews, content/Anti-D/resources, site
settings, branding, SMTP, AI configuration, live chat and activity.

Existing modules are connected through the shared sidebar and account menu;
Request Blood and Profile shortcuts were added. Blood Requests continues to use
the existing request list/detail/action flow. No disconnected CRUD or invented
statistics were introduced. Admin overview failure retains the admin page,
sidebar and retry action, uses unavailable values and disables the unavailable
notice form instead of redirecting to Home.

### Route/API inventory

| Frontend route | Guard | Existing API or source |
|---|---|---|
| `/login`, `/register` | Public; logged-in visitors go to their role's hub | `/api/auth/login`, `/api/auth/register` |
| `/dashboard` | Login | Orders/mine, blood-requests/mine, messages, reviews/mine, authenticated user |
| `/dashboard/orders` | Login | `/api/shop/orders/mine`; cancellation forwards to the owner-only API |
| `/dashboard/requests` | Login | `/api/blood-requests/mine` |
| `/dashboard/security` | Login | Authenticated user; `/api/auth/password` |
| `/profile`, `/profile/edit` | Login | `/api/auth/me`; `PUT /api/users/me` |
| `/donors/profile/view/:id` | Public | `/api/users/:id` |
| `/admin`, `/admin/users` | Admin or superadmin | `/api/admin/dashboard` |
| `/shop/admin/products`, `/shop/admin/orders` and detail/actions | Admin or superadmin | Existing `/api/admin/products`, `/api/admin/orders` endpoints |
| `/messages/admin/messages` and reply flow | Admin or superadmin | `/api/messages/admin/list`, reply/original endpoints |
| `/admin/reviews` | Admin or superadmin | `/api/reviews/admin` and moderation endpoints |
| `/admin/content` | Admin or superadmin | `/api/admin/content/antid`, `/api/admin/content/resources` |
| `/admin/settings`, `/admin/branding`, `/admin/smtp` | Admin or superadmin | Matching existing admin endpoints |
| `/admin/ai` | Admin or superadmin | Existing AI config/conversations/knowledge APIs |
| `/admin/live-chat` | Admin or superadmin | `/api/support/admin/sessions`; authenticated stream/proxies |
| `/admin/activity` | Admin or superadmin | `/api/admin/activity` and announcement endpoint |
| `/logout` | Local session cleanup; upstream revoke when logged in | `/api/auth/logout` |

This is Express/EJS, not React or an SPA: there is no auth context/provider,
React Router, `ProtectedRoute`, `PrivateRoute`, `AdminRoute`, `AuthGuard`,
`RoleGuard`, `router.push` or client-side route registration. Authentication is
`loadUser` → `req.user`/`res.locals.currentUser` → shared route middleware. The
12 original routers, template tree, public scripts, redirects, form actions,
links, session store, i18n, aliases and Vercel configuration were audited. No
linked account/settings component was found requiring `/account`, `/settings`
or `/user` root routes; these were not gratuitously registered.

## 6. Exact files changed

### Runtime/frontend files

- `server.js`
- `src/api.js`
- `src/i18n.js`
- `src/middleware/auth.js`
- `src/middleware/cookieStore.js`
- `src/routes/admin.js`
- `src/routes/auth.js`
- `src/routes/dashboard.js`
- `src/routes/donors.js`
- `src/routes/messages.js`
- `src/routes/profile.js` **(new)**
- `src/routes/reviews.js`
- `src/routes/shop.js`
- `views/admin/_sidebar.ejs`
- `views/admin/dashboard.ejs`
- `views/admin/unavailable.ejs` **(new)**
- `views/dashboard/_sidebar.ejs`
- `views/dashboard/home.ejs`
- `views/dashboard/security.ejs`
- `views/edit_profile.ejs`
- `views/my_profile.ejs`
- `views/partials/header.ejs`

### Tests, build validation and documentation

- `package.json`
- `package-lock.json`
- `playwright.config.js` **(new)**
- `e2e/account.spec.js` **(new)**
- `e2e/assets.js` **(new)**
- `e2e/fixture-api.mjs` **(new)**
- `test/account.test.mjs` **(new)**
- `scripts/build.mjs` **(new)**
- `README.md`
- `docs/frontend-account-audit.md` **(this new report)**

`vercel.json`, backend code and the custom 404 design are unchanged. Browser
binaries, downloaded audit references, logs, screenshots and traces are not
committed; workspace test artifacts are under ignored `.tmp/`.

## 7. Exact routes added/fixed

**Added:**

- `GET /profile` — protected, renders the existing self-profile view.
- `GET /profile/edit` — protected canonical edit view (was a legacy redirect).
- `POST /profile/edit` — protected multipart profile update.
- `GET /admin/dashboard` — protected compatibility redirect to `/admin`.
- `POST /logout` — account menu/sidebar logout; legacy GET still works.

**Corrected/reconnected:**

- `/dashboard` and its account links, activity failure handling and logout.
- `/admin` overview error handling and role access.
- `/login` and `/register` role-specific redirects and session persistence.
- `/profile/my`, `/donors/profile/my`, `/donors/profile/edit` — canonical links;
  legacy multipart POST uses a method-preserving 307 to `/profile/edit`.
- All existing `requireAdmin` consumers, including shop, messaging, AI and
  support prefixes, receive the corrected guard.
- `/support/admin/stream` now sends the token to the existing backend stream.
- Messages, reviews and admin-shop failures are explicit instead of hidden
  redirects/empty success states where corrected in this change.

## 8. Authentication redirect logic

Validated API account + token → normal user `/dashboard`, admin/superadmin
`/admin`. Logged-in visits to Login/Register also use the role-specific hub.
Arbitrary `next` URLs are no longer accepted, so login cannot land on a missing
page, logout URL or another role's destination.

The frontend recognizes Vercel's HTTPS terminator so Secure session-ID cookies
are issued. The session store re-enters each response's request context when
persisting, including multipart registration callbacks. Logout calls the
existing revoke endpoint and clears the local authenticated session even if
revocation is temporarily unavailable. A subsequent public page may create a
new anonymous language/cart session; it contains no auth token/user cache.

## 9. Role protection

- Only explicit server-returned `is_admin`/`is_super_admin` flags grant admin
  entry. Boolean, numeric and `"1"` flags are normalized; `"0"` is not truthy
  admin access. The donation role does not grant privileges.
- Superadmin implies admin for frontend access and navbar rendering.
- `/api/auth/me` is revalidated on every request, not a 20-second cached role.
- Anonymous protected requests → Login; normal users on admin routes → the
  existing styled **403**. Guards apply to the route, not only the navbar.
- Revoked/expired tokens clear local auth; temporary `/me` failures preserve the
  token but do not grant access and return an unavailable response.
- Existing backend authorization remains authoritative for CRUD and
  superadmin-only operations. No frontend auth bypass or JWT signing was added.
- Account responses are not cached; browser history/refresh rechecks auth.

## 10. Vercel routing

**No rewrite change was needed.** `vercel.json` already routes all paths to
`server.js` and includes `views/**`, `public/**`, `src/**`. This is a server-rendered
frontend, so adding an SPA `index.html` fallback would be incorrect. The needed
Vercel-related correction was Express HTTPS proxy recognition, not backend
routing or a rewrite.

## 11. Missing backend API dependencies

**No new backend endpoint is required for the implemented pages.** Read-only
contract inspection confirms the existing auth, profile, orders, requests,
messages and admin APIs used here. In particular, `PUT /api/users/me` exists in
the backend repository, with the multipart fields used by this frontend.

That is contract verification, not proof that a particular deployment/version
has every endpoint. A missing deployed profile endpoint is reported explicitly
as `PUT /api/users/me`; it is never treated as a saved profile. Full donation
history is not implemented because no donation-history collection was identified
in the inspected account contract; only supported last-donation/availability
fields are displayed. No booking feature was found or invented. Notifications
in this hub use the existing unread inbox messages.

## 12. Production build result

**Passed:** `npm run build` validates 21 frontend JavaScript modules, compiles all
59 EJS templates and checks the exported Vercel handler/packaging rules. EJS is
rendered at runtime: there is no SPA bundle. The actual frontend was additionally
run with `NODE_ENV=production` during the browser tests, with Secure cookies and
an emulated HTTPS terminator.

**Passed:** `npm test` — **64/64 tests**. `git diff --check` passed.

A Vercel cloud build/deployment was not triggered. Dependencies still report the
repository's two moderate npm advisories; unrelated dependency migrations were
not performed in this routing repair.

## 13. Browser verification result and limits

**Final Chromium suite: 13/13 tests passed (approximately 3.3 minutes).**

The tests use the actual frontend HTTP server, EJS rendering, browser forms,
redirects, cookies, guards, API forwarding and navigation. An explicitly isolated
loopback **contract-fixture API** supplies controlled user/admin/superadmin and
failure cases; it is not imported by application code. Fixture profile writes
verify forwarding and subsequent frontend reads, **not real database persistence**.

| Check | Local Chromium result |
|---|---|
| `/dashboard`, `/profile`, `/profile/edit` render after login, without 404 | Passed |
| `/admin` renders for admin and superadmin; compatibility alias works | Passed |
| Normal users cannot access admin paths/POST actions across prefixes | Passed |
| Login and registration reach the correct registered account route | Passed |
| Authenticated navbar replaces Login/Register; account menu opens | Passed |
| Profile shows API-supplied identity; edit submits `PUT /api/users/me` | Passed against fixture API |
| Failed/missing/malformed profile updates never show success | Passed |
| Empty dashboard sections vs unavailable API sections are distinct | Passed |
| Admin dashboard failure stays on the dashboard with retry | Passed |
| Role demotion and revoked tokens take effect on the next request | Passed |
| Logout removes authenticated state; Back cannot restore access | Passed |
| Direct URLs, reload, new tabs, Back/Forward navigation | Passed |
| Bengali/English dashboard, profile, edit and admin hub | Passed |
| 375px mobile, 768px tablet, 1024px laptop, 1440px desktop | Passed; no document horizontal overflow |
| Existing admin-sidebar section destinations render | Passed for admin and superadmin |
| Healthy dashboard/admin navigation: JS exceptions and console errors | None in monitored flows |
| Bounded stalled API and explicit failure state | Passed; 8-second request budget |
| Custom unknown-route 404 design still renders | Passed |

Screenshots of the canonical desktop/mobile pages were also opened and visually
inspected. Browser tests detected and drove fixes for registration session loss,
admin SSE 401, mobile sidebar layout and mobile account-menu scrolling.

### What is **not** verified/completed

- No live normal-user/admin session or test deployment URL was supplied during
  this turn. Direct sandbox TLS access to the linked Vercel domains failed;
  external page-fetch observations are not a substitute for live browser tests.
- **Production authenticated access and real profile persistence remain open.**
  This branch has not been deployed or pushed. The historical production
  `/dashboard` and `/admin` 404s remain unconfirmed on the exact affected URL.
- Real admin CRUD, email delivery, payment actions, photo storage and production
  notifications were not exercised against live data.
- The canonical account screens/admin hub and new labels use existing i18n.
  Specialized pre-existing admin modules (for example AI, SMTP and branding)
  still contain some English-only explanatory/configuration copy; this work does
  not claim a complete retranslation of those legacy modules.
- Network-restricted browser tests used local copies of the existing
  Bootstrap 5.3.3, Font Awesome 6.5.2 and matching main en/bn font families.
  Test branding/avatar assets were local. Production CDN availability, exact
  remote logo rendering and native browser control language were not verified.
- Expected 400/403/404/503/timeout responses were deliberately exercised in
  negative tests. Their server logs are expected failures, not a claim of zero
  network errors under outage conditions.

### Repeat verification

```sh
npm ci
npm run build
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

On a restricted runner, set `BLOODORA_OFFLINE_ASSETS=1` and optionally
`BROWSER_EXECUTABLE=/path/to/chromium`. The test harness starts both loopback
servers and stops them afterward. Browser artifacts go to `.tmp/`; no test
server, fake account or fixture data is deployed with the application.

**Next production gate:** deploy this frontend branch, provide the exact affected
frontend URL, then test normal-user and admin login in the deployment's browser
UI without sharing passwords/tokens in chat. Confirm real profile persistence,
refresh/new-tab access and admin authorization there before calling the
production issue fixed.
