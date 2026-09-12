// ==================== BloodOra Backend - SMTP / Email Service ====================
// All mail settings are stored in the database and editable from the Admin
// Panel (Settings → SMTP & Email). Environment variables are only the initial
// fallback so a fresh deployment can send before an admin has logged in.
// Every send attempt is written to the email_log table for the admin log view.
import nodemailer from "nodemailer";
import { get, run } from "./db.js";

const ENV_DEFAULTS = {
  smtp_enabled: process.env.SMTP_ENABLED ? 1 : 0,
  smtp_host: process.env.SMTP_HOST || "",
  smtp_port: parseInt(process.env.SMTP_PORT || "587", 10),
  smtp_secure: (process.env.SMTP_SECURE || "").toLowerCase() === "true" ? 1 : 0,
  smtp_user: process.env.SMTP_USER || "",
  smtp_pass: process.env.SMTP_PASS || "",
  smtp_from_name: process.env.SMTP_FROM_NAME || "BloodOra",
  smtp_from_email: process.env.SMTP_FROM_EMAIL || "no-reply@bloodora.site",
};

/** Public, non-secret subset of the SMTP configuration. */
export function maskSmtpConfig(cfg = {}) {
  const pass = cfg.smtp_pass || "";
  return {
    ...cfg,
    smtp_pass: pass ? "•".repeat(Math.min(pass.length, 12)) : "",
    smtp_pass_set: Boolean(pass),
  };
}

/** Merge DB settings over the env defaults. Never returns the masked form. */
export async function getSmtpConfig() {
  let row = null;
  try { row = await get("SELECT * FROM site_settings LIMIT 1"); } catch (e) { row = null; }
  const cfg = {
    smtp_enabled: row?.smtp_enabled ?? ENV_DEFAULTS.smtp_enabled,
    smtp_host: row?.smtp_host || ENV_DEFAULTS.smtp_host,
    smtp_port: parseInt(row?.smtp_port || ENV_DEFAULTS.smtp_port, 10),
    smtp_secure: row?.smtp_secure ?? ENV_DEFAULTS.smtp_secure,
    smtp_user: row?.smtp_user || ENV_DEFAULTS.smtp_user,
    smtp_pass: row?.smtp_pass || ENV_DEFAULTS.smtp_pass,
    smtp_from_name: row?.smtp_from_name || ENV_DEFAULTS.smtp_from_name,
    smtp_from_email: row?.smtp_from_email || ENV_DEFAULTS.smtp_from_email,
    site_name: row?.site_name || "BloodOra",
  };
  return cfg;
}

export function buildTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port) || 587,
    secure: Boolean(Number(cfg.smtp_secure)),
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
    tls: { rejectUnauthorized: false },
  });
}

async function logMail(entry) {
  try {
    await run(
      `INSERT INTO email_log (to_email, subject, status, error, created_at) VALUES (?,?,?,?,?)`,
      [entry.to || "", entry.subject || "", entry.status || "sent", entry.error || null, new Date().toISOString()]
    );
  } catch (e) { /* the log table may not exist yet on a very old DB */ }
}

/**
 * Send an email using the admin-configured SMTP server.
 * @returns {{sent:boolean, message:string, info?:object, error?:string}}
 */
export async function sendMail({ to, subject, text, html }) {
  const cfg = await getSmtpConfig();
  if (!Number(cfg.smtp_enabled)) {
    return { sent: false, message: "Email sending is disabled. Enable it in Admin Panel → SMTP & Email." };
  }
  if (!cfg.smtp_host) {
    return { sent: false, message: "No SMTP host configured. Set it in Admin Panel → SMTP & Email." };
  }
  if (!to) {
    return { sent: false, message: "No recipient address supplied." };
  }
  try {
    const transport = buildTransport(cfg);
    const from = `${cfg.smtp_from_name || cfg.site_name} <${cfg.smtp_from_email || cfg.smtp_user}>`;
    const info = await transport.sendMail({
      from,
      to,
      subject: subject || `${cfg.site_name} notification`,
      text: text || "",
      html: html || undefined,
    });
    await logMail({ to, subject, status: "sent" });
    return { sent: true, message: "✅ Email sent successfully.", info };
  } catch (e) {
    await logMail({ to, subject, status: "failed", error: e.message });
    return { sent: false, message: "❌ Email failed: " + e.message, error: e.message };
  }
}

/** Admin "Send test email" button. Reports the exact transport error. */
export async function testSmtp(toOverride) {
  const cfg = await getSmtpConfig();
  const to = (toOverride || cfg.smtp_from_email || cfg.smtp_user || "").trim();
  if (!to) return { sent: false, message: "❌ No recipient address. Enter a test address or set the From address first." };
  if (!cfg.smtp_host) return { sent: false, message: "❌ SMTP host is empty — save the settings first." };
  try {
    const transport = buildTransport(cfg);
    await transport.verify();
    const info = await transport.sendMail({
      from: `${cfg.smtp_from_name || cfg.site_name} <${cfg.smtp_from_email || cfg.smtp_user}>`,
      to,
      subject: `✅ ${cfg.site_name} SMTP test successful`,
      text: `This is a test email from ${cfg.site_name}.\n\nServer: ${cfg.smtp_host}:${cfg.smtp_port}\nSecure (TLS): ${cfg.smtp_secure ? "yes" : "no (STARTTLS/opportunistic)"}\nUsername: ${cfg.smtp_user || "(none)"}\nSent at: ${new Date().toISOString()}\n\nIf you received this, your Admin Panel SMTP settings are working.`,
      html: `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#e31b23,#ff3340);color:#fff;padding:22px 26px;">
          <div style="font-size:22px;font-weight:700;">${cfg.site_name}</div>
          <div style="opacity:.9;">SMTP configuration test</div>
        </div>
        <div style="padding:26px;color:#0f172a;">
          <p style="font-size:16px;margin:0 0 14px;"><strong>✅ Success!</strong> Your SMTP settings are working correctly.</p>
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:6px 0;color:#64748b;">Host</td><td style="padding:6px 0;text-align:right;">${cfg.smtp_host}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Port</td><td style="padding:6px 0;text-align:right;">${cfg.smtp_port}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">TLS / Secure</td><td style="padding:6px 0;text-align:right;">${cfg.smtp_secure ? "yes" : "no"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Username</td><td style="padding:6px 0;text-align:right;">${cfg.smtp_user || "(none)"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Sent at</td><td style="padding:6px 0;text-align:right;">${new Date().toISOString()}</td></tr>
          </table>
        </div>
      </div>`,
    });
    await logMail({ to, subject: "SMTP test", status: "sent" });
    return { sent: true, message: `✅ Test email sent to ${to}. Check the inbox (and spam folder).`, info };
  } catch (e) {
    await logMail({ to, subject: "SMTP test", status: "failed", error: e.message });
    return { sent: false, message: "❌ SMTP test failed: " + e.message, error: e.message };
  }
}

// --------------------------- Templated notifications ---------------------------

function layout(siteName, title, bodyHtml) {
  return `<div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#e31b23,#ff3340);color:#fff;padding:20px 26px;">
      <div style="font-size:21px;font-weight:700;">${siteName}</div>
      <div style="opacity:.9;font-size:13px;">${title}</div>
    </div>
    <div style="padding:26px;color:#0f172a;font-size:14px;line-height:1.6;">${bodyHtml}</div>
    <div style="padding:16px 26px;background:#f8fafc;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">
      This is an automated message from ${siteName}. Please do not reply directly.
    </div>
  </div>`;
}

export async function sendOrderConfirmation({ to, order, items = [], siteName = "BloodOra" }) {
  const rows = items
    .map((i) => `<tr><td style="padding:6px 0;">${i.product_name} × ${i.quantity}</td><td style="padding:6px 0;text-align:right;">৳${(i.price * i.quantity).toFixed(2)}</td></tr>`)
    .join("");
  const html = layout(siteName, "Order received", `
    <p>Thank you — your order <strong>#${order.id}</strong> has been received and is awaiting payment confirmation.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0;">
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <tr><td>Subtotal</td><td style="text-align:right;">৳${Number(order.subtotal_amount || 0).toFixed(2)}</td></tr>
      <tr><td>Delivery (Kalai)</td><td style="text-align:right;">৳${Number(order.delivery_charge || 0).toFixed(2)}</td></tr>
      <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>৳${Number(order.total_amount || 0).toFixed(2)}</strong></td></tr>
      <tr><td>Payment method</td><td style="text-align:right;">${order.payment_method || "n/a"}</td></tr>
      <tr><td>Status</td><td style="text-align:right;">${order.status || "pending"}</td></tr>
    </table>
    <p style="margin-top:16px;">Track your order any time at <a href="/shop/my-orders" style="color:#e31b23;">/shop/my-orders</a>.</p>
  `);
  return sendMail({ to, subject: `Order #${order.id} received — ${siteName}`, text: `Your order #${order.id} totalling ৳${order.total_amount} has been received. Track it at /shop/my-orders.`, html });
}

export async function sendNewSupportMessageAlert({ to, from, message, siteName = "BloodOra" }) {
  const html = layout(siteName, "New live support message", `
    <p>A visitor has sent a message through Live Messaging.</p>
    <p><strong>From:</strong> ${from}</p>
    <blockquote style="border-left:3px solid #e31b23;margin:12px 0;padding:8px 14px;background:#fff0f0;border-radius:0 8px 8px 0;">${message}</blockquote>
    <p>Reply in real time from <a href="/admin/live-chat" style="color:#e31b23;">/admin/live-chat</a>.</p>
  `);
  return sendMail({ to, subject: `💬 New live message from ${from}`, text: `New live message from ${from}: ${message}`, html });
}

export async function sendContactFormAlert({ to, name, email, message, siteName = "BloodOra" }) {
  const html = layout(siteName, "New contact message", `
    <p><strong>Name:</strong> ${name}<br><strong>Email:</strong> ${email}</p>
    <blockquote style="border-left:3px solid #e31b23;margin:12px 0;padding:8px 14px;background:#fff0f0;border-radius:0 8px 8px 0;">${message}</blockquote>
  `);
  return sendMail({ to, subject: `✉️ Contact form message from ${name}`, text: `${name} <${email}> wrote: ${message}`, html });
}
