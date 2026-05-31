// Deep-link builder for the upstream airline's booking page.
// Mirrors the URL format the airline's site itself produces after a search.

import { config } from "./config.js";

function fmtDate(yyyyMmDd) {
  return yyyyMmDd.replace(/-/g, "");
}

/**
 * Build a booking deep-link. Returns null if BOOKING_URL_BASE is not configured.
 *
 * @param {object} opts
 * @param {Array<{origin: string, destination: string, date: string}>} opts.legs
 * @param {string|null} [opts.shoppingId]
 * @param {number} [opts.adt=1]
 * @param {number} [opts.chd=0]
 * @param {number} [opts.inf=0]
 * @param {"Economy"|"PremiumEconomy"|"Business"} [opts.cabinClass="Economy"]
 * @param {"ONE_WAY"|"ROUND_TRIP"|"MULTI_DESTINATION"} [opts.flightType]
 */
export function buildBookingUrl({
  legs,
  shoppingId,
  adt = 1,
  chd = 0,
  inf = 0,
  cabinClass = "Economy",
  flightType,
}) {
  const base = config.bookingUrlBase();
  if (!base) return null;
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new Error("buildBookingUrl: legs is required");
  }
  const type =
    flightType ??
    (legs.length === 1
      ? "ONE_WAY"
      : legs.length === 2
        ? "ROUND_TRIP"
        : "MULTI_DESTINATION");

  const params = new URLSearchParams({
    adt: String(adt),
    inf: String(inf),
    chd: String(chd),
    flexDates: "false",
    cabinClass,
    flightType: type,
  });
  if (shoppingId) params.set("shoppingId", shoppingId);
  for (const l of legs) {
    params.append("leg", `${l.origin}-${l.destination}-${fmtDate(l.date)}`);
  }
  return `${base}?${params.toString()}`;
}
