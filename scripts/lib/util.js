"use strict";

/** 台灣時間的今天（YYYY-MM-DD）。抓價一律用台北日期當紀錄日。 */
function todayTW(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

/** 料號正規化：去空白、轉大寫。跟網頁原型的 normMpn 一致。 */
function normMpn(s) {
  return String(s || "").replace(/\s+/g, "").toUpperCase();
}

/** parts.json 裡的 key，跟網頁原型的 partId 一致。 */
function partId(mpn) {
  return normMpn(mpn).replace(/[^A-Za-z0-9_\-~:@+.]/g, "_").replace(/^\.+$/, "_");
}

/** 通路名稱轉成能放進 obs id 的短代號。 */
function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 交期字串轉週數。Mouser 回 "25 Days"、"12 Weeks"；Digi-Key 直接給週。 */
function leadToWeeks(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const m = s.match(/([\d.]+)\s*(day|days|week|weeks|天|日|週|周)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || "").toLowerCase();
  if (unit === "day" || unit === "days" || unit === "天" || unit === "日") return Math.round((n / 7) * 10) / 10;
  return n;
}

/** "$1.2345"、"1,234.5 NT$"、"€0,5" → 數字。抓不到回 null。 */
function parseMoney(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,-]/g, "").trim();
  if (!s) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");   // 歐式 1.234,56
  else s = s.replace(/,/g, "");                                          // 英式 1,234.56
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** "1,234"、" 500 " → 整數。抓不到回 null。 */
function parseCount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** 讀環境變數並去掉前後空白 —— 貼進 GitHub Secrets 時很容易夾帶到換行。 */
function env(source, name) {
  const v = source[name];
  return typeof v === "string" ? v.trim() : v;
}

module.exports = { todayTW, normMpn, partId, slug, sleep, leadToWeeks, parseMoney, parseCount, env };
