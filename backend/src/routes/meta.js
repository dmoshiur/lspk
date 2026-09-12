// ==================== BloodOra Backend API - Public Meta / Content ====================
// Every reference page here merges the admin-managed database rows ON TOP of the
// canonical content in src/content.js, so a page can never render empty because
// the database is fresh, empty or still seeding.
import express from "express";
import { get, all } from "../db.js";
import { optionalAuth } from "../auth.js";
import { divisions, districts, bangladeshData } from "../locations.js";
import { tryCatch } from "../utils.js";
import { antidReference, compatibilityReference, resourcesReference, siteRoutes } from "../content.js";
import { getRecentActivity, subscribe, kindMeta } from "../activity.js";

const router = express.Router();

// GET /api/health
router.get("/health", async (req, res) => {
  try {
    await get("SELECT 1 as ok");
    res.json({ status: "healthy", database: "connected", service: "bloodora-backend", time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: "unhealthy", error: e.message });
  }
});

/** Public site settings — branding and contact only, never SMTP/AI secrets. */
function publicSettings(s) {
  if (!s) return null;
  return {
    id: s.id,
    site_name: s.site_name,
    site_tagline: s.site_tagline,
    site_email: s.site_email,
    site_phone: s.site_phone,
    site_address: s.site_address,
    site_description: s.site_description,
    facebook_url: s.facebook_url,
    twitter_url: s.twitter_url,
    instagram_url: s.instagram_url,
    linkedin_url: s.linkedin_url,
    logo_file: s.logo_file,
    favicon_file: s.favicon_file,
    brand_primary: s.brand_primary,
    brand_accent: s.brand_accent,
    brand_font_style: s.brand_font_style,
    default_language: s.default_language,
    bkash_merchant_number: s.bkash_merchant_number,
    nagad_merchant_number: s.nagad_merchant_number,
    upay_merchant_number: s.upay_merchant_number,
    rocket_merchant_number: s.rocket_merchant_number,
    pathao_merchant_number: s.pathao_merchant_number,
    ai_enabled: !!s.ai_enabled,
    ai_model: s.ai_model,
    ai_persona: s.ai_persona,
    live_chat_enabled: !!s.live_chat_enabled,
    live_activity_enabled: !!s.live_activity_enabled,
  };
}

// GET /api/meta/settings — public site settings (footer, contact page, guidelines, faq)
router.get("/settings", (req, res) =>
  tryCatch(res, async () => {
    const settings = await get("SELECT * FROM site_settings LIMIT 1");
    res.json({ success: true, settings: publicSettings(settings) });
  })
);

// GET /api/meta/locations — Bangladesh divisions/districts/upazilas for cascading dropdowns
router.get("/locations", (req, res) => {
  res.json({ success: true, divisions, districts, bangladeshData });
});

// GET /api/meta/routes — the site's route map (used by the AI Help and the footer)
router.get("/routes", (req, res) => res.json({ success: true, routes: siteRoutes }));

// GET /api/meta/home — everything the homepage needs in one call
router.get("/home", (req, res) =>
  tryCatch(res, async () => {
    const settings = await get("SELECT * FROM site_settings LIMIT 1");
    const notice = await get("SELECT * FROM site_notice WHERE active=1 LIMIT 1");
    const total_donors_row = await get("SELECT COUNT(*) as c FROM users WHERE can_donate=1 AND is_verified=1");
    const urgent_row = await get("SELECT COUNT(*) as c FROM blood_requests WHERE is_urgent=1 AND is_fulfilled=0");
    const recent_donors = await all("SELECT * FROM users WHERE can_donate=1 AND is_verified=1 ORDER BY created_at DESC LIMIT 6");
    const recent_requests = await all("SELECT * FROM blood_requests WHERE is_fulfilled=0 ORDER BY is_urgent DESC, needed_by ASC LIMIT 5");
    res.json({
      success: true,
      settings: publicSettings(settings),
      notice: notice || null,
      total_donors: total_donors_row.c,
      urgent_requests: urgent_row.c,
      recent_donors,
      recent_requests,
    });
  })
);

// ------------------------------------------------------------------ Activity

// GET /api/meta/activity — the real live activity feed (polling layer)
router.get("/activity", (req, res) =>
  tryCatch(res, async () => {
    const limit = Math.min(parseInt(req.query.limit || "12", 10) || 12, 40);
    const events = await getRecentActivity(limit);
    res.json({ success: true, events, serverTime: new Date().toISOString() });
  })
);

// GET /api/meta/activity/stream — Server-Sent Events (real-time layer)
router.get("/activity/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(`retry: 5000\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, time: new Date().toISOString() })}\n\n`);

  const unsubscribe = subscribe((evt) => {
    try { res.write(`event: activity\ndata: ${JSON.stringify(evt)}\n\n`); } catch (e) { /* closed */ }
  });
  const heartbeat = setInterval(() => { try { res.write(`: ping\n\n`); } catch (e) { /* closed */ } }, 25000);

  req.on("close", () => { clearInterval(heartbeat); unsubscribe(); res.end(); });
});

// ------------------------------------------------------------------- Anti-D

// GET /api/meta/antid — canonical reference + admin-managed entries
router.get("/antid", (req, res) =>
  tryCatch(res, async () => {
    let entries = [];
    try { entries = await all("SELECT * FROM anti_d_info ORDER BY id ASC"); } catch (e) { entries = []; }
    res.json({
      success: true,
      reference: antidReference,
      // Admin rows are exposed both raw (back-compat) and shaped for cards.
      antid_info: entries,
      entries: entries.map((e) => ({
        id: e.id, title: e.title, description: e.description,
        timing: e.timing, dosage: e.dosage, image_file: e.image_file,
      })),
    });
  })
);

// -------------------------------------------------------------- Compatibility

// GET /api/meta/compatibility — the complete compatibility reference
router.get("/compatibility", (req, res) =>
  res.json({ success: true, reference: compatibilityReference })
);

// ------------------------------------------------------------------ Resources

// GET /api/meta/resources?category=&q=  — canonical library + admin rows
router.get("/resources", (req, res) =>
  tryCatch(res, async () => {
    const cat = req.query.category;
    const q = (req.query.q || req.query.search || "").trim().toLowerCase();

    let rows = [];
    try {
      let sql = "SELECT * FROM resources";
      const params = [];
      const clauses = [];
      if (cat) { clauses.push("category=?"); params.push(cat); }
      if (q) { clauses.push("(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
      if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
      sql += " ORDER BY is_featured DESC, created_at DESC";
      rows = await all(sql, params);
    } catch (e) { rows = []; }

    const dbResources = rows.map((r) => ({
      id: r.id, title: r.title, category: r.category, content: r.content,
      summary: r.summary || "", read_time: r.read_time || "", image_file: r.image_file,
      is_featured: !!r.is_featured, created_at: r.created_at, source: "database",
    }));

    // Canonical library, filtered the same way, de-duplicated against DB titles.
    const dbTitles = new Set(dbResources.map((r) => String(r.title).toLowerCase().trim()));
    const base = resourcesReference
      .filter((r) => (!cat || r.category === cat))
      .filter((r) => !q || `${r.title} ${r.summary} ${r.content}`.toLowerCase().includes(q))
      .map((r, i) => ({
        id: `base-${i}`, title: r.title, category: r.category, content: r.content,
        summary: r.summary, read_time: r.readTime, image_file: null,
        is_featured: i < 4, created_at: null, source: "core",
      }))
      .filter((r) => !dbTitles.has(String(r.title).toLowerCase().trim()));

    const resources = [...dbResources, ...base];
    const categories = [...new Set([
      ...resourcesReference.map((r) => r.category),
      ...dbResources.map((r) => r.category).filter(Boolean),
    ])];

    res.json({ success: true, resources, categories, count: resources.length });
  })
);

// -------------------------------------------------------------------- Reviews

// GET /api/meta/reviews — public approved reviews (product reviews + testimonials)
router.get("/reviews", (req, res) =>
  tryCatch(res, async () => {
    const { kind, product_id, rating, featured } = req.query;
    let sql = `SELECT r.*, u.name as user_name, u.image_file as user_image, p.name as product_name
               FROM reviews r
               LEFT JOIN users u ON r.user_id=u.id
               LEFT JOIN products p ON r.product_id=p.id
               WHERE r.status='approved'`;
    const params = [];
    if (kind && kind !== "all") { sql += " AND r.kind=?"; params.push(kind); }
    if (product_id) { sql += " AND r.product_id=?"; params.push(product_id); }
    if (rating) { sql += " AND r.rating=?"; params.push(parseInt(rating, 10)); }
    if (featured === "1") { sql += " AND r.is_featured=1"; }
    sql += " ORDER BY r.is_featured DESC, r.id DESC";
    const reviews = await all(sql, params);

    const summaryRow = await get(
      "SELECT COUNT(*) as c, ROUND(AVG(rating),2) as a FROM reviews WHERE status='approved'"
    );
    const breakdown = {};
    for (let s = 5; s >= 1; s--) {
      const row = await get("SELECT COUNT(*) as c FROM reviews WHERE status='approved' AND rating=?", [s]);
      breakdown[s] = row?.c || 0;
    }
    res.json({
      success: true,
      reviews: reviews.map((r) => ({ ...r, is_featured: !!r.is_featured })),
      summary: { count: summaryRow?.c || 0, average: summaryRow?.a || 0, breakdown },
    });
  })
);

// GET /api/meta/chat-auth — identity for the live chat widget
router.get("/chat-auth", optionalAuth, (req, res) => {
  if (req.user) {
    return res.json({ uid: String(req.user.id), name: req.user.name, image: req.user.image_file || "default.jpg", is_admin: !!req.user.is_admin });
  }
  res.json({ uid: "guest_" + (req.ip || "").replace(/\./g, ""), name: "Guest User", image: "default.jpg", is_admin: false });
});

export default router;
