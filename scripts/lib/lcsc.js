"use strict";
const crypto = require("crypto");
const { normMpn, parseCount, sleep, env } = require("./util");
const { toSpec } = require("./spec");

const SOURCE = "LCSC";
// LCSC 會告訴你要用哪個網域（文件範例用的是他們的測試站 fatapi.lcsc.com）。
// 不用改程式：在 repo 的 Settings → Secrets and variables → Actions → Variables
// 新增 LCSC_BASE_URL 就會蓋過預設值。
const DEFAULT_BASE = "https://api.lcsc.com";
const PATH = "/rest/api/agent/product/v1/keywordsearch";

function configured(e) {
  return Boolean(env(e, "LCSC_API_KEY") && env(e, "LCSC_API_SECRET"));
}

/** Python urllib.parse.quote_plus 的等價實作 —— 簽章字串要跟官方範例逐字元一致。 */
function quotePlus(s) {
  return encodeURIComponent(String(s))
    .replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

/**
 * 官方文件的 Python 範例用 sha256，並且把「排序後的請求參數」接在簽章字串後面：
 *   sha256("key=..&nonce=..&secret=..&timestamp=..&<排序後的參數>")
 * 但 lcsc.com/docs 那頁的文字說明寫的是 sha1 且不含參數。兩者兜不攏，
 * 所以預設照文件範例走 sha256，需要時用 LCSC_SIGN_ALGO=sha1 切換。
 */
function sign({ key, secret, nonce, timestamp, params, algo = "sha256", includeParams = true }) {
  let s = `key=${key}&nonce=${nonce}&secret=${secret}&timestamp=${timestamp}`;
  if (includeParams && params) {
    const query = Object.keys(params).sort()
      .filter(k => params[k] !== undefined && params[k] !== null)
      .map(k => `${quotePlus(k)}=${quotePlus(params[k])}`)
      .join("&");
    if (query) s += "&" + query;
  }
  return { signature: crypto.createHash(algo).update(s, "utf8").digest("hex"), signedString: s };
}

const randomNonce = () => crypto.randomBytes(8).toString("hex");   // 16 碼

/**
 * LCSC 一個原廠料號可能對應多個 LCSC 料號（不同包裝），每個各自有
 * 最小訂購量與價格級距，剛好對上我們的「包裝」模型。
 */
function toPackaging(p) {
  const pp = p.productPrice || {};
  return {
    name: [p.package, p.packageType].filter(Boolean).join(" / ") || p.lcscProductNumber || "",
    code: p.lcscProductNumber || "",
    moq: parseCount(p.minimumOrderQuantity) ?? 1,
    stock: parseCount(pp.quantityAvailable),
    breaks: (pp.standardPricing || [])
      .map(b => ({ qty: parseCount(b.breakQuantity), unit: Number(b.unitPrice) }))
      .filter(b => b.qty != null && Number.isFinite(b.unit)),
    currency: pp.currency || "",
  };
}

/** 查無時列出「我們的料號 + 後綴」的候選，只提示不採用。 */
function suggestions(products, mpn) {
  const want = normMpn(mpn);
  const out = [];
  for (const p of products || []) {
    const n = p.manufacturerProductNumber;
    if (!n || normMpn(n) === want || !normMpn(n).startsWith(want)) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out.slice(0, 4);
}

/** 純函式：把一份 LCSC 回應轉成我們的中間格式。 */
function parseResponse(json, mpn, fallbackCurrency = "USD") {
  if (json && json.success === false) {
    throw new Error(`${json.code || "?"}: ${json.message || "未知錯誤"}`);
  }
  const all = (json && json.result && json.result.products) || [];
  const want = normMpn(mpn);
  const hits = all.filter(p => normMpn(p.manufacturerProductNumber) === want);
  if (!hits.length) return { found: false, source: SOURCE, mpn, suggestions: suggestions(all, mpn), rawResponse: json };

  const packagings = hits.map(toPackaging).filter(p => p.breaks.length);
  if (!packagings.length) return { found: false, source: SOURCE, mpn, reason: "沒有價格級距", rawResponse: json };

  const first = hits[0];
  const stocks = hits.map(p => parseCount(p.productPrice && p.productPrice.quantityAvailable)).filter(v => v != null);
  return {
    found: true,
    source: SOURCE,
    mpn,
    manufacturer: (first.manufacturer && first.manufacturer.name) || "",
    currency: packagings.find(p => p.currency)?.currency || fallbackCurrency,
    leadWeeks: null,                       // LCSC 現貨為主，回應裡沒有交期欄位
    stock: stocks.length ? Math.max(...stocks) : null,
    url: first.productDetailURL || "",
    packagings,
    spec: toSpec.fromLcsc(first),
    rawResponse: json,
  };
}

async function fetchPart(mpn, ctx) {
  const params = {
    keyword: mpn,
    limit: 10,
    offset: 0,
    currency: ctx.currency,
    returnInformation: "All",
    language: "EN",
  };
  const nonce = randomNonce();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const { signature } = sign({
    key: ctx.key, secret: ctx.secret, nonce, timestamp, params,
    algo: ctx.algo, includeParams: ctx.includeParams,
  });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const res = await fetch(`${ctx.baseUrl}${PATH}?${qs}`, {
    method: "GET",
    headers: { key: ctx.key, nonce, timestamp, signature, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return parseResponse(JSON.parse(text), mpn, ctx.currency);
}

async function fetchAll(mpns, e, opts = {}) {
  const ctx = {
    key: env(e, "LCSC_API_KEY"),
    secret: env(e, "LCSC_API_SECRET"),
    baseUrl: (env(e, "LCSC_BASE_URL") || DEFAULT_BASE).replace(/\/+$/, ""),
    currency: env(e, "LCSC_CURRENCY") || "USD",
    algo: env(e, "LCSC_SIGN_ALGO") || "sha256",
    includeParams: env(e, "LCSC_SIGN_PARAMS") !== "false",
  };
  const out = [];
  for (const mpn of mpns) {
    try {
      out.push(await fetchPart(mpn, ctx));
    } catch (err) {
      out.push({ found: false, error: String(err.message || err), source: SOURCE, mpn });
    }
    await sleep(opts.delayMs ?? 400);   // 每分鐘上限 200 次，這個間隔很安全
  }
  return out;
}

module.exports = { SOURCE, configured, fetchPart, fetchAll, parseResponse, toPackaging, suggestions, sign, quotePlus };
