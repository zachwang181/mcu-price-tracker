"use strict";
/**
 * 用「真實 API 回應」驗欄位名稱。
 * fixtures/ 底下的檔案是實際呼叫 Digi-Key / Mouser 存下來的原始回應，
 * 產生方式：node scripts/fetch.js --limit=3 --dump=scripts/test/fixtures/<檔名>.json
 * 欄位名稱一旦被猜錯，這些測試就會抓到。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const digikey = require("../lib/digikey");
const mouser = require("../lib/mouser");
const { resultToObs } = require("../lib/build");
const { BUY_QTYS } = require("../lib/breaks");

const DIR = path.join(__dirname, "fixtures");
const load = name => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
const has = name => fs.existsSync(path.join(DIR, name));

/** 不管哪一家，解析結果都要長成同一個樣子。 */
function checkShape(r, mpn) {
  assert.equal(r.mpn, mpn);
  assert.ok(typeof r.source === "string" && r.source, "要有通路名稱");
  assert.ok(typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency), `幣別要是三碼，拿到 ${r.currency}`);
  assert.ok(Array.isArray(r.packagings) && r.packagings.length, "至少要有一個包裝");
  for (const pk of r.packagings) {
    assert.ok(Number.isFinite(pk.moq) && pk.moq >= 1, `MOQ 要是正整數，拿到 ${pk.moq}`);
    assert.ok(pk.breaks.length, `包裝 ${pk.name} 要有價格級距`);
    for (const b of pk.breaks) {
      assert.ok(Number.isFinite(b.qty) && b.qty >= 1, `級距數量要是正數，拿到 ${b.qty}`);
      assert.ok(Number.isFinite(b.unit) && b.unit > 0, `單價要大於 0，拿到 ${b.unit}`);
    }
    const qs = pk.breaks.map(b => b.qty);
    assert.deepEqual(qs, [...qs].sort((a, b) => a - b), "級距數量要由小到大");
  }
  assert.ok(r.leadWeeks === null || Number.isFinite(r.leadWeeks), "交期要是數字或 null");
  assert.ok(r.stock === null || Number.isFinite(r.stock), "庫存要是數字或 null");
}

function checkObs(r) {
  const obs = resultToObs(r, "2026-09-25");
  assert.ok(obs.length >= 1 && obs.length <= 3);
  assert.ok(obs.every(o => BUY_QTYS.includes(o.q)));
  assert.ok(obs.every(o => o.p > 0 && o.cur === r.currency && o.kind === "catalog" && o.origin === "auto"));
  assert.equal(new Set(obs.map(o => o.id)).size, obs.length, "同一次不會產生重複 id");
  // 買越多單價不該變貴
  const byQty = [...obs].sort((a, b) => a.q - b.q);
  for (let i = 1; i < byQty.length; i++) {
    assert.ok(byQty[i].p <= byQty[i - 1].p + 1e-9, `買 ${byQty[i].q} 顆的單價不該比買 ${byQty[i - 1].q} 顆貴`);
  }
}

const dkFile = "digikey-real.json";
test("Digi-Key：真實回應的欄位名稱正確", { skip: has(dkFile) ? false : `還沒有 fixtures/${dkFile}` }, () => {
  const dump = load(dkFile);
  const keys = Object.keys(dump).filter(k => k.startsWith("digikey:"));
  assert.ok(keys.length, "fixture 裡沒有 Digi-Key 的回應");
  let found = 0;
  for (const k of keys) {
    const mpn = k.slice("digikey:".length);
    const r = digikey.parseResponse(dump[k], mpn, "USD");
    if (!r.found) continue;
    found++;
    checkShape(r, mpn);
    checkObs(r);
  }
  assert.ok(found, "至少要有一顆料號解析成功");
});

test("Digi-Key：真實回應解出來的數字，逐項對過", { skip: has(dkFile) ? false : `還沒有 fixtures/${dkFile}` }, () => {
  const dump = load(dkFile);
  const r = digikey.parseResponse(dump["digikey:STM32F103C8T6"], "STM32F103C8T6", "USD");
  assert.equal(r.manufacturer, "STMicroelectronics");
  assert.equal(r.leadWeeks, 40, "ManufacturerLeadWeeks 是字串 \"40\"，要轉成數字");
  assert.equal(r.stock, 7658);
  assert.equal(r.packagings.length, 1);
  assert.equal(r.packagings[0].name, "Tray");
  assert.equal(r.packagings[0].code, "497-6063-ND");
  assert.deepEqual(r.packagings[0].breaks.map(b => b.qty), [1, 10, 50, 100, 250, 500]);
  assert.deepEqual(resultToObs(r, "2026-09-25").map(o => [o.q, o.p]), [[1, 8.24], [100, 5.3473], [1000, 4.94928]],
    "買 1000 顆要取 500 那一階（≤1000 的最大級距）");

  // 級距落在非整數位置：74 和 518
  const g030 = digikey.parseResponse(dump["digikey:STM32G030F6P6"], "STM32G030F6P6", "USD");
  assert.deepEqual(g030.packagings[0].breaks.map(b => b.qty), [1, 10, 74, 148, 518]);
  assert.deepEqual(resultToObs(g030, "2026-09-25").map(o => [o.q, o.p]), [[1, 2.18], [100, 1.32919], [1000, 1.10917]],
    "買 100 顆取 74 那一階，買 1000 顆取 518 那一階");

  // 最大級距只到 100：買 1000 顆仍然用 100 那一階
  const atmega = digikey.parseResponse(dump["digikey:ATMEGA328P-AU"], "ATMEGA328P-AU", "USD");
  assert.deepEqual(atmega.packagings[0].breaks.map(b => b.qty), [1, 25, 100]);
  assert.deepEqual(resultToObs(atmega, "2026-09-25").map(o => [o.q, o.p]), [[1, 2.66], [100, 2.2], [1000, 2.2]]);
});

test("Digi-Key：搜尋結果含其他料號時，只取原廠料號完全相符的那筆", { skip: has(dkFile) ? false : `還沒有 fixtures/${dkFile}` }, () => {
  const dump = load(dkFile);
  const json = dump["digikey:STM32F103C8T6"];
  assert.ok(json.Products.length > 1, "這份 fixture 的搜尋結果本來就不只一筆");
  assert.equal(digikey.parseResponse(json, "STM32F103C8T6", "USD").mpn, "STM32F103C8T6");
  // 搜尋結果裡的其他料號不會被誤認
  assert.equal(digikey.parseResponse(json, "STM32F103C8T7", "USD").found, false);
});

test("Digi-Key：查無時列出相近料號，但不會自己拿來當價格", () => {
  const json = {
    Products: [
      { ManufacturerProductNumber: "LPC1768FBD100K", ProductVariations: [] },
      { ManufacturerProductNumber: "LPC1768FBD100Y", ProductVariations: [] },
      { ManufacturerProductNumber: "LPC1768FBD100,551", ProductVariations: [] },
      { ManufacturerProductNumber: "MIKROE-4350", ProductVariations: [] },
    ],
    ExactMatches: [],
  };
  const r = digikey.parseResponse(json, "LPC1768FBD100", "USD");
  assert.equal(r.found, false, "後綴不同不算抓到 —— 可能是不同封裝或溫度等級");
  assert.deepEqual(r.suggestions, ["LPC1768FBD100K", "LPC1768FBD100Y", "LPC1768FBD100,551"], "不相干的料號不列入");
  assert.deepEqual(resultToObs(r, "2026-09-25"), [], "查無就是沒有價格");
});

test("Mouser：查無時同樣列出相近料號", () => {
  const json = { Errors: [], SearchResults: { Parts: [
    { ManufacturerPartNumber: "R7FA4M1AB3CFM#AA0" },
    { ManufacturerPartNumber: "SOMETHING-ELSE" },
  ] } };
  const r = mouser.parseResponse(json, "R7FA4M1AB3CFM", "USD");
  assert.equal(r.found, false);
  assert.deepEqual(r.suggestions, ["R7FA4M1AB3CFM#AA0"]);
});

const mouFile = "mouser-real.json";
test("Mouser：真實回應的欄位名稱正確", { skip: has(mouFile) ? false : `還沒有 fixtures/${mouFile}` }, () => {
  const dump = load(mouFile);
  const keys = Object.keys(dump).filter(k => k.startsWith("mouser:"));
  assert.ok(keys.length, "fixture 裡沒有 Mouser 的回應");
  let found = 0;
  for (const k of keys) {
    const mpn = k.slice("mouser:".length);
    const r = mouser.parseResponse(dump[k], mpn, "USD");
    if (!r.found) continue;
    found++;
    checkShape(r, mpn);
    checkObs(r);
  }
  assert.ok(found, "至少要有一顆料號解析成功");
});

test("查無的料號不會讓程式壞掉", () => {
  assert.equal(digikey.parseResponse({ Products: [], ExactMatches: [] }, "NOPE").found, false);
  assert.equal(mouser.parseResponse({ Errors: [], SearchResults: { Parts: [] } }, "NOPE").found, false);
  assert.deepEqual(resultToObs({ found: false, mpn: "NOPE" }, "2026-09-25"), []);
});

test("Mouser 回錯誤時丟出可讀的訊息", () => {
  assert.throws(() => mouser.parseResponse({ Errors: [{ Message: "Invalid unique identifier" }] }, "X"), /Invalid unique identifier/);
});

test("Mouser 的價格字串與幣別照原樣解析，不自行換算", () => {
  const json = { Errors: [], SearchResults: { Parts: [{
    ManufacturerPartNumber: "STM32F103C8T6", Manufacturer: "STMicroelectronics",
    MouserPartNumber: "511-STM32F103C8T6", Min: "1", Availability: "1,200 In Stock", LeadTime: "25 Days",
    PriceBreaks: [{ Quantity: 1, Price: "NT$121.00", Currency: "TWD" }, { Quantity: 100, Price: "NT$98.50", Currency: "TWD" }],
  }] } };
  const r = mouser.parseResponse(json, "STM32F103C8T6", "USD");
  assert.equal(r.currency, "TWD", "台灣帳號回台幣時要照記");
  assert.equal(r.packagings[0].breaks[0].unit, 121);
  assert.equal(r.stock, 1200);
  assert.equal(r.leadWeeks, 3.6);
  checkShape(r, "STM32F103C8T6");
});
