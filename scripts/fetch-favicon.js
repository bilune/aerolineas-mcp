// Downloads the Aerolíneas Argentinas favicon and writes it to the project
// root so api/favicon.js can inline it at build time. Required because
// www.aerolineas.com.ar/favicon.ico returns 403 without browser-like headers.
//
// Run: node scripts/fetch-favicon.js
//
// We deliberately keep the favicon out of the repo to avoid redistributing
// trademarked artwork. Run this once after cloning and after every deploy that
// rebuilds api/favicon.js.

import fs from "node:fs";
import path from "node:path";

const URL = "https://www.aerolineas.com.ar/favicon.ico";
const OUT = path.resolve("favicon.ico");

const res = await fetch(URL, {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    accept: "image/avif,image/webp,*/*",
    referer: "https://www.aerolineas.com.ar/",
  },
});
if (!res.ok) {
  console.error(`download failed: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(OUT, buf);
console.log(`wrote ${OUT} (${buf.length} bytes)`);

// Also regenerate api/favicon.js with the new base64
const b64 = buf.toString("base64");
const handlerPath = path.resolve("api/favicon.js");
const handler = `// Serves Aerolíneas Argentinas favicon, self-hosted. Embedded as base64 to
// avoid runtime dependency on www.aerolineas.com.ar (which blocks unattributed
// requests) and to guarantee the file is bundled with the function.
//
// Regenerate with: node scripts/fetch-favicon.js

export const config = { runtime: "nodejs" };

const ICO_BASE64 =
  "${b64}";
const ICO = Buffer.from(ICO_BASE64, "base64");

export default function handler(req, res) {
  res.setHeader("content-type", "image/x-icon");
  res.setHeader("cache-control", "public, max-age=86400, immutable");
  res.statusCode = 200;
  res.end(ICO);
}
`;
fs.writeFileSync(handlerPath, handler);
console.log(`wrote ${handlerPath}`);
