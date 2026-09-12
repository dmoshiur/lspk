import express from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { get, all, run } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { getClientIp, getDeviceFingerprint } from "../middleware/auth.js";

const router = express.Router();

function genToken(){ return uuidv4(); }

router.get("/", requireAdmin, async (req,res)=>{
  try{
    const users = await all("SELECT * FROM users ORDER BY datetime(created_at) DESC");
    const total_users = (await get("SELECT COUNT(*) as c FROM users"))?.c || 0;
    const total_donors = (await get("SELECT COUNT(*) as c FROM users WHERE can_donate=1 AND is_verified=1"))?.c || 0;
    const admins = (await get("SELECT COUNT(*) as c FROM users WHERE is_admin=1"))?.c || 0;
    const unread_messages = (await get("SELECT COUNT(*) as c FROM messages WHERE recipient_id IS NULL AND is_read=0"))?.c || 0;
    const pending_verifications = (await get("SELECT COUNT(*) as c FROM users WHERE is_verified=0 AND age>=18"))?.c || 0;
    const urgent_requests = (await get("SELECT COUNT(*) as c FROM blood_requests WHERE is_urgent=1 AND is_fulfilled=0"))?.c || 0;
    const total_products = (await get("SELECT COUNT(*) as c FROM products"))?.c || 0;
    const total_orders = (await get("SELECT COUNT(*) as c FROM orders"))?.c || 0;
    const pending_orders = (await get("SELECT COUNT(*) as c FROM orders WHERE status='pending'"))?.c || 0;
    const stats={ total_users, total_donors, admins, unread_messages, pending_verifications, urgent_requests, total_products, total_orders, pending_orders };
    const notice = await get("SELECT * FROM site_notice LIMIT 1");
    const curr_note = notice?.content || "";
    const settings = await get("SELECT * FROM site_settings LIMIT 1");
    // normalize bools for users
    users.forEach(u=>{ u.is_admin=!!u.is_admin; u.is_super_admin=!!u.is_super_admin; u.is_verified=!!u.is_verified; u.can_donate=!!u.can_donate; });
    res.render("admin/dashboard", { title:"Admin Dashboard - BloodOra", all_users:users, stats, current_notice:curr_note, settings, now: new Date() });
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Dashboard failed to load."};
    res.redirect("/");
  }
});

router.get("/settings", requireAdmin, async (req,res)=>{
  const settings = await get("SELECT * FROM site_settings LIMIT 1") || {};
  res.render("admin/settings", { title:"Site Settings - Admin", settings });
});
router.post("/settings", requireAdmin, async (req,res)=>{
  try{
    let settings = await get("SELECT * FROM site_settings LIMIT 1");
    if (!settings){
      await run(`INSERT INTO site_settings (site_name) VALUES (?)`,["BloodOra"]);
      settings = await get("SELECT * FROM site_settings LIMIT 1");
    }
    const fields = ["site_name","site_email","site_phone","site_address","site_description","facebook_url","twitter_url","instagram_url","linkedin_url","bkash_merchant_number","nagad_merchant_number","upay_merchant_number","rocket_merchant_number","pathao_merchant_number"];
    const updates = fields.map(f=> `${f}=?`).join(", ");
    const values = fields.map(f=> req.body[f] || settings[f]);
    values.push(settings.id);
    await run(`UPDATE site_settings SET ${updates}, updated_at=? WHERE id=?`, [...values.slice(0,fields.length), new Date().toISOString(), settings.id]);
    // need to handle offset correctly
    // Actually rebuild properly
    req.session.flash={type:"success", message:"✅ Site settings updated successfully!"};
    res.redirect("/admin/settings");
  } catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Failed to update."};
    res.redirect("/admin/settings");
  }
});

// Fix settings update more robustly
router.post("/settings", requireAdmin, async (req,res)=>{ // duplicate - Express will use first; we handle above properly now via separate logic
});

// Keep correct handler: override
// We'll implement a cleaner POST for settings (fallback)
router.post("/settings-update", requireAdmin, async (req,res)=>{
  try{
    const s = await get("SELECT * FROM site_settings LIMIT 1");
    await run(`UPDATE site_settings SET site_name=?, site_email=?, site_phone=?, site_address=?, site_description=?, facebook_url=?, twitter_url=?, instagram_url=?, linkedin_url=?, bkash_merchant_number=?, nagad_merchant_number=?, upay_merchant_number=?, rocket_merchant_number=?, pathao_merchant_number=?, updated_at=? WHERE id=?`,
      [req.body.site_name||s.site_name, req.body.site_email||s.site_email, req.body.site_phone||s.site_phone, req.body.site_address||s.site_address, req.body.site_description||s.site_description, req.body.facebook_url||s.facebook_url, req.body.twitter_url||s.twitter_url, req.body.instagram_url||s.instagram_url, req.body.linkedin_url||s.linkedin_url, req.body.bkash_merchant_number||s.bkash_merchant_number, req.body.nagad_merchant_number||s.nagad_merchant_number, req.body.upay_merchant_number||s.upay_merchant_number, req.body.rocket_merchant_number||s.rocket_merchant_number, req.body.pathao_merchant_number||s.pathao_merchant_number, new Date().toISOString(), s.id]);
    req.session.flash={type:"success", message:"✅ Site settings updated!"};
    res.redirect("/admin/settings");
  }catch(e){ console.error(e); res.redirect("/admin/settings"); }
});

router.post("/verify-donor/:id", requireAdmin, async (req,res)=>{
  const user = await get("SELECT * FROM users WHERE id=?",[req.params.id]);
  if (user && user.age>=18){
    await run("UPDATE users SET is_verified=1 WHERE id=?",[req.params.id]);
    req.session.flash={type:"success", message:`✅ ${user.name} is now a verified donor!`};
  } else {
    req.session.flash={type:"warning", message:"⚠️ User must be 18+ to be verified."};
  }
  res.redirect("/admin");
});

router.get("/promote/:id", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin){ req.session.flash={type:"warning", message:"⚠️ Only Super Admin can promote."}; return res.redirect("/admin"); }
  await run("UPDATE users SET is_admin=1 WHERE id=?",[req.params.id]);
  const u = await get("SELECT name FROM users WHERE id=?",[req.params.id]);
  req.session.flash={type:"success", message:`✅ ${u?.name} is now an Admin.`};
  res.redirect("/admin");
});
router.get("/demote/:id", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin){ req.session.flash={type:"danger", message:"❌ Unauthorized."}; return res.redirect("/admin"); }
  const u = await get("SELECT * FROM users WHERE id=?",[req.params.id]);
  if (u?.is_super_admin){ req.session.flash={type:"warning", message:"⚠️ Cannot demote Super Admin."}; return res.redirect("/admin"); }
  await run("UPDATE users SET is_admin=0 WHERE id=?",[req.params.id]);
  req.session.flash={type:"info", message:`ℹ️ Admin rights removed from ${u.name}.`};
  res.redirect("/admin");
});
router.get("/delete/:id", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin){ req.session.flash={type:"danger", message:"❌ Unauthorized."}; return res.redirect("/admin"); }
  const u = await get("SELECT * FROM users WHERE id=?",[req.params.id]);
  if (!u) return res.redirect("/admin");
  if (u.is_super_admin){ req.session.flash={type:"warning", message:"⚠️ Cannot delete Super Admin."}; return res.redirect("/admin"); }
  if (u.id===req.user.id){ req.session.flash={type:"warning", message:"⚠️ Cannot delete your own account."}; return res.redirect("/admin"); }
  await run("DELETE FROM users WHERE id=?",[req.params.id]);
  req.session.flash={type:"success", message:`✅ User '${u.name}' deleted.`};
  res.redirect("/admin");
});
router.post("/notice", requireAdmin, async (req,res)=>{
  const content=(req.body.notice_content||"").trim();
  if (!content){ req.session.flash={type:"warning", message:"⚠️ Notice cannot be empty."}; return res.redirect("/admin"); }
  const notice = await get("SELECT * FROM site_notice LIMIT 1");
  if (!notice) await run("INSERT INTO site_notice (content, active) VALUES (?,1)",[content]);
  else await run("UPDATE site_notice SET content=?, updated_at=? WHERE id=?",[content, new Date().toISOString(), notice.id]);
  req.session.flash={type:"success", message:"✅ Site notice updated."};
  res.redirect("/admin");
});
router.get("/notice/clear", requireAdmin, async (req,res)=>{
  await run("DELETE FROM site_notice");
  req.session.flash={type:"info", message:"ℹ️ Notice cleared."};
  res.redirect("/admin");
});

// Super admin user management
router.post("/user/update/:id", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin){ req.session.flash={type:"danger", message:"❌ Unauthorized."}; return res.redirect("/admin"); }
  try{
    const user = await get("SELECT * FROM users WHERE id=?",[req.params.id]);
    if (!user) return res.redirect("/admin");
    if (user.is_super_admin || user.id===req.user.id){ req.session.flash={type:"warning", message:"⚠️ Cannot edit this user."}; return res.redirect("/admin"); }
    const is_verified = req.body.is_verified ? 1 : 0;
    const is_admin = req.body.is_admin ? 1 : 0;
    const can_donate = req.body.can_donate ? 1 : 0;
    await run(`UPDATE users SET name=?, email=?, phone=?, blood_group=?, district=?, upazila=?, address_holding=?, is_verified=?, is_admin=?, can_donate=? WHERE id=?`,
      [req.body.name, req.body.email, req.body.phone, req.body.blood_group, req.body.district, req.body.upazila, req.body.address_holding, is_verified, is_admin, can_donate, req.params.id]);
    if (req.body.new_password && req.body.new_password.length>=6){
      const hash=await bcrypt.hash(req.body.new_password,10);
      await run("UPDATE users SET password_hash=?, session_token=? WHERE id=?",[hash, genToken(), req.params.id]);
      req.session.flash={type:"info", message:"🔑 Password changed. User will need to login again."};
    }
    req.session.flash={type:"success", message:`✅ User '${req.body.name}' updated!`};
    if (req.headers['x-requested-with']==='XMLHttpRequest') return res.json({success:true});
    res.redirect("/admin");
  }catch(e){
    console.error(e);
    if (req.headers['x-requested-with']==='XMLHttpRequest') return res.status(400).json({success:false, error:e.message});
    req.session.flash={type:"danger", message:"❌ Failed to update."};
    res.redirect("/admin");
  }
});

router.get("/user/details/:id", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin) return res.status(403).json({error:"Unauthorized"});
  const u = await get("SELECT * FROM users WHERE id=?",[req.params.id]);
  if (!u) return res.status(404).json({error:"Not found"});
  res.json({
    id:u.id, name:u.name, email:u.email, phone:u.phone, blood_group:u.blood_group, district:u.district, upazila:u.upazila, address_holding:u.address_holding,
    is_verified:!!u.is_verified, is_admin:!!u.is_admin, can_donate:!!u.can_donate,
    last_login_ip:u.last_login_ip, last_login_device:u.last_login_device,
    last_login_at: u.last_login_at ? new Date(u.last_login_at).toISOString().slice(0,16).replace('T',' ') : null,
    created_at: u.created_at ? new Date(u.created_at).toISOString().slice(0,10) : null
  });
});

router.post("/impersonate/:id", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin){ req.session.flash={type:"danger", message:"❌ Unauthorized."}; return res.redirect("/admin"); }
  const user = await get("SELECT * FROM users WHERE id=?",[req.params.id]);
  if (!user) return res.redirect("/admin");
  if (user.is_super_admin || user.id===req.user.id){ req.session.flash={type:"warning", message:"⚠️ Cannot impersonate."}; return res.redirect("/admin"); }
  req.session.original_admin_id = req.user.id;
  req.session.impersonating = true;
  req.session.impersonator_token = req.user.session_token;
  const newToken = genToken();
  await run("UPDATE users SET session_token=? WHERE id=?",[newToken, user.id]);
  req.session.userId = user.id;
  req.session.session_token = newToken;
  req.session.flash={type:"info", message:`🎭 Now logged in as ${user.name}. Go to profile to switch back.`};
  res.redirect("/");
});

router.get("/switch-back", requireAdmin, async (req,res)=>{
  // Actually requireLogin but allow impersonated session
  if (req.session.impersonating && req.session.original_admin_id){
    const admin = await get("SELECT * FROM users WHERE id=?",[req.session.original_admin_id]);
    if (admin && admin.is_super_admin){
      await run("UPDATE users SET session_token=? WHERE id=?",[req.session.impersonator_token || genToken(), admin.id]);
      req.session.userId = admin.id;
      req.session.session_token = admin.session_token || req.session.impersonator_token;
      delete req.session.impersonating;
      delete req.session.original_admin_id;
      delete req.session.impersonator_token;
      req.session.flash={type:"success", message:"🔙 Switched back to admin account."};
      return res.redirect("/admin");
    }
  }
  req.session.flash={type:"danger", message:"❌ Cannot switch back."};
  res.redirect("/");
});

// For profile switch-back route used via /profile/switch-back alias
router.get("/profile/switch-back", async (req,res)=>{
  if (req.session.impersonating && req.session.original_admin_id){
    const admin = await get("SELECT * FROM users WHERE id=?",[req.session.original_admin_id]);
    if (admin){
      await run("UPDATE users SET session_token=? WHERE id=?",[req.session.impersonator_token || genToken(), admin.id]);
      req.session.userId = admin.id;
      req.session.session_token = req.session.impersonator_token || admin.session_token;
      delete req.session.impersonating;
      delete req.session.original_admin_id;
      delete req.session.impersonator_token;
      req.session.flash={type:"success", message:"🔙 Switched back to admin account."};
      return res.redirect("/admin");
    }
  }
  req.session.flash={type:"danger", message:"❌ Cannot switch back."};
  res.redirect("/");
});

router.post("/create-admin", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin){ req.session.flash={type:"danger", message:"❌ Unauthorized."}; return res.redirect("/admin"); }
  if (await get("SELECT id FROM users WHERE email=?",[req.body.email])){
    req.session.flash={type:"warning", message:"⚠️ Email already registered."};
    return res.redirect("/admin");
  }
  const hash=await bcrypt.hash(req.body.password,10);
  await run(`INSERT INTO users (name,email,phone,password_hash,is_admin,is_verified,is_super_admin,blood_group,district,upazila,age,can_donate,session_token,last_login_ip,last_login_device,last_login_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.body.name, req.body.email, req.body.phone, hash, 1,1,0, "O+", "Joypurhat","Kalai",25,1, genToken(), getClientIp(req), getDeviceFingerprint(req), new Date().toISOString()]);
  req.session.flash={type:"success", message:`✅ New admin '${req.body.name}' created!`};
  res.redirect("/admin");
});

router.get("/backup-database", requireAdmin, async (req,res)=>{
  if (!req.user.is_super_admin){ req.session.flash={type:"danger", message:"❌ Unauthorized."}; return res.redirect("/admin"); }
  // For Turso, we can dump via query - but for file fallback, send file
  try{
    // Try to send local file if exists
    import("fs").then(fs=>{
      const p = "data/blood_network.db";
      if (fs.existsSync(p)){
        res.download(p, `bloodora_backup_${new Date().toISOString().slice(0,10)}.db`);
      } else {
        req.session.flash={type:"info", message:"📥 Turso serverless DB - use Turso dashboard to backup."};
        res.redirect("/admin");
      }
    });
  }catch(e){
    req.session.flash={type:"danger", message:"❌ Backup failed."};
    res.redirect("/admin");
  }
});

export default router;
