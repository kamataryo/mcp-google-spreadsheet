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

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（または既存を利用）
2. **Google Sheets API** を有効化
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
connect_spreadsheet({ url: "https://docs.google.com/spreadsheets/d/1AbC.../edit" })
→ 「売上管理」に接続しました。

list_sheets()
→ 1. 2026年6月  2. 2026年5月  3. ...

get_sheet_info()
→ 各シートの行数・列数・データ範囲を返す

read_sheet({ sheetName: "2026年6月" })
→ Markdown 表形式でシート全体を返す

read_sheet({ sheetName: "2026年6月", range: "A1:D50" })
→ 指定範囲を返す

update_sheet({ sheetName: "2026年6月", range: "A49:B49", values: [["みかん", "300"]] })
→ 更新完了: 1 行 × 2 列

disconnect_spreadsheet()
→ 接続を解除しました
```

## 制限事項

- 単一接続のみ（複数スプレッドシートの同時操作は不可）
- 接続状態はメモリ内のみ（プロセス再起動で接続が失われる）
- 認証は Service Account 方式のみ
- 書式設定操作は対象外（値の読み書きのみ）
