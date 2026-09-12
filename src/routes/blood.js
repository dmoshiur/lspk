import express from "express";
import { get, all, run } from "../db.js";
import { requireLogin } from "../middleware/auth.js";

const router = express.Router();

// GET request-blood form
router.get("/request-blood", (req,res)=>{
  res.render("request_blood", { title:"Request Blood - BloodOra" });
});

// POST request-blood
router.post("/request-blood", async (req,res)=>{
  try{
    const { patient_name, blood_group, hospital_name, hospital_address, contact_person, contact_phone, contact_email, needed_by, division, district, upazila, is_urgent, urgent_reason, additional_info, patient_relation, quantity } = req.body;

    const required = { "Patient Name":patient_name, "Blood Group":blood_group, "Hospital Name":hospital_name, "Contact Person":contact_person, "Contact Phone":contact_phone, "Needed By":needed_by, "Division":division, "District":district, "Upazila":upazila };
    const missing = Object.entries(required).filter(([k,v])=>!v || !String(v).trim()).map(([k])=>k);
    if (missing.length){
      req.session.flash={type:"danger", message:`❌ Please fill all required fields: ${missing.join(", ")}`};
      return res.redirect("/request-blood");
    }
    // parse datetime - from input type datetime-local
    let needed_dt = needed_by;
    // ensure ISO format
    try { needed_dt = new Date(needed_by).toISOString(); } catch(e){ needed_dt = needed_by; }

    const isUrgentVal = is_urgent ? 1 : 0;
    const now = new Date().toISOString();
    const requester_id = req.user ? req.user.id : null;

    await run(`INSERT INTO blood_requests (requester_id, patient_name, patient_relation, blood_group, quantity, hospital_name, hospital_address, contact_person, contact_phone, contact_email, is_urgent, urgent_reason, needed_by, location_division, location_district, location_upazila, additional_info, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [requester_id, patient_name, patient_relation||"Self", blood_group, quantity||"1 unit", hospital_name, hospital_address||`${upazila}, ${district}, ${division}`, contact_person, contact_phone, contact_email||null, isUrgentVal, urgent_reason||null, needed_dt, division, district, upazila, additional_info||null, "open", now, now]);

    req.session.flash={type: isUrgentVal?"warning":"success", message: isUrgentVal ? "🚨 URGENT blood request submitted! Donors will be notified." : "✅ Blood request submitted successfully! Thank you."};
    return res.redirect("/blood-requests");
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Failed to submit request. Please try again."};
    return res.redirect("/request-blood");
  }
});

// GET blood-requests list
router.get("/blood-requests", async (req,res)=>{
  try{
    const { bg, dist, division, urgent } = req.query;
    let sql="SELECT * FROM blood_requests WHERE is_fulfilled=0 AND datetime(needed_by) >= datetime('now')";
    const params=[];
    if (bg){ sql+=" AND blood_group=?"; params.push(bg); }
    if (division){ sql+=" AND location_division LIKE ?"; params.push(`%${division}%`); }
    if (dist){ sql+=" AND location_district LIKE ?"; params.push(`%${dist}%`); }
    if (urgent==="true"){ sql+=" AND is_urgent=1"; }
    sql+=" ORDER BY is_urgent DESC, datetime(needed_by) ASC";
    const requests = await all(sql, params);
    res.render("blood_requests", { title:"Blood Requests - BloodOra", requests, query:req.query });
  }catch(e){
    console.error(e);
    res.render("blood_requests", { title:"Blood Requests - BloodOra", requests:[], query:{} });
  }
});

// Urgent page
router.get("/urgent", async (req,res)=>{
  const urgent_requests = await all("SELECT * FROM blood_requests WHERE is_urgent=1 AND is_fulfilled=0 AND status!='cancelled' ORDER BY datetime(needed_by) ASC");
  res.render("urgent", { title:"Urgent Requests - BloodOra", urgent_requests });
});
router.post("/urgent-contact", async (req,res)=>{
  try{
    const { subject, message, email } = req.body;
    if (req.user) {
      await run(`INSERT INTO messages (sender_id, recipient_id, subject, content, is_admin_message) VALUES (?,?,?, ?,1)`,
        [req.user.id, null, `🚨 URGENT PAGE: ${subject||"Urgent Inquiry"}`, `From: ${email||req.user.email}\n\n${message}`]);
    }
    req.session.flash={type:"success", message:"✅ Your message has been sent to the BloodOra admin team!"};
  }catch(e){
    req.session.flash={type:"info", message:"✅ Message noted. We'll reach out shortly!"};
  }
  res.redirect("/urgent");
});

// View single request
router.get("/blood-request/:id", async (req,res)=>{
  const reqData = await get("SELECT br.*, u.name as requester_name FROM blood_requests br LEFT JOIN users u ON br.requester_id=u.id WHERE br.id=?",[req.params.id]);
  if (!reqData) return res.status(404).render("404",{title:"Not Found"});
  // normalize booleans
  reqData.is_urgent=!!reqData.is_urgent; reqData.is_fulfilled=!!reqData.is_fulfilled;
  res.render("view_blood_request", { title:"Request Details - BloodOra", request: reqData });
});

// Fulfill
router.post("/blood-request/:id/fulfill", requireLogin, async (req,res)=>{
  try{
    const br = await get("SELECT * FROM blood_requests WHERE id=?",[req.params.id]);
    if (!br) return res.redirect("/blood-requests");
    if (br.is_fulfilled){ req.session.flash={type:"info", message:"ℹ️ Already fulfilled."}; return res.redirect(`/blood-request/${req.params.id}`); }
    const now=new Date().toISOString();
    await run("UPDATE blood_requests SET is_fulfilled=1, fulfilled_at=?, fulfilled_by=?, status='fulfilled', updated_at=? WHERE id=?",[now, req.user.id, now, req.params.id]);
    req.session.flash={type:"success", message: br.is_urgent ? "✅ Urgent request marked as fulfilled. Thank you for donating!" : "✅ Blood request marked as fulfilled. Thank you!"};
    res.redirect("/blood-requests");
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Failed to update request."};
    res.redirect(`/blood-request/${req.params.id}`);
  }
});

// Cancel
router.post("/blood-request/:id/cancel", async (req,res)=>{
  try{
    const br = await get("SELECT * FROM blood_requests WHERE id=?",[req.params.id]);
    if (!br) return res.redirect("/blood-requests");
    if (req.user){
      if (br.requester_id===req.user.id || req.user.is_admin){
        await run("UPDATE blood_requests SET status='cancelled', is_fulfilled=1, updated_at=? WHERE id=?",[new Date().toISOString(), req.params.id]);
        req.session.flash={type:"info", message:"ℹ️ Blood request cancelled."};
      } else {
        req.session.flash={type:"danger", message:"❌ You do not have permission to cancel this request."};
      }
    } else {
      req.session.flash={type:"warning", message:"⚠️ Please login to manage requests."};
    }
    res.redirect("/blood-requests");
  }catch(e){
    console.error(e);
    req.session.flash={type:"danger", message:"❌ Failed to cancel."};
    res.redirect("/blood-requests");
  }
});

export default router;
