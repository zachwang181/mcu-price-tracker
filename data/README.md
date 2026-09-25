# data/ 裡面各是什麼

| 檔案 | 誰在改 | 說明 |
| --- | --- | --- |
| `parts_list.csv` | **你** | 要追蹤哪些料號。一列一顆。欄位：`mpn,manufacturer,group,note,use`。`group` 只能填 `intl`／`cn`／`tw`；`use` 是「這顆料通常用在哪」。 |
| `manual_quotes.csv` | **你** | 代理商報價、實際成交價，或任何手動記的價格。一列一筆。 |
| `notices.json` | **你** | 原廠調價事件。 |
| `parts.json` | 程式 | 網頁真正讀的檔。每次執行由上面三個檔 + 自動抓到的價格與規格重新組出來。**不要手改。** |
| `last_run.json` | 程式 | 最近一次執行的時間、各通路成功／查無／失敗筆數和錯誤訊息。**不要手改。** |
| `raw/YYYY-MM-DD.json` | 程式 | 當天抓到的完整價格級距（每個包裝、每個級距都留著），日後要重算用得到。**不要手改。** |

## 規格是自動抓的，用途是人工寫的

料號卡片上那一塊「核心／時脈／Flash／RAM／封裝／分類」是程式每天從通路的回應直接抓下來的
（Digi-Key 的參數最完整，LCSC 次之，Mouser 只有分類），**不用也不要手動維護**。

通路 API **沒有**「這顆料用在什麼產品上」這種資料，所以 `parts_list.csv` 的 `use` 欄位是人工寫的。
現在裡面那一版是初稿，看到不對就直接改。

## manual_quotes.csv 的欄位

`date,mpn,source,kind,qty,price,currency,lead_weeks,stock,note,id`

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `date` | ✅ | 報價日期，一定要 `2026-09-25` 這種寫法。 |
| `mpn` | ✅ | 原廠料號，要跟 `parts_list.csv` 裡的一致。 |
| `source` | | 誰報的價，例如 `大聯大`、`文曄`、`LCSC`。留空會記成「未填」。 |
| `kind` | | `quote`＝代理商報價（預設）、`po`＝實際成交、`catalog`＝通路目錄價。 |
| `qty` | ✅ | 這個價格適用的買量（顆）。 |
| `price` | ✅ | 單價。只寫數字，`1.85`。 |
| `currency` | | `USD`（預設）、`TWD`、`CNY`、`EUR`、`JPY`。**照對方報的幣別填，不要自己換算。** |
| `lead_weeks` | | 交期，單位是週。不知道就留空。 |
| `stock` | | 對方說的庫存顆數。不知道就留空。 |
| `note` | | 備註，例如「王經理 email，含稅」。 |
| `id` | | 留空就好，程式會自己編。 |

範例列：

```
2026-09-30,STM32F103C8T6,大聯大,quote,5000,2.95,USD,20,,王經理 9/30 email 報價,
```

備註裡如果要寫半形逗號 `,`，整欄用雙引號包起來：`"含稅, 不含運"`。

## notices.json 的欄位

```json
{ "id": "st-1101", "vendor": "STMicroelectronics", "announced": "2026-10-05", "effective": "2026-11-01", "range": "5–10%", "scope": "通用 MCU", "source": "TrendForce 10/6" }
```

`vendor` 的寫法要跟 `parts_list.csv` 裡的 `manufacturer` 一致，網頁才會把調價日畫在那顆料號的走勢圖上。
`id` 自己取個不重複的短代號；`effective`（生效日）必填，其他不知道就填空字串 `""`。
