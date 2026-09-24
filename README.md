# MCU 料號行情

**網址：<https://zachwang181.github.io/mcu-price-tracker/>**

每天台灣時間早上 9 點，程式會自己去 Digi-Key 和 Mouser 抓一次這些料號的目錄價，存進這個 repo，網頁就會跟著更新。你不用開終端機，所有事情都在 GitHub 網頁上做。

---

## 我要做的四件事

### 1. 加一顆料號 / 不追某顆料號了

1. 打開 **[data/parts_list.csv](../../edit/main/data/parts_list.csv)**（這個連結會直接進編輯模式）。
2. 在最後面加一列，用半形逗號隔開四個欄位：

   ```
   STM32G431CBT6,STMicroelectronics,intl,Cortex-M4
   ```

   | 欄位 | 填什麼 |
   | --- | --- |
   | 料號 | 完整的原廠料號，含封裝後綴。錯一個字就會查無。 |
   | 製造商 | 要跟調價事件裡的原廠寫法一致，網頁才會把調價日畫在走勢圖上。 |
   | 分組 | `intl`＝國際大廠、`cn`＝中國品牌、`tw`＝台灣品牌。只能填這三個。 |
   | 備註 | 隨便寫，會顯示在料號卡片上。 |

3. 不追蹤某顆料號，就把**那一整列刪掉**。
4. 右上角綠色的 **Commit changes…** → 再按一次 **Commit changes**。
5. 約一分鐘後網頁就會更新。新加的料號要等下一次抓價（或你自己按一次 Run workflow）才會有價格。

### 2. 記一筆代理商報價或成交價

1. 打開 **[data/manual_quotes.csv](../../edit/main/data/manual_quotes.csv)**（網頁上「記一筆報價」按鈕也是連到這裡）。
2. 在最後面加一列。**日期一定要寫成 `2026-09-30` 這種格式**：

   ```
   2026-09-30,STM32F103C8T6,大聯大,quote,5000,2.95,USD,20,,王經理 9/30 email 報價,
   ```

   依序是：日期、料號、誰報的價、類型、買量、單價、幣別、交期（週）、庫存、備註、id。
   - **類型**：`quote`＝代理商報價、`po`＝實際成交、`catalog`＝通路目錄價。
   - **幣別**：對方報什麼就填什麼（`USD`／`TWD`／`CNY`／`EUR`／`JPY`），**不要自己換算成美金**。網頁會分開畫。
   - 不知道的欄位留空就好（兩個逗號中間什麼都不打），最後的 `id` 永遠留空。
   - 備註裡要寫半形逗號的話，整欄用雙引號包起來：`"含稅, 不含運"`。
3. Commit 之後約一分鐘，網頁上就看得到。
4. **寫錯了就回去改那一列，或把那一列刪掉**，網頁會跟著改。自動抓到的價格不受影響。

完整欄位說明在 [data/README.md](data/README.md)。

### 3. 記一則原廠調價

打開 **[data/notices.json](../../edit/main/data/notices.json)**，複製最後一筆 `{ ... }` 貼到它後面，改成新的內容，**記得兩筆之間要有逗號**：

```json
{ "id": "st-1101", "vendor": "STMicroelectronics", "announced": "2026-10-05", "effective": "2026-11-01", "range": "5–10%", "scope": "通用 MCU", "source": "TrendForce 10/6" }
```

- `vendor` 要跟料號清單裡的製造商寫法一模一樣，網頁才會把這條紅色虛線畫在那顆料號的走勢圖上。
- `effective`（生效日）必填，其他不知道就留 `""`。
- `id` 自己取個沒用過的短代號就好。

### 4. 馬上抓一次價（不等明天早上）

1. 進 **[Actions 頁](../../actions/workflows/update.yml)**。
2. 右邊 **Run workflow** → 綠色 **Run workflow**。
3. 等兩分鐘左右。跑完重新整理網頁就看得到今天的價格。

---

## 出問題的時候

網頁最上面有一條**「最近一次抓價」**，會寫清楚每家通路抓到幾顆、查無幾顆、失敗幾顆。

- **那條變成紅色**：表示有東西壞了，上面會直接寫原因，旁邊有「去 Actions 看完整記錄」的連結。
- **Actions 頁出現紅色叉叉**：點進那次執行 → 點 **build** → 點 **抓價** 那一步，錯誤訊息就在裡面。最常見的是：
  - `OAuth 401`／`Invalid API key`：key 過期或被改掉了，重新申請一次再更新 Secret。
  - `HTTP 429`：當天呼叫次數用完了，隔天會自己恢復。
  - `某顆料號 HTTP 500`：那家通路暫時出問題，只有那顆料號會少一筆，其他照常。
- **某顆料號卡片上寫「查無」**：那家通路沒賣這顆、或料號打錯了。國產料（GD32、WCH 這些）在 Digi-Key 和 Mouser 本來就多半查不到，屬正常。

---

## 這些資料怎麼來的

- **通路目錄價**：程式每天自動抓，一顆料號每家通路固定記 **買 1 顆、100 顆、1000 顆** 三個單價。某個包裝的最小訂購量大於那個買量時就不列入；單價取「數量 ≤ 買量的最大級距」；還有多個包裝可選時取最便宜的。完整的原始價格級距另外存在 `data/raw/` 裡。
- **代理商報價、成交價**：你手動記的。
- **調價事件**：整理自公開報導，每則附出處。
- 資料只會累積，不刪舊紀錄。同一天重跑兩次不會產生重複的資料。

## API key 放哪裡

放在 repo 的 **Settings → Secrets and variables → Actions**，不會出現在程式碼、commit 紀錄或網頁上。目前用到：

| Secret 名稱 | 給誰用 |
| --- | --- |
| `DIGIKEY_CLIENT_ID` / `DIGIKEY_CLIENT_SECRET` | Digi-Key Product Information API v4 |
| `MOUSER_API_KEY` | Mouser Search API |

沒設定的資料源會自動略過，不會讓執行失敗。

## 給工程師

```bash
npm test                        # 單元測試
node scripts/fetch.js --dry     # 抓價但不寫檔
node scripts/fetch.js --no-fetch  # 不呼叫 API，只用 CSV 重建 parts.json
node scripts/fetch.js --limit=3 --dump=out.json   # 存下原始回應，驗欄位名稱用
```
