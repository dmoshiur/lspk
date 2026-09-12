// ==================== Frontend Routes - Public Pages (API-backed) ====================
import express from "express";
import { apiGet } from "../api.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const d = await apiGet("/api/meta/home");
    res.render("home", {
      title: "BloodOra - Blood Donation Network",
      settings: d.settings, notice: d.notice,
      total_donors: d.total_donors, urgent_requests: d.urgent_requests,
      recent_donors: d.recent_donors, recent_requests: d.recent_requests,
    });
  } catch (e) {
    console.error(e.message);
    res.render("home", { title: "BloodOra", settings: null, notice: null, total_donors: 0, urgent_requests: 0, recent_donors: [], recent_requests: [] });
  }
});

router.get("/compatibility", (req, res) => res.render("compatibility", { title: "Blood Compatibility - BloodOra" }));

router.get("/antid", async (req, res) => {
  try {
    const d = await apiGet("/api/meta/antid");
    res.render("antid", { title: "Anti-D Info - BloodOra", antid_info: d.antid_info });
  } catch (e) {
    res.render("antid", { title: "Anti-D Info - BloodOra", antid_info: [] });
  }
});

router.get("/resources", async (req, res) => {
  try {
    const d = await apiGet("/api/meta/resources", null, { category: req.query.category });
    res.render("resources", { title: "Resources - BloodOra", resources: d.resources, query: req.query });
  } catch (e) {
    res.render("resources", { title: "Resources - BloodOra", resources: [], query: req.query });
  }
});

async function settingsPage(res, view, title) {
  let settings = null;
  try {
    settings = (await apiGet("/api/meta/settings")).settings;
  } catch (e) { /* render with fallbacks */ }
  res.render(view, { title, settings });
}

router.get("/donation-guidelines", (req, res) => settingsPage(res, "donation_guidelines", "Donation Guidelines - BloodOra"));
router.get("/faq", (req, res) => settingsPage(res, "faq", "FAQ - BloodOra"));
router.get("/contact", (req, res) => settingsPage(res, "contact", "Contact - BloodOra"));

// Health check — proxies the backend health endpoint
router.get("/health", async (req, res) => {
  try {
    const d = await apiGet("/api/health");
    res.json(d);
  } catch (e) {
    res.status(500).json({ status: "unhealthy", error: e.message });
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
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://bloodora.site/</loc><priority>1.0</priority></url><url><loc>https://bloodora.site/donors</loc><priority>0.8</priority></url><url><loc>https://bloodora.site/blood-requests</loc><priority>0.8</priority></url><url><loc>https://bloodora.site/request-blood</loc><priority>0.8</priority></url><url><loc>https://bloodora.site/shop</loc><priority>0.8</priority></url></urlset>`;
  res.type("application/xml").send(xml);
});
router.get("/robots.txt", (req, res) => { res.type("text/plain").send("User-agent: *\nAllow: /\nSitemap: https://bloodora.site/sitemap.xml"); });

export default router;
