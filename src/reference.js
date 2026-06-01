// Static reference data exposed as MCP resources. Curated from observed
// fareRules responses of the upstream airline + common domestic airports
// for the configured market. Adapt to your target airline if needed.

export const brands = [
  { code: "EA", name: "Promo",                 cabin: "Economy",        includesCarryOn: false, includesCheckedBag: false, notes: "Cheapest miles fare. No carry-on, no checked baggage; only personal item." },
  { code: "EB", name: "Base",                  cabin: "Economy",        includesCarryOn: false, includesCheckedBag: false, notes: "Cheapest cash fare. Only personal item (3kg) is included; carry-on is AVAILABLE FOR EXTRA CHARGE, not free. To include carry-on without paying extra, use EP Plus or above." },
  { code: "EX", name: "Turista (miles)",       cabin: "Economy",        includesCarryOn: false, includesCheckedBag: false, notes: "Miles fare with personal item only." },
  { code: "EP", name: "Plus",                  cabin: "Economy",        includesCarryOn: true,  includesCheckedBag: false, notes: "Carry-on (8kg) included free. Checked baggage is AVAILABLE FOR EXTRA CHARGE." },
  { code: "EF", name: "Flex",                  cabin: "Economy",        includesCarryOn: true,  includesCheckedBag: true,  notes: "Carry-on + 1 checked bag (15kg) included free. Free changes and partial refunds." },
  { code: "PA", name: "Premium Economy (miles)", cabin: "PremiumEconomy", includesCarryOn: true, includesCheckedBag: true, notes: "Premium Economy paid with miles." },
  { code: "PP", name: "Promo Premium Economy", cabin: "PremiumEconomy", includesCarryOn: true,  includesCheckedBag: true,  notes: "Premium Economy promo fare." },
  { code: "PE", name: "Premium Economy",       cabin: "PremiumEconomy", includesCarryOn: true,  includesCheckedBag: true,  notes: "Full Premium Economy with more legroom." },
  { code: "BA", name: "Business (miles)",      cabin: "Business",       includesCarryOn: true,  includesCheckedBag: true,  notes: "Business paid with miles." },
  { code: "BI", name: "Promo Business",        cabin: "Business",       includesCarryOn: true,  includesCheckedBag: true,  notes: "Discounted Business fare." },
  { code: "BC", name: "Business",              cabin: "Business",       includesCarryOn: true,  includesCheckedBag: true,  notes: "Full Business: lounges, priority, multiple bags." },
];

export const fareOptions = [
  { code: "Personal_Item",     es: "Artículo personal",     description: "Personal item (small bag under the seat, ~3kg). Almost always included." },
  { code: "CARRY_ON",          es: "Equipaje de mano",      description: "Cabin carry-on bag (~8kg). Included on Base and above." },
  { code: "CHECKED_BAGGAGE",   es: "Equipaje en bodega",    description: "Checked bag in the hold. Included starting on Plus." },
  { code: "SEAT_SELECTION",    es: "Selección de asiento",  description: "Pre-flight seat selection. Free in higher brands, paid in lower ones." },
  { code: "EXCHANGES",         es: "Cambios",               description: "Ability to change the ticket (may have fees)." },
  { code: "REFUNDS",           es: "Devoluciones",          description: "Ability to refund the ticket (may have fees)." },
  { code: "ARPLUS_MILES",      es: "Millas",                description: "Accrual of loyalty-program miles on the ticket." },
  { code: "PRIORITY_BOARDING", es: "Embarque prioritario",  description: "Priority boarding lane." },
  { code: "LOUNGE",            es: "Sala VIP",              description: "Access to airport lounges (typically Business)." },
];

export const cabinClasses = [
  { code: "Economy",         description: "Standard economy class." },
  { code: "PremiumEconomy",  description: "Premium economy with extra legroom and meal." },
  { code: "Business",        description: "Business class with lie-flat or recliner seats." },
];

export const airports = [
  { iata: "AEP", name: "Aeroparque Jorge Newbery",    city: "Buenos Aires", country: "AR", domestic: true },
  { iata: "EZE", name: "Ezeiza Ministro Pistarini",   city: "Buenos Aires", country: "AR", domestic: true, notes: "International hub." },
  { iata: "BHI", name: "Comandante Espora",           city: "Bahía Blanca", country: "AR", domestic: true },
  { iata: "COR", name: "Ingeniero Taravella",         city: "Córdoba",      country: "AR", domestic: true },
  { iata: "MDZ", name: "El Plumerillo",               city: "Mendoza",      country: "AR", domestic: true },
  { iata: "BRC", name: "Teniente Luis Candelaria",    city: "Bariloche",    country: "AR", domestic: true },
  { iata: "USH", name: "Malvinas Argentinas",         city: "Ushuaia",      country: "AR", domestic: true },
  { iata: "FTE", name: "Comandante Armando Tola",     city: "El Calafate",  country: "AR", domestic: true },
  { iata: "IGR", name: "Cataratas del Iguazú",        city: "Puerto Iguazú", country: "AR", domestic: true },
  { iata: "SLA", name: "Martín Miguel de Güemes",     city: "Salta",        country: "AR", domestic: true },
  { iata: "TUC", name: "Teniente Benjamín Matienzo",  city: "Tucumán",      country: "AR", domestic: true },
  { iata: "NQN", name: "Presidente Perón",            city: "Neuquén",      country: "AR", domestic: true },
  { iata: "ROS", name: "Islas Malvinas",              city: "Rosario",      country: "AR", domestic: true },
  { iata: "MDQ", name: "Astor Piazzolla",             city: "Mar del Plata", country: "AR", domestic: true },
  { iata: "REL", name: "Almirante Marcos A. Zar",     city: "Trelew",       country: "AR", domestic: true },
  { iata: "CRD", name: "General Mosconi",             city: "Comodoro Rivadavia", country: "AR", domestic: true },
  { iata: "RGL", name: "Piloto Civil Norberto Fernández", city: "Río Gallegos", country: "AR", domestic: true },
  { iata: "PSS", name: "Libertador General José de San Martín", city: "Posadas", country: "AR", domestic: true },
];

export function buildServerInstructions(uriScheme) {
  return `
Flight search MCP — wrapper for an upstream airline's flight inventory API.
Prices in the upstream currency (typically ARS for this deployment). Dates YYYY-MM-DD.

Tool selection:
- find_best_combinations: USE THIS when the user is flexible on dates and wants
  the cheapest round-trip honoring constraints like CARRY_ON or CHECKED_BAGGAGE.
  Pass outbound/return date windows + minStay/maxStay + requireOptions.
- search_flights: use for exploring a specific date or a 30-day flex calendar
  with no brand-option filter. Default response is lean; pass \`include\` to add
  segments/availability/fareDetails when you've already chosen candidates.
- get_fare_rules: use to inspect what each brand actually includes when the
  reference resources are not enough or you suspect the catalog changed.
- token_status: debug only.

Brand cheat sheet (Economy domestic — codes are upstream-specific):
- EA Promo: only personal item. Carry-on NOT available.
- EB Base: only personal item INCLUDED FREE. Carry-on is AVAILABLE FOR EXTRA
  CHARGE — do NOT tell the user "Base includes carry-on", because it doesn't.
- EP Plus: carry-on (8kg) included free. Checked bag is extra charge.
- EF Flex: carry-on + 1 checked bag (15kg) included free + free changes.
- PE Premium Economy: like Flex but Premium Economy cabin.
- BC Business: typically full-service, but the upstream fareRules data has all
  options as 'unavailable' for this brand — do NOT rely on fareRules to validate
  carry-on inclusion on Business; consult the brands reference resource instead.

IMPORTANT: in the get_fare_rules output, each option has an \`inclusion\` field:
  - "free"        → included at no extra cost
  - "paid"        → AVAILABLE but with an extra charge (check \`inclusionNote\`)
  - "unavailable" → not in this brand at all
NEVER interpret \`enabled: true\` as "free". Use \`inclusion\` instead. The
find_best_combinations tool already filters strictly by inclusion === "free"
when you pass requireOptions, so its results are guaranteed to include the
required options without extra cost.

Common requireOptions strings: "CARRY_ON", "CHECKED_BAGGAGE", "Personal_Item",
"SEAT_SELECTION", "EXCHANGES", "REFUNDS", "ARPLUS_MILES".

IMPORTANT - Metro-code substitution: the upstream airline treats EZE and AEP
(both Buenos Aires) as the same node. If you request EZE→BHI you may receive
mixed offers — some really from EZE, some actually from AEP. Each offer carries
\`actualOrigin\` and \`actualDestination\` fields with the TRUE airport from the
segment data, and an \`originMismatch\`/\`destinationMismatch\` flag when they
differ from the requested leg. Legs with mismatches also carry a \`warnings\`
array. ALWAYS check actualOrigin before telling the user a flight is from a
specific airport. The same may apply to other multi-airport cities.

Reference data (read once per session if needed):
- ${uriScheme}://reference/brands
- ${uriScheme}://reference/fare-options
- ${uriScheme}://reference/cabin-classes
- ${uriScheme}://reference/airports
`.trim();
}
