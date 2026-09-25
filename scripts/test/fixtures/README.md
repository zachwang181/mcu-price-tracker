# fixtures

這裡的檔案是 **實際呼叫 API 存下來的回應**，用來確認我們讀的欄位名稱跟對方回的一致。
拿掉了沒用到的大欄位（`Parameters`、`Classifications` 之類），留下來的部分原樣未改。

重抓方式：在 Actions 頁跑 **抓原始回應（除錯用）** 這個 workflow，下載 `raw-dump` 成品。

| 檔案 | 抓取日期 | 內容 |
| --- | --- | --- |
| `digikey-real.json` | 2026-09-25 | Digi-Key Product Information v4 keyword search，3 顆料號 |
| `mouser-real.json` | 2026-09-25 | Mouser Search API part number search，3 顆料號 |
