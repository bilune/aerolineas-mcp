// Markdown formatters for tool responses. The MCP spec says `content[].text`
// SHOULD be a human-readable representation of `structuredContent` for clients
// that don't render structured content. We use it as the LLM-facing rendering;
// `structuredContent` keeps the typed JSON for client UI / chained tool calls.

function fmtNumber(n) {
  if (n == null) return "—";
  return n.toLocaleString("es-AR");
}

function fmtPrice(n) {
  if (n == null) return "—";
  return `$${n.toLocaleString("es-AR")}`;
}

function shortDate(yyyyMmDd) {
  if (!yyyyMmDd) return "—";
  const [, m, d] = yyyyMmDd.split("-");
  return `${d}-${m}`;
}

// ---- find_best_combinations ----------------------------------------------

export function renderCombinations(result) {
  const lines = [];
  const n = result.combinations.length;
  const req =
    result.requireOptions?.length > 0
      ? ` con ${result.requireOptions.join(" + ")} incluido`
      : "";
  lines.push(
    `**${n} combinaciones${req}** · ${result.currency} · ${result.validBrandCount} brand${result.validBrandCount === 1 ? "" : "s"} cumplen el filtro`,
  );
  lines.push("");

  if (!n) {
    lines.push("_No se encontraron combinaciones válidas._");
    return lines.join("\n");
  }

  lines.push("| # | Salida | Vuelta | Días | Brand | Total | Comprar |");
  lines.push("|---|---|---|---|---|---|---|");
  for (let i = 0; i < result.combinations.length; i++) {
    const c = result.combinations[i];
    const out = `${shortDate(c.outDate)} ${c.out.depart ?? "—"} ${c.out.flightCode ?? ""}`.trim();
    const ret = `${shortDate(c.retDate)} ${c.ret.depart ?? "—"} ${c.ret.flightCode ?? ""}`.trim();
    const brand = `${c.brandCode}${c.brandName ? ` ${c.brandName}` : ""}`;
    const link = c.bookingUrl ? `[link](${c.bookingUrl})` : "—";
    lines.push(
      `| ${i + 1} | ${out} | ${ret} | ${c.stay} | ${brand} | ${fmtPrice(c.total)} | ${link} |`,
    );
  }
  lines.push("");

  // Summarize included / paid options from the first row (typically uniform).
  const first = result.combinations[0];
  if (first?.includedOptions?.length) {
    lines.push(
      `**Incluido gratis:** ${first.includedOptions.join(", ")}`,
    );
  }
  if (first?.paidOptions?.length) {
    const paid = first.paidOptions
      .map((p) => `${p.code}${p.note ? ` (${p.note})` : ""}`)
      .join(", ");
    lines.push(`**Con costo extra:** ${paid}`);
  }

  lines.push("");
  const e = result.explored;
  lines.push(
    `_Explorado: ${e.outboundCalendarDays} días de ida × ${e.returnCalendarDays} de vuelta, ${e.combosEvaluated} combos rankeados, ${e.brandedCalls} branded calls (${e.brandedHits} pairings)._`,
  );

  return lines.join("\n");
}

// ---- search_flights -------------------------------------------------------

export function renderSearchFlights(result) {
  const lines = [];
  const routes = result.routes.join(" + ");
  const mode =
    result.searchType === "FLEXCALENDAR" ? "calendario flex" : "tarifas branded";
  lines.push(
    `**${routes}** · ${result.currency} · ${mode} · ${result.flightType}`,
  );

  if (result.priceSummary?.length) {
    const sum = result.priceSummary
      .map(
        (p) =>
          `${p.route}: ${fmtPrice(p.min)}–${fmtPrice(p.max)}${p.bestDate ? ` (mejor ${shortDate(p.bestDate)})` : ""}`,
      )
      .join(" · ");
    lines.push(sum);
  }
  if (result.bookingUrl) {
    lines.push(`[Comprar esta búsqueda](${result.bookingUrl})`);
  }
  lines.push("");

  for (const leg of result.legs) {
    lines.push(`### Leg ${leg.index}: ${leg.route ?? ""}`);
    if (leg.warnings?.length) {
      for (const w of leg.warnings) lines.push(`> ⚠ ${w}`);
      lines.push("");
    }
    if (leg.days?.length) {
      lines.push(...renderFlexDays(leg.days));
    } else if (leg.offers?.length) {
      lines.push(...renderBrandedOffers(leg.offers));
    } else {
      lines.push("_Sin resultados._");
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

function renderFlexDays(days) {
  const hasSegments = days.some((d) => d.segments?.length);
  const hasMismatch = days.some((d) => d.originMismatch || d.destinationMismatch);
  const headers = ["Día", "Total", "Ruta real", "Stops", "Salida", "Llegada", "Dur (min)"];
  if (hasMismatch) headers.push("⚠");
  if (hasSegments) headers.push("Vuelo");
  const out = [];
  out.push(`| ${headers.join(" | ")} |`);
  out.push(`|${headers.map(() => "---").join("|")}|`);
  for (const d of days) {
    const route =
      d.actualOrigin && d.actualDestination
        ? `${d.actualOrigin}→${d.actualDestination}`
        : "—";
    const cells = [
      shortDate(d.date),
      fmtPrice(d.total),
      route,
      d.stops ?? "—",
      d.depart ?? "—",
      d.arrive ?? "—",
      d.duration ?? "—",
    ];
    if (hasMismatch) {
      cells.push(d.originMismatch || d.destinationMismatch ? "⚠" : "");
    }
    if (hasSegments) {
      const flights = (d.segments ?? [])
        .map((s) => `${s.airline}${s.flightNumber}`)
        .join(",");
      cells.push(flights || "—");
    }
    out.push(`| ${cells.join(" | ")} |`);
  }
  return out;
}

function renderBrandedOffers(offers) {
  const out = [];
  for (const o of offers) {
    const stops = o.stops === 0 ? "directo" : `${o.stops} escalas`;
    const route =
      o.actualOrigin && o.actualDestination
        ? `${o.actualOrigin}→${o.actualDestination}`
        : "";
    const mismatch =
      o.originMismatch || o.destinationMismatch
        ? " ⚠ aeropuerto distinto al pedido"
        : "";
    out.push(
      `**${shortDate(o.date)}** ${route} · ${o.depart ?? "—"}→${o.arrive ?? "—"} · ${stops} · ${o.duration ?? "?"} min${mismatch}`,
    );
    if (o.brands?.length) {
      // Sort by total ascending so cheapest is on top
      const sorted = [...o.brands].sort(
        (a, b) => (a.total ?? Infinity) - (b.total ?? Infinity),
      );
      out.push("| Brand | Tarifa | Total |");
      out.push("|---|---|---|");
      for (const b of sorted) {
        const name = b.brandName
          ? `${b.brandCode} ${b.brandName}`
          : (b.brandCode ?? "—");
        const fare = b.cabinClass ? b.cabinClass : "—";
        out.push(`| ${name} | ${fare} | ${fmtPrice(b.total)} |`);
      }
    }
    out.push("");
  }
  return out;
}
