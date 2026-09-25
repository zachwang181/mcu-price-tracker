"use strict";
const { normMpn, leadToWeeks, parseCount, sleep, env } = require("./util");

const SOURCE = "Digi-Key";
const TOKEN_URL = "https://api.digikey.com/v1/oauth2/token";
const SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword";

function configured(e) {
  return Boolean(env(e, "DIGIKEY_CLIENT_ID") && env(e, "DIGIKEY_CLIENT_SECRET"));
}

async function getToken(e) {
  const body = new URLSearchParams({
    client_id: env(e, "DIGIKEY_CLIENT_ID"),
    client_secret: env(e, "DIGIKEY_CLIENT_SECRET"),
    grant_type: "client_credentials",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    // 只印長度，不印內容 —— Actions 的記錄是公開的。
    const hint = `（Secret 長度：Client ID ${String(env(e, "DIGIKEY_CLIENT_ID") || "").length}、Client Secret ${String(env(e, "DIGIKEY_CLIENT_SECRET") || "").length}）`;
    throw new Error(`OAuth ${res.status}: ${text.slice(0, 300)} ${hint}`);
  }
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error(`OAuth 回應沒有 access_token：${text.slice(0, 300)}`);
  return json.access_token;
}

/**
 * Digi-Key 的價格級距長在每個「包裝」（ProductVariation）底下，
 * 每個包裝各有自己的最小訂購量與 StandardPricing。
 */
function toPackagings(product) {
  const vars = product.ProductVariations || product.productVariations || [];
  return vars.map(v => {
    const pk = v.PackageType || v.Packaging || {};
    return {
      name: pk.Name || pk.name || v.DigiKeyProductNumber || "",
      code: v.DigiKeyProductNumber || v.digiKeyProductNumber || "",
      moq: parseCount(v.MinimumOrderQuantity) ?? 1,
      stock: parseCount(v.QuantityAvailableforPackageType),
      breaks: (v.StandardPricing || []).map(b => ({ qty: Number(b.BreakQuantity), unit: Number(b.UnitPrice) })),
    };
  }).filter(p => p.breaks.length);
}

function pickProduct(json, mpn) {
  const want = normMpn(mpn);
  const pools = [json.ExactMatches, json.Products].filter(Array.isArray);
  for (const pool of pools) {
    const hit = pool.find(p => normMpn(p.ManufacturerProductNumber) === want);
    if (hit) return hit;
  }
  return null;
}

/** 回傳 { found, source, mpn, manufacturer, currency, leadWeeks, stock, url, packagings, rawResponse }。 */
async function fetchPart(mpn, ctx) {
  const currency = ctx.currency || "USD";
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "X-DIGIKEY-Client-Id": ctx.clientId,
      "X-DIGIKEY-Locale-Site": ctx.site || "US",
      "X-DIGIKEY-Locale-Language": ctx.language || "en",
      "X-DIGIKEY-Locale-Currency": currency,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Keywords: mpn, Limit: 10, Offset: 0 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return parseResponse(JSON.parse(text), mpn, currency);
}

/** 純函式：把一份 Digi-Key 回應轉成我們的中間格式。單元測試直接餵存下來的真實回應。 */
function parseResponse(json, mpn, currency = "USD") {
  const product = pickProduct(json, mpn);
  if (!product) return { found: false, source: SOURCE, mpn, rawResponse: json };

  return {
    found: true,
    source: SOURCE,
    mpn,
    manufacturer: (product.Manufacturer && (product.Manufacturer.Name || product.Manufacturer.name)) || "",
    currency,
    leadWeeks: leadToWeeks(product.ManufacturerLeadWeeks),
    stock: parseCount(product.QuantityAvailable),
    url: product.ProductUrl || "",
    packagings: toPackagings(product),
    rawResponse: json,
  };
}

/** 依序抓一批料號。每顆之間稍微停一下，避免踩到速率限制。 */
async function fetchAll(mpns, e, opts = {}) {
  const token = await getToken(e);
  const ctx = {
    token,
    clientId: env(e, "DIGIKEY_CLIENT_ID"),
    currency: env(e, "DIGIKEY_CURRENCY") || "USD",
    site: env(e, "DIGIKEY_SITE") || "US",
    language: env(e, "DIGIKEY_LANGUAGE") || "en",
  };
  const out = [];
  for (const mpn of mpns) {
    try {
      out.push(await fetchPart(mpn, ctx));
    } catch (err) {
      out.push({ found: false, error: String(err.message || err), source: SOURCE, mpn });
    }
    await sleep(opts.delayMs ?? 300);
  }
  return out;
}

module.exports = { SOURCE, configured, getToken, fetchPart, fetchAll, toPackagings, pickProduct, parseResponse };
