// Deep-link builder for aerolineas.com.ar/flights-offers.
// Mirrors the URL format the site itself produces after a search, so the user
// lands on the offer-selection screen with results already loaded.

const BASE = "https://www.aerolineas.com.ar/flights-offers";

function fmtDate(yyyyMmDd) {
  // "2026-06-02" → "20260602"
  return yyyyMmDd.replace(/-/g, "");
}

/**
 * Build a booking deep-link.
 *
 * @param {object} opts
 * @param {Array<{origin: string, destination: string, date: string}>} opts.legs  Required, 1 (ONE_WAY) or 2 (ROUND_TRIP).
 * @param {string|null} [opts.shoppingId]  From searchMetadata.shoppingId. Optional; site re-searches if absent.
 * @param {number} [opts.adt=1]
 * @param {number} [opts.chd=0]
 * @param {number} [opts.inf=0]
 * @param {"Economy"|"PremiumEconomy"|"Business"} [opts.cabinClass="Economy"]
 * @param {"ONE_WAY"|"ROUND_TRIP"|"MULTI_DESTINATION"} [opts.flightType]  Defaults from legs count.
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
  return `${BASE}?${params.toString()}`;
}
