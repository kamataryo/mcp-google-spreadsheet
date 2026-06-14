# mcp-google-spreadsheet 仕様書

## 概要

MCP クライアント（Claude Code 等）から Google Spreadsheet を操作するための MCP サーバー。

## 認証方式

Service Account（サービスアカウント）方式を採用。

- ユーザーが Google Cloud Console でサービスアカウントを作成し、JSON キーを配置
- アクセスしたいスプレッドシートにサービスアカウントのメールアドレスを共有設定で追加
- キーファイルの探索: 環境変数 `MCP_GSPREAD_SERVICE_ACCOUNT_PATH` → `~/.config/mcp-google-spreadsheet/service-account.json`

## 状態管理

メモリ内に単一の接続情報を保持。プロセス再起動で消失。

```ts
interface Connection {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  connectedAt: string;
}
```

## ツール仕様

### connect_spreadsheet

| パラメータ | 型     | 必須 | 説明                    |
|------------|--------|------|-------------------------|
| url        | string | ✓    | Google Spreadsheet の URL |

処理:
1. URL から `spreadsheetId` を抽出（`/spreadsheets/d/([a-zA-Z0-9-_]+)`）
2. `spreadsheets.get` でメタデータ取得・検証
3. 成功時に `connection` 変数に保存

### disconnect_spreadsheet

パラメータなし。`connection` を `null` にクリア。

### get_sheet_info

| パラメータ | 型     | 必須 | 説明                                |
|------------|--------|------|-------------------------------------|
| sheetName  | string |      | 省略時は全シートのサマリを返す      |

取得情報: タイトル / sheetId / rowCount / columnCount / dataRange / frozenRowCount / frozenColumnCount

### read_sheet

| パラメータ | 型     | 必須 | 説明                                   |
|------------|--------|------|----------------------------------------|
| sheetName  | string | ✓    | 対象シート名                           |
| range      | string |      | A1 表記の範囲。省略時はシート全体      |

戻り値: Markdown 表形式の文字列

### update_sheet

| パラメータ       | 型         | 必須 | 説明                                       |
|------------------|------------|------|--------------------------------------------|
| sheetName        | string     | ✓    | 対象シート名                               |
| values           | string[][] | ✓    | 2次元配列（行 × 列）                       |
| range            | string     |      | A1 表記の更新範囲。省略時は A1 始点        |
| valueInputOption | string     |      | `RAW`（既定）または `USER_ENTERED`         |

## エラーハンドリング

- 未接続時に `read_sheet` / `update_sheet` / `get_sheet_info` を呼ぶと日本語エラーメッセージを返す
- サービスアカウントキーが見つからない場合はセットアップ手順を案内
- すべてのエラーは `isError: true` フラグ付きで返す

## 制限事項

- 単一接続のみ
- 接続状態はメモリ内のみ（プロセス再起動で失われる）
- Service Account 認証のみ
- 値の読み書きのみ（書式設定は対象外）
