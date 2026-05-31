// Shared OAuth helpers for the Vercel function handlers.

import { sign, verify, sha256base64url } from "./jwt.js";

export const SCOPE = "mcp";
export const CODE_TTL_SEC = 60;
export const ACCESS_TTL_SEC = 24 * 60 * 60; // 24h
export const REFRESH_TTL_SEC = 90 * 24 * 60 * 60; // 90d

export function serverOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export function parseForm(body) {
  const params = new URLSearchParams(body.toString("utf8"));
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

export function safeJSON(body) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

export function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, mcp-protocol-version, mcp-session-id",
  );
  res.setHeader("access-control-expose-headers", "www-authenticate");
}

export function sendJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

export function oauthError(res, status, error, description) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      error,
      ...(description ? { error_description: description } : {}),
    }),
  );
}

export function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET env var missing");
  return s;
}

export function issueCode(payload) {
  return sign(payload, jwtSecret(), CODE_TTL_SEC);
}

export function issueAccessToken(payload) {
  return sign({ ...payload, typ: "access" }, jwtSecret(), ACCESS_TTL_SEC);
}

export function issueRefreshToken(payload) {
  return sign({ ...payload, typ: "refresh" }, jwtSecret(), REFRESH_TTL_SEC);
}

export function verifyToken(token) {
  return verify(token, jwtSecret());
}

export function verifyPkce(codeChallenge, method, verifier) {
  if (!codeChallenge) return true; // PKCE optional
  if (!verifier) return false;
  if (method === "S256" || method == null) {
    return sha256base64url(verifier) === codeChallenge;
  }
  if (method === "plain") {
    return verifier === codeChallenge;
  }
  return false;
}
