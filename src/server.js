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
  buildServerInstructions,
} from "./reference.js";
import { config } from "./config.js";

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
      "Deep-link to the upstream booking page preloaded with the searched legs (if BOOKING_URL_BASE is configured).",
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
        .describe("Deep-link to the upstream booking page for this exact combo (if BOOKING_URL_BASE is configured)."),
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
  const uriScheme = config.resourceUriScheme();
  const server = new McpServer(
    {
      name: config.serverName(),
      version: "0.11.1",
      websiteUrl: config.serverWebsiteUrl() || undefined,
      description: config.serverDescription(),
    },
    { instructions: buildServerInstructions(uriScheme) },
  );

  server.registerTool(
    "search_flights",
    {
      title: "Search flight offers",
      description:
        "Calls the upstream airline's offers endpoint and returns a lean per-leg list of days. Use `include` to add segments/availability/fareDetails, `topN` for cheapest only, or `dates` to filter.",
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
    `${uriScheme}://reference/brands`,
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
    `${uriScheme}://reference/fare-options`,
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
    `${uriScheme}://reference/cabin-classes`,
    {
      title: "Cabin classes",
      description: "Cabin class codes accepted by the cabinClass argument.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.href ?? uri.toString(), cabinClasses),
  );

  server.registerResource(
    "airports",
    `${uriScheme}://reference/airports`,
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
