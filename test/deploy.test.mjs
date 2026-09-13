// ==================== Deployment regression guard ====================
// These tests exist because of a real production outage: Vercel rejected every
// request with "Invalid export found in module /var/task/server.js. The default
// export must be a function or server." — server.js had no default export.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Use an unlikely port so the "does not listen" assertion can never be confused
// with a dev server that happens to be running.
process.env.PORT = "4599";
process.env.SESSION_SECRET ||= "test-secret";

test("server.js default-exports a request handler (what @vercel/node invokes)", async () => {
  const mod = await import("../server.js");
  assert.equal(typeof mod.default, "function", "default export must be a function");
  assert.equal(mod.default.length, 2, "handler must accept (req, res)");
});

test("importing server.js does not open a listening port", async () => {
  const net = await import("net");
  await import("../server.js");
  const probePort = Number(process.env.PORT || 3000);
  const opened = await new Promise((resolve) => {
    const sock = net.connect(probePort, "127.0.0.1");
    sock.on("connect", () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
    setTimeout(() => resolve(false), 300);
  });
  assert.equal(opened, false, "server.js must only listen when run directly with `node server.js`");
});

test("vercel.json bundles the EJS views and static assets into the function", () => {
  const cfg = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
  const nodeBuild = cfg.builds.find((b) => b.use === "@vercel/node");
  assert.ok(nodeBuild, "an @vercel/node build must exist");
  const included = String(nodeBuild.config?.includeFiles);
  for (const pattern of ["views/**", "public/**"]) {
    assert.ok(included.includes(pattern), `includeFiles must contain ${pattern} (templates are read from disk at runtime)`);
  }
  assert.ok(
    cfg.routes.some((r) => r.dest === "/server.js"),
    "a route must send traffic to /server.js"
  );
});

test("the session store is not the in-memory MemoryStore", async () => {
  const { CookieSessionStore } = await import("../src/middleware/cookieStore.js");
  const session = (await import("express-session")).default;
  const store = new CookieSessionStore({ secret: "test-secret" });
  assert.ok(!(store instanceof session.MemoryStore), "MemoryStore triggers a production warning and loses sessions on serverless");
});

test("this repository contains no backend source and no reference to it", async () => {
  const fs = await import("fs");
  // 1. the folder itself must be gone — lspk is the frontend, nothing else
  assert.equal(fs.existsSync(path.join(root, "backend")), false, "backend/ must not exist in this repo");

  // 2. no frontend file may reach into a backend source tree
  const offenders = [];
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full); continue; }
      if (!/\.(js|mjs|ejs|json)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      if (/\.\.\/backend|\.\.\/\.\.\/backend|backend\/src\//.test(text)) offenders.push(path.relative(root, full));
    }
  };
  scan(path.join(root, "src"));
  scan(path.join(root, "views"));
  for (const f of ["server.js", "vercel.json", "package.json"]) {
    if (/\.\.\/backend|backend\/src\//.test(fs.readFileSync(path.join(root, f), "utf8"))) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `these files still depend on the backend repo: ${offenders.join(", ")}`);
});

test("the built-in fallback content the frontend owns is complete", async () => {
  const c = await import("../src/utils/content.js");
  assert.ok(Object.keys(c.antidReference).length > 0, "antidReference must have content");
  assert.ok(Object.keys(c.compatibilityReference).length > 0, "compatibilityReference must have content");
  assert.ok(c.resourcesReference.length > 0, "resourcesReference must have entries");
  assert.ok(c.siteRoutes.length > 0, "siteRoutes must have entries");
});

test("the session cookie survives a round trip and rejects tampering", async () => {
  const { CookieSessionStore, sessionContext } = await import("../src/middleware/cookieStore.js");
  const store = new CookieSessionStore({ secret: "round-trip-secret", secure: true });
  const rr = () => ({
    req: { headers: {} },
    res: { headersSent: false, _h: {},
      getHeader(k) { return this._h[k.toLowerCase()]; },
      setHeader(k, v) { this._h[k.toLowerCase()] = v; } },
  });
  const inCtx = (c, fn) => new Promise((r) => sessionContext(c.req, c.res, () => { fn(); r(); }));

  const first = rr();
  await inCtx(first, () => store.set("sid", { token: "jwt.abc", lang: "bn", cookie: { maxAge: 60000 } }, () => {}));
  const cookie = [].concat(first.res.getHeader("Set-Cookie"))[0];
  assert.match(cookie, /^bloodora\.session=/);
  for (const flag of ["HttpOnly", "SameSite=Lax", "Secure"]) {
    assert.ok(cookie.includes(flag), `cookie must be ${flag}`);
  }
  assert.ok(cookie.length < 4096, "cookie must fit the browser size limit");

  const raw = decodeURIComponent(cookie.split(";")[0].split("=")[1]);
  const good = rr();
  good.req.headers.cookie = `bloodora.session=${encodeURIComponent(raw)}`;
  let restored = null;
  await inCtx(good, () => store.get("sid", (e, s) => { restored = s; }));
  assert.equal(restored?.token, "jwt.abc");
  assert.equal(restored?.lang, "bn");

  const evil = rr();
  evil.req.headers.cookie = `bloodora.session=${encodeURIComponent(raw.slice(0, 8) + "AAAA" + raw.slice(12))}`;
  let forged = "unset";
  await inCtx(evil, () => store.get("sid", (e, s) => { forged = s; }));
  assert.equal(forged, null, "a tampered cookie must not produce a session");
});
