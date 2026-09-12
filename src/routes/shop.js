import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { get, all, run } from "../db.js";
import { requireLogin, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req,file,cb)=>cb(null,"uploads/"),
  filename: (req,file,cb)=>{
    const ext=path.extname(file.originalname);
    cb(null, new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14)+"_"+crypto.randomBytes(4).toString("hex")+ext);
  }
});
const upload = multer({
  storage,
  limits:{fileSize:16*1024*1024},
  fileFilter:(req,file,cb)=>{ if(['image/jpeg','image/png','image/jpg','image/gif','image/webp'].includes(file.mimetype)) cb(null,true); else cb(null,false); }
});

// Helper to get cart total
async function getCartDetails(cart) {
  if (!cart || typeof cart !== 'object') return { items: [], subtotal:0, total:0, count:0 };
  const items=[];
  let subtotal=0;
  for (const [pid, qty] of Object.entries(cart)) {
    const product = await get("SELECT * FROM products WHERE id=? AND is_available=1", [pid]);
    if (product) {
      const quantity = parseInt(qty);
      const itemSubtotal = product.price * quantity;
      subtotal += itemSubtotal;
      items.push({ product, quantity, subtotal: itemSubtotal });
    }
  }
  return { items, subtotal, total: subtotal, count: Object.keys(cart).length };
}

// GET /shop
router.get("/", async (req,res)=>{
  try {
    const { category, search } = req.query;
    let sql = "SELECT * FROM products WHERE is_available=1";
    const params=[];
    if (category) { sql += " AND category=?"; params.push(category); }
    if (search) { sql += " AND name LIKE ?"; params.push(`%${search}%`); }
    sql += " ORDER BY created_at DESC";
    const products = await all(sql, params);
    const cats = await all("SELECT DISTINCT category FROM products WHERE category IS NOT NULL");
    const categories = cats.map(c=>c.category).filter(Boolean);
    res.render("shop", { title:"Shop - BloodOra", products, categories, query:req.query });
  } catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Shop loading failed."};
    res.redirect("/");
  }
});

// GET /shop/product/:id
router.get("/product/:id", async (req,res)=>{
  const product = await get("SELECT * FROM products WHERE id=?", [req.params.id]);
  if (!product) return res.status(404).render("404", { title:"Not Found" });
  res.render("product_detail", { title: product.name+" - BloodOra", product });
});

// GET /shop/cart
router.get("/cart", async (req,res)=>{
  const cart = req.session.cart || {};
  const { items, subtotal } = await getCartDetails(cart);
  res.render("cart", { title:"Cart - BloodOra", cart_items: items, total: subtotal });
});

// POST /shop/cart/add/:id  (supports JSON ajax and form)
router.post("/cart/add/:id", async (req,res)=>{
  try{
    const pid = req.params.id;
    const product = await get("SELECT * FROM products WHERE id=? AND is_available=1",[pid]);
    if (!product) {
      if (req.headers.accept?.includes("application/json")) return res.json({ success:false, message:"Product not found"});
      req.session.flash={type:"danger", message:"❌ Product not found."};
      return res.redirect("/shop");
    }
    if (product.stock <=0) {
      if (req.headers.accept?.includes("application/json")) return res.json({ success:false, message:"Out of stock"});
      req.session.flash={type:"warning", message:"⚠️ Out of stock."};
      return res.redirect("/shop");
    }
    const cart = req.session.cart || {};
    cart[pid] = (cart[pid]||0)+1;
    req.session.cart = cart;
    // If AJAX request expects JSON
    const wantsJson = req.headers['x-requested-with']==='XMLHttpRequest' || req.headers.accept?.includes('application/json') || req.query.ajax==='1';
    // Also check if fetch from JS sends json content type, we still return json for API usage
    if (wantsJson || req.headers['content-type']?.includes('application/json')) {
      return res.json({ success:true, message:`${product.name} added to cart!`, cartCount: Object.keys(cart).length });
    }
    req.session.flash={type:"success", message:`✅ ${product.name} added to cart!`};
    return res.redirect(req.get('Referer') || '/shop');
  }catch(e){
    console.error(e);
    if (req.headers.accept?.includes("application/json")) return res.json({ success:false, message:"Error"});
    req.session.flash={type:"danger", message:"❌ Failed to add to cart."};
    res.redirect("/shop");
  }
});

// POST /shop/cart/remove/:id
router.post("/cart/remove/:id", async (req,res)=>{
  const cart = req.session.cart || {};
  delete cart[req.params.id];
  req.session.cart = cart;
  req.session.flash={type:"info", message:"ℹ️ Item removed from cart."};
  res.redirect("/shop/cart");
});

// POST /shop/cart/update/:id
router.post("/cart/update/:id", async (req,res)=>{
  const qty = parseInt(req.body.quantity||1);
  const cart = req.session.cart || {};
  if (qty>0) cart[req.params.id]=qty;
  else delete cart[req.params.id];
  req.session.cart = cart;
  res.redirect("/shop/cart");
});

// Cart count API for JS
router.get("/cart/count", (req,res)=>{
  const cart = req.session.cart || {};
  res.json({ count: Object.keys(cart).length });
});

// GET /shop/checkout
router.get("/checkout", requireLogin, async (req,res)=>{
  const cart = req.session.cart || {};
  if (!cart || Object.keys(cart).length===0) {
    req.session.flash={type:"warning", message:"⚠️ Your cart is empty!"};
    return res.redirect("/shop");
  }
  const { items, subtotal } = await getCartDetails(cart);
  if (items.length===0) {
    req.session.flash={type:"warning", message:"⚠️ Your cart is empty!"};
    return res.redirect("/shop");
  }
  const delivery_charge = 0; // initially 0 until form submit logic, but show placeholder
  const total = subtotal + delivery_charge;
  // user payment methods
  const user = req.user;
  const settings = await get("SELECT * FROM site_settings LIMIT 1");
  const gateway_numbers = {
    bkash: settings?.bkash_merchant_number || "01709202140",
    nagad: settings?.nagad_merchant_number || "01800000000",
    upay: settings?.upay_merchant_number || "01600000000",
    rocket: settings?.rocket_merchant_number || "01900000000",
    pathao: settings?.pathao_merchant_number || "01500000000",
  };
  const user_payment_methods = {
    bkash: user.bkash_number, nagad:user.nagad_number, upay:user.upay_number,
    rocket:user.rocket_number, pathao:user.pathao_number,
    card_last_four:user.card_last_four, card_type:user.card_type
  };
  const user_address = {
    division: user.division||"", district:user.district||"", upazila:user.upazila||"", address:user.address_holding||""
  };
  res.render("checkout", { title:"Checkout - BloodOra", cart_items:items, subtotal, delivery_charge, total, gateway_numbers, user_payment_methods, user_address });
});

// POST /shop/checkout
router.post("/checkout", requireLogin, async (req,res)=>{
  try{
    const cart = req.session.cart || {};
    if (!cart || Object.keys(cart).length===0) {
      req.session.flash={type:"warning", message:"⚠️ Your cart is empty!"};
      return res.redirect("/shop");
    }
    const { items, subtotal } = await getCartDetails(cart);
    if (items.length===0) return res.redirect("/shop");

    const { payment_method, delivery_address, division, district, upazila, transaction_id,
      bkash_number, nagad_number, upay_number, rocket_number, pathao_number, card_type, card_number } = req.body;

    // Delivery validation: only Kalai allowed (case-insensitive, supports Bengali)
    const upazilaNorm = (upazila||"").toLowerCase().trim();
    let delivery_charge = 0;
    if (upazilaNorm.includes("kalai") || upazilaNorm.includes("কলাই")) {
      delivery_charge = 10;
    } else {
      req.session.flash={type:"danger", message:"❌ Sorry! Home delivery is currently ONLY available in Kalai Upazila."};
      return res.redirect("/shop/checkout");
    }

    const total = subtotal + delivery_charge;

    // Save payment method to user
    if (payment_method === "bKash" || payment_method === "bkash") {
      await run("UPDATE users SET bkash_number=? WHERE id=?", [bkash_number, req.user.id]);
    } else if (payment_method === "Nagad" || payment_method === "nagad") {
      await run("UPDATE users SET nagad_number=? WHERE id=?", [nagad_number, req.user.id]);
    } else if (payment_method === "Upay" || payment_method === "upay") {
      await run("UPDATE users SET upay_number=? WHERE id=?", [upay_number, req.user.id]);
    } else if (payment_method === "Rocket" || payment_method === "rocket") {
      await run("UPDATE users SET rocket_number=? WHERE id=?", [rocket_number, req.user.id]);
    } else if (payment_method === "Pathao" || payment_method === "pathao") {
      await run("UPDATE users SET pathao_number=? WHERE id=?", [pathao_number, req.user.id]);
    } else if (payment_method === "Card" || payment_method === "card") {
      const last4 = card_number ? card_number.slice(-4) : null;
      await run("UPDATE users SET card_type=?, card_last_four=? WHERE id=?", [card_type, last4, req.user.id]);
    }

    // Create order
    const now = new Date().toISOString();
    const result = await run(`INSERT INTO orders (user_id, subtotal_amount, delivery_charge, total_amount, payment_method, payment_status, transaction_id, delivery_address, delivery_division, delivery_district, delivery_upazila, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, subtotal, delivery_charge, total, payment_method, "pending", transaction_id, delivery_address, division, district, upazila, "pending", now, now]);

    // get last inserted id via sqlite last_insert_rowid()
    const orderRow = await get("SELECT last_insert_rowid() as id");
    let orderId = orderRow?.id;
    if (!orderId) {
      // fallback: get max id for this user
      const m = await get("SELECT id FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 1",[req.user.id]);
      orderId = m?.id;
    }

    for (const item of items) {
      await run(`INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES (?,?,?,?,?)`,
        [orderId, item.product.id, item.product.name, item.quantity, item.product.price]);
      // optionally reduce stock
      await run(`UPDATE products SET stock = stock - ? WHERE id=? AND stock >= ?`, [item.quantity, item.product.id, item.quantity]);
    }

    req.session.cart = {};
    req.session.flash={type:"success", message:"✅ Order placed successfully! Admin will confirm your payment."};
    return res.redirect(`/shop/order/success/${orderId}`);

  } catch(e){
    console.error("Checkout error:", e);
    req.session.flash={type:"danger", message:"❌ Checkout failed. Please try again."};
    return res.redirect("/shop/checkout");
  }
});

// GET /shop/order/success/:id
router.get("/order/success/:id", async (req,res)=>{
  const order = await get("SELECT * FROM orders WHERE id=?", [req.params.id]);
  if (!order) return res.status(404).render("404",{title:"Not Found"});
  // ideally ensure user owns order or admin
  if (order.user_id && req.user && order.user_id !== req.user.id && !req.user.is_admin) {
    req.session.flash={type:"danger", message:"❌ Unauthorized."};
    return res.redirect("/shop");
  }
  const items = await all("SELECT * FROM order_items WHERE order_id=?", [order.id]);
  // fetch user for display
  let orderUser = null;
  if (order.user_id) orderUser = await get("SELECT * FROM users WHERE id=?",[order.user_id]);
  res.render("order_success", { title:"Order Success - BloodOra", order, items, orderUser });
});

// GET /shop/my-orders
router.get("/my-orders", requireLogin, async (req,res)=>{
  const orders = await all("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", [req.user.id]);
  res.render("my_orders", { title:"My Orders - BloodOra", orders });
});

// ============== Admin Shop ==============
router.get("/admin/products", requireAdmin, async (req,res)=>{
  const products = await all("SELECT * FROM products ORDER BY created_at DESC");
  res.render("admin/products", { title:"Manage Products - Admin", products, layout:"admin" });
});

router.get("/admin/product/add", requireAdmin, async (req,res)=>{
  res.render("admin/product_form", { title:"Add Product - Admin", product:null });
});

router.post("/admin/product/add", requireAdmin, upload.single("image"), async (req,res)=>{
  try{
    const { name, description, price, category, stock } = req.body;
    let filename="default_product.jpg";
    if (req.file) filename=req.file.filename;
    await run(`INSERT INTO products (name, description, price, category, stock, image_file, is_available) VALUES (?,?,?,?,?,?,1)`,
      [name, description, parseFloat(price), category, parseInt(stock||0), filename]);
    req.session.flash={type:"success", message:`✅ Product '${name}' added!`};
    res.redirect("/shop/admin/products");
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Failed to add product."};
    res.redirect("/shop/admin/products");
  }
});

router.get("/admin/product/edit/:id", requireAdmin, async (req,res)=>{
  const product = await get("SELECT * FROM products WHERE id=?",[req.params.id]);
  if (!product) return res.status(404).render("404",{title:"Not Found"});
  res.render("admin/product_form", { title:"Edit Product - Admin", product });
});

router.post("/admin/product/edit/:id", requireAdmin, upload.single("image"), async (req,res)=>{
  try{
    const product = await get("SELECT * FROM products WHERE id=?",[req.params.id]);
    if (!product) return res.redirect("/shop/admin/products");
    const { name, description, price, category, stock, is_available } = req.body;
    let filename = product.image_file;
    if (req.file) {
      filename = req.file.filename;
      // optionally delete old file if not default
    }
    const avail = is_available ? 1 : 0;
    await run(`UPDATE products SET name=?, description=?, price=?, category=?, stock=?, image_file=?, is_available=? WHERE id=?`,
      [name, description, parseFloat(price), category, parseInt(stock||0), filename, avail, req.params.id]);
    req.session.flash={type:"success", message:`✅ Product '${name}' updated!`};
    res.redirect("/shop/admin/products");
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Failed to edit."};
    res.redirect("/shop/admin/products");
  }
});

router.post("/admin/product/delete/:id", requireAdmin, async (req,res)=>{
  try{
    const product = await get("SELECT * FROM products WHERE id=?",[req.params.id]);
    if (product) {
      await run("DELETE FROM products WHERE id=?",[req.params.id]);
      req.session.flash={type:"success", message:`✅ Product '${product.name}' deleted.`};
    }
    res.redirect("/shop/admin/products");
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Failed to delete."};
    res.redirect("/shop/admin/products");
  }
});

// Admin orders
router.get("/admin/orders", requireAdmin, async (req,res)=>{
  const { status } = req.query;
  let sql="SELECT o.*, u.name as user_name FROM orders o LEFT JOIN users u ON o.user_id=u.id";
  const params=[];
  if (status) { sql+=" WHERE o.status=?"; params.push(status); }
  sql+=" ORDER BY o.created_at DESC";
  const orders = await all(sql, params);
  res.render("admin/orders", { title:"Manage Orders - Admin", orders, filter:status });
});

router.get("/admin/order/:id", requireAdmin, async (req,res)=>{
  const order = await get("SELECT o.*, u.name as user_name, u.phone as user_phone, u.email as user_email FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.id=?",[req.params.id]);
  if (!order) return res.status(404).render("404",{title:"Not Found"});
  const items = await all("SELECT oi.*, p.image_file FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?",[req.params.id]);
  res.render("admin/order_detail", { title:`Order #${order.id} - Admin`, order, items });
});

router.get("/admin/order/:id/invoice", requireAdmin, async (req,res)=>{
  const order = await get("SELECT o.*, u.name as user_name, u.phone as user_phone, u.email as user_email FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.id=?",[req.params.id]);
  if (!order) return res.status(404).render("404",{title:"Not Found"});
  const items = await all("SELECT * FROM order_items WHERE order_id=?",[req.params.id]);
  let customer_name = order.user_name || order.guest_name || "Guest";
  let customer_phone = order.user_phone || order.guest_phone || "N/A";
  let customer_email = order.user_email || order.guest_email || "N/A";
  res.render("admin/invoice", { title:`Invoice #${order.id}`, order, items, customer_name, customer_phone, customer_email });
});

router.post("/admin/order/:id/confirm-payment", requireAdmin, async (req,res)=>{
  await run("UPDATE orders SET payment_status='confirmed', status='processing', updated_at=? WHERE id=?",[new Date().toISOString(), req.params.id]);
  req.session.flash={type:"success", message:"✅ Payment confirmed! Order is now processing."};
  res.redirect(`/shop/admin/order/${req.params.id}`);
});

router.post("/admin/order/:id/update-status", requireAdmin, async (req,res)=>{
  const { status } = req.body;
  await run("UPDATE orders SET status=?, updated_at=? WHERE id=?",[status, new Date().toISOString(), req.params.id]);
  req.session.flash={type:"success", message:`✅ Order status updated to ${status}.`};
  res.redirect(`/shop/admin/order/${req.params.id}`);
});

export default router;
