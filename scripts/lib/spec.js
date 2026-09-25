"use strict";
/**
 * 從通路回應裡抽出「這顆料是什麼」——分類、核心、記憶體、封裝這些規格。
 * 資料來源優先序：Digi-Key（參數最完整）→ LCSC → Mouser（只有分類）。
 * 全部是 API 實際回傳的欄位，不做任何推測。
 */
const { parseCount } = require("./util");

/** 去掉 ®、™ 這些符號和多餘空白。 */
const clean = s => String(s ?? "").replace(/[®™©]/g, "").replace(/\s+/g, " ").trim();

/** Digi-Key 的記憶體寫法："64KB (64K x 8)" → "64KB"；"20K x 8" → "20KB"；"-" → null。 */
function memSize(v) {
  const s = clean(v);
  if (!s || s === "-") return null;
  const paren = s.match(/^([\d.]+\s*[KMG]?B)\b/i);
  if (paren) return paren[1].replace(/\s+/g, "").toUpperCase();
  const times = s.match(/^([\d.]+)\s*([KMG])?\s*x\s*8$/i);
  if (times) return `${times[1]}${(times[2] || "").toUpperCase()}B`;
  return s;
}

/** 空字串、"-"、null 一律當作沒有。 */
const val = v => {
  const s = clean(v);
  return s && s !== "-" ? s : null;
};

/** 把有值的欄位留下來，沒值的不要寫進 JSON，免得檔案一堆 null。 */
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

/** Digi-Key 的 Category 是一層層往下包的樹，沿著第一個子分類走到底就是完整路徑。 */
function digikeyCategoryPath(cat) {
  const path = [];
  let node = cat;
  while (node && node.Name) {
    path.push(clean(node.Name));
    node = (node.ChildCategories || [])[0];
  }
  return path;
}

function fromDigikey(product) {
  if (!product) return null;
  const m = new Map();
  for (const p of product.Parameters || []) {
    const k = clean(p.ParameterText || p.Parameter);
    if (k) m.set(k, p.ValueText ?? p.Value);
  }
  const path = digikeyCategoryPath(product.Category);
  return compact({
    categoryPath: path,
    category: path[path.length - 1] || null,
    core: val(m.get("Core Processor")),
    bits: val(m.get("Core Size")),
    speed: val(m.get("Speed")),
    flash: memSize(m.get("Program Memory Size")),
    flashType: val(m.get("Program Memory Type")),
    ram: memSize(m.get("RAM Size")),
    eeprom: memSize(m.get("EEPROM Size")),
    io: parseCount(m.get("Number of I/O")),
    package: val(m.get("Package / Case")),
    mount: val(m.get("Mounting Type")),
    voltage: val(m.get("Voltage - Supply (Vcc/Vdd)")),
    temp: val(m.get("Operating Temperature")),
    connectivity: val(m.get("Connectivity")),
    peripherals: val(m.get("Peripherals")),
    adc: val(m.get("Data Converters")),
    desc: val(product.Description && (product.Description.ProductDescription || product.Description.DetailedDescription)),
    datasheet: val(product.DatasheetUrl),
    src: "Digi-Key",
  });
}

function fromMouser(part) {
  if (!part) return null;
  // Mouser 的 ProductAttributes 只有包裝資訊，規格得靠分類字串和描述。
  return compact({
    category: val(part.Category),
    categoryPath: val(part.Category) ? [clean(part.Category)] : [],
    desc: val(part.Description),
    datasheet: val(part.DataSheetUrl),
    src: "Mouser",
  });
}

function fromLcsc(product) {
  if (!product) return null;
  const c = product.category || {};
  const path = [c.firstCatalogName, c.secondCatalogName, c.thirdCatalogName].map(clean).filter(Boolean);
  return compact({
    categoryPath: path,
    category: path[path.length - 1] || null,
    package: val(product.package),
    desc: val(product.description),
    datasheet: val(product.datasheetURL),
    src: "LCSC",
  });
}

/** 欄位多的贏。同分時照 RANK 的順序。 */
const RANK = { "Digi-Key": 3, LCSC: 2, Mouser: 1 };
function pickBest(specs) {
  let best = null;
  for (const s of specs) {
    if (!s) continue;
    if (!best) { best = s; continue; }
    const a = Object.keys(s).length, b = Object.keys(best).length;
    if (a > b || (a === b && (RANK[s.src] || 0) > (RANK[best.src] || 0))) best = s;
  }
  return best;
}

const toSpec = { fromDigikey, fromMouser, fromLcsc };
module.exports = { toSpec, pickBest, memSize, digikeyCategoryPath, clean, compact };
