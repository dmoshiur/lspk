// ==================== BloodOra - Node.js + Turso Serverless ====================
// Ultra modern, bug-free, fully workable shop & blood donation platform
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import morgan from "morgan";
import helmet from "helmet";
import { createServer } from "http";
import { Server as SocketIO } from "socket.io";

import { initDB } from "./src/db.js";
import { loadUser, getClientIp, getDeviceFingerprint } from "./src/middleware/auth.js";

import authRoutes from "./src/routes/auth.js";
import pageRoutes from "./src/routes/pages.js";
import donorRoutes from "./src/routes/donors.js";
import bloodRoutes from "./src/routes/blood.js";
import shopRoutes from "./src/routes/shop.js";
import adminRoutes from "./src/routes/admin.js";
import messageRoutes from "./src/routes/messages.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// ---------- View Engine ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---------- Security & Logging ----------
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(morgan(isProd ? "combined" : "dev"));

// ---------- Body & Static ----------
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---------- Session (Memory for dev, Turso-ready) ----------
app.use(session({
  secret: process.env.SESSION_SECRET || "blood-donation-secret-key-2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// ---------- Global locals & auth loader ----------
app.use(async (req, res, next) => {
  // Make session available in views (for impersonating check)
  res.locals.session = req.session;
  // Cart count for navbar
  const cart = req.session.cart || {};
  res.locals.sessionCartCount = Object.keys(cart).length;
  res.locals.cartCount = res.locals.sessionCartCount;
  // Flash handling
  if (req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  } else {
    res.locals.flash = null;
  }
  next();
});
app.use(loadUser);

// Also expose settings for footer (optional global)
app.use(async (req, res, next) => {
  // Lazy load settings only for footer if needed - we can fetch once and cache
  // For simplicity, let each page pass settings; footer will fallback
  next();
});

// ---------- Socket.IO (live chat) ----------
io.on("connection", (socket) => {
  // console.log("socket connected:", socket.id);
  socket.on("join", (room) => socket.join(room));
  socket.on("chat:message", (data) => {
    io.emit("chat:message", data);
  });
  socket.on("disconnect", () => {});
});

// ---------- Routes ----------
app.use("/", pageRoutes);
app.use("/", authRoutes);
app.use("/donors", donorRoutes);
app.use("/", bloodRoutes); // includes /request-blood, /blood-requests, /blood-request/:id etc, /urgent
app.use("/shop", shopRoutes);
app.use("/admin", adminRoutes);
app.use("/messages", messageRoutes);

// Aliases for compatibility with Flask url_for names (old Python routes → new Node routes)
app.get("/profile/switch-back", (req, res) => res.redirect("/admin/profile/switch-back"));
app.get("/my_orders", (req, res) => res.redirect("/shop/my-orders"));
// Old Flask shop admin paths → new shop admin
app.get("/admin/shop/products", (req, res) => res.redirect("/shop/admin/products"));
app.get("/admin/shop/product/add", (req, res) => res.redirect("/shop/admin/product/add"));
app.get("/admin/shop/product/edit/:id", (req, res) => res.redirect(`/shop/admin/product/edit/${req.params.id}`));
app.post("/admin/shop/product/delete/:id", (req, res) => res.redirect(307, `/shop/admin/product/delete/${req.params.id}`));
app.get("/admin/shop/orders", (req, res) => res.redirect("/shop/admin/orders"));
app.get("/admin/shop/order/:id", (req, res) => res.redirect(`/shop/admin/order/${req.params.id}`));
app.get("/admin/shop/order/:id/invoice", (req, res) => res.redirect(`/shop/admin/order/${req.params.id}/invoice`));
app.post("/admin/shop/order/:id/confirm-payment", (req, res) => res.redirect(307, `/shop/admin/order/${req.params.id}/confirm-payment`));
app.post("/admin/shop/order/:id/update-status", (req, res) => res.redirect(307, `/shop/admin/order/${req.params.id}/update-status`));
// Old Flask donor/profile root aliases
app.get("/profile/view/:id", (req, res) => res.redirect(`/donors/profile/view/${req.params.id}`));
app.get("/profile/my", (req, res) => res.redirect("/donors/profile/my"));
app.get("/profile/edit", (req, res) => res.redirect("/donors/profile/edit"));
app.post("/toggle_status", (req, res) => res.redirect(307, "/donors/toggle_status"));
app.post("/apply-for-verification", (req, res) => res.redirect(307, "/donors/apply-for-verification"));
// Old Flask admin messages → new
app.get("/admin/messages", (req, res) => res.redirect("/messages/admin/messages"));
app.get("/admin/message/reply/:id", (req, res) => res.redirect(`/messages/admin/message/reply/${req.params.id}`));

// Health check also at /health (already in pageRoutes)

// ---------- 404 & Error ----------
app.use((req, res) => {
  res.status(404).render("404", { title: "404 - Not Found" });
});
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).render("500", { title: "500 - Server Error" });
});

// ---------- Init DB & Start ----------
await initDB();
console.log("✅ BloodOra DB ready — Turso serverless or local file");

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🩸 BloodOra v2.0 — Node.js + Turso Serverless`);
  console.log(`   Theme: SAME as original, Ultra resolution, no removal`);
  console.log(`   Shop: FULLY WORKABLE (cart, Kalai ৳10, invoice, payment save)`);
  console.log(`   URL: http://0.0.0.0:${PORT}`);
  console.log(`   Env: ${isProd ? "production" : "development"} | Turso: ${process.env.TURSO_DATABASE_URL ? "ENABLED ☁️" : "local file 💾"}\n`);
});
