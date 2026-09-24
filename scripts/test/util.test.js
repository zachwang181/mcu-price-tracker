"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { todayTW, normMpn, partId, slug, leadToWeeks, parseMoney, parseCount } = require("../lib/util");

test("todayTW 用台北時間，UTC 16:00 之後就算隔天", () => {
  assert.equal(todayTW(Date.parse("2026-09-24T15:59:00Z")), "2026-09-24");
  assert.equal(todayTW(Date.parse("2026-09-24T16:00:00Z")), "2026-09-25");
});

test("normMpn 去空白轉大寫，partId 把特殊字元換成底線", () => {
  assert.equal(normMpn(" stm32f103 c8t6 "), "STM32F103C8T6");
  assert.equal(partId("stm32f103c8t6"), "STM32F103C8T6");
  assert.equal(partId("ATMEGA328P-AU"), "ATMEGA328P-AU");
  assert.equal(partId("A/B#C"), "A_B_C");
});

test("slug 給 obs id 用，不會留下奇怪字元", () => {
  assert.equal(slug("Digi-Key"), "digi-key");
  assert.equal(slug("WPG 大聯大"), "wpg");
});

test("leadToWeeks：天換算成週，週原樣留下", () => {
  assert.equal(leadToWeeks("25 Days"), 3.6);
  assert.equal(leadToWeeks("12 Weeks"), 12);
  assert.equal(leadToWeeks("16"), 16);
  assert.equal(leadToWeeks(31), 31);
  assert.equal(leadToWeeks(""), null);
  assert.equal(leadToWeeks(null), null);
  assert.equal(leadToWeeks("洽詢"), null);
});

test("parseMoney 處理各種幣別寫法，含歐式千分位", () => {
  assert.equal(parseMoney("$1.2345"), 1.2345);
  assert.equal(parseMoney("1,234.56"), 1234.56);
  assert.equal(parseMoney("1.234,56 €"), 1234.56);
  assert.equal(parseMoney("NT$ 48.5"), 48.5);
  assert.equal(parseMoney(2.5), 2.5);
  assert.equal(parseMoney("洽詢"), null);
  assert.equal(parseMoney(""), null);
});

test("parseCount 抓數量", () => {
  assert.equal(parseCount("4,100 In Stock"), 4100);
  assert.equal(parseCount(" 500 "), 500);
  assert.equal(parseCount("None"), null);
});
