"use strict";

/** 固定記錄這三個買量的單價。 */
const BUY_QTYS = [1, 100, 1000];

/**
 * 從一顆料號在某通路的所有包裝中，挑出買 buyQty 顆時的單價。
 *
 * 規則（對應需求）：
 *  1. 某包裝的最小訂購量（MOQ）大於 buyQty → 這個包裝不列入。
 *  2. 單價取「數量 ≤ buyQty 的最大級距」；沒有任何級距 ≤ buyQty 的包裝不列入。
 *  3. 還有多個包裝可選時，取單價最低的那個（實際採購會這樣買），並記下是哪個包裝。
 *
 * packagings: [{ name, moq, stock, breaks: [{ qty, unit }] }]
 * 回傳 { unit, qtyBreak, packaging, moq, stock } 或 null。
 */
function pickUnitPrice(packagings, buyQty) {
  let best = null;
  for (const pk of packagings || []) {
    const moq = Number.isFinite(pk.moq) && pk.moq > 0 ? pk.moq : 1;
    if (moq > buyQty) continue;

    let tier = null;
    for (const b of pk.breaks || []) {
      const qty = Number(b.qty), unit = Number(b.unit);
      if (!Number.isFinite(qty) || !Number.isFinite(unit) || unit <= 0) continue;
      if (qty > buyQty) continue;
      if (!tier || qty > tier.qty) tier = { qty, unit };
    }
    if (!tier) continue;

    const cand = { unit: tier.unit, qtyBreak: tier.qty, packaging: pk.name || "", moq, stock: pk.stock ?? null };
    if (!best || cand.unit < best.unit) best = cand;
  }
  return best;
}

/** 對 BUY_QTYS 各跑一次，回傳 [{ buyQty, ...pick }]，挑不到的買量直接略過。 */
function pickAll(packagings) {
  const out = [];
  for (const q of BUY_QTYS) {
    const p = pickUnitPrice(packagings, q);
    if (p) out.push({ buyQty: q, ...p });
  }
  return out;
}

module.exports = { BUY_QTYS, pickUnitPrice, pickAll };
