// ==================== Frontend Routes - Live AI Help proxy ====================
// Same-origin proxy for the widget plus the admin configuration routes.
import express from "express";
import { createRequire } from "module";
import { apiGet, apiPost } from "../api.js";
import { requireAdmin } from "../middleware/auth.js";
import { invalidateBranding } from "../middleware/site.js";

const router = express.Router();

// Single source of truth for reasoning removal: the same UMD module the
// browser loads (/js/chat-utils.js). Stripping here means internal reasoning
// never even leaves this server — the client-side strip is defence-in-depth.
const require = createRequire(import.meta.url);
const { stripThink } = require("../../public/js/chat-utils.js");

// GET /ai-help/config — safe public configuration for the widget
router.get("/config", async (req, res) => {
  try { res.json(await apiGet("/api/ai/config")); }
  catch (e) { res.json({ success: false, enabled: false, prompts: [] }); }
});

// POST /ai-help/chat — the main endpoint used by the Live AI Help popup
router.post("/chat", async (req, res) => {
  try {
    const d = await apiPost("/api/ai/chat", {
      message: req.body?.message || "",
      conversation_id: req.body?.conversation_id || null,
      language: req.body?.language || res.locals.lang || "en",
      user_id: req.user?.id || null,
    }, req.session.token || null);
    // SECURITY: never forward model reasoning (<think>…</think>) to the
    // browser — stripped from the string itself, not hidden with CSS.
    if (d && typeof d.reply === "string") d.reply = stripThink(d.reply);
    res.json(d);
  } catch (e) {
    res.status(e.status && e.status >= 400 ? e.status : 502).json({
      success: false,
      message: e.message || "The AI assistant could not be reached.",
    });
  }
});

// ---------------------------------------------------------------- admin side

router.get("/admin/config", requireAdmin, async (req, res) => {
  try { res.json(await apiGet("/api/ai/admin/config", req.session.token)); }
  catch (e) { res.status(502).json({ success: false, settings: {}, models: [], message: e.message }); }
});

router.post("/admin/config", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost("/api/ai/admin/config", req.body, req.session.token);
    invalidateBranding();
    res.json(d);
  } catch (e) { res.status(502).json({ success: false, message: e.message }); }
});

router.post("/admin/test", requireAdmin, async (req, res) => {
  try { res.json(await apiPost("/api/ai/admin/test", req.body, req.session.token)); }
  catch (e) { res.status(502).json({ success: false, ok: false, message: e.message }); }
});

router.get("/admin/models", requireAdmin, async (req, res) => {
  try { res.json(await apiGet("/api/ai/admin/models", req.session.token)); }
  catch (e) { res.json({ success: false, models: [], message: e.message }); }
});

router.get("/admin/conversations", requireAdmin, async (req, res) => {
  try { res.json(await apiGet("/api/ai/admin/conversations", req.session.token)); }
  catch (e) { res.json({ success: false, conversations: [], message: e.message }); }
});

router.get("/admin/knowledge", requireAdmin, async (req, res) => {
  try { res.json(await apiGet("/api/ai/admin/knowledge", req.session.token)); }
  catch (e) { res.status(502).json({ success: false, message: e.message }); }
});

export default router;
