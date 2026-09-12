import express from "express";
import { get, all, run } from "../db.js";
import { requireLogin, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireLogin, async (req,res)=>{
  try{
    const received = await all(`SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE (m.recipient_id=? OR m.recipient_id IS NULL) AND m.is_admin_message=0 ORDER BY m.created_at DESC`,[req.user.id]);
    const sent = await all(`SELECT m.*, u.name as recipient_name FROM messages m LEFT JOIN users u ON m.recipient_id=u.id WHERE m.sender_id=? ORDER BY m.created_at DESC`,[req.user.id]);
    const unreadRow = await get(`SELECT COUNT(*) as c FROM messages WHERE recipient_id=? AND is_read=0`,[req.user.id]);
    res.render("messages", { title:"Messages - BloodOra", received, sent, unread_count: unreadRow.c });
  }catch(e){ console.error(e); res.redirect("/"); }
});

router.get("/send", requireLogin, (req,res)=> res.render("send_message",{title:"Send Message - BloodOra"}));
router.post("/send", requireLogin, async (req,res)=>{
  try{
    const { subject, content, recipient_email } = req.body;
    let recipient_id=null, is_admin=1;
    if (recipient_email){
      const recipient = await get("SELECT id FROM users WHERE email=?",[recipient_email]);
      if (!recipient){ req.session.flash={type:"danger", message:"❌ Recipient not found."}; return res.redirect("/messages/send"); }
      recipient_id=recipient.id; is_admin=0;
    }
    await run(`INSERT INTO messages (sender_id, recipient_id, subject, content, is_admin_message) VALUES (?,?,?, ?,?)`,[req.user.id, recipient_id, subject, content, is_admin]);
    req.session.flash={type:"success", message:"✅ Message sent successfully!"};
    res.redirect("/messages");
  }catch(e){ console.error(e); req.session.flash={type:"danger", message:"❌ Failed to send."}; res.redirect("/messages/send"); }
});

router.get("/read/:id", requireLogin, async (req,res)=>{
  const message = await get(`SELECT m.*, s.name as sender_name, r.name as recipient_name FROM messages m LEFT JOIN users s ON m.sender_id=s.id LEFT JOIN users r ON m.recipient_id=r.id WHERE m.id=?`,[req.params.id]);
  if (!message) return res.status(404).render("404",{title:"Not Found"});
  if (message.recipient_id===req.user.id || message.recipient_id===null){
    await run("UPDATE messages SET is_read=1 WHERE id=?",[req.params.id]);
    message.is_read=1;
  }
  res.render("read_message",{title:"Read Message - BloodOra", message});
});

router.get("/reply/:id", requireLogin, async (req,res)=>{
  const original = await get("SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.id=?",[req.params.id]);
  if (!original) return res.status(404).render("404",{title:"Not Found"});
  res.render("reply_message",{title:"Reply - BloodOra", original});
});
router.post("/reply/:id", requireLogin, async (req,res)=>{
  try{
    const original = await get("SELECT * FROM messages WHERE id=?",[req.params.id]);
    if (!original) return res.redirect("/messages");
    await run(`INSERT INTO messages (sender_id, recipient_id, subject, content, replied_to) VALUES (?,?,?, ?,?)`,[req.user.id, original.sender_id, `Re: ${original.subject}`, req.body.content, original.id]);
    req.session.flash={type:"success", message:"✅ Reply sent!"};
    res.redirect("/messages");
  }catch(e){ console.error(e); req.session.flash={type:"danger", message:"❌ Failed."}; res.redirect("/messages"); }
});

// Admin messages
router.get("/admin/messages", requireAdmin, async (req,res)=>{
  const messages = await all(`SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.recipient_id IS NULL OR m.is_admin_message=1 ORDER BY m.created_at DESC`);
  const unreadRow = await get(`SELECT COUNT(*) as c FROM messages WHERE recipient_id IS NULL AND is_read=0`);
  res.render("admin/messages",{title:"Admin Messages", messages, unread: unreadRow.c});
});
router.get("/admin/message/reply/:id", requireAdmin, async (req,res)=>{
  const original = await get("SELECT m.*, u.name as sender_name FROM messages m LEFT JOIN users u ON m.sender_id=u.id WHERE m.id=?",[req.params.id]);
  if (!original) return res.status(404).render("404",{title:"Not Found"});
  res.render("admin/reply_message",{title:"Admin Reply", original});
});
router.post("/admin/message/reply/:id", requireAdmin, async (req,res)=>{
  try{
    const original = await get("SELECT * FROM messages WHERE id=?",[req.params.id]);
    await run(`INSERT INTO messages (sender_id, recipient_id, subject, content, replied_to, is_admin_message) VALUES (?,?,?, ?,?,1)`,[req.user.id, original.sender_id, `Re: ${original.subject}`, req.body.content, original.id]);
    req.session.flash={type:"success", message:"✅ Reply sent to user!"};
    res.redirect("/messages/admin/messages");
  }catch(e){ console.error(e); req.session.flash={type:"danger", message:"❌ Failed."}; res.redirect("/messages/admin/messages"); }
});

export default router;
