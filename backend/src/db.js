// ==================== BloodOra Backend - Turso / libSQL Database Layer ====================
// Supports both Turso serverless (libsql://) and local file fallback for dev.
import { createClient } from "@libsql/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { antidReference, resourcesReference } from "./content.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TURSO_URL = (process.env.TURSO_DATABASE_URL || "").trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || "").trim();

let clientConfig;
if (TURSO_URL.startsWith("libsql://") || TURSO_URL.startsWith("https://")) {
  clientConfig = { url: TURSO_URL, authToken: TURSO_TOKEN };
  console.log("☁️  Using Turso Serverless DB:", TURSO_URL);
} else {
  // Serverless platforms (e.g. Vercel) only allow writes to /tmp
  const isServerless = Boolean(process.env.VERCEL);
  const dbPath = isServerless
    ? "/tmp/blood_network.db"
    : path.join(__dirname, "../data/blood_network.db");
  if (isServerless) {
    console.warn(
      "⚠️  TURSO_DATABASE_URL is not set to a libsql:// URL — falling back to an EPHEMERAL SQLite file in /tmp (data will not persist between invocations). " +
      "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN as plain values in your Vercel Project Settings -> Environment Variables."
    );
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  clientConfig = { url: `file:${dbPath}` };
  console.log("💾 Using Local SQLite DB:", dbPath);
}

export const db = createClient(clientConfig);

// ---------- Helper wrappers ----------
// libsql rejects `undefined` args — normalize to null everywhere.
const clean = (args) => (Array.isArray(args) ? args.map((a) => (a === undefined ? null : a)) : args);

export async function query(sql, args = []) {
  return await db.execute({ sql, args: clean(args) });
}
export async function get(sql, args = []) {
  const res = await db.execute({ sql, args: clean(args) });
  return res.rows[0] || null;
}
export async function all(sql, args = []) {
  const res = await db.execute({ sql, args: clean(args) });
  return res.rows;
}
export async function run(sql, args = []) {
  return await db.execute({ sql, args: clean(args) });
}

/**
 * Add a column to an existing table if it is missing.
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so we read the table shape first.
 * Used to evolve site_settings (branding, SMTP, AI) without dropping user data.
 */
export async function ensureColumn(table, column, declaration) {
  try {
    const info = await all(`PRAGMA table_info(${table})`);
    const exists = info.some((c) => String(c.name).toLowerCase() === column.toLowerCase());
    if (!exists) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
      console.log(`   ↳ added column ${table}.${column}`);
    }
  } catch (e) {
    console.warn(`   ! ensureColumn ${table}.${column}: ${e.message}`);
  }
}

// ---------- Schema Initialization ----------
export async function initDB() {
  console.log("🔧 Initializing BloodOra database schema...");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      address_holding TEXT,
      division TEXT,
      district TEXT,
      upazila TEXT,
      union_area TEXT,
      blood_group TEXT,
      image_file TEXT NOT NULL DEFAULT 'default.jpg',
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'Both',
      can_donate INTEGER DEFAULT 0,
      last_donation TEXT,
      is_admin INTEGER DEFAULT 0,
      is_super_admin INTEGER DEFAULT 0,
      is_verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      age INTEGER,
      date_of_birth TEXT,
      birth_certificate_number TEXT,
      bkash_number TEXT,
      nagad_number TEXT,
      upay_number TEXT,
      rocket_number TEXT,
      pathao_number TEXT,
      card_last_four TEXT,
      card_type TEXT,
      session_token TEXT,
      last_login_ip TEXT,
      last_login_device TEXT,
      last_login_at TEXT
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_district ON users(district);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_users_blood ON users(blood_group);`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS blood_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER REFERENCES users(id),
      patient_name TEXT NOT NULL,
      patient_relation TEXT,
      blood_group TEXT NOT NULL,
      quantity TEXT DEFAULT '1 unit',
      hospital_name TEXT NOT NULL,
      hospital_address TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_email TEXT,
      is_urgent INTEGER DEFAULT 0,
      urgent_reason TEXT,
      needed_by TEXT NOT NULL,
      is_fulfilled INTEGER DEFAULT 0,
      fulfilled_at TEXT,
      fulfilled_by INTEGER REFERENCES users(id),
      location_division TEXT,
      location_district TEXT,
      location_upazila TEXT,
      additional_info TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_br_blood ON blood_requests(blood_group);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_br_urgent ON blood_requests(is_urgent);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_br_fulfilled ON blood_requests(is_fulfilled);`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      recipient_id INTEGER REFERENCES users(id),
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      is_admin_message INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      replied_to INTEGER REFERENCES messages(id)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS anti_d_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      timing TEXT NOT NULL,
      dosage TEXT NOT NULL,
      image_file TEXT DEFAULT 'antid_default.jpg',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS site_notice (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT,
      content TEXT NOT NULL,
      image_file TEXT,
      is_featured INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_name TEXT DEFAULT 'BloodOra',
      site_email TEXT DEFAULT 'info.bloodora@gmail.com',
      site_phone TEXT DEFAULT '+8801709202140',
      site_address TEXT DEFAULT 'Kalai,Rajshahi, Bangladesh',
      site_description TEXT DEFAULT 'Connecting blood donors to save lives across Bangladesh.',
      facebook_url TEXT DEFAULT 'https://www.facebook.com/profile.php?id=61575592734038',
      twitter_url TEXT DEFAULT '#',
      instagram_url TEXT DEFAULT '#',
      linkedin_url TEXT DEFAULT '#',
      bkash_merchant_number TEXT DEFAULT '01709202140',
      nagad_merchant_number TEXT DEFAULT '01800000000',
      upay_merchant_number TEXT DEFAULT '01600000000',
      rocket_merchant_number TEXT DEFAULT '01900000000',
      pathao_merchant_number TEXT DEFAULT '01500000000',
      site_tagline TEXT DEFAULT 'Donate blood. Save lives.',
      logo_file TEXT DEFAULT 'logo.png',
      favicon_file TEXT DEFAULT 'favicon.png',
      brand_primary TEXT DEFAULT '#e31b23',
      brand_accent TEXT DEFAULT '#ff3340',
      brand_font_style TEXT DEFAULT 'calligraphic',
      default_language TEXT DEFAULT 'en',
      smtp_enabled INTEGER DEFAULT 0,
      smtp_host TEXT DEFAULT '',
      smtp_port INTEGER DEFAULT 587,
      smtp_secure INTEGER DEFAULT 0,
      smtp_user TEXT DEFAULT '',
      smtp_pass TEXT DEFAULT '',
      smtp_from_name TEXT DEFAULT 'BloodOra',
      smtp_from_email TEXT DEFAULT 'no-reply@bloodora.site',
      ai_enabled INTEGER DEFAULT 1,
      ai_provider TEXT DEFAULT 'groq',
      ai_model TEXT DEFAULT 'qwen/qwen3.6-27b',
      ai_api_key TEXT DEFAULT '',
      ai_base_url TEXT DEFAULT 'https://api.groq.com/openai/v1',
      ai_temperature REAL DEFAULT 0.5,
      ai_max_tokens INTEGER DEFAULT 900,
      ai_persona TEXT DEFAULT '',
      ai_prompts TEXT DEFAULT '',
      live_chat_enabled INTEGER DEFAULT 1,
      live_activity_enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrate an existing site_settings table (created before branding/SMTP/AI existed)
  for (const [col, decl] of [
    ["site_tagline", "TEXT DEFAULT 'Donate blood. Save lives.'"],
    ["logo_file", "TEXT DEFAULT 'logo.png'"],
    ["favicon_file", "TEXT DEFAULT 'favicon.png'"],
    ["brand_primary", "TEXT DEFAULT '#e31b23'"],
    ["brand_accent", "TEXT DEFAULT '#ff3340'"],
    ["brand_font_style", "TEXT DEFAULT 'calligraphic'"],
    ["default_language", "TEXT DEFAULT 'en'"],
    ["smtp_enabled", "INTEGER DEFAULT 0"],
    ["smtp_host", "TEXT DEFAULT ''"],
    ["smtp_port", "INTEGER DEFAULT 587"],
    ["smtp_secure", "INTEGER DEFAULT 0"],
    ["smtp_user", "TEXT DEFAULT ''"],
    ["smtp_pass", "TEXT DEFAULT ''"],
    ["smtp_from_name", "TEXT DEFAULT 'BloodOra'"],
    ["smtp_from_email", "TEXT DEFAULT 'no-reply@bloodora.site'"],
    ["ai_enabled", "INTEGER DEFAULT 1"],
    ["ai_provider", "TEXT DEFAULT 'groq'"],
    ["ai_model", "TEXT DEFAULT 'qwen/qwen3.6-27b'"],
    ["ai_api_key", "TEXT DEFAULT ''"],
    ["ai_base_url", "TEXT DEFAULT 'https://api.groq.com/openai/v1'"],
    ["ai_temperature", "REAL DEFAULT 0.5"],
    ["ai_max_tokens", "INTEGER DEFAULT 900"],
    ["ai_persona", "TEXT DEFAULT ''"],
    ["ai_prompts", "TEXT DEFAULT ''"],
    ["live_chat_enabled", "INTEGER DEFAULT 1"],
    ["live_activity_enabled", "INTEGER DEFAULT 1"],
  ]) {
    await ensureColumn("site_settings", col, decl);
  }

  // ---------- Reviews & testimonials ----------
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      author_name TEXT,
      product_id INTEGER REFERENCES products(id),
      kind TEXT DEFAULT 'site',
      rating INTEGER NOT NULL DEFAULT 5,
      title TEXT,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      is_featured INTEGER DEFAULT 0,
      admin_reply TEXT,
      admin_replied_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);`);

  // ---------- Live Messaging (real human support chat) ----------
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id),
      visitor_name TEXT DEFAULT 'Guest',
      last_message TEXT,
      last_message_at TEXT DEFAULT (datetime('now')),
      unread_admin INTEGER DEFAULT 0,
      unread_visitor INTEGER DEFAULT 0,
      is_open INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_key ON chat_sessions(session_key);`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL,
      sender_type TEXT NOT NULL DEFAULT 'visitor',
      sender_name TEXT,
      body TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_chat_messages_key ON chat_messages(session_key);`);

  // ---------- AI Help conversation history ----------
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ai_conv ON ai_messages(conversation_id);`);

  // ---------- Real activity feed (powers the homepage Live Activity) ----------
  await db.execute(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      link TEXT,
      meta TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);`);

  // ---------- Outgoing email log (Admin → SMTP & Email) ----------
  await db.execute(`
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT,
      subject TEXT,
      status TEXT DEFAULT 'sent',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT,
      image_file TEXT DEFAULT 'default_product.jpg',
      stock INTEGER DEFAULT 0,
      is_available INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      guest_email TEXT,
      guest_name TEXT,
      guest_phone TEXT,
      subtotal_amount REAL DEFAULT 0,
      delivery_charge REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_method TEXT,
      payment_status TEXT DEFAULT 'pending',
      transaction_id TEXT,
      delivery_address TEXT,
      delivery_division TEXT,
      delivery_district TEXT,
      delivery_upazila TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT,
      quantity INTEGER DEFAULT 1,
      price REAL NOT NULL
    );
  `);

  // Extend resources with the fields the full Resources page needs
  await ensureColumn("resources", "summary", "TEXT DEFAULT ''");
  await ensureColumn("resources", "read_time", "TEXT DEFAULT ''");

  // Seed defaults
  const settings = await get("SELECT id FROM site_settings LIMIT 1");
  if (!settings) {
    await run(`INSERT INTO site_settings (site_name, site_email, site_phone, site_address) VALUES (?, ?, ?, ?)`, ["BloodOra", "info.bloodora@gmail.com", "+8801709202140", "Kalai,Rajshahi, Bangladesh"]);
    console.log("✅ Seeded site_settings");
  }
  // AI key can be supplied by env on first boot; the Admin Panel can change it later.
  if (process.env.GROQ_API_KEY) {
    const s = await get("SELECT id, ai_api_key FROM site_settings LIMIT 1");
    if (s && !s.ai_api_key) {
      await run("UPDATE site_settings SET ai_api_key=? WHERE id=?", [process.env.GROQ_API_KEY, s.id]);
      console.log("✅ Imported GROQ_API_KEY from the environment into site_settings");
    }
  }

  const antidCount = await get("SELECT COUNT(*) as c FROM anti_d_info");
  if (!antidCount || antidCount.c == 0) {
    for (const ind of antidReference.indications) {
      await run(
        `INSERT INTO anti_d_info (title, description, timing, dosage) VALUES (?, ?, ?, ?)`,
        [ind.condition, `${ind.who}. ${ind.note}`, ind.when, ind.dosage || "See the dosing schedule"]
      );
    }
    console.log(`✅ Seeded ${antidReference.indications.length} anti_d_info entries`);
  }

  const resCount = await get("SELECT COUNT(*) as c FROM resources");
  if (!resCount || resCount.c == 0) {
    for (const [i, r] of resourcesReference.entries()) {
      await run(
        `INSERT INTO resources (title, category, content, image_file, is_featured, summary, read_time) VALUES (?,?,?,?,?,?,?)`,
        [r.title, r.category, r.content, null, i < 4 ? 1 : 0, r.summary, r.readTime]
      );
    }
    console.log(`✅ Seeded ${resourcesReference.length} resources`);
  }

  const reviewCount = await get("SELECT COUNT(*) as c FROM reviews");
  if (!reviewCount || reviewCount.c == 0) {
    const seeded = [
      ["Rahima Begum", "site", 5, "Found an O− donor in 40 minutes", "My brother needed O− at Joypurhat Sadar Hospital at 2am. I posted an urgent request and two verified donors called within 40 minutes. I cannot thank this platform enough.", 1],
      ["Tanvir Ahmed", "site", 5, "Verification took one day", "I registered as a donor on Sunday and an admin verified me by Monday evening. Now I get notified about nearby requests in Kalai.", 0],
      ["Nusrat Jahan", "product", 5, "Rhophylac arrived the same day", "Ordered the Anti-D injection after my 28-week appointment. Delivered in Kalai the same day with a proper invoice.", 1],
      ["Shafiqul Islam", "site", 4, "Shop delivery is Kalai-only", "Excellent service, but please expand delivery beyond Kalai Upazila — the rest of Joypurhat needs this too.", 0],
    ];
    for (const [name, kind, rating, title, body, featured] of seeded) {
      await run(
        `INSERT INTO reviews (author_name, kind, rating, title, body, status, is_featured) VALUES (?,?,?,?,?,'approved',?)`,
        [name, kind, rating, title, body, featured]
      );
    }
    console.log("✅ Seeded 4 starter reviews");
  }
  const prodCount = await get("SELECT COUNT(*) as c FROM products");
  if (prodCount && prodCount.c == 0) {
    const samples = [
      ["Amaryl M 1mg Tablet", "Diabetes medicine - Glimepiride + Metformin. Pack of 30 tablets.", 245, "Medicine", 50],
      ["Uromax 0.4mg Capsule", "Tamsulosin for BPH treatment. 30 capsules.", 320, "Medicine", 30],
      ["CoralCal-DX 600mg", "Calcium + Vitamin D3 supplement. 30 tablets.", 180, "Supplements", 100],
      ["CoralCal-D 500mg", "Calcium supplement for bone health. 30 tablets.", 150, "Supplements", 80],
      ["AlphaPress 1mg", "Prazosin for hypertension. 30 tablets.", 210, "Medicine", 40],
      ["Bilastin 20mg", "Antihistamine for allergies. 10 tablets.", 120, "Medicine", 60],
      ["Rhophylac Anti-D 300mcg", "Anti-D Immunoglobulin injection.", 2850, "Medicine", 15],
      ["Surgel 40mg", "Esomeprazole for acidity. 14 capsules.", 95, "Medicine", 70],
      ["Digital BP Monitor", "Automatic upper arm blood pressure monitor with memory.", 2250, "Equipment", 20],
      ["First Aid Kit", "Complete emergency first aid box with 50+ items.", 850, "Healthcare", 25],
    ];
    for (const [name, desc, price, cat, stock] of samples) {
      await run(`INSERT INTO products (name, description, price, category, stock) VALUES (?, ?, ?, ?, ?)`, [name, desc, price, cat, stock]);
    }
    console.log("✅ Seeded 10 sample products");
  }

  await seedSuperAdmin();
  console.log("✅ Database initialization complete!");
}

// Creates/confirms a Super Admin account driven entirely by environment variables.
export async function seedSuperAdmin() {
  const email = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email) {
    console.log("ℹ️  SUPER_ADMIN_EMAIL not set — skipping super admin provisioning.");
    return;
  }
  const password = (process.env.SUPER_ADMIN_PASSWORD || "").trim();
  const name = (process.env.SUPER_ADMIN_NAME || "Super Admin").trim();
  const phone = (process.env.SUPER_ADMIN_PHONE || "+8801000000000").trim();

  const existing = await get("SELECT * FROM users WHERE email = ?", [email]);
  if (existing) {
    await run(
      "UPDATE users SET is_admin=1, is_super_admin=1, is_verified=1, can_donate=1 WHERE email=?",
      [email]
    );
    console.log("✅ Super Admin account confirmed:", email);
    return;
  }

  if (!password || password.length < 6) {
    console.warn(
      "⚠️  SUPER_ADMIN_EMAIL set but SUPER_ADMIN_PASSWORD is missing/short — skipping super admin provisioning."
    );
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await run(
    `INSERT INTO users (name, email, phone, blood_group, password_hash, role, age,
      is_admin, is_super_admin, is_verified, can_donate, district, upazila)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [name, email, phone, "O+", hash, "Both", 25, 1, 1, 1, 1, "Joypurhat", "Kalai"]
  );
  console.log("✅ Provisioned Super Admin:", email);
}

// Auto-init if run directly:  node src/db.js --init
if (process.argv.includes("--init")) {
  initDB().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
