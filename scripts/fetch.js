#!/usr/bin/env node
"use strict";
/**
 * 抓價主程式。GitHub Actions 每天跑一次，也可以在本機跑：
 *   node scripts/fetch.js                 # 有設 key 的資料源全部跑
 *   node scripts/fetch.js --only=mouser   # 只跑一家
 *   node scripts/fetch.js --dry           # 只印結果，不寫檔
 *   node scripts/fetch.js --limit=2       # 只抓前兩顆料號（試接 API 時用）
 *   node scripts/fetch.js --mpns=A,B      # 只抓指定料號，查「為什麼查無」時用
 *   node scripts/fetch.js --dump=out.json # 另外存一份原始回應，驗欄位名稱用
 * API key 一律從環境變數讀，不會寫進任何輸出檔。
 */
const fs = require("fs");
const path = require("path");
const { parseCsv } = require("./lib/csv");
const { buildParts } = require("./lib/build");
const { todayTW } = require("./lib/util");
const digikey = require("./lib/digikey");
const mouser = require("./lib/mouser");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const SOURCES = [
  { key: "digikey", mod: digikey, missing: "沒有設定 DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET" },
  { key: "mouser", mod: mouser, missing: "沒有設定 MOUSER_API_KEY" },
];

function arg(name, dflt) {
  const hit = process.argv.slice(2).find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
}
const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; } };
const readCsv = p => { try { return parseCsv(fs.readFileSync(p, "utf8")); } catch { return []; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); };

async function main() {
  const dry = Boolean(arg("dry", false));
  const only = arg("only", "");
  const limit = parseInt(arg("limit", "0"), 10) || 0;
  const dump = arg("dump", "");
  // --no-fetch：不呼叫任何 API，只用現有資料和 CSV 重建 parts.json。
  // 在 GitHub 上改完 CSV 時用這個，馬上就能看到結果，也不會浪費 API 額度。
  const noFetch = Boolean(arg("no-fetch", false));
  const dateTW = String(arg("date", "")) !== "" && arg("date") !== true ? String(arg("date")) : todayTW();

  const partsListRows = readCsv(path.join(DATA, "parts_list.csv"));
  const manualRows = readCsv(path.join(DATA, "manual_quotes.csv"));
  const existingParts = readJson(path.join(DATA, "parts.json"), []);
  let mpns = partsListRows.map(r => (r.mpn || "").trim()).filter(Boolean);
  // --mpns=A,B 只抓指定的幾顆，查「為什麼這顆查無」時很好用。
  const only_mpns = String(arg("mpns", "") === true ? "" : arg("mpns", "")).split(",").map(s => s.trim()).filter(Boolean);
  if (only_mpns.length) mpns = only_mpns;
  else if (limit) mpns = mpns.slice(0, limit);
  console.log(`日期 ${dateTW}・料號 ${mpns.length} 顆`);

  const results = [], report = [], rawDump = {};
  for (const s of SOURCES) {
    if (only && only !== s.key) continue;
    const name = s.mod.SOURCE;
    if (noFetch) {
      const reason = "這次只重建資料，沒有呼叫 API";
      console.log(`- ${name}：略過（${reason}）`);
      report.push({ name, key: s.key, status: "skipped", configured: s.mod.configured(process.env), reason });
      continue;
    }
    if (!s.mod.configured(process.env)) {
      console.log(`- ${name}：略過（${s.missing}）`);
      report.push({ name, key: s.key, status: "skipped", configured: false, reason: s.missing });
      continue;
    }
    let list;
    try {
      list = await s.mod.fetchAll(mpns, process.env);
    } catch (err) {
      const msg = String(err.message || err);
      console.log(`- ${name}：整批失敗 — ${msg}`);
      report.push({ name, key: s.key, status: "failed", configured: true, found: 0, notFound: 0, failed: mpns.length, errors: [{ mpn: "(全部)", message: msg }] });
      continue;
    }
    const found = list.filter(r => r.found);
    const errors = list.filter(r => r.error).map(r => ({ mpn: r.mpn, message: r.error }));
    const notFound = list.filter(r => !r.found && !r.error).map(r => r.mpn);
    results.push(...found);
    if (dump) for (const r of list) rawDump[`${s.key}:${r.mpn}`] = r.rawResponse ?? { error: r.error };
    const status = errors.length === list.length ? "failed" : errors.length ? "partial" : "ok";
    report.push({
      name, key: s.key, status, configured: true,
      found: found.length, notFound: notFound.length, failed: errors.length,
      notFoundMpns: notFound, errors,
    });
    console.log(`- ${name}：抓到 ${found.length}、查無 ${notFound.length}、失敗 ${errors.length}`);
    for (const e of errors) console.log(`    ! ${e.mpn}：${e.message}`);
  }

  const built = buildParts({ partsListRows, manualRows, existingParts, results, dateTW });
  for (const p of built.problems) console.log(`  · ${p}`);

  const prevRun = readJson(path.join(DATA, "last_run.json"), null);
  const lastRun = noFetch && prevRun ? {
    // 只重建資料時，畫面上的「最近一次抓價」要留著上一次真正抓價的結果。
    ...prevRun,
    rebuiltAt: new Date().toISOString(),
    parts: 0, newObs: 0, problems: [],
  } : {
    ranAt: new Date().toISOString(),
    dateTW,
    sources: report,
    parts: built.parts.length,
    newObs: built.addedObs,
    problems: built.problems,
    ok: report.some(r => r.status === "ok" || r.status === "partial") || report.every(r => r.status === "skipped"),
  };
  lastRun.parts = built.parts.length;
  lastRun.newObs = built.addedObs;
  lastRun.problems = built.problems;

  if (dump) { writeJson(path.resolve(String(dump)), rawDump); console.log(`原始回應寫到 ${dump}`); }
  if (dry) {
    console.log(JSON.stringify(lastRun, null, 2));
    console.log("（--dry：沒有寫檔）");
  } else {
    writeJson(path.join(DATA, "parts.json"), built.parts);
    writeJson(path.join(DATA, "last_run.json"), lastRun);
    // 原始價格級距完整保存，方便日後重算
    if (results.length) {
      writeJson(path.join(DATA, "raw", `${dateTW}.json`), results.map(r => ({
        source: r.source, mpn: r.mpn, manufacturer: r.manufacturer, currency: r.currency,
        leadWeeks: r.leadWeeks, stock: r.stock, url: r.url, packagings: r.packagings,
      })));
    }
    console.log(`寫出 data/parts.json（${built.parts.length} 顆、共 ${built.parts.reduce((a, p) => a + p.obs.length, 0)} 筆報價）`);
  }

  // 設了 key 卻全部失敗 → 讓 Actions 顯示失敗（檔案還是已經寫好了）
  const live = report.filter(r => r.configured);
  if (live.length && live.every(r => r.status === "failed")) {
    console.error("所有已設定的資料源都失敗了。");
    process.exitCode = 1;
  }
}

main().catch(err => { console.error(err); process.exit(1); });
