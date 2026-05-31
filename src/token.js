import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, ".env");

const HTML_URL =
  "https://www.aerolineas.com.ar/flex-dates-calendar?adt=1&inf=0&chd=0&flexDates=true&cabinClass=Economy&flightType=ROUND_TRIP&leg=BHI-AEP-20260530&leg=AEP-BHI-20260620";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SAFETY_MARGIN_SECONDS = 60;

let cache = { token: null, expiration: 0 };

async function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const raw = await readFile(ENV_PATH, "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function persistEnv(token, expiration) {
  if (process.env.VERCEL || process.env.AWS_REGION) return;
  try {
    const body = `ACCESS_TOKEN=${token}\nTOKEN_EXPIRATION=${expiration}\n`;
    await writeFile(ENV_PATH, body, "utf8");
  } catch {
    // read-only fs (serverless); memory cache is enough
  }
}

async function scrapeToken() {
  const res = await fetch(HTML_URL, {
    headers: {
      "user-agent": UA,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`scrape failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  const tokenMatch = html.match(/window\.__ACCESS_TOKEN__\s*=\s*"([^"]+)"/);
  const expMatch = html.match(/window\.__TOKEN_EXPIRATION__\s*=\s*(\d+)/);
  if (!tokenMatch || !expMatch) {
    throw new Error("token markers not found in HTML");
  }
  return { token: tokenMatch[1], expiration: Number(expMatch[1]) };
}

function isFresh(expiration) {
  const now = Math.floor(Date.now() / 1000);
  return expiration - now > SAFETY_MARGIN_SECONDS;
}

export async function getAccessToken({ force = false } = {}) {
  if (!force && cache.token && isFresh(cache.expiration)) {
    return cache;
  }
  if (!force) {
    const env = await loadEnv();
    if (env.ACCESS_TOKEN && env.TOKEN_EXPIRATION) {
      const exp = Number(env.TOKEN_EXPIRATION);
      if (isFresh(exp)) {
        cache = { token: env.ACCESS_TOKEN, expiration: exp };
        return cache;
      }
    }
  }
  const fresh = await scrapeToken();
  cache = fresh;
  await persistEnv(fresh.token, fresh.expiration);
  return fresh;
}

export function tokenStatus() {
  const now = Math.floor(Date.now() / 1000);
  return {
    hasToken: Boolean(cache.token),
    expiration: cache.expiration,
    expiresInSeconds: cache.expiration ? cache.expiration - now : null,
    expiresAtIso: cache.expiration
      ? new Date(cache.expiration * 1000).toISOString()
      : null,
  };
}
