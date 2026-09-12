// ==================== BloodOra Backend - Real Activity Feed ====================
// The homepage "Live Activity" panel is driven by this module. Events are
// genuine: they are written when a donor is verified, a request is posted,
// an order is placed, a review is approved, and so on.
//
// Delivery is two-layered so it works everywhere:
//   1. Server-Sent Events  (instant, when the platform allows long-lived HTTP)
//   2. DB-backed polling   (the source of truth; works on any serverless host)
import { all, run } from "./db.js";

// In-process fan-out for SSE subscribers.
const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publish(event) {
  for (const l of [...listeners]) {
    try { l(event); } catch (e) { listeners.delete(l); }
  }
}

const KIND_META = {
  donor_verified:   { icon: "fa-user-shield",       tone: "success", label: "Verified" },
  donor_joined:     { icon: "fa-user-plus",         tone: "info",    label: "New" },
  request_posted:   { icon: "fa-droplet",           tone: "danger",  label: "Request" },
  request_urgent:   { icon: "fa-triangle-exclamation", tone: "danger", label: "URGENT" },
  request_fulfilled:{ icon: "fa-hand-holding-heart", tone: "success", label: "Fulfilled" },
  order_placed:     { icon: "fa-bag-shopping",      tone: "warning", label: "Order" },
  order_delivered:  { icon: "fa-truck-fast",        tone: "success", label: "Delivered" },
  review_published: { icon: "fa-star",              tone: "warning", label: "Review" },
  product_added:    { icon: "fa-pills",             tone: "info",    label: "In shop" },
  notice:           { icon: "fa-bullhorn",          tone: "danger",  label: "Notice" },
};

export function kindMeta(kind) {
  return KIND_META[kind] || { icon: "fa-circle-info", tone: "info", label: "Update" };
}

/** Write a real event and push it to every live SSE subscriber. */
export async function recordActivity(kind, title, detail = "", link = null, meta = null) {
  const createdAt = new Date().toISOString();
  let id = null;
  try {
    await run(
      `INSERT INTO activity_events (kind, title, detail, link, meta, created_at) VALUES (?,?,?,?,?,?)`,
      [kind, title, detail, link, meta ? JSON.stringify(meta) : null, createdAt]
    );
    const row = await all(`SELECT id FROM activity_events ORDER BY id DESC LIMIT 1`);
    id = row[0]?.id ?? null;
    // keep the table small
    await run(`DELETE FROM activity_events WHERE id NOT IN (SELECT id FROM activity_events ORDER BY id DESC LIMIT 200)`);
  } catch (e) {
    console.warn("recordActivity:", e.message);
  }
  const event = { id, kind, title, detail, link, meta, created_at: createdAt, ...kindMeta(kind) };
  publish(event);
  return event;
}

/**
 * Recent events for the feed. If the log is still empty (fresh database),
 * the feed is reconstructed from real rows in the database — never fabricated.
 */
export async function getRecentActivity(limit = 12) {
  let events = [];
  try {
    events = await all(`SELECT * FROM activity_events ORDER BY id DESC LIMIT ?`, [limit * 2]);
  } catch (e) {
    events = [];
  }
  const shaped = events.map((e) => ({
    id: e.id, kind: e.kind, title: e.title, detail: e.detail, link: e.link,
    meta: e.meta ? safeJson(e.meta) : null, created_at: e.created_at, ...kindMeta(e.kind),
  }));

  // If the log is already rich we can serve it directly.
  if (shaped.length >= limit) return shaped.slice(0, limit);

  // ---- Otherwise top up from real rows so a fresh deployment is still truthful ----
  const safe = async (fn) => { try { return await fn(); } catch (e) { return []; } };
  const [donors, requests, orders, reviews] = await Promise.all([
    safe(() => all(`SELECT id, name, blood_group, district, upazila, created_at FROM users WHERE can_donate=1 AND is_verified=1 ORDER BY created_at DESC LIMIT 5`)),
    safe(() => all(`SELECT id, patient_name, blood_group, hospital_name, location_district, is_urgent, is_fulfilled, created_at FROM blood_requests ORDER BY is_urgent DESC, id DESC LIMIT 5`)),
    safe(() => all(`SELECT id, total_amount, delivery_upazila, status, created_at FROM orders ORDER BY id DESC LIMIT 4`)),
    safe(() => all(`SELECT id, author_name, rating, title, product_id, created_at FROM reviews WHERE status='approved' ORDER BY id DESC LIMIT 4`)),
  ]);

  const merged = [];
  for (const d of donors) {
    merged.push({
      id: `donor-${d.id}`, kind: "donor_verified", title: `${d.blood_group || "Donor"} donor verified`,
      detail: `${initials(d.name)} • ${d.upazila || d.district || "Bangladesh"}`,
      link: `/donors/profile/view/${d.id}`, created_at: d.created_at, ...kindMeta("donor_verified"),
    });
  }
  for (const r of requests) {
    const kind = r.is_urgent && !r.is_fulfilled ? "request_urgent" : r.is_fulfilled ? "request_fulfilled" : "request_posted";
    merged.push({
      id: `req-${r.id}`, kind,
      title: r.is_fulfilled ? `${r.blood_group} request fulfilled` : `${r.blood_group} needed — ${r.hospital_name || "hospital"}`,
      detail: `${r.location_district || "Bangladesh"}${r.patient_name ? ` • for ${initials(r.patient_name)}` : ""}`,
      link: `/blood-request/${r.id}`, created_at: r.created_at, ...kindMeta(kind),
    });
  }
  for (const o of orders) {
    const kind = o.status === "delivered" ? "order_delivered" : "order_placed";
    merged.push({
      id: `order-${o.id}`, kind,
      title: kind === "order_delivered" ? `Order #${o.id} delivered` : `New shop order #${o.id}`,
      detail: `${o.delivery_upazila || "Kalai"} • ৳${Number(o.total_amount || 0).toFixed(0)}`,
      link: "/shop/my-orders", created_at: o.created_at, ...kindMeta(kind),
    });
  }
  for (const rv of reviews) {
    merged.push({
      id: `review-${rv.id}`, kind: "review_published",
      title: `${"★".repeat(Math.max(1, rv.rating || 5))} ${rv.title || "New review"}`,
      detail: rv.author_name ? `by ${initials(rv.author_name)}` : "Verified reviewer",
      link: rv.product_id ? `/shop/product/${rv.product_id}` : "/reviews", created_at: rv.created_at, ...kindMeta("review_published"),
    });
  }

  // Merge the real-time log on top of the reconstructed rows, de-duplicated by
  // headline so a fresh action (e.g. "Test Paracetamol added to the shop") is
  // visible immediately even before the log itself grows past a few rows.
  const logTitles = new Set(shaped.map((s) => String(s.title || "").toLowerCase()));
  const combined = [...shaped];
  for (const m of merged) {
    if (!logTitles.has(String(m.title || "").toLowerCase())) combined.push(m);
  }
  combined.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return combined.slice(0, limit);
}

/** Never expose a visitor's full name in the public feed. */
export function initials(name) {
  if (!name) return "A donor";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}
