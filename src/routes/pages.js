import express from "express";
import { get, all } from "../db.js";
const router = express.Router();

router.get("/", async (req,res)=>{
  try {
    const settings = await get("SELECT * FROM site_settings LIMIT 1");
    const notice = await get("SELECT * FROM site_notice WHERE active=1 LIMIT 1");
    const total_donors_row = await get("SELECT COUNT(*) as c FROM users WHERE can_donate=1 AND is_verified=1");
    const urgent_row = await get("SELECT COUNT(*) as c FROM blood_requests WHERE is_urgent=1 AND is_fulfilled=0");
    const recent_donors = await all("SELECT * FROM users WHERE can_donate=1 AND is_verified=1 ORDER BY created_at DESC LIMIT 6");
    const recent_requests = await all("SELECT * FROM blood_requests WHERE is_fulfilled=0 ORDER BY is_urgent DESC, needed_by ASC LIMIT 5");
    res.render("home", { title:"BloodOra - Blood Donation Network", settings, notice, total_donors: total_donors_row.c, urgent_requests: urgent_row.c, recent_donors, recent_requests });
  } catch(e){
    console.error(e);
    res.render("home", { title:"BloodOra", settings:null, notice:null, total_donors:0, urgent_requests:0, recent_donors:[], recent_requests:[] });
  }
});

router.get("/compatibility", (req,res)=> res.render("compatibility", { title:"Blood Compatibility - BloodOra" }));
router.get("/antid", async (req,res)=>{
  const antid_info = await all("SELECT * FROM anti_d_info");
  res.render("antid", { title:"Anti-D Info - BloodOra", antid_info });
});
router.get("/resources", async (req,res)=>{
  try{
    const cat = req.query.category;
    let sql="SELECT * FROM resources";
    const params=[];
    if (cat){ sql+=" WHERE category=?"; params.push(cat); }
    sql+=" ORDER BY is_featured DESC, created_at DESC";
    const resources = await all(sql, params);
    res.render("resources", { title:"Resources - BloodOra", resources, query: req.query });
  }catch(e){
    console.error(e);
    res.render("resources", { title:"Resources - BloodOra", resources:[], query: req.query });
  }
});
router.get("/donation-guidelines", async (req,res)=>{
  const settings = await get("SELECT * FROM site_settings LIMIT 1");
  res.render("donation_guidelines", { title:"Donation Guidelines - BloodOra", settings });
});
router.get("/faq", async (req,res)=>{
  const settings = await get("SELECT * FROM site_settings LIMIT 1");
  res.render("faq", { title:"FAQ - BloodOra", settings });
});
router.get("/contact", async (req,res)=>{
  const settings = await get("SELECT * FROM site_settings LIMIT 1");
  res.render("contact", { title:"Contact - BloodOra", settings });
});
router.get("/health", async (req,res)=>{
  try{ await get("SELECT 1 as ok"); res.json({ status:"healthy", database:"connected" }); } catch(e){ res.status(500).json({ status:"unhealthy", error:e.message }); }
});
router.get("/api/chat/auth", (req,res)=>{
  if (req.user) {
    return res.json({ uid: String(req.user.id), name: req.user.name, image: req.user.image_file||"default.jpg", is_admin: !!req.user.is_admin });
  }
  res.json({ uid:"guest_"+(req.ip||"").replace(/\./g,""), name:"Guest User", image:"default.jpg", is_admin:false });
});
router.get("/sitemap.xml", (req,res)=>{
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://bloodora.site/</loc><priority>1.0</priority></url><url><loc>https://bloodora.site/donors</loc><priority>0.8</priority></url><url><loc>https://bloodora.site/blood-requests</loc><priority>0.8</priority></url><url><loc>https://bloodora.site/request-blood</loc><priority>0.8</priority></url><url><loc>https://bloodora.site/shop</loc><priority>0.8</priority></url></urlset>`;
  res.type("application/xml").send(xml);
});
router.get("/robots.txt", (req,res)=>{ res.type("text/plain").send("User-agent: *\nAllow: /\nSitemap: https://bloodora.site/sitemap.xml"); });

export default router;
