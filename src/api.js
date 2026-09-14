// ==================== BloodOra Frontend - Backend API Client ====================
// The ONLY connection between this frontend and the separated backend is the
// BACKEND_URL environment variable (set in Vercel: Project -> Settings ->
// Environment Variables). Example: BACKEND_URL=https://bloodora-api.vercel.app
import dotenv from "dotenv";
import { AsyncLocalStorage } from "node:async_hooks";
const pageDeadline = new AsyncLocalStorage();
// One budget for branding, /me and page data, not 8 seconds per serial call.
export function apiPageBudget(req, res, next) {
  pageDeadline.run({ at: Date.now() + 8000, req }, next);
}
dotenv.config();

export const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * Low-level request to the backend API.
 * @param {string} path  e.g. "/api/auth/login"
 * @param {object} opts  { method, token, json, formData, query }
 */
export async function apiRequest(path, { method = "GET", token = null, json = null, formData = null, query = null } = {}) {
  let url = BACKEND_URL + path;
  if (query && typeof query === "object") {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  const headers = {};
  const language = pageDeadline.getStore()?.req?.session?.lang;
  if (["en", "bn", "ar"].includes(language)) headers["Accept-Language"] = language;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Bound JSON calls (including response-body reads); no unending page loads.
  const remaining = Math.min(8000, (pageDeadline.getStore()?.at ?? Date.now() + 8000) - Date.now());
  if (remaining <= 0) throw new ApiError("The API request timed out. Please retry.", 504);
  const init = { method, headers, signal: AbortSignal.timeout(remaining) };
  if (formData) {
    init.body = formData; // fetch sets the multipart boundary itself
  } else if (json !== null && json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError(
      `⚠️ Cannot reach the backend API at ${BACKEND_URL}. Check the BACKEND_URL environment variable.`,
      0
    );
  }

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    throw new ApiError(`⚠️ Backend returned a non-JSON response (${res.status}).`, res.status);
  }

  if (!res.ok || (data && (data.success === false || data.ok === false))) {
    const msg = (data && data.message) || `Request failed (${res.status})`;
    const err = new ApiError(msg, res.status, data);
    err.type = data && data.type;
    throw err;
  }
  return data;
}

// ---------- Convenience wrappers ----------
export const apiGet = (path, token = null, query = null) =>
  apiRequest(path, { method: "GET", token, query });

export const apiPost = (path, json = null, token = null) =>
  apiRequest(path, { method: "POST", json, token });

export const apiPut = (path, json = null, token = null) =>
  apiRequest(path, { method: "PUT", json, token });

export const apiDel = (path, token = null) =>
  apiRequest(path, { method: "DELETE", token });

export const apiPostForm = (path, formData, token = null) =>
  apiRequest(path, { method: "POST", formData, token });

export const apiPutForm = (path, formData, token = null) =>
  apiRequest(path, { method: "PUT", formData, token });

/**
 * Build a FormData from plain fields + an optional multer memory-storage file.
 * Used to forward browser multipart uploads to the backend API.
 */
export function buildFormData(fields = {}, file = null, fileField = "file") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  }
  if (file && file.buffer) {
    fd.append(fileField, new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }), file.originalname || "upload.bin");
  }
  return fd;
}

// ---------- Server-Sent Events proxy ----------
/**
 * Pipe a backend SSE stream straight to the browser. The browser only ever
 * talks to this frontend (same origin), so the backend URL stays server-side.
 * Falls back to a 502 that the client can detect and switch to polling.
 */
export async function proxyEventStream(req, res, backendPath) {
  let upstream;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = { Accept: "text/event-stream" };
    // Admin SSE uses the same verified API token as JSON calls. It must never
    // become an anonymous upstream request or expose the bearer to the browser.
    if (req.session?.token) headers.Authorization = `Bearer ${req.session.token}`;
    upstream = await fetch(BACKEND_URL + backendPath, { headers, signal: controller.signal });
  } catch (e) {
    if (!res.headersSent) res.status(502).end();
    return;
  } finally {
    clearTimeout(timer); // bound connection only, not the established SSE stream
  }
  if (!upstream.ok || !upstream.body) {
    if (!res.headersSent) res.status(upstream.status || 502).end();
    return;
  }
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const { Readable } = await import("stream");
  const nodeStream = Readable.fromWeb(upstream.body);
  const close = () => { try { nodeStream.destroy(); } catch (e) { /* already closed */ } };
  req.on("close", close);
  req.on("aborted", close);
  nodeStream.on("error", () => { try { res.end(); } catch (e) { /* ignore */ } });
  nodeStream.pipe(res);
}
