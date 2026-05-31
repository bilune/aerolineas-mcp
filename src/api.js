import { getAccessToken } from "./token.js";
import { config } from "./config.js";

function buildLegs(legs) {
  return legs.map((l) => {
    if (typeof l === "string") return l;
    const { origin, destination, date } = l;
    const d = date.replace(/-/g, "");
    return `${origin}-${destination}-${d}`;
  });
}

export async function searchOffers({
  legs,
  adt = 1,
  chd = 0,
  inf = 0,
  cabinClass = "Economy",
  flightType,
  flexDates = true,
}) {
  const resolvedType =
    flightType || (legs.length > 1 ? "ROUND_TRIP" : "ONE_WAY");
  const params = new URLSearchParams({
    adt: String(adt),
    inf: String(inf),
    chd: String(chd),
    flexDates: String(flexDates),
    cabinClass,
    flightType: resolvedType,
  });
  for (const leg of buildLegs(legs)) params.append("leg", leg);
  const url = `${config.upstreamApiBase()}${config.upstreamOffersPath()}?${params.toString()}`;

  let { token } = await getAccessToken();
  let res = await call(url, token);
  if (res.status === 401 || res.status === 403) {
    ({ token } = await getAccessToken({ force: true }));
    res = await call(url, token);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `offers HTTP ${res.status}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return body;
}

function call(url, token) {
  const origin = config.upstreamWebOrigin();
  return fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": config.upstreamLocale(),
      authorization: `Bearer ${token}`,
      origin,
      referer: `${origin}/`,
      "user-agent": config.upstreamUserAgent(),
      "x-channel-id": config.upstreamChannelId(),
    },
  });
}
