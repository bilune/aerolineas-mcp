// Transformations from the raw upstream /flights/offers payload into the
// lean shapes exposed by the MCP tools.

import { buildBookingUrl } from "./url.js";

function timeOf(iso) {
  // "2026-06-01T20:55:00" → "20:55"
  if (typeof iso !== "string") return null;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function mapSegment(s) {
  return {
    flightNumber: s.flightNumber,
    airline: s.airline,
    operatingAirline: s.operatingAirline ?? s.airline,
    origin: s.origin,
    destination: s.destination,
    departure: s.departure,
    arrival: s.arrival,
    duration: s.duration ?? null,
    layoverDuration: s.layoverDuration ?? 0,
    equipment: s.equipment ?? null,
    stopAirports: s.stopAirports ?? [],
  };
}

function buildDay(item, include) {
  const offer = item?.offerDetails ?? null;
  const leg = item?.leg ?? null;
  const firstSeg = leg?.segments?.[0];
  const lastSeg = leg?.segments?.[leg.segments.length - 1];

  const day = {
    date: item?.departure ?? null,
    total: offer?.fare?.total ?? null,
    stops: leg?.stops ?? null,
    duration: leg?.totalDuration ?? null,
    depart: timeOf(firstSeg?.departure),
    arrive: timeOf(lastSeg?.arrival),
  };
  if (item?.bestOffer) day.best = true;

  if (include.has("availability")) {
    day.seatsAvailable = offer?.seatAvailability?.seats ?? null;
    day.lowAvailability = offer?.seatAvailability?.lowAvailability ?? null;
    day.soldOut = Boolean(item?.soldOut);
  }
  if (include.has("fareDetails")) {
    day.base = offer?.fare?.baseFare ?? null;
    day.taxes = offer?.fare?.taxes ?? null;
    day.cabinClass = offer?.cabinClass ?? null;
    day.bookingClass = offer?.bookingClass ?? null;
    day.fareBasis = offer?.fareBasis ?? null;
    day.discounted = offer?.discounted ?? null;
  }
  if (include.has("segments")) {
    day.segments = (leg?.segments ?? []).map(mapSegment);
  }
  return day;
}

function buildBrandedOffer(item, include) {
  const leg = item?.leg ?? null;
  const brandOffers =
    item?.offerDetails?.brandOffers ??
    item?.brandOffers ??
    (item?.offerDetails ? [item.offerDetails] : []);
  const firstSeg = leg?.segments?.[0];
  const lastSeg = leg?.segments?.[leg?.segments?.length - 1];

  const offer = {
    date: item?.departure ?? null,
    stops: leg?.stops ?? null,
    duration: leg?.totalDuration ?? null,
    depart: timeOf(firstSeg?.departure),
    arrive: timeOf(lastSeg?.arrival),
    brands: brandOffers.map((b) => {
      const brand = {
        brandCode: b.brandId ?? b.brand ?? b.brandCode ?? null,
        total: b.fare?.total ?? null,
      };
      if (include.has("fareDetails")) {
        brand.base = b.fare?.baseFare ?? null;
        brand.taxes = b.fare?.taxes ?? null;
        brand.cabinClass = b.cabinClass ?? null;
        brand.bookingClass = b.bookingClass ?? null;
        brand.fareBasis = b.fareBasis ?? null;
      }
      if (include.has("availability")) {
        brand.seatsAvailable = b.seatAvailability?.seats ?? null;
      }
      return brand;
    }),
  };
  if (include.has("segments")) {
    offer.segments = (leg?.segments ?? []).map(mapSegment);
  }
  return offer;
}

function applyFilters(items, { topN, dates }, pricePicker) {
  let out = items;
  if (Array.isArray(dates) && dates.length) {
    const set = new Set(dates);
    out = out.filter((d) => set.has(d.date));
  }
  if (typeof topN === "number" && topN > 0) {
    out = [...out]
      .filter((d) => typeof pricePicker(d) === "number")
      .sort((a, b) => pricePicker(a) - pricePicker(b))
      .slice(0, topN);
  }
  return out;
}

export function summarizeOffers(data, opts = {}) {
  const include = new Set(opts.include ?? []);
  const { topN, dates, searchArgs } = opts;

  const meta = data?.searchMetadata ?? {};
  const routes = meta.routes ?? [];
  const searchType = meta.searchType ?? null;

  const calendar = data?.calendarOffers ?? {};
  const branded = data?.brandedOffers ?? null;

  let legs;
  if (Array.isArray(branded) && branded.length) {
    legs = branded.map((legItems, idx) => {
      const offers = (legItems ?? []).map((it) => buildBrandedOffer(it, include));
      const filtered = applyFilters(
        offers,
        { topN, dates },
        (o) => Math.min(...o.brands.map((b) => b.total ?? Infinity)),
      );
      return { index: idx, route: routes[idx] ?? null, offers: filtered };
    });
  } else {
    const keys = Object.keys(calendar).sort((a, b) => Number(a) - Number(b));
    legs = keys.map((k) => {
      const days = (calendar[k] ?? []).map((it) => buildDay(it, include));
      const filtered = applyFilters(days, { topN, dates }, (d) => d.total);
      return { index: Number(k), route: routes[Number(k)] ?? null, days: filtered };
    });
  }

  const priceSummary = legs.map((l) => {
    const items = l.days ?? l.offers ?? [];
    const totals = items
      .flatMap((d) =>
        d.brands ? d.brands.map((b) => b.total) : [d.total],
      )
      .filter((n) => typeof n === "number");
    let bestDate = null;
    if (totals.length) {
      const min = Math.min(...totals);
      bestDate =
        items.find((d) =>
          d.brands
            ? d.brands.some((b) => b.total === min)
            : d.total === min,
        )?.date ?? null;
    }
    return {
      legIndex: l.index,
      route: l.route,
      min: totals.length ? Math.min(...totals) : null,
      max: totals.length ? Math.max(...totals) : null,
      bestDate,
      offersCount: items.length,
    };
  });

  let bookingUrl = null;
  if (searchArgs?.legs && meta.shoppingId) {
    try {
      bookingUrl = buildBookingUrl({
        legs: searchArgs.legs,
        shoppingId: meta.shoppingId,
        adt: searchArgs.adt,
        chd: searchArgs.chd,
        inf: searchArgs.inf,
        cabinClass: searchArgs.cabinClass,
        flightType: meta.flightType ?? searchArgs.flightType,
      });
    } catch {
      bookingUrl = null;
    }
  }

  return {
    shoppingId: meta.shoppingId ?? null,
    currency: meta.currency ?? null,
    flightType: meta.flightType ?? null,
    searchType,
    routes,
    bookingUrl,
    priceSummary,
    legs,
  };
}

// Classifies a fare option as included free / paid / unavailable.
// `enabled: true` only means the option is APPLICABLE to the brand; whether it
// is included for free depends on `detail`:
//   - empty detail   → included by default
//   - "Carry on de 8kg", "1 pieza de 15 kg" → included with this description
//   - "Cargo extra", "$ 40.000", "Con 40% de retención" → available BUT PAID
export function inclusionStatus(option) {
  if (!option || option.enabled === false) {
    return { status: "unavailable", note: null };
  }
  const detail = (option.detail || "").trim();
  if (!detail) return { status: "free", note: null };
  // Anything that looks like a price/charge/retention → paid
  if (/cargo|retenci[oó]n|\$\s*\d|con cargo/i.test(detail)) {
    return { status: "paid", note: detail };
  }
  return { status: "free", note: detail };
}

export function extractFareRules(data) {
  const rules = Array.isArray(data?.fareRules) ? data.fareRules : [];
  return rules.map((rule) => {
    const brands = rule.brandConfigurations ?? {};
    return {
      code: rule.code ?? null,
      displayName: rule.displayName ?? null,
      active: rule.active ?? null,
      programIds: rule.programIds ?? [],
      brands: Object.entries(brands).map(([brandCode, b]) => {
        const options = b?.fareOptionConfiguration ?? {};
        return {
          brandCode,
          description: b?.brandDescription ?? null,
          options: Object.entries(options).map(([optionCode, o]) => {
            const inclusion = inclusionStatus(o);
            return {
              code: optionCode,
              name: o?.fareName ?? null,
              enabled: o?.enabled ?? null,
              inclusion: inclusion.status,
              inclusionNote: inclusion.note,
              priority: o?.priority ?? null,
              icon: o?.icon ?? null,
              includedText: o?.includedDefaultText ?? null,
              nonIncludedText: o?.nonIncludedDefaultText ?? null,
              detail: o?.detail ?? null,
            };
          }),
        };
      }),
    };
  });
}
