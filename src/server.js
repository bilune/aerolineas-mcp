import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAccessToken, tokenStatus } from "./token.js";
import { searchOffers } from "./api.js";
import { summarizeOffers, extractFareRules } from "./transform.js";
import { findBestCombinations } from "./combinations.js";
import { renderCombinations, renderSearchFlights } from "./format.js";
import {
  brands,
  fareOptions,
  cabinClasses,
  airports,
  serverInstructions,
} from "./reference.js";

const legSchema = z.object({
  origin: z.string().length(3).describe("IATA origin (e.g. BHI)"),
  destination: z.string().length(3).describe("IATA destination (e.g. AEP)"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("YYYY-MM-DD"),
});

const includeFlags = z
  .array(z.enum(["segments", "availability", "fareDetails"]))
  .default([])
  .describe(
    "Per-day extras: 'segments' adds flight numbers/equipment/layovers, 'availability' adds seats/soldOut, 'fareDetails' adds base/taxes/bookingClass/fareBasis.",
  );

const searchInput = {
  legs: z
    .array(legSchema)
    .min(1)
    .max(6)
    .describe("Flight legs in order. 1 for ONE_WAY, 2 for ROUND_TRIP."),
  adt: z.number().int().min(1).max(9).default(1),
  chd: z.number().int().min(0).max(9).default(0),
  inf: z.number().int().min(0).max(9).default(0),
  cabinClass: z
    .enum(["Economy", "Business", "PremiumEconomy"])
    .default("Economy"),
  flightType: z
    .enum(["ONE_WAY", "ROUND_TRIP", "MULTI_DESTINATION"])
    .optional(),
  flexDates: z
    .boolean()
    .default(true)
    .describe(
      "true → flex calendar (cheapest per day across 30 days). false → branded fares for the exact date.",
    ),
  include: includeFlags,
  topN: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe("If set, return only the N cheapest days/offers per leg."),
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional()
    .describe("If set, return only days matching these dates per leg."),
};

const segmentSchema = z.object({
  flightNumber: z.number().int(),
  airline: z.string(),
  operatingAirline: z.string(),
  origin: z.string(),
  destination: z.string(),
  departure: z.string(),
  arrival: z.string(),
  duration: z.number().nullable(),
  layoverDuration: z.number(),
  equipment: z.string().nullable(),
  stopAirports: z.array(z.string()),
});

const flexDaySchema = z
  .object({
    date: z.string().nullable(),
    total: z.number().nullable(),
    stops: z.number().nullable(),
    duration: z.number().nullable(),
    depart: z.string().nullable(),
    arrive: z.string().nullable(),
    best: z.boolean().optional(),
    seatsAvailable: z.number().nullable().optional(),
    lowAvailability: z.boolean().nullable().optional(),
    soldOut: z.boolean().optional(),
    base: z.number().nullable().optional(),
    taxes: z.number().nullable().optional(),
    cabinClass: z.string().nullable().optional(),
    bookingClass: z.string().nullable().optional(),
    fareBasis: z.string().nullable().optional(),
    discounted: z.boolean().nullable().optional(),
    segments: z.array(segmentSchema).optional(),
  })
  .passthrough();

const brandedOfferSchema = z
  .object({
    date: z.string().nullable(),
    stops: z.number().nullable(),
    duration: z.number().nullable(),
    depart: z.string().nullable(),
    arrive: z.string().nullable(),
    brands: z.array(
      z
        .object({
          brandCode: z.string().nullable(),
          total: z.number().nullable(),
          base: z.number().nullable().optional(),
          taxes: z.number().nullable().optional(),
          cabinClass: z.string().nullable().optional(),
          bookingClass: z.string().nullable().optional(),
          fareBasis: z.string().nullable().optional(),
          seatsAvailable: z.number().nullable().optional(),
        })
        .passthrough(),
    ),
    segments: z.array(segmentSchema).optional(),
  })
  .passthrough();

const legResultSchema = z.object({
  index: z.number().int(),
  route: z.string().nullable(),
  days: z.array(flexDaySchema).optional(),
  offers: z.array(brandedOfferSchema).optional(),
});

const searchOutput = {
  shoppingId: z.string().nullable(),
  currency: z.string().nullable(),
  flightType: z.string().nullable(),
  searchType: z.string().nullable(),
  routes: z.array(z.string()),
  bookingUrl: z
    .string()
    .nullable()
    .describe(
      "Deep-link to aerolineas.com.ar/flights-offers preloaded with the searched legs.",
    ),
  priceSummary: z.array(
    z.object({
      legIndex: z.number().int(),
      route: z.string().nullable(),
      min: z.number().nullable(),
      max: z.number().nullable(),
      bestDate: z.string().nullable(),
      offersCount: z.number().int(),
    }),
  ),
  legs: z.array(legResultSchema),
};

const fareRulesOutput = {
  rules: z.array(
    z.object({
      code: z.string().nullable(),
      displayName: z.string().nullable(),
      active: z.boolean().nullable(),
      programIds: z.array(z.string()),
      brands: z.array(
        z.object({
          brandCode: z.string(),
          description: z.string().nullable(),
          options: z.array(
            z.object({
              code: z.string(),
              name: z.string().nullable(),
              enabled: z.boolean().nullable(),
              inclusion: z
                .enum(["free", "paid", "unavailable"])
                .describe(
                  "free = included at no extra cost. paid = available with extra charge. unavailable = not in this brand.",
                ),
              inclusionNote: z
                .string()
                .nullable()
                .describe(
                  "Optional descriptor: '8kg', '$ 40.000', 'Con 40% de retención', etc.",
                ),
              priority: z.string().nullable(),
              icon: z.string().nullable(),
              includedText: z.string().nullable(),
              nonIncludedText: z.string().nullable(),
              detail: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
};

const combinationsInput = {
  origin: z.string().length(3),
  destination: z.string().length(3),
  outboundFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outboundTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minStay: z.number().int().min(0).optional(),
  maxStay: z.number().int().min(0).optional(),
  requireOptions: z
    .array(z.string())
    .default([])
    .describe(
      "Fare options that must be enabled on the brand (e.g. ['CARRY_ON','CHECKED_BAGGAGE']).",
    ),
  topN: z.number().int().min(1).max(50).default(10),
  exploreK: z.number().int().min(1).max(200).optional(),
  cabinClass: z
    .enum(["Economy", "Business", "PremiumEconomy"])
    .default("Economy"),
  adt: z.number().int().min(1).max(9).default(1),
  chd: z.number().int().min(0).max(9).default(0),
  inf: z.number().int().min(0).max(9).default(0),
};

const combinationsOutput = {
  currency: z.string(),
  requireOptions: z.array(z.string()),
  validBrandCount: z.number().int(),
  combinations: z.array(
    z.object({
      outDate: z.string(),
      retDate: z.string(),
      stay: z.number().int(),
      brandCode: z.string(),
      brandName: z.string().nullable(),
      total: z.number(),
      outTotal: z.number().nullable(),
      retTotal: z.number().nullable(),
      cabinClass: z.string().nullable(),
      out: z.object({
        flightCode: z.string().nullable(),
        depart: z.string().nullable(),
        arrive: z.string().nullable(),
        stops: z.number().nullable(),
        duration: z.number().nullable(),
      }),
      ret: z.object({
        flightCode: z.string().nullable(),
        depart: z.string().nullable(),
        arrive: z.string().nullable(),
        stops: z.number().nullable(),
        duration: z.number().nullable(),
      }),
      includedOptions: z
        .array(z.string())
        .describe("Option codes INCLUDED FREE on this brand."),
      paidOptions: z
        .array(
          z.object({
            code: z.string(),
            note: z.string().nullable(),
          }),
        )
        .describe(
          "Option codes available BUT with extra cost (note has the price/condition).",
        ),
      shoppingId: z.string().nullable(),
      bookingUrl: z
        .string()
        .describe("Deep-link to aerolineas.com.ar to buy this exact combo."),
    }),
  ),
  explored: z.object({
    outboundCalendarDays: z.number().int(),
    returnCalendarDays: z.number().int(),
    combosEvaluated: z.number().int(),
    brandedCalls: z.number().int(),
    brandedHits: z.number().int(),
  }),
};

const tokenStatusOutput = {
  hasToken: z.boolean(),
  expiration: z.number().nullable(),
  expiresInSeconds: z.number().nullable(),
  expiresAtIso: z.string().nullable(),
};

const readOnlyOpen = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
  destructiveHint: false,
};

// `text` is what the LLM (and clients that don't render structuredContent) see.
// `structuredContent` is the typed JSON. For tools that have a natural human
// presentation we use markdown; for technical/internal tools we keep JSON.
function asStructured(value, textRenderer) {
  const text =
    typeof textRenderer === "function"
      ? textRenderer(value)
      : JSON.stringify(value);
  return {
    content: [{ type: "text", text }],
    structuredContent: value,
  };
}

function jsonResource(uri, value) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function buildServer() {
  const server = new McpServer(
    {
      name: "aerolineas-mcp",
      version: "0.10.0",
      websiteUrl: "https://www.aerolineas.com.ar",
      description:
        "Search Aerolíneas Argentinas flight offers, brand inclusions, and best round-trip combinations.",
      icons: [
        {
          src: "data:image/x-icon;base64,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",
          mimeType: "image/x-icon",
          sizes: ["16x16", "32x32"],
        },
      ],
    },
    { instructions: serverInstructions },
  );

  server.registerTool(
    "search_flights",
    {
      title: "Search Aerolíneas Argentinas flight offers",
      description:
        "Calls api.aerolineas.com.ar/v1/flights/offers and returns a lean per-leg list of days. Use `include` to add segments/availability/fareDetails, `topN` for cheapest only, or `dates` to filter.",
      inputSchema: searchInput,
      outputSchema: searchOutput,
      annotations: { ...readOnlyOpen, title: "Search flight offers" },
    },
    async ({ include, topN, dates, ...searchArgs }) => {
      const data = await searchOffers(searchArgs);
      const summary = summarizeOffers(data, { include, topN, dates, searchArgs });
      return asStructured(summary, renderSearchFlights);
    },
  );

  server.registerTool(
    "get_fare_rules",
    {
      title: "Get brand/fare rules (baggage, changes, refunds, …)",
      description:
        "Returns the fare-rule programs and per-brand options for a search. Use only when reference resources are not enough.",
      inputSchema: searchInput,
      outputSchema: fareRulesOutput,
      annotations: { ...readOnlyOpen, title: "Get fare rules" },
    },
    async ({ include: _i, topN: _t, dates: _d, ...searchArgs }) => {
      const data = await searchOffers(searchArgs);
      return asStructured({ rules: extractFareRules(data) });
    },
  );

  server.registerTool(
    "find_best_combinations",
    {
      title: "Find best round-trip combinations within date windows",
      description:
        "Cheapest round-trip combos filtered by required brand options (e.g. CARRY_ON). Pass outbound/return windows + min/max stay. Returns all valid brand pairings sorted by total.",
      inputSchema: combinationsInput,
      outputSchema: combinationsOutput,
      annotations: {
        ...readOnlyOpen,
        title: "Find best round-trip combinations",
      },
    },
    async (args) =>
      asStructured(await findBestCombinations(args), renderCombinations),
  );

  server.registerTool(
    "token_status",
    {
      title: "Inspect auth token cache",
      description:
        "Returns the cached token's expiration. Set refresh=true to force a re-scrape.",
      inputSchema: { refresh: z.boolean().default(false) },
      outputSchema: tokenStatusOutput,
      annotations: { ...readOnlyOpen, title: "Inspect auth token cache" },
    },
    async ({ refresh }) => {
      if (refresh) await getAccessToken({ force: true });
      else await getAccessToken();
      return asStructured(tokenStatus());
    },
  );

  server.registerResource(
    "brands",
    "aerolineas://reference/brands",
    {
      title: "Brand catalog",
      description:
        "List of fare brands (EA, EB, EP, EF, PE, BC, …) with cabin, carry-on/checked-bag inclusion and notes. Stable; safe to cache.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href ?? uri.toString(), brands),
  );

  server.registerResource(
    "fare-options",
    "aerolineas://reference/fare-options",
    {
      title: "Fare option codes",
      description:
        "Catalog of option codes used in requireOptions and fare rules (CARRY_ON, CHECKED_BAGGAGE, EXCHANGES, REFUNDS, …) with English + Spanish names.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href ?? uri.toString(), fareOptions),
  );

  server.registerResource(
    "cabin-classes",
    "aerolineas://reference/cabin-classes",
    {
      title: "Cabin classes",
      description: "Cabin class codes accepted by the cabinClass argument.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href ?? uri.toString(), cabinClasses),
  );

  server.registerResource(
    "airports",
    "aerolineas://reference/airports",
    {
      title: "Common airports",
      description:
        "Curated list of Argentine cabotage airports (IATA → city/name). Not exhaustive; international airports not included.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href ?? uri.toString(), airports),
  );

  return server;
}
