"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { buildParts, buildPartsList, buildManualObs, resultToObs } = require("../lib/build");

const LIST = [
  { mpn: "STM32F103C8T6", manufacturer: "STMicroelectronics", group: "intl", note: "基準" },
  { mpn: "GD32F103C8T6", manufacturer: "GigaDevice", group: "cn", note: "替代" },
];
const RESULT = {
  found: true, source: "Digi-Key", mpn: "STM32F103C8T6", manufacturer: "STMicroelectronics",
  currency: "USD", leadWeeks: 16, stock: 4100, url: "",
  packagings: [{ name: "Tube", moq: 1, stock: 4100, breaks: [{ qty: 1, unit: 4 }, { qty: 100, unit: 3.2 }, { qty: 1000, unit: 2.8 }] }],
};
const build = (over = {}) => buildParts({
  partsListRows: LIST, manualRows: [], existingParts: [], results: [RESULT], dateTW: "2026-09-25", ...over,
});

test("料號清單決定 parts.json 有哪些料號", () => {
  const { parts } = build();
  assert.deepEqual(parts.map(p => p.id), ["STM32F103C8T6", "GD32F103C8T6"]);
  assert.equal(parts[1].group, "cn");
});

test("一顆料號一個通路，剛好記 1 / 100 / 1000 三筆", () => {
  const p = build().parts[0];
  assert.deepEqual(p.obs.map(o => o.q), [1, 100, 1000]);
  assert.deepEqual(p.obs.map(o => o.p), [4, 3.2, 2.8]);
  assert.ok(p.obs.every(o => o.cur === "USD" && o.lt === 16 && o.kind === "catalog" && o.origin === "auto"));
});

test("同一天重跑，同料號同通路的紀錄被覆蓋，不會重複", () => {
  const first = build().parts;
  const cheaper = { ...RESULT, packagings: [{ ...RESULT.packagings[0], breaks: [{ qty: 1, unit: 3.5 }, { qty: 100, unit: 3.0 }, { qty: 1000, unit: 2.5 }] }] };
  const second = buildParts({ partsListRows: LIST, manualRows: [], existingParts: first, results: [cheaper], dateTW: "2026-09-25" }).parts;
  const obs = second[0].obs;
  assert.equal(obs.length, 3, "重跑後還是 3 筆");
  assert.deepEqual(new Set(obs.map(o => o.id)).size, 3);
  assert.deepEqual(obs.map(o => o.p), [3.5, 3.0, 2.5]);
});

test("隔天抓的價格是新增，不會蓋掉前一天", () => {
  const day1 = build().parts;
  const day2 = buildParts({ partsListRows: LIST, manualRows: [], existingParts: day1, results: [RESULT], dateTW: "2026-09-26" }).parts;
  assert.equal(day2[0].obs.length, 6);
  assert.deepEqual([...new Set(day2[0].obs.map(o => o.d))], ["2026-09-25", "2026-09-26"]);
});

test("不同通路各記自己的三筆，互不覆蓋", () => {
  const mouser = { ...RESULT, source: "Mouser", currency: "TWD", leadWeeks: 3.6,
    packagings: [{ name: "511-XX", moq: 1, stock: 900, breaks: [{ qty: 1, unit: 130 }, { qty: 100, unit: 104 }, { qty: 1000, unit: 92 }] }] };
  const p = buildParts({ partsListRows: LIST, manualRows: [], existingParts: [], results: [RESULT, mouser], dateTW: "2026-09-25" }).parts[0];
  assert.equal(p.obs.length, 6);
  assert.deepEqual(p.obs.filter(o => o.src === "Mouser").map(o => o.cur), ["TWD", "TWD", "TWD"], "台幣原樣記錄，不換算");
});

test("手動報價每次從 CSV 重建：改 CSV 就改資料，刪一列就少一筆", () => {
  const manual = [{ date: "2026-09-20", mpn: "STM32F103C8T6", source: "大聯大", kind: "quote", qty: "5000", price: "2.95", currency: "USD", lead_weeks: "20", stock: "", note: "業務口頭", id: "" }];
  const withManual = buildParts({ partsListRows: LIST, manualRows: manual, existingParts: [], results: [], dateTW: "2026-09-25" }).parts[0];
  assert.equal(withManual.obs.length, 1);
  assert.equal(withManual.obs[0].p, 2.95);
  assert.equal(withManual.obs[0].origin, "manual");

  const edited = [{ ...manual[0], price: "2.80" }];
  const after = buildParts({ partsListRows: LIST, manualRows: edited, existingParts: [withManual], results: [], dateTW: "2026-09-26" }).parts[0];
  assert.equal(after.obs.length, 1, "改價格不會變成兩筆");
  assert.equal(after.obs[0].p, 2.8);

  const removed = buildParts({ partsListRows: LIST, manualRows: [], existingParts: [after], results: [], dateTW: "2026-09-27" }).parts[0];
  assert.equal(removed.obs.length, 0, "CSV 刪掉那列，資料也跟著消失");
});

test("自動抓的紀錄不會被 CSV 重建影響", () => {
  const auto = build().parts;
  const after = buildParts({ partsListRows: LIST, manualRows: [], existingParts: auto, results: [], dateTW: "2026-09-26" }).parts[0];
  assert.equal(after.obs.length, 3);
});

test("從料號清單移掉一顆，它就不再出現在 parts.json", () => {
  const before = build().parts;
  const { parts } = buildParts({ partsListRows: [LIST[1]], manualRows: [], existingParts: before, results: [], dateTW: "2026-09-26" });
  assert.deepEqual(parts.map(p => p.id), ["GD32F103C8T6"]);
});

test("查無的料號還是留在清單裡，只是沒有報價", () => {
  const p = build().parts[1];
  assert.deepEqual(p.obs, []);
});

test("單一料號的抓價結果壞掉時，其他料號照樣寫進去", () => {
  const bad = { found: false, source: "Digi-Key", mpn: "GD32F103C8T6", error: "HTTP 500" };
  const { parts } = buildParts({ partsListRows: LIST, manualRows: [], existingParts: [], results: [RESULT, bad], dateTW: "2026-09-25" });
  assert.equal(parts[0].obs.length, 3);
  assert.equal(parts[1].obs.length, 0);
});

test("清單裡壞掉的列只回報問題，不中斷", () => {
  const { parts, problems } = buildPartsList([
    { mpn: "", manufacturer: "X", group: "intl" },
    { mpn: "A1", group: "xx" },
    { mpn: "A1", group: "intl" },
  ]);
  assert.deepEqual(parts.map(p => p.id), ["A1"]);
  assert.equal(parts[0].group, "intl");
  assert.equal(problems.length, 3);
});

test("手動報價缺欄位或日期格式錯的列會被擋掉並回報", () => {
  const { entries, problems } = buildManualObs([
    { date: "2026-09-20", mpn: "A1", qty: "10", price: "1" },
    { date: "2026/09/20", mpn: "A1", qty: "10", price: "1" },
    { date: "2026-09-20", mpn: "", qty: "10", price: "1" },
    { date: "2026-09-20", mpn: "A1", qty: "10", price: "洽詢" },
  ], new Set(["A1"]));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].obs.kind, "quote", "kind 沒填時預設代理商報價");
  assert.equal(problems.length, 3);
});

test("手動報價的料號不在清單裡時會提醒", () => {
  const { problems } = buildManualObs([{ date: "2026-09-20", mpn: "ZZZ", qty: "1", price: "1" }], new Set(["A1"]));
  assert.match(problems.join(""), /不在 parts_list\.csv/);
});

test("resultToObs 把包裝與級距寫進備註，方便日後對帳", () => {
  const obs = resultToObs(RESULT, "2026-09-25");
  assert.match(obs[2].note, /包裝 Tube/);
  assert.match(obs[2].note, /級距 1000\+/);
  assert.equal(obs[2].id, "auto-digi-key-2026-09-25-1000");
  assert.deepEqual(resultToObs({ found: false }, "2026-09-25"), []);
});
