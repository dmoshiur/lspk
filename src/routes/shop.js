// ==================== Frontend Routes - Shop (API-backed) ====================
// The cart lives in the frontend session; prices/stock/order creation are
// always computed by the backend API (source of truth).
import express from "express";
import multer from "multer";
import { apiGet, apiPost, apiPostForm, apiPutForm, apiDel, buildFormData } from "../api.js";
import { requireLogin, requireAdmin } from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

async function resolveSessionCart(req) {
  const cart = req.session.cart || {};
  if (!Object.keys(cart).length) return { items: [], subtotal: 0, total: 0, count: 0 };
  try {
    return await apiPost("/api/shop/cart/resolve", { cart });
  } catch (e) {
    return { items: [], subtotal: 0, total: 0, count: 0 };
  }
}

// GET /shop
router.get("/", async (req, res) => {
  try {
    const d = await apiGet("/api/shop/products", null, { category: req.query.category, search: req.query.search });
    res.render("shop", { title: "Shop - BloodOra", products: d.products, categories: d.categories, query: req.query });
  } catch (e) {
    console.error(e.message);
    req.session.flash = { type: "danger", message: "❌ Shop loading failed." };
    res.redirect("/");
  }
});

// GET /shop/product/:id
router.get("/product/:id", async (req, res) => {
  try {
    const d = await apiGet(`/api/shop/products/${req.params.id}`);
    res.render("product_detail", { title: d.product.name + " - BloodOra", product: d.product });
  } catch (e) {
    return res.status(404).render("404", { title: "Not Found" });
  }
});

// GET /shop/cart
router.get("/cart", async (req, res) => {
  const { items, subtotal } = await resolveSessionCart(req);
  res.render("cart", { title: "Cart - BloodOra", cart_items: items, total: subtotal });
});

// POST /shop/cart/add/:id  (supports JSON ajax and form)
router.post("/cart/add/:id", async (req, res) => {
  const wantsJson =
    req.headers["x-requested-with"] === "XMLHttpRequest" ||
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json") ||
    req.query.ajax === "1";
  try {
    await apiPost("/api/shop/cart/validate-item", { product_id: req.params.id });
    const cart = req.session.cart || {};
    cart[req.params.id] = (cart[req.params.id] || 0) + 1;
    req.session.cart = cart;
    if (wantsJson) return res.json({ success: true, message: "Added to cart!", cartCount: Object.keys(cart).length });
    req.session.flash = { type: "success", message: "✅ Added to cart!" };
    return res.redirect(req.get("Referer") || "/shop");
  } catch (e) {
    if (wantsJson) return res.json({ success: false, message: e.message || "Error" });
    req.session.flash = { type: e.status === 400 ? "warning" : "danger", message: e.message || "❌ Failed to add to cart." };
    res.redirect("/shop");
  }
});

// POST /shop/cart/remove/:id
router.post("/cart/remove/:id", async (req, res) => {
  const cart = req.session.cart || {};
  delete cart[req.params.id];
  req.session.cart = cart;
  req.session.flash = { type: "info", message: "ℹ️ Item removed from cart." };
  res.redirect("/shop/cart");
});

// POST /shop/cart/update/:id
router.post("/cart/update/:id", async (req, res) => {
  const qty = parseInt(req.body.quantity || 1);
  const cart = req.session.cart || {};
  if (qty > 0) cart[req.params.id] = qty;
  else delete cart[req.params.id];
  req.session.cart = cart;
  res.redirect("/shop/cart");
});

// Cart count API for JS
router.get("/cart/count", (req, res) => {
  const cart = req.session.cart || {};
  res.json({ count: Object.keys(cart).length });
});

// GET /shop/checkout
router.get("/checkout", requireLogin, async (req, res) => {
  const cart = req.session.cart || {};
  if (!cart || Object.keys(cart).length === 0) {
    req.session.flash = { type: "warning", message: "⚠️ Your cart is empty!" };
    return res.redirect("/shop");
  }
  const { items, subtotal } = await resolveSessionCart(req);
  if (items.length === 0) {
    req.session.flash = { type: "warning", message: "⚠️ Your cart is empty!" };
    return res.redirect("/shop");
  }
  const delivery_charge = 0; // shown as placeholder; finalized on submit by the backend
  const total = subtotal + delivery_charge;
  let ctx = { gateway_numbers: {}, user_payment_methods: {}, user_address: {} };
  try {
    ctx = await apiGet("/api/shop/checkout/context", req.session.token);
  } catch (e) { /* keep empty defaults */ }
  res.render("checkout", {
    title: "Checkout - BloodOra",
    cart_items: items, subtotal, delivery_charge, total,
    gateway_numbers: ctx.gateway_numbers,
    user_payment_methods: ctx.user_payment_methods,
    user_address: ctx.user_address,
  });
});

// POST /shop/checkout
router.post("/checkout", requireLogin, async (req, res) => {
  try {
    const cart = req.session.cart || {};
    if (!cart || Object.keys(cart).length === 0) {
      req.session.flash = { type: "warning", message: "⚠️ Your cart is empty!" };
      return res.redirect("/shop");
    }
    const b = req.body;
    const d = await apiPost(
      "/api/shop/orders",
      {
        cart,
        payment_method: b.payment_method,
        delivery_address: b.delivery_address,
        division: b.division,
        district: b.district,
        upazila: b.upazila,
        transaction_id: b.transaction_id,
        bkash_number: b.bkash_number,
        nagad_number: b.nagad_number,
        upay_number: b.upay_number,
        rocket_number: b.rocket_number,
        pathao_number: b.pathao_number,
        card_type: b.card_type,
        card_number: b.card_number,
      },
      req.session.token
    );
    req.session.cart = {};
    req.session.flash = { type: "success", message: d.message };
    return res.redirect(`/shop/order/success/${d.orderId}`);
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Checkout failed. Please try again." };
    return res.redirect("/shop/checkout");
  }
});

// GET /shop/order/success/:id
router.get("/order/success/:id", async (req, res) => {
  try {
    const d = await apiGet(`/api/shop/orders/${req.params.id}`, req.session.token);
    res.render("order_success", { title: "Order Success - BloodOra", order: d.order, items: d.items, orderUser: d.orderUser });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      req.session.flash = { type: "danger", message: e.message || "❌ Unauthorized." };
      return res.redirect("/shop");
    }
    return res.status(404).render("404", { title: "Not Found" });
  }
});

// GET /shop/my-orders
router.get("/my-orders", requireLogin, async (req, res) => {
  try {
    const d = await apiGet("/api/shop/orders/mine", req.session.token);
    res.render("my_orders", { title: "My Orders - BloodOra", orders: d.orders });
  } catch (e) {
    res.render("my_orders", { title: "My Orders - BloodOra", orders: [] });
  }
});

// ============== Admin Shop ==============
router.get("/admin/products", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet("/api/admin/products", req.session.token);
    res.render("admin/products", { title: "Manage Products - Admin", products: d.products, layout: "admin" });
  } catch (e) {
    req.session.flash = { type: "danger", message: "❌ Failed to load products." };
    res.redirect("/admin");
  }
});

router.get("/admin/product/add", requireAdmin, async (req, res) => {
  res.render("admin/product_form", { title: "Add Product - Admin", product: null });
});

router.post("/admin/product/add", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const b = req.body;
    const fd = buildFormData(
      { name: b.name, description: b.description, price: b.price, category: b.category, stock: b.stock },
      req.file,
      "image"
    );
    const d = await apiPostForm("/api/admin/products", fd, req.session.token);
    req.session.flash = { type: "success", message: d.message };
    res.redirect("/shop/admin/products");
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Failed to add product." };
    res.redirect("/shop/admin/products");
  }
});

router.get("/admin/product/edit/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet(`/api/shop/products/${req.params.id}`);
    res.render("admin/product_form", { title: "Edit Product - Admin", product: d.product });
  } catch (e) {
    return res.status(404).render("404", { title: "Not Found" });
  }
});

router.post("/admin/product/edit/:id", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const b = req.body;
    const fd = buildFormData(
      {
        name: b.name, description: b.description, price: b.price, category: b.category,
        stock: b.stock, is_available: b.is_available ? 1 : "",
      },
      req.file,
      "image"
    );
    const d = await apiPutForm(`/api/admin/products/${req.params.id}`, fd, req.session.token);
    req.session.flash = { type: "success", message: d.message };
    res.redirect("/shop/admin/products");
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Failed to edit." };
    res.redirect("/shop/admin/products");
  }
});

router.post("/admin/product/delete/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiDel(`/api/admin/products/${req.params.id}`, req.session.token);
    req.session.flash = { type: "success", message: d.message };
  } catch (e) {
    req.session.flash = { type: "danger", message: e.message || "❌ Failed to delete." };
  }
  res.redirect("/shop/admin/products");
});

// Admin orders
router.get("/admin/orders", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet("/api/admin/orders", req.session.token, { status: req.query.status });
    res.render("admin/orders", { title: "Manage Orders - Admin", orders: d.orders, filter: req.query.status });
  } catch (e) {
    res.render("admin/orders", { title: "Manage Orders - Admin", orders: [], filter: null });
  }
});

router.get("/admin/order/:id", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet(`/api/admin/orders/${req.params.id}`, req.session.token);
    res.render("admin/order_detail", { title: `Order #${d.order.id} - Admin`, order: d.order, items: d.items });
  } catch (e) {
    return res.status(404).render("404", { title: "Not Found" });
  }
});

router.get("/admin/order/:id/invoice", requireAdmin, async (req, res) => {
  try {
    const d = await apiGet(`/api/admin/orders/${req.params.id}`, req.session.token);
    const order = d.order;
    const customer_name = order.user_name || order.guest_name || "Guest";
    const customer_phone = order.user_phone || order.guest_phone || "N/A";
    const customer_email = order.user_email || order.guest_email || "N/A";
    res.render("admin/invoice", { title: `Invoice #${order.id}`, order, items: d.items, customer_name, customer_phone, customer_email });
  } catch (e) {
    return res.status(404).render("404", { title: "Not Found" });
  }
});

router.post("/admin/order/:id/confirm-payment", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost(`/api/admin/orders/${req.params.id}/confirm-payment`, {}, req.session.token);
    req.session.flash = { type: "success", message: d.message };
  } catch (e) {
    req.session.flash = { type: "danger", message: "❌ Failed to confirm payment." };
  }
  res.redirect(`/shop/admin/order/${req.params.id}`);
});

router.post("/admin/order/:id/update-status", requireAdmin, async (req, res) => {
  try {
    const d = await apiPost(`/api/admin/orders/${req.params.id}/status`, { status: req.body.status }, req.session.token);
    req.session.flash = { type: "success", message: d.message };
  } catch (e) {
    req.session.flash = { type: "danger", message: "❌ Failed to update status." };
  }
  res.redirect(`/shop/admin/order/${req.params.id}`);
});

export default router;
