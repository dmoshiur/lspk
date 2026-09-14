// ==================== Frontend Routes - Auth (API-backed) ====================
// Forms POST here; the server forwards to the backend API and keeps the
// returned JWT in the session.
import express from "express";
import multer from "multer";
import { apiGet, apiPost, apiPostForm, buildFormData } from "../api.js";
import { invalidateUserCache, normalizeUser, accountHome } from "../middleware/auth.js";
import { bangladeshData as localBangladeshData } from "../utils/locations.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

function setAuthSession(req, token, user) {
  if (typeof token !== "string" || !token) throw new Error(req.t("auth_unavailable"));
  user = normalizeUser(user);
  req.session.token = token;
  req.session.userId = user.id;
  req.session.userCache = { user, at: Date.now() };
}

// GET Register
router.get("/register", async (req, res) => {
  if (req.user) return res.redirect(accountHome(req.user));
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
    return res.redirect(accountHome(req.session.userCache.user));
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Registration failed." };
    return res.redirect("/register");
  }
});

// GET Login
router.get("/login", (req, res) => {
  if (req.user) return res.redirect(accountHome(req.user));
  res.render("login", { title: `${req.t("nav_login")} - ${res.locals.siteName}` });
});

// POST Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const d = await apiPost("/api/auth/login", { email, password });
    setAuthSession(req, d.token, d.user);
    // Canonical, registered destinations only. Do not accept arbitrary `next`
    // URLs (including missing pages, logout or a different role's area).
    const next = accountHome(req.session.userCache.user);
    req.session.flash = { type: "success", message: req.t("dash_welcome", { name: d.user.name }) };
    return res.redirect(next);
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Login error." };
    return res.redirect("/login");
  }
});

// Logout
router.route("/logout").get(logout).post(logout);
async function logout(req, res) {
  try {
    if (req.session.token) await apiPost("/api/auth/logout", {}, req.session.token);
  } catch (e) { /* best effort */ }
  invalidateUserCache(req);
  req.session.destroy(() => {
    res.clearCookie("connect.sid", { path: "/" });
    res.redirect("/");
  });
}

export default router;
