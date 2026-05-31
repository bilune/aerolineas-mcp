// Round-trip combination finder. Given outbound/return date windows, finds the
// best (outDate, retDate, brand) combinations whose brand includes a given
// set of fare options (e.g. CARRY_ON).
//
// Strategy:
//   1. Page flex calendars across both windows (the API returns ~30 days per call).
//   2. Cross-product (out, ret) combos restricted by minStay/maxStay; pick top-K by
//      flex-lower-bound total (cheapest-brand-of-the-day price, usually Base/Promo).
//   3. For each top-K combo, do a branded round-trip call. The response groups
//      offers per leg; each offer carries `brand.id` and `combinableOffers` (the
//      offerIds it can be paired with on the other leg).
//   4. Filter to brands whose `fareRules` entry has every required option enabled,
//      pair via combinableOffers, sum totals, and emit one row per
//      (outDate, retDate, brand) — choosing the cheapest flight pairing.

import { searchOffers } from "./api.js";
import { extractFareRules } from "./transform.js";
import { buildBookingUrl } from "./url.js";

const DAY_MS = 86400000;

function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}
function timeOf(iso) {
  const m = typeof iso === "string" ? iso.match(/T(\d{2}:\d{2})/) : null;
  return m ? m[1] : null;
}

async function flexCalendarPage(origin, destination, refDate, shared) {
  const data = await searchOffers({
    legs: [{ origin, destination, date: refDate }],
    flexDates: true,
    ...shared,
  });
  const days = (data.calendarOffers?.["0"] ?? [])
    .map((it) => ({
      date: it?.departure ?? null,
      total: it?.offerDetails?.fare?.total ?? null,
    }))
    .filter((d) => d.date && typeof d.total === "number");
  return { days, fareRules: extractFareRules(data) };
}

async function collectCalendar(origin, destination, from, to, shared) {
  const map = new Map();
  let fareRules = null;
  // Reference dates spaced 20 days apart (API returns ~30 days per call,
  // some before/some after ref). Overlap guarantees coverage.
  for (
    let cursor = parseDate(from);
    cursor <= parseDate(to);
    cursor = new Date(cursor.getTime() + 20 * DAY_MS)
  ) {
    const { days, fareRules: fr } = await flexCalendarPage(
      origin,
      destination,
      fmtDate(cursor),
      shared,
    );
    if (!fareRules && fr.length) fareRules = fr;
    for (const d of days) {
      if (d.date >= from && d.date <= to) map.set(d.date, d);
    }
  }
  return {
    days: [...map.values()].sort((a, b) => a.date.localeCompare(b.date)),
    fareRules: fareRules ?? [],
  };
}

function brandsMatching(fareRules, requireOptions) {
  // A brand "matches" requireOptions iff EVERY required option is INCLUDED FREE
  // on that brand (inclusion === "free"). enabled-but-paid options (e.g. Base
  // marks CARRY_ON as "Cargo extra") do NOT count.
  const set = new Set();
  if (!requireOptions?.length) {
    for (const r of fareRules) for (const b of r.brands) set.add(b.brandCode);
    return set;
  }
  for (const r of fareRules) {
    for (const b of r.brands) {
      const free = new Set(
        b.options.filter((o) => o.inclusion === "free").map((o) => o.code),
      );
      if (requireOptions.every((req) => free.has(req))) set.add(b.brandCode);
    }
  }
  return set;
}

function brandInfoMap(fareRules) {
  const m = new Map();
  for (const r of fareRules) {
    for (const b of r.brands) {
      if (m.has(b.brandCode)) continue;
      m.set(b.brandCode, {
        name: b.description,
        includedOptions: b.options
          .filter((o) => o.inclusion === "free")
          .map((o) => o.code),
        paidOptions: b.options
          .filter((o) => o.inclusion === "paid")
          .map((o) => ({ code: o.code, note: o.inclusionNote })),
      });
    }
  }
  return m;
}

function summarizeFlight(flight) {
  const seg = flight?.legs?.[0]?.segments?.[0];
  const lastSeg = flight?.legs?.[0]?.segments?.slice(-1)?.[0];
  return {
    flightCode: seg ? `${seg.airline}${seg.flightNumber}` : null,
    depart: timeOf(seg?.departure),
    arrive: timeOf(lastSeg?.arrival),
    stops: flight?.legs?.[0]?.stops ?? null,
    duration: flight?.legs?.[0]?.totalDuration ?? null,
  };
}

async function brandedRoundTrip(origin, destination, outDate, retDate, shared) {
  const data = await searchOffers({
    legs: [
      { origin, destination, date: outDate },
      { origin: destination, destination: origin, date: retDate },
    ],
    flexDates: false,
    ...shared,
  });
  return data;
}

function pairCombo(data, validBrands) {
  // Returns array of { brandCode, total, outOffer, retOffer, outFlight, retFlight }.
  const branded = data?.brandedOffers ?? {};
  const outFlights = branded["0"] ?? [];
  const retFlights = branded["1"] ?? [];

  // Build a flat list of all out offers and ret offers, each tagged with its flight.
  const outItems = [];
  for (const f of outFlights) {
    for (const off of f.offers ?? []) {
      outItems.push({ flight: f, offer: off });
    }
  }
  const retItems = [];
  for (const f of retFlights) {
    for (const off of f.offers ?? []) {
      retItems.push({ flight: f, offer: off });
    }
  }
  const retById = new Map(retItems.map((x) => [x.offer.offerId, x]));

  // For each (brand), find cheapest valid pair.
  const best = new Map();
  for (const o of outItems) {
    const brandCode = o.offer.brand?.id;
    if (!brandCode || !validBrands.has(brandCode)) continue;
    const combinable = o.offer.combinableOffers ?? [];
    for (const retId of combinable) {
      const r = retById.get(retId);
      if (!r) continue;
      if (r.offer.brand?.id !== brandCode) continue; // same-brand only
      const total = (o.offer.fare?.total ?? 0) + (r.offer.fare?.total ?? 0);
      const cur = best.get(brandCode);
      if (!cur || total < cur.total) {
        best.set(brandCode, { brandCode, total, out: o, ret: r });
      }
    }
  }
  return [...best.values()];
}

export async function findBestCombinations({
  origin,
  destination,
  outboundFrom,
  outboundTo,
  returnFrom,
  returnTo,
  minStay,
  maxStay,
  requireOptions = [],
  topN = 10,
  exploreK,
  cabinClass = "Economy",
  adt = 1,
  chd = 0,
  inf = 0,
}) {
  const shared = { cabinClass, adt, chd, inf };
  const K = exploreK ?? Math.max(20, topN * 3);

  const [outCal, retCal] = await Promise.all([
    collectCalendar(origin, destination, outboundFrom, outboundTo, shared),
    collectCalendar(destination, origin, returnFrom, returnTo, shared),
  ]);

  const fareRules = outCal.fareRules.length ? outCal.fareRules : retCal.fareRules;
  const validBrands = brandsMatching(fareRules, requireOptions);
  const brandInfo = brandInfoMap(fareRules);

  // Build combos and rank by lower-bound flex total.
  const combos = [];
  for (const o of outCal.days) {
    for (const r of retCal.days) {
      if (r.date <= o.date) continue;
      const stay = diffDays(o.date, r.date);
      if (typeof minStay === "number" && stay < minStay) continue;
      if (typeof maxStay === "number" && stay > maxStay) continue;
      combos.push({
        outDate: o.date,
        retDate: r.date,
        stay,
        flexTotal: o.total + r.total,
      });
    }
  }
  combos.sort((a, b) => a.flexTotal - b.flexTotal);
  const candidates = combos.slice(0, K);

  // Branded calls in parallel (small batches to be polite).
  const batchSize = 4;
  const rows = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((c) =>
        brandedRoundTrip(origin, destination, c.outDate, c.retDate, shared).then(
          (data) => ({ combo: c, data }),
        ),
      ),
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { combo, data } = r.value;
      const shoppingId = data?.searchMetadata?.shoppingId ?? null;
      const bookingUrl = buildBookingUrl({
        legs: [
          { origin, destination, date: combo.outDate },
          { origin: destination, destination: origin, date: combo.retDate },
        ],
        shoppingId,
        adt,
        chd,
        inf,
        cabinClass,
        flightType: "ROUND_TRIP",
      });
      const pairs = pairCombo(data, validBrands);
      for (const p of pairs) {
        const info = brandInfo.get(p.brandCode) ?? {};
        rows.push({
          outDate: combo.outDate,
          retDate: combo.retDate,
          stay: combo.stay,
          brandCode: p.brandCode,
          brandName: info.name ?? null,
          total: p.total,
          outTotal: p.out.offer.fare?.total ?? null,
          retTotal: p.ret.offer.fare?.total ?? null,
          cabinClass: p.out.offer.cabinClass ?? null,
          out: summarizeFlight(p.out.flight),
          ret: summarizeFlight(p.ret.flight),
          includedOptions: info.includedOptions ?? [],
          paidOptions: info.paidOptions ?? [],
          shoppingId,
          bookingUrl,
        });
      }
    }
  }

  rows.sort((a, b) => a.total - b.total);
  return {
    currency: "ARS",
    requireOptions,
    validBrandCount: validBrands.size,
    combinations: rows.slice(0, topN),
    explored: {
      outboundCalendarDays: outCal.days.length,
      returnCalendarDays: retCal.days.length,
      combosEvaluated: combos.length,
      brandedCalls: candidates.length,
      brandedHits: rows.length,
    },
  };
}
