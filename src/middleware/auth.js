// ==================== Frontend Auth Middleware (API-backed) ====================
// The frontend keeps NO database. The login state is a JWT issued by the
// separated backend API; it is stored in the frontend session and sent as a
// Bearer token on every API call.
import { apiGet, ApiError } from "../api.js";

const USER_CACHE_MS = 20_000; // refresh /me at most every 20s per session

export async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.isAuthenticated = false;
  if (req.session && req.session.token) {
    try {
      const cache = req.session.userCache;
      if (cache && cache.user && Date.now() - (cache.at || 0) < USER_CACHE_MS) {
        req.user = cache.user;
      } else {
        const data = await apiGet("/api/auth/me", req.session.token);
        req.user = data.user;
        req.session.userCache = { user: data.user, at: Date.now() };
      }
      res.locals.currentUser = req.user;
      res.locals.isAuthenticated = true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Token invalid/expired/revoked — clear local login state
        delete req.session.token;
        delete req.session.userCache;
        delete req.session.userId;
      } else {
        console.error("loadUser error:", e.message);
      }
    }
  }
  next();
}

export function invalidateUserCache(req) {
  if (req.session) delete req.session.userCache;
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
