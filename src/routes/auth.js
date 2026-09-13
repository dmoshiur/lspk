// ==================== Frontend Routes - Auth (API-backed) ====================
// Forms POST here; the server forwards to the backend API and keeps the
// returned JWT in the session.
import express from "express";
import multer from "multer";
import { apiGet, apiPost, apiPostForm, buildFormData } from "../api.js";
import { invalidateUserCache } from "../middleware/auth.js";
import { bangladeshData as localBangladeshData } from "../utils/locations.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

function setAuthSession(req, token, user) {
  req.session.token = token;
  req.session.userId = user.id;
  req.session.userCache = { user, at: Date.now() };
}

// GET Register
router.get("/register", async (req, res) => {
  if (req.user) return res.redirect("/");
  let bangladeshData = localBangladeshData;
  try {
    const d = await apiGet("/api/meta/locations");
    if (d && d.bangladeshData && Object.keys(d.bangladeshData).length) bangladeshData = d.bangladeshData;
  } catch (e) { /* fallback to bundled static data */ }
  res.render("register", { title: `${req.t("nav_register")} - ${res.locals.siteName}`, error: null, bangladeshData });
});

// POST Register (multipart → forwarded to backend)
router.post("/register", upload.single("profile_pic"), async (req, res) => {
  try {
    const b = req.body;
    const fd = buildFormData(
      {
        name: b.name, email: b.email, phone: b.phone, password: b.password,
        blood_group: b.blood_group, role: b.role, division: b.division,
        district: b.district, upazila: b.upazila, union: b.union, holding: b.holding,
        birth_certificate: b.birth_certificate, date_of_birth: b.date_of_birth, age: b.age,
      },
      req.file,
      "profile_pic"
    );
    const d = await apiPostForm("/api/auth/register", fd);
    setAuthSession(req, d.token, d.user);
    req.session.flash = { type: "success", message: d.message };
    return res.redirect(d.user && (d.user.is_admin || d.user.is_super_admin) ? "/admin" : "/dashboard");
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Registration failed." };
    return res.redirect("/register");
  }
});

// GET Login
router.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  res.render("login", { title: `${req.t("nav_login")} - ${res.locals.siteName}` });
});

// POST Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const d = await apiPost("/api/auth/login", { email, password });
    setAuthSession(req, d.token, d.user);
    // Keep the two protected areas separate: /dashboard is the normal user's
    // dashboard, while administrators must enter the admin dashboard.  The
    // old unconditional /dashboard redirect made admin logins land in the
    // wrong area (and, on deployments where that legacy page was absent,
    // appear as a 404).  Only honour a safe return URL for non-admin users;
    // never let a normal user be redirected into the admin area.
    const requestedNext = String(req.query.next || "");
    const isAdmin = Boolean(d.user && (d.user.is_admin || d.user.is_super_admin));
    const next = isAdmin
      ? (requestedNext.startsWith("/admin") ? requestedNext : "/admin")
      : (requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.startsWith("/admin")
        ? requestedNext
        : "/dashboard");
    req.session.flash = { type: "success", message: d.message || `👋 Welcome back, ${d.user.name}!` };
    return res.redirect(next);
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Login error." };
    return res.redirect("/login");
  }
});

// Logout
router.get("/logout", async (req, res) => {
  try {
    if (req.session.token) await apiPost("/api/auth/logout", {}, req.session.token);
  } catch (e) { /* best effort */ }
  invalidateUserCache(req);
  req.session.destroy(() => {});
  res.redirect("/");
});

export default router;
