// Minimal HS256 JWT sign/verify using Node crypto. No external deps.

import crypto from "node:crypto";

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s) {
  let p = s.replace(/-/g, "+").replace(/_/g, "/");
  while (p.length % 4) p += "=";
  return Buffer.from(p, "base64");
}

function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

export function sign(payload, secret, expiresInSec) {
  if (!secret) throw new Error("JWT secret missing");
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + expiresInSec, ...payload };
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const b = b64url(JSON.stringify(body));
  const sig = b64url(hmac(secret, `${h}.${b}`));
  return `${h}.${b}.${sig}`;
}

export function verify(token, secret) {
  if (!secret) throw new Error("JWT secret missing");
  if (typeof token !== "string") throw new Error("invalid token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, b, sig] = parts;
  const expected = b64url(hmac(secret, `${h}.${b}`));
  const a = Buffer.from(sig);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) {
    throw new Error("bad signature");
  }
  const payload = JSON.parse(b64urlDecode(b).toString("utf8"));
  if (typeof payload.exp === "number") {
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("expired");
  }
  return payload;
}

export function sha256base64url(input) {
  return b64url(crypto.createHash("sha256").update(input).digest());
}
