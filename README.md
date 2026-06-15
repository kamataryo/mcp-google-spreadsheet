# mcp-google-spreadsheet

Google Spreadsheet を MCP（Model Context Protocol）経由で操作するサーバー。

## 機能

- スプレッドシートへの接続（URL 指定）
- 接続解除
- シート名一覧の取得（軽量）
- シートのメタ情報取得（行数・列数・データ範囲）
- シート内容の読み取り（シート全体 / 範囲指定）
- シート内容の更新（シート全体 / 範囲指定）

## セットアップ

### 1. Google Cloud でサービスアカウントを作成

> **推奨: Sheets API 専用のプロジェクトを新規作成する**
>
> 既存プロジェクトを使うと、Drive API など他の API が有効になっていた場合にサービスアカウントが意図しないリソースにアクセスできてしまう。
> 専用プロジェクトなら有効化する API を Sheets API だけに絞れるため、権限が構造的に最小化される。
> また不要になったときはプロジェクトごと削除するだけでクリーンアップできる。

1. [Google Cloud Console](https://console.cloud.google.com/) で**新規プロジェクトを作成**（例: `mcp-sheets-only`）
2. **Google Sheets API のみ**を有効化（Drive API など他の API は有効化しない）
3. **サービスアカウント**を作成し、JSON キーをダウンロード

### 2. キーファイルを配置

ダウンロードした JSON キーを以下のいずれかに配置:

```
~/.config/mcp-google-spreadsheet/service-account.json
```

または環境変数で別パスを指定:

```bash
export MCP_GSPREAD_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
```

### セキュリティ監査

設定後、サービスアカウントが Sheets API 以外にアクセスできないことを確認するための監査スクリプトを用意しています。

```bash
bun run tests/security-audit.ts
```

各 API への接続を試み、想定外のリソース（Drive・IAM・Storage 等）に ✅ が出ていないかを確認してください。Drive API が ✅ になる場合は、GCP プロジェクトで Drive API が有効になっているため無効化を検討してください。

### サービスアカウントのベストプラクティス

- **権限の分割**: サービスアカウントはプロジェクトや用途ごとに分けることを推奨。1つのアカウントに権限を集中させると、漏洩時の影響範囲が広がる。環境変数 `MCP_GSPREAD_SERVICE_ACCOUNT_PATH` を使えばプロジェクトごとに別のキーファイルを指定できる。
- **わかりやすい名前をつける**: `mcp-spreadsheet-salesreport@...` のように、用途がひと目でわかる名前にしておくと、Google Cloud Console での管理や不要アカウントの特定がしやすくなる。
- **不要になった共有は手動で削除する**: スプレッドシートの共有設定は、MCP サーバー側からは削除できない。不要になったスプレッドシートからはサービスアカウントのアクセス権を手動で削除すること。

### 3. スプレッドシートをサービスアカウントに共有

アクセスしたい Google Spreadsheet を開き、共有設定でサービスアカウントのメールアドレス（例: `mcp-sheets@xxx.iam.gserviceaccount.com`）を「編集者」として追加。

### 4. ビルド・インストール

```bash
pnpm install
pnpm build
```

### 5. Claude Code への登録

`~/.claude/settings.json` または `.claude/settings.json` に追記:

```json
{
  "mcpServers": {
    "mcp-google-spreadsheet": {
      "command": "node",
      "args": ["/path/to/mcp-google-spreadsheet/dist/index.js"]
    }
  }
}
```

## ツール一覧

| ツール名 | 説明 |
|---|---|
| `connect_spreadsheet` | URL を指定してスプレッドシートに接続 |
| `disconnect_spreadsheet` | 現在の接続を解除 |
| `list_sheets` | シート名一覧を返す（軽量。追加 API コールなし） |
| `get_sheet_info` | シートのメタ情報を取得（行数・列数・データ範囲） |
| `read_sheet` | シート内容を Markdown 表形式で読み取り |
| `update_sheet` | シートに値を書き込み |

## 利用例

```
User: https://docs.google.com/spreadsheets/d/1AbC.../edit に接続して
 → connect_spreadsheet({ url: "https://docs.google.com/spreadsheets/d/1AbC.../edit" })
 ← スプレッドシート「売上管理」に接続しました。
    シート一覧:
      - 2026年6月（rows: 100, cols: 12）
      - 2026年5月（rows: 100, cols: 12）

User: どんなシートがある？
 → list_sheets()
 ← スプレッドシート「売上管理」のシート一覧:
    1. 2026年6月
    2. 2026年5月

User: 2026年6月シートの構造を教えて
 → get_sheet_info({ sheetName: "2026年6月" })
 ← グリッド: 100 行 × 12 列、データ範囲: A1:L48、固定行: 1

User: 2026年6月のシートを全部見せて
 → read_sheet({ sheetName: "2026年6月" })
 ← | 日付 | 商品 | ... |（Markdown 表形式）

User: 大きいから A1:D50 だけ読んで
 → read_sheet({ sheetName: "2026年6月", range: "A1:D50" })
 ← | 日付 | 商品 | ... |（指定範囲のみ）

User: 末尾に「みかん, 300」を追記して
 → update_sheet({ sheetName: "2026年6月", range: "A49:B49", values: [["みかん", "300"]] })
 ← 更新完了: 1 行 × 2 列（updatedCells: 2）

User: 接続を切って
 → disconnect_spreadsheet()
 ← 「売上管理」との接続を解除しました。
```

## 制限事項

- 単一接続のみ（複数スプレッドシートの同時操作は不可）
- 接続状態はメモリ内のみ（プロセス再起動で接続が失われる）
- 認証は Service Account 方式のみ
- 書式設定操作は対象外（値の読み書きのみ）
