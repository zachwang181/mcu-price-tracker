"use strict";

/**
 * 極簡但正確的 CSV 解析：支援雙引號包住的欄位、欄位內的逗號與換行、""（跳脫的引號）、
 * CRLF、UTF-8 BOM，以及 # 開頭的註解列。
 * 回傳 [{ 欄名: 值 }]，第一列當表頭。
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  const clean = rows.filter(r => !(r.length === 1 && r[0].trim() === "") && !String(r[0]).trimStart().startsWith("#"));
  if (!clean.length) return [];
  const head = clean[0].map(h => h.trim());
  return clean.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}

module.exports = { parseCsv };
