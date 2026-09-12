// ==================== BloodOra Frontend - Backend API Client ====================
// The ONLY connection between this frontend and the separated backend is the
// BACKEND_URL environment variable (set in Vercel: Project -> Settings ->
// Environment Variables). Example: BACKEND_URL=https://bloodora-api.vercel.app
import dotenv from "dotenv";
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
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const init = { method, headers };
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

  if (!res.ok || (data && data.success === false)) {
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
