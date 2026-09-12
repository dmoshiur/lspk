import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { get, run, all } from "../db.js";
import { getClientIp, getDeviceFingerprint } from "../middleware/auth.js";
import { calculateAge } from "../utils/locations.js";

const router = express.Router();

// Multer config for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14) + "_" + crypto.randomBytes(4).toString("hex") + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 16*1024*1024 },
  fileFilter: (req,file,cb)=>{
    if (['image/jpeg','image/png','image/jpg','image/gif','image/webp'].includes(file.mimetype)) cb(null,true);
    else cb(null,false);
  }
});

function genToken(){ return uuidv4(); }

// GET Register
router.get("/register", (req,res)=>{
  if (req.user) return res.redirect("/");
  res.render("register", { title: "Register - BloodOra", error:null });
});

// POST Register
router.post("/register", upload.single("profile_pic"), async (req,res)=>{
  try {
    const { name, email, phone, password, blood_group, role, division, district, upazila, union, holding, birth_certificate, date_of_birth } = req.body;
    if (!email || !password || !name) {
      req.session.flash = { type:"danger", message:"❌ Please fill required fields." };
      return res.redirect("/register");
    }
    const existing = await get("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      req.session.flash = { type:"danger", message:"⚠️ Email already registered." };
      return res.redirect("/register");
    }
    let filename = "default.jpg";
    if (req.file) filename = req.file.filename;

    const countRow = await get("SELECT COUNT(*) as c FROM users");
    const isFirstUser = countRow.c === 0;

    let age = null, dob = null;
    if (date_of_birth) {
      try {
        dob = date_of_birth;
        age = calculateAge(date_of_birth);
      } catch(e){}
    }
    if (!age && req.body.age) age = parseInt(req.body.age);

    const is_verified = (age && age >= 18) ? 1 : 0;
    const can_donate = (age && age >= 18) ? 1 : 0;

    const hash = await bcrypt.hash(password, 10);
    const token = genToken();
    const ip = getClientIp(req);
    const device = getDeviceFingerprint(req);
    const now = new Date().toISOString();

    await run(`INSERT INTO users (name,email,phone,division,district,upazila,union_area,address_holding,blood_group,image_file,password_hash,role,age,date_of_birth,birth_certificate_number,is_verified,can_donate,is_admin,is_super_admin,session_token,last_login_ip,last_login_device,last_login_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name,email,phone,division,district,upazila,union,holding,blood_group,filename,hash,role||"Both",age,dob,birth_certificate,is_verified,can_donate, isFirstUser?1:0, isFirstUser?1:0, token, ip, device, now]);

    const user = await get("SELECT * FROM users WHERE email = ?", [email]);
    req.session.userId = user.id;
    req.session.session_token = token;
    req.session.flash = { type:"success", message: is_verified ? "✅ Registration successful! You are verified as a donor (18+)." : "✅ Registration successful! You will be verified when you turn 18." };
    return res.redirect("/");

  } catch(e){
    console.error("Register error:", e);
    req.session.flash = { type:"danger", message:"❌ Registration failed: "+e.message };
    return res.redirect("/register");
  }
});

// GET Login
router.get("/login", (req,res)=>{
  if (req.user) return res.redirect("/");
  res.render("login", { title:"Login - BloodOra" });
});

// POST Login
router.post("/login", async (req,res)=>{
  try {
    const { email, password } = req.body;
    const user = await get("SELECT * FROM users WHERE email = ?", [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      req.session.flash = { type:"danger", message:"❌ Invalid email or password." };
      return res.redirect("/login");
    }
    const token = genToken();
    const ip = getClientIp(req);
    const device = getDeviceFingerprint(req);
    const now = new Date().toISOString();
    await run("UPDATE users SET session_token=?, last_login_ip=?, last_login_device=?, last_login_at=? WHERE id=?", [token, ip, device, now, user.id]);
    req.session.userId = user.id;
    req.session.session_token = token;
    const next = req.query.next || "/";
    req.session.flash = { type:"success", message:`👋 Welcome back, ${user.name}!` };
    return res.redirect(next);
  } catch(e){
    console.error("Login error", e);
    req.session.flash = { type:"danger", message:"❌ Login error." };
    return res.redirect("/login");
  }
});

// Logout
router.get("/logout", (req,res)=>{
  req.session.destroy(()=>{});
  res.redirect("/");
});

export default router;
