"use strict";
const { normMpn, leadToWeeks, parseCount, parseMoney, sleep, env } = require("./util");
const { toSpec } = require("./spec");

const SOURCE = "Mouser";
const SEARCH_URL = "https://api.mouser.com/api/v1/search/partnumber";

function configured(e) {
  return Boolean(env(e, "MOUSER_API_KEY"));
}

/**
 * Mouser 把不同包裝拆成不同的 Mouser 料號，各自一筆 Part。
 * 所以「一筆 Part」= 我們的「一個包裝」。
 */
function toPackaging(part) {
  const breaks = (part.PriceBreaks || []).map(b => ({
    qty: parseCount(b.Quantity),
    unit: parseMoney(b.Price),
    currency: b.Currency || "",
  })).filter(b => b.qty != null && b.unit != null);
  return {
    name: part.MouserPartNumber || "",
    code: part.MouserPartNumber || "",
    moq: parseCount(part.Min) ?? 1,
    stock: parseCount(part.Availability),
    breaks,
    currency: (breaks.find(b => b.currency) || {}).currency || "",
  };
}

/** 查無時列出「我們的料號 + 後綴」的候選，只用來提示，不會自動採用。 */
function suggestions(parts, mpn) {
  const want = normMpn(mpn);
  const out = [];
  for (const p of parts || []) {
    const n = p.ManufacturerPartNumber;
    if (!n || normMpn(n) === want || !normMpn(n).startsWith(want)) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out.slice(0, 4);
}

async function fetchPart(mpn, ctx) {
  const res = await fetch(`${SEARCH_URL}?apiKey=${encodeURIComponent(ctx.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      SearchByPartRequest: { mouserPartNumber: mpn, partSearchOptions: ctx.searchOption || "Exact" },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return parseResponse(JSON.parse(text), mpn, ctx.fallbackCurrency);
}

/** 純函式：把一份 Mouser 回應轉成我們的中間格式。單元測試直接餵存下來的真實回應。 */
function parseResponse(json, mpn, fallbackCurrency = "USD") {
  const errs = (json.Errors || []).map(e => e.Message || e.message || JSON.stringify(e)).filter(Boolean);
  if (errs.length) throw new Error(errs.join("; ").slice(0, 300));

  const want = normMpn(mpn);
  const all = (json.SearchResults && json.SearchResults.Parts) || [];
  const parts = all.filter(p => normMpn(p.ManufacturerPartNumber) === want);
  if (!parts.length) return { found: false, source: SOURCE, mpn, suggestions: suggestions(all, mpn), rawResponse: json };

  const packagings = parts.map(toPackaging).filter(p => p.breaks.length);
  if (!packagings.length) return { found: false, source: SOURCE, mpn, reason: "沒有價格級距（可能缺貨或需洽詢）", rawResponse: json };

  // 幣別照 Mouser 回什麼就記什麼（台灣帳號可能是 TWD），不自行換算。
  const currency = packagings.find(p => p.currency)?.currency || fallbackCurrency || "USD";
  const leads = parts.map(p => leadToWeeks(p.LeadTime)).filter(v => v != null);
  const stocks = parts.map(p => parseCount(p.Availability)).filter(v => v != null);

  return {
    found: true,
    source: SOURCE,
    mpn,
    manufacturer: parts[0].Manufacturer || "",
    currency,
    leadWeeks: leads.length ? Math.min(...leads) : null,
    stock: stocks.length ? Math.max(...stocks) : null,
    url: parts[0].ProductDetailUrl || "",
    packagings,
    spec: toSpec.fromMouser(parts[0]),
    rawResponse: json,
  };
}

async function fetchAll(mpns, e, opts = {}) {
  const ctx = {
    apiKey: env(e, "MOUSER_API_KEY"),
    searchOption: env(e, "MOUSER_SEARCH_OPTION") || "Exact",
    fallbackCurrency: env(e, "MOUSER_CURRENCY") || "USD",
  };
  const out = [];
  for (const mpn of mpns) {
    try {
      out.push(await fetchPart(mpn, ctx));
    } catch (err) {
      out.push({ found: false, error: String(err.message || err), source: SOURCE, mpn });
    }
    await sleep(opts.delayMs ?? 600);   // Mouser 有每分鐘上限，放慢一點
  }
  return out;
}

module.exports = { SOURCE, configured, fetchPart, fetchAll, toPackaging, parseResponse, suggestions };
