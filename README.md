# 4項目日記

PC とスマホの両方から使える、4項目の日記 Web アプリです。

- 毎日 `目標 / 進捗 / 問題点 / 反省・改善点` を1行ずつ書けます
- 同じ日付で保存すると、その日の内容を上書き更新できます
- Google Apps Script と Google Sheets をつなぐと、オンラインで履歴を共有できます
- フロントは GitHub Pages にそのまま載せられる静的構成です

## GitHub Pages で公開する

1. このリポジトリの `Settings > Pages` を開きます。
2. `Deploy from a branch` を選びます。
3. Branch を `main`、Folder を `/(root)` にします。
4. 数分待つと `https://haseatsu114514-dot.github.io/nikki/` で開けます。

GitHub Pages の作成手順: https://docs.github.com/pages/getting-started-with-github-pages/creating-a-github-pages-site

## Google Sheets とつなぐ

1. `google-apps-script/Code.gs` と `google-apps-script/appsscript.json` を Google Apps Script に貼ります。
2. Script Properties に必要なら次を設定します。
   - `SPREADSHEET_ID`
   - `ENTRIES_SHEET_NAME`
   - `API_SECRET`
3. `setupSheet()` を1回実行します。
4. Web アプリとしてデプロイします。
5. `index.html` の `window.DAILY_REFLECTION_CONFIG` に Web アプリ URL を入れます。

## ファイル

- `index.html`: 画面本体
- `styles.css`: スタイル
- `app.js`: 履歴表示、保存、同期処理
- `google-apps-script/Code.gs`: Sheets 保存 API
- `google-apps-script/appsscript.json`: Apps Script 設定
