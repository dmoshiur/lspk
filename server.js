// ==================== BloodOra - FRONTEND (presentation layer) ====================
// This is the frontend half of the split deployment. It keeps NO database.
// All data comes from the separated Backend API, whose URL is configured via
// the BACKEND_URL environment variable (set on Vercel for this project).
// The backend sets the matching FRONTEND_URL variable for CORS.
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";

import { loadUser } from "./src/middleware/auth.js";
import { BACKEND_URL } from "./src/api.js";

import authRoutes from "./src/routes/auth.js";
import pageRoutes from "./src/routes/pages.js";
import donorRoutes from "./src/routes/donors.js";
import bloodRoutes from "./src/routes/blood.js";
import shopRoutes from "./src/routes/shop.js";
import adminRoutes from "./src/routes/admin.js";
import messageRoutes from "./src/routes/messages.js";
import reviewRoutes from "./src/routes/reviews.js";
import supportRoutes from "./src/routes/support.js";
import aiRoutes from "./src/routes/ai.js";

import { siteContext } from "./src/middleware/site.js";
import { DEFAULT_LANG } from "./src/i18n.js";
import { CookieSessionStore, sessionContext } from "./src/middleware/cookieStore.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// ---------- View Engine ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---------- Security & Logging ----------
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(morgan(isProd ? "combined" : "dev"));

// ---------- Body & Static ----------
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
// Legacy /public/<file> URLs keep working (they map to the same folder).
app.use("/public", express.static(path.join(__dirname, "public")));

// ---------- Session ----------
// Vercel serverless functions are short-lived and not shared, so the session is
// kept in a signed cookie instead of the in-memory default store. That removes
// the "MemoryStore is not designed for a production environment" warning and
// keeps users logged in across invocations.
const SESSION_SECRET = process.env.SESSION_SECRET || "blood-donation-secret-key-2026";
if (isProd && !process.env.SESSION_SECRET) {
  console.warn("⚠️  SESSION_SECRET is not set — using the built-in fallback. Set it in Vercel.");
}

// Must run before session(): it gives the store access to the current req/res.
app.use(sessionContext);

app.use(session({
  store: new CookieSessionStore({ secret: SESSION_SECRET, secure: isProd }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ---------- Global locals ----------
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.backendUrl = BACKEND_URL; // available to views if ever needed
  // Cart count for navbar
  const cart = req.session.cart || {};
  res.locals.sessionCartCount = Object.keys(cart).length;
  res.locals.cartCount = res.locals.sessionCartCount;
  // Flash handling
  if (req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  } else {
    res.locals.flash = null;
  }
  next();
});

// Language + site identity (branding) — must run before loadUser so every
// handler and view has `t()`, `lang`, `dir` and `branding` available.
app.use(siteContext);

// Load current user from the backend API (JWT kept in session)
app.use(loadUser);

// ---------- Uploaded images: proxy to the backend ----------
// Views reference /uploads/<file>; the files live on the backend host.
app.get("/uploads/:file", async (req, res) => {
  try {
    const r = await fetch(`${BACKEND_URL}/uploads/${encodeURIComponent(req.params.file)}`);
    if (!r.ok) return res.status(r.status).send("Not found");
    res.set("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=3600");
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    console.error("Upload proxy error:", e.message);
    res.status(502).send("Upload proxy error");
  }
});

// ---------- Routes ----------
app.use("/", pageRoutes);
app.use("/", authRoutes);
app.use("/donors", donorRoutes);
app.use("/", bloodRoutes); // /request-blood, /blood-requests, /blood-request/:id, /urgent
app.use("/shop", shopRoutes);
app.use("/admin", adminRoutes);
app.use("/messages", messageRoutes);
app.use("/reviews", reviewRoutes);
app.use("/support", supportRoutes);   // Live Messaging (human support)
app.use("/ai-help", aiRoutes);        // Live AI Help (Groq / Qwen3.6 27B)

// Aliases for compatibility with old URL names
app.get("/profile/switch-back", (req, res) => res.redirect("/admin/profile/switch-back"));
app.get("/my-orders", (req, res) => res.redirect("/shop/my-orders"));
app.get("/my_orders", (req, res) => res.redirect("/shop/my-orders"));
// Old Flask shop admin paths → new shop admin
app.get("/admin/shop/products", (req, res) => res.redirect("/shop/admin/products"));
app.get("/admin/shop/product/add", (req, res) => res.redirect("/shop/admin/product/add"));
app.get("/admin/shop/product/edit/:id", (req, res) => res.redirect(`/shop/admin/product/edit/${req.params.id}`));
app.post("/admin/shop/product/delete/:id", (req, res) => res.redirect(307, `/shop/admin/product/delete/${req.params.id}`));
app.get("/admin/shop/orders", (req, res) => res.redirect("/shop/admin/orders"));
app.get("/admin/shop/order/:id", (req, res) => res.redirect(`/shop/admin/order/${req.params.id}`));
app.get("/admin/shop/order/:id/invoice", (req, res) => res.redirect(`/shop/admin/order/${req.params.id}/invoice`));
app.post("/admin/shop/order/:id/confirm-payment", (req, res) => res.redirect(307, `/shop/admin/order/${req.params.id}/confirm-payment`));
app.post("/admin/shop/order/:id/update-status", (req, res) => res.redirect(307, `/shop/admin/order/${req.params.id}/update-status`));
// Old Flask donor/profile root aliases
app.get("/profile/view/:id", (req, res) => res.redirect(`/donors/profile/view/${req.params.id}`));
app.get("/profile/my", (req, res) => res.redirect("/donors/profile/my"));
app.get("/profile/edit", (req, res) => res.redirect("/donors/profile/edit"));
app.post("/toggle_status", (req, res) => res.redirect(307, "/donors/toggle_status"));
app.post("/apply-for-verification", (req, res) => res.redirect(307, "/donors/apply-for-verification"));
// Old Flask admin messages → new
app.get("/admin/messages", (req, res) => res.redirect("/messages/admin/messages"));
app.get("/admin/message/reply/:id", (req, res) => res.redirect(`/messages/admin/message/reply/${req.params.id}`));

// ---------- Custom error pages: 400 / 403 / 404 / 500 ----------
// `renderError` always answers with the right status code and a real page.
// If rendering itself fails (template error, backend down) it degrades to a
// minimal self-contained HTML page rather than an Express stack trace.
function renderError(req, res, status, view, extra = {}) {
  const titles = { 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Server Error" };
  res.status(status);
  res.render(view, {
    title: `${status} ${titles[status] || ""} - ${res.locals.siteName || "BloodOra"}`,
    requestPath: req.originalUrl,
    ...extra,
  }, (err, html) => {
    if (err) {
      console.error(`renderError(${status}) failed:`, err.message);
      if (!res.headersSent) {
        res.set("Content-Type", "text/html; charset=utf-8").send(
          `<!doctype html><html><head><meta charset="utf-8"><title>${status}</title>` +
          `<style>body{font-family:Georgia,serif;background:#0f172a;color:#e2e8f0;display:flex;` +
          `align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}` +
          `h1{font-size:5rem;margin:0;color:#e31b23}a{color:#fda4af}</style></head>` +
          `<body><div><h1>${status}</h1><p>${titles[status] || "Error"}</p>` +
          `<p><a href="/">Go to home</a></p></div></body></html>`
        );
      }
    } else {
      res.send(html);
    }
  });
}
app.locals.renderError = renderError;

/** Throw an HttpError with a status so any handler can trigger an error page. */
export function httpError(status, message) {
  const e = new Error(message || `HTTP ${status}`);
  e.status = status;
  return e;
}

app.use((req, res) => {
  renderError(req, res, 404, "404");
});

app.use((err, req, res, next) => {
  const status =
    err.status || err.statusCode ||
    (err.type === "entity.parse.failed" ? 400 : 0) ||
    (err.type === "entity.too.large" ? 400 : 0) ||
    (err.code === "LIMIT_FILE_SIZE" ? 400 : 0) ||
    500;
  if (status >= 500) console.error("Unhandled error:", err);

  // API-style clients get JSON, browsers get the styled error page.
  if ((req.headers.accept || "").includes("application/json") || req.xhr) {
    return res.status(status).json({ success: false, message: err.message || "Error" });
  }

  const views = { 400: "400", 403: "403", 404: "404", 500: "500" };
  const view = views[status] || "500";
  const detail = status >= 500 ? (process.env.NODE_ENV === "production" ? "" : err.message) : err.message;
  renderError(req, res, status, view, { detail });
});

// ==================== Entrypoints ====================

/**
 * Vercel serverless handler.
 *
 * @vercel/node imports this file and requires the module's DEFAULT export to be
 * a request handler function or an http.Server. Without it the platform fails
 * every request with:
 *   "Invalid export found in module /var/task/server.js.
 *    The default export must be a function or server."
 * A named export alone (or an exported Express app under another name) is not
 * enough — it has to be `export default`.
 */
export default function handler(req, res) {
  return app(req, res);
}

/** Exported for tests / composition; the platform uses the default export above. */
export { app };

// ---------- Local development server ----------
// Only listen when this file is executed directly (`node server.js`). On Vercel
// the platform owns the socket, and calling listen() inside a serverless
// function just pins the instance and logs a misleading URL.
const isDirectRun =
  !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (!process.env.VERCEL && isDirectRun) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🩸 BloodOra v3.0 — FRONTEND (presentation layer)`);
    console.log(`   URL: http://localhost:${PORT}`);
    console.log(`   Backend API: ${BACKEND_URL}${process.env.BACKEND_URL ? "" : "  ⚠️ (BACKEND_URL not set — using local default)"}\n`);
  });
}
