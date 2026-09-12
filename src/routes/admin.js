// ==================== Frontend Routes - Admin Panel (API-backed) ====================
import express from "express";
import { apiGet, apiPost, apiDel } from "../api.js";
import { requireAdmin, invalidateUserCache } from "../middleware/auth.js";

const router = express.Router();

function flashFrom(req, d, fallback) {
  req.session.flash = { type: d.type || "success", message: d.message || fallback };
}

router.get("/", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet("/api/admin/dashboard", req.session.token);
    res.render("admin/dashboard", {
      title: "Admin Dashboard - BloodOra",
      all_users: d.all_users, stats: d.stats,
      current_notice: d.current_notice, settings: d.settings, now: new Date(),
    });
  } catch (e) {
    console.error(e.message);
    req.session.flash = { type: "danger", message: "❌ Dashboard failed to load." };
    res.redirect("/");
  }
});

router.get("/settings", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet("/api/admin/settings", req.session.token);
    res.render("admin/settings", { title: "Site Settings - Admin", settings: d.settings });
  } catch (e) {
    res.render("admin/settings", { title: "Site Settings - Admin", settings: {} });
  }
});

router.post("/settings", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost("/api/admin/settings", req.body, req.session.token);
    flashFrom(req, d, "✅ Site settings updated successfully!");
    res.redirect("/admin/settings");
  } catch (e) {
    req.session.flash = { type: "danger", message: "❌ Failed to update." };
    res.redirect("/admin/settings");
  }
});

router.post("/verify-donor/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost(`/api/admin/verify-donor/${req.params.id}`, {}, req.session.token);
    flashFrom(req, d);
  } catch (e) {
    req.session.flash = { type: e.type || "warning", message: e.message || "⚠️ Could not verify user." };
  }
  res.redirect("/admin");
});

router.get("/promote/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost(`/api/admin/promote/${req.params.id}`, {}, req.session.token);
    flashFrom(req, d);
  } catch (e) {
    req.session.flash = { type: e.status === 403 ? "warning" : "danger", message: e.message || "⚠️ Only Super Admin can promote." };
  }
  res.redirect("/admin");
});

router.get("/demote/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost(`/api/admin/demote/${req.params.id}`, {}, req.session.token);
    flashFrom(req, d);
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Unauthorized." };
  }
  res.redirect("/admin");
});

router.get("/delete/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiDel(`/api/admin/user/${req.params.id}`, req.session.token);
    flashFrom(req, d);
  } catch (e) {
    req.session.flash = { type: e.type || "danger", message: e.message || "❌ Unauthorized." };
  }
  res.redirect("/admin");
});

router.post("/notice", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost("/api/admin/notice", { notice_content: req.body.notice_content }, req.session.token);
    flashFrom(req, d);
  } catch (e) {
    req.session.flash = { type: e.type || "warning", message: e.message || "⚠️ Notice cannot be empty." };
  }
  res.redirect("/admin");
});

router.get("/notice/clear", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet("/api/admin/notice/clear", req.session.token);
    flashFrom(req, d);
  } catch (e) {
    req.session.flash = { type: "danger", message: "❌ Failed to clear notice." };
  }
  res.redirect("/admin");
});

// Super admin user management
router.post("/user/update/:id", requireAdmin, async (req, res) => {
  const wantsJson = req.headers["x-requested-with"] === "XMLHttpRequest";
  try {
    const d = await apiPost(`/api/admin/user/update/${req.params.id}`, req.body, req.session.token);
    if (wantsJson) return res.json({ success: true });
    flashFrom(req, d);
    res.redirect("/admin");
  } catch (e) {
    if (wantsJson) return res.status(e.status || 400).json({ success: false, error: e.message });
    req.session.flash = { type: e.type || "danger", message: e.message || "❌ Failed to update." };
    res.redirect("/admin");
  }
});

router.get("/user/details/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet(`/api/admin/user/details/${req.params.id}`, req.session.token);
    res.json(d.user);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Error" });
  }
});

// Impersonation: keep the admin's own token in the session so we can switch back.
router.post("/impersonate/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost(`/api/admin/impersonate/${req.params.id}`, {}, req.session.token);
    req.session.original_admin_id = req.user.id;
    req.session.impersonating = true;
    req.session.impersonatorToken = req.session.token;
    req.session.impersonatedUserId = d.user.id;
    req.session.token = d.token; // now acting as the target user
    invalidateUserCache(req);
    req.session.flash = { type: "info", message: d.message };
    res.redirect("/");
  } catch (e) {
    req.session.flash = { type: e.type || "danger", message: e.message || "❌ Unauthorized." };
    res.redirect("/admin");
  }
});

async function switchBack(req, res) {
  if (req.session.impersonating && req.session.impersonatorToken) {
    try {
      await apiPost(
        "/api/admin/switch-back",
        { impersonated_user_id: req.session.impersonatedUserId || null },
        req.session.impersonatorToken
      );
    } catch (e) { /* best effort */ }
    req.session.token = req.session.impersonatorToken;
    delete req.session.impersonating;
    delete req.session.original_admin_id;
    delete req.session.impersonatorToken;
    delete req.session.impersonatedUserId;
    invalidateUserCache(req);
    req.session.flash = { type: "success", message: "🔙 Switched back to admin account." };
    return res.redirect("/admin");
  }
  req.session.flash = { type: "danger", message: "❌ Cannot switch back." };
  res.redirect("/");
}

router.get("/switch-back", requireAdmin, (req, res) => switchBack(req, res));
router.get("/profile/switch-back", (req, res) => switchBack(req, res));

router.post("/create-admin", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost("/api/admin/create-admin", req.body, req.session.token);
    flashFrom(req, d);
  } catch (e) {
    req.session.flash = { type: e.type || "danger", message: e.message || "❌ Unauthorized." };
  }
  res.redirect("/admin");
});

router.get("/backup-database", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet("/api/admin/backup", req.session.token);
    req.session.flash = { type: "info", message: d.message };
  } catch (e) {
    req.session.flash = { type: "danger", message: "❌ Backup failed." };
  }
  res.redirect("/admin");
});

export default router;
