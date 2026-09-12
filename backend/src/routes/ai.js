// ==================== BloodOra Backend API - Live AI Help (Groq / Qwen3.6 27B) ====================
// The assistant is given a knowledge base built from the *current* state of the
// site (routes, features, business rules, live catalogue, clinical reference),
// so it can answer anything about the platform and hand back real clickable
// links. Everything below is configurable from Admin Panel → AI Assistant.
import express from "express";
import crypto from "crypto";
import { get, all, run } from "../db.js";
import { requireAdmin } from "../auth.js";
import { tryCatch } from "../utils.js";
import { buildSystemPrompt, collectLiveKnowledge, routeCatalogue } from "../knowledge.js";
import { siteRoutes } from "../content.js";

const router = express.Router();

export const DEFAULT_MODEL = "qwen/qwen3.6-27b";

/** Models that are safe to offer in the Admin dropdown (Groq-served). */
export const MODEL_CHOICES = [
  { id: "qwen/qwen3.6-27b", label: "Qwen3.6 27B (Groq) — default", note: "262K context, strong multilingual, Groq-recommended successor to qwen3-32b." },
  { id: "qwen/qwen3-32b", label: "Qwen3 32B (Groq, deprecated 17 Jul 2026)", note: "Kept for compatibility; migrate to Qwen3.6 27B." },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (Groq)", note: "Reasoning model, higher latency." },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (Groq)", note: "Fast, lightweight." },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile (Groq)", note: "General purpose fallback." },
  { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2 Instruct (Groq)", note: "Long-context alternative." },
];

const ENV_DEFAULTS = {
  ai_enabled: process.env.AI_ENABLED === "false" ? 0 : 1,
  ai_provider: "groq",
  ai_model: process.env.AI_MODEL || DEFAULT_MODEL,
  ai_api_key: process.env.GROQ_API_KEY || "",
  ai_base_url: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  ai_temperature: parseFloat(process.env.AI_TEMPERATURE || "0.5"),
  ai_max_tokens: parseInt(process.env.AI_MAX_TOKENS || "900", 10),
  ai_persona: "",
  ai_prompts: "",
};

/** Never returns the raw API key. */
function maskAiConfig(c = {}) {
  const key = c.ai_api_key || "";
  return {
    ...c,
    ai_api_key: key ? `${key.slice(0, 6)}${"•".repeat(10)}${key.slice(-4)}` : "",
    ai_api_key_set: Boolean(key),
  };
}

async function getAiConfig() {
  let row = null;
  try { row = await get("SELECT * FROM site_settings LIMIT 1"); } catch (e) { row = null; }
  return {
    ai_enabled: row?.ai_enabled ?? ENV_DEFAULTS.ai_enabled,
    ai_provider: row?.ai_provider || ENV_DEFAULTS.ai_provider,
    ai_model: row?.ai_model || ENV_DEFAULTS.ai_model,
    ai_api_key: row?.ai_api_key || ENV_DEFAULTS.ai_api_key,
    ai_base_url: row?.ai_base_url || ENV_DEFAULTS.ai_base_url,
    ai_temperature: row?.ai_temperature ?? ENV_DEFAULTS.ai_temperature,
    ai_max_tokens: row?.ai_max_tokens ?? ENV_DEFAULTS.ai_max_tokens,
    ai_persona: row?.ai_persona || ENV_DEFAULTS.ai_persona,
    ai_prompts: row?.ai_prompts || ENV_DEFAULTS.ai_prompts,
    site_name: row?.site_name || "BloodOra",
  };
}

/** Parse markdown links out of the reply and enrich them with page titles. */
function extractLinks(text) {
  const out = [];
  const seen = new Set();
  const re = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const path = m[2].split("?")[0].replace(/[#:].*$/, "");
    if (seen.has(path)) continue;
    seen.add(path);
    const known = siteRoutes.find((r) => r.path === path || (r.path.includes("/:id") && path.startsWith(r.path.split("/:")[0])));
    out.push({ label: m[1], path: m[2], title: known?.title || m[1] });
  }
  return out;
}

/** Suggested prompts for the widget chips (admin-editable, newline separated). */
function parsePrompts(raw) {
  const list = String(raw || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length
    ? list
    : [
        "How do I request blood urgently?",
        "Open the medical shop",
        "When is Anti-D given during pregnancy?",
        "Who can receive O- blood?",
        "What is the delivery charge?",
        "How do I become a verified donor?",
      ];
}

// ------------------------------------------------------------------ public

// GET /api/ai/config — safe, public configuration for the widget
router.get("/config", (req, res) =>
  tryCatch(res, async () => {
    const c = await getAiConfig();
    res.json({
      success: true,
      enabled: Boolean(Number(c.ai_enabled)),
      model: c.ai_model,
      provider: c.ai_provider,
      site_name: c.site_name,
      prompts: parsePrompts(c.ai_prompts),
    });
  })
);

// POST /api/ai/chat — the main endpoint used by the Live AI Help popup
router.post("/chat", (req, res) =>
  tryCatch(res, async () => {
    const cfg = await getAiConfig();
    if (!Number(cfg.ai_enabled)) {
      return res.status(503).json({ success: false, message: "🤖 The AI assistant is currently disabled. Please use Live Messaging to reach a human." });
    }
    if (!cfg.ai_api_key) {
      return res.status(503).json({
        success: false,
        message: "🔑 The AI assistant is not configured yet. An admin must add the Groq API key in Admin Panel → AI Assistant. Meanwhile, please use Live Messaging to reach a human.",
      });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ success: false, message: "❌ Message cannot be empty." });
    if (message.length > 4000) return res.status(400).json({ success: false, message: "❌ Message too long." });

    const conversationId = String(req.body?.conversation_id || crypto.randomUUID());
    const language = String(req.body?.language || "en");

    // ---- build the message history -------------------------------------------------
    const db = { get, all };
    const live = await collectLiveKnowledge(db);
    const systemPrompt = buildSystemPrompt({ settings: live.settings, live }, cfg.ai_persona);

    let history = [];
    try {
      history = await all(
        "SELECT role, content FROM ai_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 12",
        [conversationId]
      );
    } catch (e) { history = []; }
    history = history.reverse();

    const langNote = {
      en: "Answer in English.",
      bn: "উত্তরটি বাংলায় দিন। Answer in Bengali (Bangla).",
      ar: "أجب باللغة العربية. Answer in Arabic.",
    }[language] || "Answer in the same language the user used.";

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content })),
      { role: "user", content: `${message}\n\n[System note: ${langNote}]` },
    ];

    // ---- call Groq ----------------------------------------------------------------
    const url = `${String(cfg.ai_base_url).replace(/\/+$/, "")}/chat/completions`;
    let data;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.ai_api_key}` },
        body: JSON.stringify({
          model: cfg.ai_model,
          messages,
          temperature: Number(cfg.ai_temperature) || 0.5,
          max_completion_tokens: Number(cfg.ai_max_tokens) || 900,
          top_p: 0.9,
        }),
      });
      const text = await r.text();
      try { data = JSON.parse(text); } catch (e) {
        return res.status(502).json({ success: false, message: `❌ Groq returned a non-JSON response (${r.status}).` });
      }
      if (!r.ok) {
        const detail = data?.error?.message || data?.message || `HTTP ${r.status}`;
        return res.status(502).json({ success: false, message: `❌ Groq error: ${detail}`, detail });
      }
    } catch (e) {
      return res.status(502).json({ success: false, message: `❌ Could not reach Groq: ${e.message}` });
    }

    const reply = data?.choices?.[0]?.message?.content?.trim()
      || "I could not generate an answer. Please try again or use Live Messaging to reach a human.";

    // ---- persist -------------------------------------------------------------------
    const now = new Date().toISOString();
    try {
      await run(
        "INSERT INTO ai_messages (conversation_id, user_id, role, content, model, created_at) VALUES (?,?,?,?,?,?)",
        [conversationId, req.body?.user_id || null, "user", message, cfg.ai_model, now]
      );
      await run(
        "INSERT INTO ai_messages (conversation_id, user_id, role, content, model, created_at) VALUES (?,?,?,?,?,?)",
        [conversationId, req.body?.user_id || null, "assistant", reply, cfg.ai_model, new Date().toISOString()]
      );
      await run(
        `DELETE FROM ai_messages WHERE conversation_id NOT IN (SELECT conversation_id FROM ai_messages GROUP BY conversation_id ORDER BY MAX(id) DESC LIMIT 300)`
      );
    } catch (e) { /* history is best-effort */ }

    res.json({
      success: true,
      conversation_id: conversationId,
      reply,
      links: extractLinks(reply),
      model: cfg.ai_model,
      usage: data?.usage || null,
    });
  })
);

// ------------------------------------------------------------------- admin

// GET /api/ai/admin/config — full configuration (key masked) + model catalogue
router.get("/admin/config", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const c = await getAiConfig();
    res.json({ success: true, settings: maskAiConfig(c), models: MODEL_CHOICES, default_model: DEFAULT_MODEL });
  })
);

// POST /api/ai/admin/config — save configuration from the Admin Panel
router.post("/admin/config", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const b = req.body || {};
    let s = await get("SELECT id, ai_api_key FROM site_settings LIMIT 1");
    if (!s) { await run("INSERT INTO site_settings (site_name) VALUES ('BloodOra')"); s = await get("SELECT id, ai_api_key FROM site_settings LIMIT 1"); }

    // A masked key (all bullets) means "keep the existing one".
    let apiKey = s.ai_api_key || "";
    if (b.ai_api_key !== undefined) {
      const incoming = String(b.ai_api_key).trim();
      if (incoming && !/^[•]+$/.test(incoming) && !/•/.test(incoming)) apiKey = incoming;
      if (b.ai_api_key === "") apiKey = "";
    }

    await run(
      `UPDATE site_settings SET ai_enabled=?, ai_provider=?, ai_model=?, ai_api_key=?, ai_base_url=?,
       ai_temperature=?, ai_max_tokens=?, ai_persona=?, ai_prompts=?, updated_at=? WHERE id=?`,
      [
        b.ai_enabled ? 1 : 0,
        b.ai_provider || "groq",
        b.ai_model || DEFAULT_MODEL,
        apiKey,
        b.ai_base_url || "https://api.groq.com/openai/v1",
        parseFloat(b.ai_temperature ?? 0.5),
        parseInt(b.ai_max_tokens ?? 900, 10),
        b.ai_persona || "",
        b.ai_prompts || "",
        new Date().toISOString(),
        s.id,
      ]
    );
    res.json({ success: true, message: "✅ AI Assistant settings saved." });
  })
);

// POST /api/ai/admin/test — real round-trip against Groq, reports the true error
router.post("/admin/test", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const c = await getAiConfig();
    const key = String(req.body?.api_key || "").trim();
    const apiKey = key && !/•/.test(key) ? key : c.ai_api_key;
    if (!apiKey) {
      return res.json({ success: false, message: "❌ No API key. Paste a Groq key or save one first.", ok: false });
    }
    const model = String(req.body?.model || c.ai_model || DEFAULT_MODEL);
    const baseUrl = String(req.body?.base_url || c.ai_base_url || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
    const started = Date.now();
    try {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are testing a connection. Reply with exactly: OK" },
            { role: "user", content: "ping" },
          ],
          max_completion_tokens: 20,
          temperature: 0,
        }),
      });
      const ms = Date.now() - started;
      const text = await r.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { /* ignore */ }
      if (!r.ok) {
        return res.json({ success: false, ok: false, ms, message: `❌ Groq rejected the request (HTTP ${r.status}): ${data?.error?.message || text.slice(0, 200)}` });
      }
      const reply = data?.choices?.[0]?.message?.content?.trim();
      res.json({
        success: true, ok: true, ms,
        model,
        message: `✅ Connection OK — ${model} replied “${reply}” in ${ms} ms.`,
        reply,
      });
    } catch (e) {
      res.json({ success: false, ok: false, message: `❌ Could not reach Groq: ${e.message}` });
    }
  })
);

// GET /api/ai/admin/models — live model list straight from Groq
router.get("/admin/models", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const c = await getAiConfig();
    if (!c.ai_api_key) {
      return res.json({ success: true, models: MODEL_CHOICES, source: "static", note: "Add a Groq API key to fetch the live catalogue." });
    }
    try {
      const r = await fetch(`${String(c.ai_base_url).replace(/\/+$/, "")}/models`, {
        headers: { Authorization: `Bearer ${c.ai_api_key}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message || `HTTP ${r.status}`);
      const ids = (data?.data || []).map((m) => m.id).filter(Boolean).sort();
      res.json({ success: true, models: ids.map((id) => ({ id, label: id })), source: "groq" });
    } catch (e) {
      res.json({ success: true, models: MODEL_CHOICES, source: "static", note: "Live fetch failed: " + e.message });
    }
  })
);

// GET /api/ai/admin/conversations — recent AI conversations for the admin
router.get("/admin/conversations", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const rows = await all(
      `SELECT conversation_id, COUNT(*) as turns, MAX(created_at) as last_at,
              SUBSTR(MAX(CASE WHEN role='user' THEN content END), 1, 90) as last_question
       FROM ai_messages GROUP BY conversation_id ORDER BY MAX(id) DESC LIMIT 50`
    );
    res.json({ success: true, conversations: rows });
  })
);

// GET /api/ai/knowledge — what the assistant is currently being told (preview)
router.get("/admin/knowledge", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const db = { get, all };
    const live = await collectLiveKnowledge(db);
    const c = await getAiConfig();
    const prompt = buildSystemPrompt({ settings: live.settings, live }, c.ai_persona);
    res.json({
      success: true,
      preview: prompt,
      characters: prompt.length,
      approxTokens: Math.round(prompt.length / 4),
      routes: siteRoutes.length,
      routeCatalogue: routeCatalogue(),
      live,
    });
  })
);

export default router;
