// ==================== Frontend Routes - Public Pages (API-backed) ====================
// Every reference page has a hard fallback: if the backend cannot be reached the
// page still renders the complete built-in content instead of an empty state.
// That fallback content lives in this repo (../utils/content.js) so the frontend
// never reaches into the backend's source tree.
import express from "express";
import { apiGet, proxyEventStream } from "../api.js";
import { SUPPORTED } from "../i18n.js";
import { writeCookie } from "../middleware/site.js";
import {
  antidReference,
  compatibilityReference,
  resourcesReference,
  siteRoutes,
} from "../utils/content.js";

const router = express.Router();

// ------------------------------------------------------------------ Homepage
router.get("/", async (req, res) => {
  try {
    const d = await apiGet("/api/meta/home");
    res.render("home", {
      title: `${res.locals.siteName} - Blood Donation Network`,
      settings: d.settings, notice: d.notice,
      total_donors: d.total_donors, urgent_requests: d.urgent_requests,
      recent_donors: d.recent_donors, recent_requests: d.recent_requests,
    });
  } catch (e) {
    console.error("home:", e.message);
    res.render("home", {
      title: res.locals.siteName,
      settings: res.locals.branding, notice: null,
      total_donors: 0, urgent_requests: 0, recent_donors: [], recent_requests: [],
    });
  }
});

// ------------------------------------------------------- Language switching
// GET /set-language/:code?next=/path — sets the cookie + session and returns.
router.get("/set-language/:code", (req, res) => {
  const code = String(req.params.code || "").toLowerCase();
  if (!SUPPORTED.includes(code)) {
    return res.status(400).render("400", { title: "Unsupported language", hint: `Supported languages: ${SUPPORTED.join(", ")}.` });
  }
  if (req.session) req.session.lang = code;
  writeCookie(res, "lang", code);
  let next = String(req.query.next || "/");
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";   // no open redirects
  res.redirect(next);
});

// ----------------------------------------------------------- Compatibility
router.get("/compatibility", async (req, res) => {
  const title = `${req.t('nav_compatibility')} - ${res.locals.siteName}`;
  try {
    const d = await apiGet("/api/meta/compatibility");
    // Shape guard: a reference without the rbc matrix cannot render — use the
    // bundled fallback rather than crashing.
    const r = d && d.reference;
    const ok = r && ["rbc", "plasma", "platelets", "components", "facts", "emergencies"].every((k) => Array.isArray(r[k]));
    res.render("compatibility", { title, reference: ok ? d.reference : compatibilityReference, loadError: !ok });
  } catch (e) {
    res.render("compatibility", { title, reference: compatibilityReference, loadError: true });
  }
});

// ------------------------------------------------------------------- Anti-D
router.get("/antid", async (req, res) => {
  const title = `${req.t('nav_antid')} - ${res.locals.siteName}`;
  try {
    const d = await apiGet("/api/meta/antid");
    // Shape guard: the view needs summary/indications/dosing/faq arrays —
    // fall back to the bundled reference when the payload is incomplete.
    const r = d && d.reference;
    const ok = r && r.summary &&
      ["whatItIs", "indications", "dosing", "timing", "administration", "faq", "sources"].every((k) => Array.isArray(r[k])) &&
      r.safety && ["common", "rare", "contraindications", "storage"].every((k) => Array.isArray(r.safety[k]));
    res.render("antid", {
      title,
      reference: ok ? r : antidReference,
      antid_info: d.antid_info || [],
      entries: d.entries || [],
      loadError: !ok,
    });
  } catch (e) {
    // Never show an empty Anti-D page: fall back to the built-in reference.
    res.render("antid", { title, reference: antidReference, antid_info: [], entries: [], loadError: true });
  }
});

// ---------------------------------------------------------------- Resources
router.get("/resources", async (req, res) => {
  const title = `${req.t('nav_education')} - ${res.locals.siteName}`;
  const query = { category: req.query.category, q: req.query.q };
  try {
    const d = await apiGet("/api/meta/resources", null, query);
    res.render("resources", { title, resources: d.resources, categories: d.categories, query, loadError: false });
  } catch (e) {
    const cat = req.query.category;
    const resources = resourcesReference
      .filter((r) => !cat || r.category === cat)
      .map((r, i) => ({ id: `base-${i}`, title: r.title, category: r.category, content: r.content, summary: r.summary, read_time: r.readTime, is_featured: i < 4, source: "core" }));
    res.render("resources", { title, resources, categories: [...new Set(resourcesReference.map((r) => r.category))], query, loadError: true });
  }
});

// ------------------------------------------------------------ Settings pages
async function settingsPage(req, res, view, title) {
  let settings = res.locals.branding;
  try { settings = (await apiGet("/api/meta/settings")).settings; } catch (e) { /* keep branding */ }
  res.render(view, { title, settings });
}

router.get("/donation-guidelines", (req, res) => settingsPage(req, res, "donation_guidelines", `${req.t('nav_guidelines')} - ${res.locals.siteName}`));
router.get("/faq", (req, res) => settingsPage(req, res, "faq", `${req.t('nav_faq')} - ${res.locals.siteName}`));
router.get("/contact", (req, res) => settingsPage(req, res, "contact", `${req.t('nav_contact')} - ${res.locals.siteName}`));

// --------------------------------------------------------- Browser JSON APIs
// Proxied so the browser only ever talks to this origin.

router.get("/api/activity", async (req, res) => {
  try {
    const d = await apiGet("/api/meta/activity", null, { limit: req.query.limit });
    res.json({ success: true, events: d.events, serverTime: d.serverTime });
  } catch (e) {
    res.status(502).json({ success: false, events: [], message: e.message });
  }
});

router.get("/api/activity/stream", (req, res) => proxyEventStream(req, res, "/api/meta/activity/stream"));

router.get("/api/reviews", async (req, res) => {
  try {
    const d = await apiGet("/api/meta/reviews", null, {
      kind: req.query.kind, product_id: req.query.product_id, rating: req.query.rating,
    });
    const all = d.reviews || [];
    const limit = parseInt(req.query.limit || "0", 10);
    res.json({ success: true, reviews: limit ? all.slice(0, limit) : all, summary: d.summary });
  } catch (e) {
    res.json({ success: false, reviews: [], summary: { count: 0, average: 0, breakdown: {} } });
  }
});

router.get("/api/routes", async (req, res) => {
  try { res.json(await apiGet("/api/meta/routes")); }
  catch (e) { res.json({ success: true, routes: siteRoutes }); }
});

// -------------------------------------------------------------- Health / SEO
router.get("/health", async (req, res) => {
  try { res.json(await apiGet("/api/health")); }
  catch (e) { res.status(500).json({ status: "unhealthy", error: e.message }); }
});

// ------------------------------------------------- notifications (real only)
// JSON for the navbar bell: the ONLY real notification source the backend has
// today is the unread inbox count from /api/messages. No fake feeds.
router.get("/api/notifications/unread", async (req, res) => {
  if (!req.user) return res.json({ success: true, unread: 0 });
  try {
    const d = await apiGet("/api/messages", req.session.token);
    res.json({ success: true, unread: d.unread_count || 0 });
  } catch (e) {
    res.json({ success: false, unread: 0 });
  }
});

// Chat identity endpoint (used by the live chat widget)
router.get("/api/chat/auth", (req, res) => {
  if (req.user) {
    return res.json({ uid: String(req.user.id), name: req.user.name, image: req.user.image_file || "default.jpg", is_admin: !!req.user.is_admin });
  }
  res.json({ uid: "guest_" + (req.ip || "").replace(/\./g, ""), name: "Guest User", image: "default.jpg", is_admin: false });
});

router.get("/sitemap.xml", (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  const paths = [
    ["", "1.0", "daily"], ["/donors", "0.9", "daily"], ["/blood-requests", "0.9", "daily"],
    ["/request-blood", "0.8", "weekly"], ["/shop", "0.9", "daily"], ["/reviews", "0.7", "weekly"],
    ["/compatibility", "0.7", "monthly"], ["/antid", "0.7", "monthly"], ["/resources", "0.7", "weekly"],
    ["/donation-guidelines", "0.6", "monthly"], ["/faq", "0.6", "monthly"], ["/contact", "0.5", "yearly"],
    ["/login", "0.4", "yearly"], ["/register", "0.4", "yearly"],
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map(([p, pr, ch]) => `  <url><loc>${host}${p}</loc><priority>${pr}</priority><changefreq>${ch}</changefreq></url>`).join("\n")}
</urlset>`;
  res.type("application/xml").send(xml);
});

router.get("/robots.txt", (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /shop/admin\nDisallow: /set-language\nSitemap: ${host}/sitemap.xml\n`);
});

export default router;
