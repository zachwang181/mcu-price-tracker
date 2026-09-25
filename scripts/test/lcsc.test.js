"use strict";
/**
 * LCSC 還沒拿到 key，所以這裡驗的是「照官方文件寫的東西對不對」：
 *  - 簽章演算法用文件裡的示範數值對答案
 *  - 解析用文件 4.1.1 的回應範例
 * 拿到 key 之後要再跑一次 capture workflow，用真實回應換掉這份 fixture。
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const lcsc = require("../lib/lcsc");
const { resultToObs } = require("../lib/build");

const DOC = require(path.join(__dirname, "fixtures", "lcsc-doc-example.json"));

test("簽章：組出來的字串跟官方文件的示範一字不差", () => {
  // 文件 2.1 節的例子。注意：文件同時給了一個雜湊值
  // 5960caf5c9675e9b4cad58ef46bf722b5413e9fa，但那個值跟它自己給的輸入字串
  // 對不起來（sha1 / sha256 / md5、各種欄位排列都試過都不符），所以文件的
  // 示範雜湊不能當答案用。字串本身是可以驗的，先鎖住字串；
  // 實際用哪種演算法等拿到 key 打真實 API 才能確定，屆時用 LCSC_SIGN_ALGO 切換。
  const { signature, signedString } = lcsc.sign({
    key: "7dc6035da7874b5b9bc245bd28017290",
    secret: "eiru73y343r36fdi",
    nonce: "63yeike7dy6c2kjd",
    timestamp: "1524662065",
    algo: "sha1",
    includeParams: false,
  });
  assert.equal(signedString,
    "key=7dc6035da7874b5b9bc245bd28017290&nonce=63yeike7dy6c2kjd&secret=eiru73y343r36fdi&timestamp=1524662065");
  assert.match(signature, /^[0-9a-f]{40}$/);
});

test("簽章演算法可以切換，預設照文件的 Python 範例用 sha256", () => {
  const args = { key: "K", secret: "S", nonce: "N", timestamp: "1", includeParams: false };
  assert.match(lcsc.sign(args).signature, /^[0-9a-f]{64}$/, "預設 sha256");
  assert.match(lcsc.sign({ ...args, algo: "sha1" }).signature, /^[0-9a-f]{40}$/);
});

test("簽章：帶請求參數時照 key 排序接在後面（文件的 Python 範例）", () => {
  const { signedString } = lcsc.sign({
    key: "K", secret: "S", nonce: "N", timestamp: "1",
    params: { returnInformation: "All", keyword: "GD32F103C8T6", limit: 10 },
  });
  assert.equal(signedString, "key=K&nonce=N&secret=S&timestamp=1&keyword=GD32F103C8T6&limit=10&returnInformation=All");
});

test("quotePlus 跟 Python 的 urllib.parse.quote_plus 一致", () => {
  assert.equal(lcsc.quotePlus("a b"), "a+b");
  assert.equal(lcsc.quotePlus("10kΩ, 1%"), "10k%CE%A9%2C+1%25");
  assert.equal(lcsc.quotePlus("a~b_c.d-e"), "a~b_c.d-e");
  assert.equal(lcsc.quotePlus("(x)"), "%28x%29");
});

test("解析文件的回應範例：欄位名稱、級距、最小訂購量、幣別", () => {
  const r = lcsc.parseResponse(DOC, "SMBJ54A", "USD");
  assert.equal(r.found, true);
  assert.equal(r.source, "LCSC");
  assert.equal(r.manufacturer, "FOSAN");
  assert.equal(r.currency, "USD");
  assert.equal(r.stock, 0);
  assert.equal(r.leadWeeks, null, "LCSC 回應裡沒有交期欄位");
  assert.equal(r.url, "https://fat.lcsc.com/product-detail/C5353278.html");
  assert.equal(r.packagings.length, 1);
  assert.equal(r.packagings[0].code, "C5353278");
  assert.equal(r.packagings[0].moq, 10);
  assert.deepEqual(r.packagings[0].breaks, [{ qty: 10, unit: 0.0478 }, { qty: 100, unit: 0.0385 }]);
});

test("最小訂購量 10 > 買 1 顆，所以買 1 顆這一筆不會產生", () => {
  const obs = resultToObs(lcsc.parseResponse(DOC, "SMBJ54A", "USD"), "2026-09-26");
  assert.deepEqual(obs.map(o => [o.q, o.p]), [[100, 0.0385], [1000, 0.0385]]);
  assert.ok(obs.every(o => o.src === "LCSC" && o.cur === "USD"));
});

test("LCSC 的分類抽得出來，剛好補上國產料缺的規格", () => {
  const r = lcsc.parseResponse(DOC, "SMBJ54A", "USD");
  assert.deepEqual(r.spec.categoryPath, ["Circuit Protection", "Transient Voltage Suppressors (TVS)", "TVS Diodes"]);
  assert.equal(r.spec.category, "TVS Diodes");
  assert.equal(r.spec.package, "SMB");
  assert.equal(r.spec.src, "LCSC");
});

test("查無與錯誤回應不會讓程式壞掉", () => {
  assert.equal(lcsc.parseResponse({ success: true, result: { products: [] } }, "NOPE").found, false);
  assert.throws(() => lcsc.parseResponse({ success: false, code: 4002, message: "API key is disabled or not found." }, "X"),
    /API key is disabled/);
});

test("查無時列出相近料號", () => {
  const json = { success: true, result: { products: [
    { manufacturerProductNumber: "GD32F103C8T6TR" }, { manufacturerProductNumber: "OTHER" },
  ] } };
  assert.deepEqual(lcsc.parseResponse(json, "GD32F103C8T6").suggestions, ["GD32F103C8T6TR"]);
});

test("沒設定 key 就不會啟用", () => {
  assert.equal(lcsc.configured({}), false);
  assert.equal(lcsc.configured({ LCSC_API_KEY: "a" }), false);
  assert.equal(lcsc.configured({ LCSC_API_KEY: "a", LCSC_API_SECRET: "b" }), true);
});
