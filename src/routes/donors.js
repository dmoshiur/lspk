import express from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { get, all, run } from "../db.js";
import { requireLogin } from "../middleware/auth.js";
import { calculateAge } from "../utils/locations.js";

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

// List donors
router.get("/", async (req,res)=>{
  try{
    const { bg, dist, upa, age_min } = req.query;
    let sql="SELECT * FROM users WHERE can_donate=1 AND is_verified=1";
    const params=[];
    if (bg){ sql+=" AND blood_group=?"; params.push(bg); }
    if (dist){ sql+=" AND district LIKE ?"; params.push(`%${dist}%`); }
    if (upa){ sql+=" AND upazila LIKE ?"; params.push(`%${upa}%`); }
    if (age_min){ sql+=" AND age >= ?"; params.push(parseInt(age_min)); }
    sql+=" ORDER BY created_at DESC";
    const users = await all(sql, params);
    res.render("donors", { title:"Donors - BloodOra", users, query:req.query });
  }catch(e){
    console.error(e);
    res.render("donors", { title:"Donors - BloodOra", users:[], query:{} });
  }
});

// View profile
router.get("/profile/view/:id", async (req,res)=>{
  const user = await get("SELECT * FROM users WHERE id=?",[req.params.id]);
  if (!user) return res.status(404).render("404",{title:"Not Found"});
  user.is_verified = !!user.is_verified; user.can_donate=!!user.can_donate; user.is_admin=!!user.is_admin;
  res.render("profile_view", { title: user.name+" - Profile", user });
});

// My profile
router.get("/profile/my", requireLogin, async (req,res)=>{
  res.render("my_profile", { title:"My Profile - BloodOra", user:req.user });
});

// Edit profile
router.get("/profile/edit", requireLogin, async (req,res)=>{
  res.render("edit_profile", { title:"Edit Profile - BloodOra", user:req.user });
});
router.post("/profile/edit", requireLogin, upload.single("profile_pic"), async (req,res)=>{
  try{
    const { name, phone, holding, birth_certificate, date_of_birth } = req.body;
    let age = req.user.age;
    let dob = req.user.date_of_birth;
    if (date_of_birth){
      dob = date_of_birth;
      age = calculateAge(date_of_birth);
    }
    let image_file = req.user.image_file;
    if (req.file) image_file = req.file.filename;
    await run(`UPDATE users SET name=?, phone=?, address_holding=?, birth_certificate_number=?, date_of_birth=?, age=?, image_file=? WHERE id=?`,
      [name, phone, holding, birth_certificate, dob, age, image_file, req.user.id]);
    req.session.flash={type:"success", message:"✅ Profile updated successfully!"};
    res.redirect("/donors/profile/my");
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Update failed."};
    res.redirect("/donors/profile/edit");
  }
});

// Toggle donation status
router.post("/toggle_status", requireLogin, async (req,res)=>{
  try{
    const newVal = req.user.can_donate ? 0 : 1;
    await run("UPDATE users SET can_donate=? WHERE id=?",[newVal, req.user.id]);
    req.session.flash={type:"success", message:`✅ Donation status updated: ${newVal?'Available':'Unavailable'}`};
  }catch(e){ req.session.flash={type:"danger", message:"❌ Status update failed."}; }
  res.redirect(req.get('Referer')||"/donors/profile/my");
});

router.post("/apply-for-verification", requireLogin, async (req,res)=>{
  if (req.user.age && req.user.age>=18){
    req.session.flash={type:"info", message:"ℹ️ Verification request submitted. Admin will review within 24 hours."};
  } else {
    req.session.flash={type:"warning", message:"⚠️ You must be 18+ to apply."};
    return res.redirect("/donors/profile/edit");
  }
  res.redirect("/donors/profile/my");
});

export default router;
