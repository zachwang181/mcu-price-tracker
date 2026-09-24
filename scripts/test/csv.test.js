"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { parseCsv } = require("../lib/csv");

test("基本表頭 + 資料列", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [{ a: "1", b: "2" }]);
});

test("雙引號包住的欄位可以有逗號、換行和跳脫的引號", () => {
  const rows = parseCsv('mpn,note\nX,"含逗號, 還有\n換行"\nY,"他說 ""漲價"" 了"\n');
  assert.equal(rows[0].note, "含逗號, 還有\n換行");
  assert.equal(rows[1].note, '他說 "漲價" 了');
});

test("吃掉 BOM、CRLF、空白列和 # 註解列", () => {
  const rows = parseCsv('﻿a,b\r\n# 這是說明，會被忽略\r\n1,2\r\n\r\n3,4');
  assert.deepEqual(rows, [{ a: "1", b: "2" }, { a: "3", b: "4" }]);
});

test("欄位少的列，缺的欄位補空字串", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2"), [{ a: "1", b: "2", c: "" }]);
});

test("空檔案回傳空陣列", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("a,b\n"), []);
});
