"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { toSpec, pickBest, memSize, digikeyCategoryPath } = require("../lib/spec");
const digikey = require("../lib/digikey");

const DIR = path.join(__dirname, "fixtures");
const load = n => JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8"));

test("記憶體大小的各種寫法", () => {
  assert.equal(memSize("64KB (64K x 8)"), "64KB");
  assert.equal(memSize("20K x 8"), "20KB");
  assert.equal(memSize("1K x 8"), "1KB");
  assert.equal(memSize("-"), null, "Digi-Key 用 - 表示沒有");
  assert.equal(memSize(""), null);
  assert.equal(memSize("2MB (2M x 8)"), "2MB");
});

test("分類路徑沿著巢狀的 Category 走到底", () => {
  assert.deepEqual(digikeyCategoryPath({
    Name: "Integrated Circuits (ICs)",
    ChildCategories: [{ Name: "Embedded", ChildCategories: [{ Name: "Microcontrollers", ChildCategories: [] }] }],
  }), ["Integrated Circuits (ICs)", "Embedded", "Microcontrollers"]);
  assert.deepEqual(digikeyCategoryPath(null), []);
});

test("從真實的 Digi-Key 回應抽出規格", () => {
  const dump = load("digikey-real.json");
  const r = digikey.parseResponse(dump["digikey:STM32F103C8T6"], "STM32F103C8T6", "USD");
  const s = r.spec;
  assert.equal(s.category, "Microcontrollers");
  assert.deepEqual(s.categoryPath, ["Integrated Circuits (ICs)", "Embedded", "Microcontrollers"]);
  assert.equal(s.core, "ARM Cortex-M3", "® 這些符號要去掉");
  assert.equal(s.bits, "32-Bit");
  assert.equal(s.speed, "72MHz");
  assert.equal(s.flash, "64KB");
  assert.equal(s.ram, "20KB");
  assert.equal(s.io, 37);
  assert.equal(s.package, "48-LQFP");
  assert.equal(s.src, "Digi-Key");
  assert.ok(!("eeprom" in s), "值是 - 的欄位不要寫進 JSON");
});

test("Mouser 只給得出分類和描述", () => {
  const mouser = require("../lib/mouser");
  const r = mouser.parseResponse(load("mouser-real.json")["mouser:STM32F103C8T6"], "STM32F103C8T6", "USD");
  assert.equal(r.spec.category, "ARM微控制器 - MCU", "台灣帳號回的是中文分類");
  assert.equal(r.spec.src, "Mouser");
  assert.ok(!r.spec.core, "Mouser 的 ProductAttributes 只有包裝資訊，抽不出核心");
});

test("同一顆料號抓到多個來源的規格時，挑欄位最完整的", () => {
  const dk = { category: "Microcontrollers", core: "ARM Cortex-M3", flash: "64KB", src: "Digi-Key" };
  const mo = { category: "ARM微控制器 - MCU", src: "Mouser" };
  assert.equal(pickBest([mo, dk]).src, "Digi-Key");
  assert.equal(pickBest([mo]).src, "Mouser", "只有一個來源時就用它");
  assert.equal(pickBest([]), null);
  assert.equal(pickBest([null, undefined]), null);
});

test("欄位數一樣時，照 Digi-Key > LCSC > Mouser 的順序", () => {
  const a = { category: "x", src: "Mouser" };
  const b = { category: "y", src: "LCSC" };
  assert.equal(pickBest([a, b]).src, "LCSC");
});
