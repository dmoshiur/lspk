// ==================== BloodOra Backend API - Live Messaging (human support) ====================
// Real two-way chat between any visitor (logged in or not) and the admin team.
// Messages are persisted in the database and pushed to both sides in real time
// over Server-Sent Events, with polling as the fallback transport.
import express from "express";
import crypto from "crypto";
import { get, all, run } from "../db.js";
import { requireAuth, requireAdmin, optionalAuth } from "../auth.js";
import { tryCatch } from "../utils.js";
import { getSmtpConfig, sendNewSupportMessageAlert } from "../mailer.js";

const router = express.Router();

// ------------------------- in-process fan-out -------------------------
const sessionListeners = new Map(); // session_key -> Set<fn>
let adminListeners = new Set();

function pushToSession(key, payload) {
  const set = sessionListeners.get(key);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); } catch (e) { set.delete(fn); }
  }
}
function pushToAdmins(payload) {
  for (const fn of [...adminListeners]) {
    try { fn(payload); } catch (e) { adminListeners.delete(fn); }
  }
}

function sse(res, onSubscribe) {
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(`retry: 4000\n\n`);
  const cleanup = onSubscribe((payload, eventName = "message") => {
    try { res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`); } catch (e) { /* closed */ }
  });
  const heartbeat = setInterval(() => { try { res.write(`: ping\n\n`); } catch (e) { /* closed */ } }, 25000);
  req_onclose(res, () => { clearInterval(heartbeat); cleanup?.(); res.end(); });
}
function req_onclose(res, fn) {
  res.req.on("close", fn);
}

function shapeMessage(m) {
  return {
    id: m.id,
    session_key: m.session_key,
    sender_type: m.sender_type,
    sender_name: m.sender_name,
    body: m.body,
    created_at: m.created_at,
  };
}

// -------------------------------------------------------------- Visitor side

// POST /api/support/session — start (or resume) a conversation
router.post("/session", optionalAuth, (req, res) =>
  tryCatch(res, async () => {
    let key = (req.body?.session_key || "").trim();
    let session = key ? await get("SELECT * FROM chat_sessions WHERE session_key=?", [key]) : null;

    if (!session) {
      key = crypto.randomBytes(18).toString("hex");
      const visitorName = req.user ? req.user.name : (req.body?.name || "Guest").toString().slice(0, 60);
      await run(
        `INSERT INTO chat_sessions (session_key, user_id, visitor_name, last_message, last_message_at)
         VALUES (?,?,?,?,?)`,
        [key, req.user?.id || null, visitorName, null, new Date().toISOString()]
      );
      session = await get("SELECT * FROM chat_sessions WHERE session_key=?", [key]);
    }

    const messages = await all("SELECT * FROM chat_messages WHERE session_key=? ORDER BY id ASC LIMIT 200", [key]);
    await run("UPDATE chat_sessions SET unread_visitor=0 WHERE session_key=?", [key]);

    res.json({
      success: true,
      session_key: key,
      visitor_name: session.visitor_name,
      enabled: true,
      messages: messages.map(shapeMessage),
      greeting: "Assalamu alaikum! This is the BloodOra live support desk. A human from the admin team will answer — usually within a few minutes. For urgent blood, please also post a request.",
    });
  })
);

// GET /api/support/messages?session=
router.get("/messages", (req, res) =>
  tryCatch(res, async () => {
    const key = req.query.session;
    if (!key) return res.status(400).json({ success: false, message: "Missing session." });
    const after = parseInt(req.query.after || "0", 10) || 0;
    const rows = after
      ? await all("SELECT * FROM chat_messages WHERE session_key=? AND id>? ORDER BY id ASC LIMIT 200", [key, after])
      : await all("SELECT * FROM chat_messages WHERE session_key=? ORDER BY id ASC LIMIT 200", [key]);
    await run("UPDATE chat_sessions SET unread_visitor=0 WHERE session_key=?", [key]);
    res.json({ success: true, messages: rows.map(shapeMessage) });
  })
);

// POST /api/support/messages — visitor sends a message
router.post("/messages", optionalAuth, (req, res) =>
  tryCatch(res, async () => {
    const body = (req.body?.body || req.body?.message || "").toString().trim();
    if (!body) return res.status(400).json({ success: false, message: "❌ Message cannot be empty." });
    if (body.length > 2000) return res.status(400).json({ success: false, message: "❌ Message too long (max 2000 characters)." });

    let key = (req.body?.session_key || "").trim();
    let session = key ? await get("SELECT * FROM chat_sessions WHERE session_key=?", [key]) : null;
    if (!session) {
      key = crypto.randomBytes(18).toString("hex");
      const visitorName = req.user ? req.user.name : (req.body?.name || "Guest").toString().slice(0, 60);
      await run(
        `INSERT INTO chat_sessions (session_key, user_id, visitor_name, last_message, last_message_at) VALUES (?,?,?,?,?)`,
        [key, req.user?.id || null, visitorName, body, new Date().toISOString()]
      );
      session = await get("SELECT * FROM chat_sessions WHERE session_key=?", [key]);
    }

    const senderName = req.user ? req.user.name : session.visitor_name || "Guest";
    const now = new Date().toISOString();
    await run(
      `INSERT INTO chat_messages (session_key, sender_type, sender_name, body, is_read, created_at)
       VALUES (?,?,?,?,0,?)`,
      [key, "visitor", senderName, body, now]
    );
    await run(
      `UPDATE chat_sessions SET last_message=?, last_message_at=?, unread_admin=unread_admin+1 WHERE session_key=?`,
      [body, now, key]
    );

    const row = await get("SELECT * FROM chat_messages WHERE session_key=? ORDER BY id DESC LIMIT 1", [key]);
    const message = shapeMessage(row);

    pushToSession(key, { type: "message", message });
    pushToAdmins({ type: "message", session_key: key, visitor_name: session.visitor_name, message });

    // Optional email alert to the admin team (fire and forget)
    const cfg = await getSmtpConfig();
    if (Number(cfg.smtp_enabled) && cfg.smtp_from_email) {
      sendNewSupportMessageAlert({ to: cfg.smtp_from_email, from: senderName, message: body, siteName: cfg.site_name })
        .catch(() => {});
    }

    res.json({ success: true, session_key: key, message });
  })
);

// GET /api/support/stream?session= — visitor's real-time channel
router.get("/stream", (req, res) => {
  const key = req.query.session;
  if (!key) { res.status(400).end(); return; }
  sse(res, (send) => {
    if (!sessionListeners.has(key)) sessionListeners.set(key, new Set());
    const set = sessionListeners.get(key);
    const handler = (payload) => send(payload, payload.type === "typing" ? "typing" : "message");
    set.add(handler);
    send({ type: "connected", session_key: key, time: new Date().toISOString() }, "hello");
    return () => { set.delete(handler); if (!set.size) sessionListeners.delete(key); };
  });
});

// ---------------------------------------------------------------- Admin side

// GET /api/support/admin/sessions
router.get("/admin/sessions", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const sessions = await all("SELECT * FROM chat_sessions ORDER BY last_message_at DESC LIMIT 200");
    const activeKeys = new Set(sessionListeners.keys());
    const unreadRow = await get("SELECT COALESCE(SUM(unread_admin),0) as c FROM chat_sessions");
    res.json({
      success: true,
      sessions: sessions.map((s) => ({ ...s, online: activeKeys.has(s.session_key), unread_admin: s.unread_admin || 0 })),
      unread_total: Number(unreadRow?.c || 0),
    });
  })
);

// GET /api/support/admin/sessions/:key/messages
router.get("/admin/sessions/:key/messages", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const session = await get("SELECT * FROM chat_sessions WHERE session_key=?", [req.params.key]);
    if (!session) return res.status(404).json({ success: false, message: "Conversation not found." });
    const messages = await all("SELECT * FROM chat_messages WHERE session_key=? ORDER BY id ASC LIMIT 500", [req.params.key]);
    await run("UPDATE chat_sessions SET unread_admin=0 WHERE session_key=?", [req.params.key]);
    res.json({ success: true, session, messages: messages.map(shapeMessage) });
  })
);

// POST /api/support/admin/sessions/:key/reply
router.post("/admin/sessions/:key/reply", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const session = await get("SELECT * FROM chat_sessions WHERE session_key=?", [req.params.key]);
    if (!session) return res.status(404).json({ success: false, message: "Conversation not found." });
    const body = (req.body?.body || "").toString().trim();
    if (!body) return res.status(400).json({ success: false, message: "❌ Reply cannot be empty." });

    const now = new Date().toISOString();
    await run(
      `INSERT INTO chat_messages (session_key, sender_type, sender_name, body, is_read, created_at) VALUES (?,?,?,?,0,?)`,
      [req.params.key, "admin", req.user.name, body, now]
    );
    await run(
      `UPDATE chat_sessions SET last_message=?, last_message_at=?, unread_admin=0, unread_visitor=unread_visitor+1 WHERE session_key=?`,
      [body, now, req.params.key]
    );

    const row = await get("SELECT * FROM chat_messages WHERE session_key=? ORDER BY id DESC LIMIT 1", [req.params.key]);
    const message = shapeMessage(row);
    pushToSession(req.params.key, { type: "message", message });
    pushToAdmins({ type: "message", session_key: req.params.key, visitor_name: session.visitor_name, message, from_admin: true });

    res.json({ success: true, message, message2: "✅ Reply sent live." });
  })
);

// POST /api/support/admin/sessions/:key/close
router.post("/admin/sessions/:key/close", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    await run("UPDATE chat_sessions SET is_open=0 WHERE session_key=?", [req.params.key]);
    pushToSession(req.params.key, { type: "closed" });
    pushToAdmins({ type: "closed", session_key: req.params.key });
    res.json({ success: true, message: "ℹ️ Conversation closed." });
  })
);

// GET /api/support/admin/stream — real-time feed of every conversation
router.get("/admin/stream", requireAdmin, (req, res) => {
  sse(res, (send) => {
    adminListeners.add(send);
    send({ type: "connected", time: new Date().toISOString() }, "hello");
    return () => adminListeners.delete(send);
  });
});

export default router;
