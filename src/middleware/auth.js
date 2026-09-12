// ==================== Auth Middleware ====================
import { get } from "../db.js";

export async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.isAuthenticated = false;
  if (req.session && req.session.userId) {
    try {
      const user = await get("SELECT * FROM users WHERE id = ?", [req.session.userId]);
      if (user) {
        // Single session enforcement: check session_token matches
        if (user.session_token && req.session.session_token !== user.session_token) {
          // Invalidated - logout
          req.session.destroy(() => {});
          res.locals.currentUser = null;
          res.locals.isAuthenticated = false;
        } else {
          // normalize booleans
          user.is_admin = !!user.is_admin;
          user.is_super_admin = !!user.is_super_admin;
          user.is_verified = !!user.is_verified;
          user.can_donate = !!user.can_donate;
          res.locals.currentUser = user;
          res.locals.isAuthenticated = true;
          req.user = user;
        }
      }
    } catch (e) { console.error("loadUser error:", e); }
  }
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) {
    req.session.flash = { type: "warning", message: "⚠️ Please login to continue." };
    return res.redirect("/login");
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    req.session.flash = { type: "danger", message: "❌ Admin access required." };
    return res.redirect("/");
  }
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.is_super_admin) {
    req.session.flash = { type: "danger", message: "❌ Super Admin access required." };
    return res.redirect("/admin");
  }
  next();
}

export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "127.0.0.1";
}
export function getDeviceFingerprint(req) {
  const ua = req.headers["user-agent"] || "";
  // simple hash
  let hash = 0;
  for (let i = 0; i < ua.length; i++) hash = ((hash << 5) - hash + ua.charCodeAt(i)) & 0xffffffff;
  return Math.abs(hash).toString(16).padStart(16, "0").slice(0,16);
}
