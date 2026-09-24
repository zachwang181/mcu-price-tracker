"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { pickUnitPrice, pickAll, BUY_QTYS } = require("../lib/breaks");

const tube = { name: "Tube", moq: 1, stock: 500, breaks: [{ qty: 1, unit: 4.0 }, { qty: 10, unit: 3.6 }, { qty: 100, unit: 3.2 }] };
const cutTape = { name: "Cut Tape", moq: 1, stock: 900, breaks: [{ qty: 1, unit: 4.2 }, { qty: 100, unit: 3.1 }, { qty: 1000, unit: 2.7 }] };
const reel = { name: "Tape & Reel", moq: 4000, stock: 8000, breaks: [{ qty: 4000, unit: 2.1 }] };

test("買量比包裝最小訂購量小時，那個包裝不列入", () => {
  assert.equal(pickUnitPrice([reel], 1000), null);
  assert.equal(pickUnitPrice([reel], 4000).unit, 2.1);
});

test("單價取數量 ≤ 買量的最大級距", () => {
  const p = pickUnitPrice([tube], 50);
  assert.equal(p.qtyBreak, 10);
  assert.equal(p.unit, 3.6);
});

test("級距全部大於買量時，這個包裝挑不出價格", () => {
  assert.equal(pickUnitPrice([{ name: "X", moq: 1, breaks: [{ qty: 500, unit: 1 }] }], 100), null);
});

test("多個包裝可選時取單價最低的，並記下是哪個包裝", () => {
  const p1 = pickUnitPrice([tube, cutTape], 1);
  assert.equal(p1.unit, 4.0);
  assert.equal(p1.packaging, "Tube");
  const p1000 = pickUnitPrice([tube, cutTape], 1000);
  assert.equal(p1000.unit, 2.7);
  assert.equal(p1000.packaging, "Cut Tape");
  assert.equal(p1000.qtyBreak, 1000);
});

test("pickAll 只回傳 1 / 100 / 1000 三個買量", () => {
  assert.deepEqual(BUY_QTYS, [1, 100, 1000]);
  const all = pickAll([tube, cutTape, reel]);
  assert.deepEqual(all.map(x => x.buyQty), [1, 100, 1000]);
  assert.deepEqual(all.map(x => x.unit), [4.0, 3.1, 2.7]);
});

test("沒有任何包裝時回傳空陣列，不會爆", () => {
  assert.deepEqual(pickAll([]), []);
  assert.deepEqual(pickAll(undefined), []);
  assert.equal(pickUnitPrice(null, 100), null);
});

test("MOQ 缺漏或為 0 時當作 1", () => {
  assert.equal(pickUnitPrice([{ name: "A", breaks: [{ qty: 1, unit: 5 }] }], 1).unit, 5);
  assert.equal(pickUnitPrice([{ name: "A", moq: 0, breaks: [{ qty: 1, unit: 5 }] }], 1).unit, 5);
});

test("壞掉的級距（非數字、零元）被忽略", () => {
  const p = pickUnitPrice([{ name: "A", moq: 1, breaks: [{ qty: 1, unit: 0 }, { qty: "x", unit: 2 }, { qty: 10, unit: 1.5 }] }], 100);
  assert.equal(p.unit, 1.5);
  assert.equal(p.qtyBreak, 10);
});
