"use strict";
const { normMpn, partId, slug, parseCount, parseMoney } = require("./util");
const { pickAll } = require("./breaks");
const { pickBest } = require("./spec");

const GROUPS = new Set(["intl", "cn", "tw"]);
const KINDS = new Set(["catalog", "quote", "po"]);

/** data/parts_list.csv → [{ id, mpn, manufacturer, group, note, use }]，順便回報壞掉的列。 */
function buildPartsList(rows) {
  const parts = [], problems = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    const line = i + 2;   // +1 表頭 +1 從 1 起算
    const mpn = normMpn(r.mpn);
    if (!mpn) { problems.push(`parts_list.csv 第 ${line} 列沒有填 mpn，已略過`); return; }
    const id = partId(mpn);
    if (seen.has(id)) { problems.push(`parts_list.csv 第 ${line} 列的料號 ${mpn} 重複，已略過`); return; }
    seen.add(id);
    let group = (r.group || "intl").trim();
    if (!GROUPS.has(group)) { problems.push(`parts_list.csv 第 ${line} 列的 group「${group}」不認得，當成 intl`); group = "intl"; }
    parts.push({
      id, mpn, manufacturer: (r.manufacturer || "").trim(), group,
      note: (r.note || "").trim(),
      use: (r.use || "").trim(),        // 用途，人工維護，API 不提供這種資訊
    });
  });
  return { parts, problems };
}

/** data/manual_quotes.csv → [{ partId, obs }]。無法用的列會回報，不會讓整批中斷。 */
function buildManualObs(rows, knownIds) {
  const entries = [], problems = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const mpn = normMpn(r.mpn);
    const d = (r.date || "").trim();
    const q = parseCount(r.qty);
    const p = parseMoney(r.price);
    if (!mpn || !d || q == null || p == null) {
      problems.push(`manual_quotes.csv 第 ${line} 列缺少 date / mpn / qty / price，已略過`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { problems.push(`manual_quotes.csv 第 ${line} 列的日期「${d}」不是 YYYY-MM-DD，已略過`); return; }
    const id = partId(mpn);
    if (knownIds && !knownIds.has(id)) problems.push(`manual_quotes.csv 第 ${line} 列的料號 ${mpn} 不在 parts_list.csv 裡，仍會記錄但網頁上看不到`);
    const kind = KINDS.has((r.kind || "").trim()) ? r.kind.trim() : "quote";
    const src = (r.source || "").trim() || "未填";
    entries.push({
      partId: id,
      obs: {
        id: (r.id || "").trim() || `m-${slug(src)}-${d}-${q}`,
        d, src, kind, q, p,
        cur: (r.currency || "USD").trim().toUpperCase() || "USD",
        lt: r.lead_weeks === "" || r.lead_weeks == null ? null : Number(r.lead_weeks),
        st: r.stock === "" || r.stock == null ? null : parseCount(r.stock),
        note: (r.note || "").trim(),
        origin: "manual",
      },
    });
  });
  return { entries, problems };
}

/** 一個資料源對一顆料號的抓價結果 → 1/100/1000 三筆 obs。 */
function resultToObs(result, dateTW) {
  if (!result || !result.found) return [];
  return pickAll(result.packagings).map(pick => ({
    id: `auto-${slug(result.source)}-${dateTW}-${pick.buyQty}`,
    d: dateTW,
    src: result.source,
    kind: "catalog",
    q: pick.buyQty,
    p: pick.unit,
    cur: result.currency || "USD",
    lt: result.leadWeeks ?? null,
    st: pick.stock ?? result.stock ?? null,
    note: [pick.packaging && `包裝 ${pick.packaging}`, `級距 ${pick.qtyBreak}+`, "自動抓取"].filter(Boolean).join("・"),
    origin: "auto",
  }));
}

/**
 * 組出新的 parts.json。
 *  - 料號清單以 parts_list.csv 為準（清單裡拿掉的料號就不再出現）。
 *  - origin=auto 的舊紀錄全部保留；同一天、同通路、同買量的會被這次的結果覆蓋（靠 obs.id 相同）。
 *  - origin=manual 的每次都從 manual_quotes.csv 重建，所以改 CSV 就等於改資料。
 */
function buildParts({ partsListRows, manualRows, existingParts, results, dateTW }) {
  const { parts, problems: listProblems } = buildPartsList(partsListRows);
  const byId = new Map(parts.map(p => [p.id, { ...p, obs: [] }]));
  const problems = [...listProblems];

  // 1. 沿用舊的自動抓價紀錄
  for (const old of existingParts || []) {
    const cur = byId.get(old.id);
    if (!cur) continue;
    for (const o of old.obs || []) if (o.origin === "auto") cur.obs.push(o);
  }

  // 2. 手動報價整批重建
  const manual = buildManualObs(manualRows, new Set(byId.keys()));
  problems.push(...manual.problems);
  for (const e of manual.entries) {
    const cur = byId.get(e.partId);
    if (cur) cur.obs.push(e.obs);
  }

  // 3. 這次抓到的價格（同 id 覆蓋）
  let added = 0;
  const specsByPart = new Map();
  for (const r of results || []) {
    const id = partId(r.mpn);
    const cur = byId.get(id);
    if (!cur) continue;
    if (r.spec) {
      if (!specsByPart.has(id)) specsByPart.set(id, []);
      specsByPart.get(id).push({ ...r.spec, d: dateTW });
    }
    for (const obs of resultToObs(r, dateTW)) {
      const at = cur.obs.findIndex(o => o.id === obs.id);
      if (at >= 0) cur.obs[at] = obs; else cur.obs.push(obs);
      added++;
    }
  }

  // 4. 規格：這次抓到就用這次的（挑欄位最完整的來源），沒抓到就沿用上次的
  const oldSpecs = new Map((existingParts || []).map(p => [p.id, p.spec]));
  const oldLinks = new Map((existingParts || []).map(p => [p.id, p.links]));
  for (const [id, part] of byId) {
    const fresh = pickBest(specsByPart.get(id) || []);
    const spec = fresh || oldSpecs.get(id);
    if (spec) part.spec = spec;

    // 各通路的產品頁連結，舊的留著、這次抓到的覆蓋掉
    const links = { ...(oldLinks.get(id) || {}) };
    for (const r of results || []) {
      if (partId(r.mpn) === id && r.found && r.url) links[r.source] = r.url;
    }
    if (Object.keys(links).length) part.links = links;
  }

  const out = [...byId.values()].map(p => ({
    ...p,
    obs: p.obs.sort((a, b) => (a.d || "").localeCompare(b.d || "") || a.src.localeCompare(b.src) || a.q - b.q),
  }));
  return { parts: out, problems, addedObs: added };
}

module.exports = { buildPartsList, buildManualObs, resultToObs, buildParts, GROUPS, KINDS };
