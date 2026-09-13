// ==================== Frontend Routes - Donors / Profiles (API-backed) ====================
import express from "express";
import multer from "multer";
import { apiGet, apiPost, apiPutForm, buildFormData } from "../api.js";
import { requireLogin, invalidateUserCache } from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// List donors
router.get("/", async (req, res) => {
  try {
    const d = await apiGet("/api/donors", null, {
      bg: req.query.bg, dist: req.query.dist, upa: req.query.upa, age_min: req.query.age_min,
    });
    res.render("donors", { title: `${req.t("don_title")} - ${res.locals.siteName}`, users: d.users, query: req.query });
  } catch (e) {
    console.error(e.message);
    res.render("donors", { title: `${req.t("don_title")} - ${res.locals.siteName}`, users: [], query: {} });
  }
});

// View profile
router.get("/profile/view/:id", async (req, res) => {
  try {
    const d = await apiGet(`/api/users/${req.params.id}`);
    res.render("profile_view", { title: d.user.name + " - Profile", user: d.user });
  } catch (e) {
    return res.status(404).render("404", { title: `${req.t("page_not_found")} - ${res.locals.siteName}` });
  }
});

// My profile
router.get("/profile/my", requireLogin, async (req, res) => {
  res.render("my_profile", { title: `${req.t("prof_title")} - ${res.locals.siteName}`, user: req.user });
});

// Edit profile
router.get("/profile/edit", requireLogin, async (req, res) => {
  res.render("edit_profile", { title: `${req.t("prof_edit")} - ${res.locals.siteName}`, user: req.user });
});

router.post("/profile/edit", requireLogin, upload.single("profile_pic"), async (req, res) => {
  try {
    const b = req.body;
    const fd = buildFormData(
      { name: b.name, phone: b.phone, holding: b.holding, birth_certificate: b.birth_certificate, date_of_birth: b.date_of_birth },
      req.file,
      "profile_pic"
    );
    const d = await apiPutForm("/api/users/me", fd, req.session.token);
    req.session.userCache = { user: d.user, at: Date.now() };
    req.session.flash = { type: "success", message: "✅ Profile updated successfully!" };
    res.redirect("/donors/profile/my");
  } catch (e) {
    console.error(e.message);
    req.session.flash = { type: "danger", message: e.message || "❌ Update failed." };
    res.redirect("/donors/profile/edit");
  }
});

// Toggle donation status
router.post("/toggle_status", requireLogin, async (req, res) => {
  try {
    const d = await apiPost("/api/users/me/toggle-status", {}, req.session.token);
    invalidateUserCache(req);
    req.session.flash = { type: "success", message: d.message };
  } catch (e) {
    req.session.flash = { type: "danger", message: "❌ Status update failed." };
  }
  res.redirect(req.get("Referer") || "/donors/profile/my");
});

router.post("/apply-for-verification", requireLogin, async (req, res) => {
  try {
    const d = await apiPost("/api/users/me/apply-verification", {}, req.session.token);
    req.session.flash = { type: d.type || "info", message: d.message };
    return res.redirect("/donors/profile/my");
  } catch (e) {
    req.session.flash = { type: e.type || "warning", message: e.message || "⚠️ You must be 18+ to apply." };
    return res.redirect("/donors/profile/edit");
  }
});

export default router;
