// ==================== BloodOra Backend API - Reviews & Testimonials ====================
// Two kinds live on /reviews: product reviews (tied to a shop product, only
// allowed for users who actually ordered it) and site testimonials.
// Everything new goes through the admin moderation queue.
import express from "express";
import { get, all, run } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { tryCatch } from "../utils.js";
import { recordActivity } from "../activity.js";

const router = express.Router();

function clampRating(v) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return 5;
  return Math.min(5, Math.max(1, n));
}

// POST /api/reviews — submit a review or testimonial (login required)
router.post("/", requireAuth, (req, res) =>
  tryCatch(res, async () => {
    const body = String(req.body?.body || "").trim();
    const title = String(req.body?.title || "").trim();
    const rating = clampRating(req.body?.rating);
    const productId = req.body?.product_id ? parseInt(req.body.product_id, 10) : null;

    if (!body || body.length < 10) {
      return res.status(400).json({ success: false, message: "❌ Please write at least 10 characters." });
    }
    if (title && title.length > 120) {
      return res.status(400).json({ success: false, message: "❌ Title too long (max 120 characters)." });
    }
    if (body.length > 2000) {
      return res.status(400).json({ success: false, message: "❌ Review too long (max 2000 characters)." });
    }

    let kind = "site";
    if (productId) {
      const product = await get("SELECT * FROM products WHERE id=?", [productId]);
      if (!product) return res.status(404).json({ success: false, message: "❌ That product does not exist." });
      const ordered = await get(
        `SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id
         WHERE o.user_id=? AND oi.product_id=? LIMIT 1`,
        [req.user.id, productId]
      );
      if (!ordered) {
        return res.status(400).json({
          success: false,
          message: `❌ You can only review “${product.name}” after ordering it. You can still leave a general testimonial instead.`,
        });
      }
      kind = "product";
    }

    const dupe = await get(
      `SELECT id FROM reviews WHERE user_id=? AND (product_id IS ? OR product_id = ?) AND created_at > datetime('now','-1 day') LIMIT 1`,
      [req.user.id, productId, productId]
    );
    if (dupe) {
      return res.status(400).json({ success: false, type: "warning", message: "⚠️ You already reviewed this recently. Please wait a day before posting another." });
    }

    const now = new Date().toISOString();
    await run(
      `INSERT INTO reviews (user_id, author_name, product_id, kind, rating, title, body, status, created_at)
       VALUES (?,?,?,?,?,?,?,'pending',?)`,
      [req.user.id, req.user.name, productId, kind, rating, title || null, body, now]
    );

    res.json({
      success: true,
      message: "✅ Thank you! Your review was submitted and will appear once an admin approves it.",
    });
  })
);

// GET /api/reviews/mine
router.get("/mine", requireAuth, (req, res) =>
  tryCatch(res, async () => {
    const reviews = await all(
      `SELECT r.*, p.name as product_name FROM reviews r LEFT JOIN products p ON r.product_id=p.id
       WHERE r.user_id=? ORDER BY r.id DESC`,
      [req.user.id]
    );
    res.json({ success: true, reviews });
  })
);

// ----------------------------------------------------------------- moderation

// GET /api/reviews/admin?status=
router.get("/admin", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const status = req.query.status;
    let sql = `SELECT r.*, u.name as user_name, u.email as user_email, p.name as product_name
               FROM reviews r LEFT JOIN users u ON r.user_id=u.id LEFT JOIN products p ON r.product_id=p.id`;
    const params = [];
    if (status && status !== "all") { sql += " WHERE r.status=?"; params.push(status); }
    sql += " ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id DESC";
    const reviews = await all(sql, params);
    const counts = {};
    for (const s of ["pending", "approved", "rejected"]) {
      counts[s] = (await get("SELECT COUNT(*) as c FROM reviews WHERE status=?", [s]))?.c || 0;
    }
    res.json({ success: true, reviews, counts });
  })
);

// POST /api/reviews/admin/:id/status
router.post("/admin/:id/status", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const status = String(req.body?.status || "").trim();
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "❌ Invalid status." });
    }
    const review = await get("SELECT * FROM reviews WHERE id=?", [req.params.id]);
    if (!review) return res.status(404).json({ success: false, message: "Review not found." });

    await run("UPDATE reviews SET status=? WHERE id=?", [status, req.params.id]);

    if (status === "approved") {
      const author = review.author_name || "A verified user";
      await recordActivity(
        "review_published",
        `${"★".repeat(Math.max(1, review.rating || 5))} ${review.title || "New review"}`,
        `by ${author}`,
        review.product_id ? `/shop/product/${review.product_id}` : "/reviews"
      );
    }
    res.json({ success: true, message: `✅ Review ${status}.` });
  })
);

// POST /api/reviews/admin/:id/feature
router.post("/admin/:id/feature", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const r = await get("SELECT id, is_featured FROM reviews WHERE id=?", [req.params.id]);
    if (!r) return res.status(404).json({ success: false, message: "Review not found." });
    const next = r.is_featured ? 0 : 1;
    await run("UPDATE reviews SET is_featured=? WHERE id=?", [next, req.params.id]);
    res.json({ success: true, message: next ? "⭐ Review featured." : "ℹ️ Feature removed." });
  })
);

// POST /api/reviews/admin/:id/reply
router.post("/admin/:id/reply", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const reply = String(req.body?.admin_reply || "").trim();
    if (!reply) return res.status(400).json({ success: false, message: "❌ Reply cannot be empty." });
    const r = await get("SELECT id FROM reviews WHERE id=?", [req.params.id]);
    if (!r) return res.status(404).json({ success: false, message: "Review not found." });
    await run("UPDATE reviews SET admin_reply=?, admin_replied_at=? WHERE id=?", [reply, new Date().toISOString(), req.params.id]);
    res.json({ success: true, message: "✅ Reply published." });
  })
);

// DELETE /api/reviews/admin/:id
router.delete("/admin/:id", requireAdmin, (req, res) =>
  tryCatch(res, async () => {
    const r = await get("SELECT id, title FROM reviews WHERE id=?", [req.params.id]);
    if (!r) return res.status(404).json({ success: false, message: "Review not found." });
    await run("DELETE FROM reviews WHERE id=?", [req.params.id]);
    res.json({ success: true, message: `🗑️ Review “${r.title || r.id}” deleted.` });
  })
);

export default router;
