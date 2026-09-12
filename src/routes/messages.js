// ==================== Frontend Routes - Messages (API-backed) ====================
import express from "express";
import { apiGet, apiPost } from "../api.js";
import { requireLogin, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  try {
    const d = await apiGet("/api/messages", req.session.token);
    res.render("messages", { title: "Messages - BloodOra", received: d.received, sent: d.sent, unread_count: d.unread_count });
  } catch (e) {
    console.error(e.message);
    res.redirect("/");
  }
});

router.get("/send", requireLogin, (req, res) => res.render("send_message", { title: "Send Message - BloodOra" }));

router.post("/send", requireLogin, async (req, res) => {
  try {
    const { subject, content, recipient_email } = req.body;
    const d = await apiPost("/api/messages", { subject, content, recipient_email }, req.session.token);
    req.session.flash = { type: "success", message: d.message };
    res.redirect("/messages");
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Failed to send." };
    res.redirect("/messages/send");
  }
});

router.get("/read/:id", requireLogin, async (req, res) => {
  try {
    const d = await apiGet(`/api/messages/${req.params.id}`, req.session.token);
    res.render("read_message", { title: "Read Message - BloodOra", message: d.message });
  } catch (e) {
    return res.status(404).render("404", { title: "Not Found" });
  }
});

router.get("/reply/:id", requireLogin, async (req, res) => {
  try {
    const d = await apiGet(`/api/messages/${req.params.id}/original`, req.session.token);
    res.render("reply_message", { title: "Reply - BloodOra", original: d.original });
  } catch (e) {
    return res.status(404).render("404", { title: "Not Found" });
  }
});

router.post("/reply/:id", requireLogin, async (req, res) => {
  try {
    const d = await apiPost(`/api/messages/${req.params.id}/reply`, { content: req.body.content }, req.session.token);
    req.session.flash = { type: "success", message: d.message };
    res.redirect("/messages");
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Failed." };
    res.redirect("/messages");
  }
});

// ---------- Admin messages ----------
router.get("/admin/messages", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet("/api/messages/admin/list", req.session.token);
    res.render("admin/messages", { title: "Admin Messages", messages: d.messages, unread: d.unread });
  } catch (e) {
    res.render("admin/messages", { title: "Admin Messages", messages: [], unread: 0 });
  }
});

router.get("/admin/message/reply/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet(`/api/messages/${req.params.id}/original`, req.session.token);
    res.render("admin/reply_message", { title: "Admin Reply", original: d.original });
  } catch (e) {
    return res.status(404).render("404", { title: "Not Found" });
  }
});

router.post("/admin/message/reply/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost(`/api/messages/admin/reply/${req.params.id}`, { content: req.body.content }, req.session.token);
    req.session.flash = { type: "success", message: d.message };
    res.redirect("/messages/admin/messages");
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Failed." };
    res.redirect("/messages/admin/messages");
  }
});

export default router;
