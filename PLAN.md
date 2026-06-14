# mcp-google-spreadsheet 実装計画

Google Spreadsheet を MCP（Model Context Protocol）経由で操作するためのサーバー実装計画。
スタックおよびリポジトリ構成は `mcp-voicevox` を踏襲する。

## 1. プロジェクト概要

MCP クライアント（Claude Code 等）から、URL 指定で Google Spreadsheet に接続し、シート内容の読み取り・更新を行うためのサーバー。

主な機能：

- スプレッドシートへの接続（URL 指定）
- 接続解除
- シートのメタ情報取得（行数・列数・データ範囲）
- シート内容の読み取り（シート全体 / 範囲指定）
- シート内容の更新（シート全体 / 範囲指定）

## 2. 技術スタック

`mcp-voicevox` と同等。

- ランタイム: Node.js 18+
- 言語: TypeScript（ES2022 / ES Modules）
- MCP SDK: `@modelcontextprotocol/sdk`（Stdio Transport）
- Google API クライアント: `googleapis`（公式）+ `google-auth-library`
- パッケージマネージャ: pnpm
- リント/フォーマット: ESLint + Prettier
- テスト: Jest（必要最小限）

### 依存パッケージ（追加分）

```
dependencies:
  - @modelcontextprotocol/sdk
  - googleapis
  - google-auth-library
```

> 注: `pnpm add` 実行はユーザーに依頼する（CLAUDE.md ルール）。`minimumReleaseAge` を 1 ヶ月に設定する。

## 3. 認証方式：Service Account（採用）

「接続しようとするスプレッドシートだけに権限を与える」という要件に最も合致する方式として **Service Account** を採用する。

### 仕組み

1. ユーザーは Google Cloud Console でサービスアカウントを **一度だけ** 作成し、JSON キーをダウンロード。
2. 使いたいスプレッドシートを Google Drive UI で開き、サービスアカウントのメールアドレス（例: `mcp-sheets@xxx.iam.gserviceaccount.com`）を「編集者」として **共有** する。
3. MCP サーバーはこのサービスアカウントでスプレッドシートにアクセスする。

### この方式の利点

- **権限スコープが最小**: 共有したシートだけにアクセス可能。Drive 全体や他のシートには触れない。
- **ブラウザ認証フロー不要**: サーバー起動時にトークン取得・リフレッシュ不要。
- **再認証なし**: トークン期限切れの心配なし。

### ユーザーがやること（初回セットアップ）

1. Google Cloud Console でプロジェクトを作成（既存利用も可）。
2. Google Sheets API を有効化。
3. サービスアカウントを作成し、JSON キーをダウンロード。
4. ダウンロードした JSON キーを `~/.config/mcp-google-spreadsheet/service-account.json` に配置。
   - または環境変数 `MCP_GSPREAD_SERVICE_ACCOUNT_PATH` で別パスを指定。
5. アクセスしたいスプレッドシートに、サービスアカウントのメールアドレスを共有設定で追加。

### 認証情報の探索順序

1. 環境変数 `MCP_GSPREAD_SERVICE_ACCOUNT_PATH` で指定されたパス
2. `~/.config/mcp-google-spreadsheet/service-account.json`
3. 見つからなければエラーを返し、セットアップ手順を案内するメッセージを出す。

## 4. 状態管理

### 単一接続モデル

サーバープロセス全体で「現在接続中のスプレッドシート」を 1 つだけ保持する。

### 永続化なし（メモリのみ）

接続状態は **MCP サーバープロセスのメモリ内** にのみ保持し、ファイルには保存しない。

```ts
// 概念的なイメージ
let connection: {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  connectedAt: string;
} | null = null;
```

#### この設計の理由

- Claude Code などの MCP クライアントは通常 **プロジェクト（cwd）ごとに MCP サーバープロセスを起動** する。
  したがって「プロセスの寿命 ≒ プロジェクトセッションの寿命」となり、メモリ保持だけで自然にプロジェクト間の接続状態が隔離される。
- ファイル経由の隔離（cwd 配下／cwd ハッシュ）を持ち込まずに済むため、実装が最小になる。

#### トレードオフ

- MCP サーバープロセスの再起動（例: Claude Code の再起動、`claude mcp` の設定変更）で接続が失われ、再度 `connect_spreadsheet` が必要になる。本仕様ではこれを許容する。
- ただし「**アクセス可能なシート集合**」自体は Service Account の共有設定で決まるため、メモリ揮発でも変わらない。プロジェクトごとの権限隔離が必要なら Service Account を分ける運用で対応（本仕様では単一 Service Account を共用）。

## 5. ツール仕様

すべてのツールはエラー時に分かりやすい日本語メッセージを返す。
`read_sheet` / `update_sheet` / `get_sheet_info` 呼び出し時に未接続なら、「先に `connect_spreadsheet` で URL を指定して接続してください」と返す。

### 5.1 `connect_spreadsheet`

URL からスプレッドシート ID を抽出し、アクセス可能か検証して接続状態を保存する。

| パラメータ | 型     | 必須 | 説明                                                                       |
| ---------- | ------ | ---- | -------------------------------------------------------------------------- |
| url        | string | ✓    | Google Spreadsheet の URL（例: `https://docs.google.com/.../d/{id}/edit`） |

#### 処理

1. URL から `spreadsheetId` を抽出（正規表現: `/spreadsheets/d/([a-zA-Z0-9-_]+)`）。
2. Sheets API `spreadsheets.get` を呼び出し、メタデータを取得。
3. 失敗時（権限なし等）はサービスアカウントへの共有が必要である旨のメッセージを返す。
4. 成功時に `state.json` に保存。

#### 戻り値（例）

```
スプレッドシート「売上管理」に接続しました。
シート一覧:
  - 2026年6月（rows: 100, cols: 12）
  - 2026年5月（rows: 100, cols: 12）
```

### 5.2 `disconnect_spreadsheet`

現在の接続を解除する。

| パラメータ | 型  | 必須 | 説明 |
| ---------- | --- | ---- | ---- |
| なし       |     |      |      |

#### 処理

メモリ上の接続情報を `null` にクリアする。

### 5.3 `get_sheet_info`

接続中のスプレッドシートのメタ情報を取得する。逐次読み込み戦略を立てるための情報源。

| パラメータ | 型     | 必須 | 説明                                                                                  |
| ---------- | ------ | ---- | ------------------------------------------------------------------------------------- |
| sheetName  | string |      | 指定したシートのみの情報を返す。省略時は全シートのサマリを返す。                      |

#### 取得・返却する情報

- スプレッドシートのタイトル
- シート一覧。各シートについて:
  - `title`: シート名
  - `sheetId`: シート内部 ID
  - `rowCount`: グリッドの最大行数（`spreadsheets.get` の `gridProperties.rowCount`）
  - `columnCount`: グリッドの最大列数（同 `columnCount`）
  - `dataRange`: 実データが入っている範囲の推定（A1 表記。`spreadsheets.values.get` で末尾の空でないセルから算出 or `sheets[].data[].rowData` の長さで近似）
  - `frozenRowCount` / `frozenColumnCount`: 固定行・列の数（あれば）

#### 戻り値（例）

```
スプレッドシート: 売上管理

シート一覧:
- 2026年6月
  sheetId: 0
  グリッド: 1000 行 × 26 列
  データ範囲: A1:L48（推定）
  固定行: 1
- 2026年5月
  sheetId: 123456
  グリッド: 1000 行 × 26 列
  データ範囲: A1:L31（推定）
```

### 5.4 `read_sheet`

接続中のスプレッドシートから値を読み取る。最低限の引数はシート名で、その場合はそのシート全体を返す。

| パラメータ | 型     | 必須 | 説明                                                                                                          |
| ---------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------- |
| sheetName  | string | ✓    | 対象シート名。                                                                                                |
| range      | string |      | A1 表記の範囲（シート名は不要、例: `A1:D10` / `A:C`）。省略時はシート全体（実データのある範囲）を読み取る。  |

#### 処理

- `range` 省略時: Sheets API には `sheetName` のみを渡し、シート全体を取得。
- `range` 指定時: `{sheetName}!{range}` を組み立てて取得。

#### 戻り値

Markdown 表形式の文字列を返す（LLM が扱いやすい形式）。

```
| A | B | C |
|---|---|---|
| 日付 | 商品 | 金額 |
| 2026-06-01 | みかん | 300 |
| ... |
```

### 5.5 `update_sheet`

接続中のスプレッドシートに値を書き込む。最低限の引数はシート名 + values で、その場合はそのシートの A1 始点で全体的に書き込む。

| パラメータ       | 型           | 必須 | 説明                                                                                                                |
| ---------------- | ------------ | ---- | ------------------------------------------------------------------------------------------------------------------- |
| sheetName        | string       | ✓    | 対象シート名。                                                                                                      |
| values           | string[][]   | ✓    | 2 次元配列。行 × 列。空セルは空文字 `""` で表現。                                                                   |
| range            | string       |      | A1 表記の更新範囲（シート名は不要、例: `A2:C2`）。省略時はシート名のみを範囲指定し、A1 始点で values を書き込む。  |
| valueInputOption | string       |      | `RAW`（既定）または `USER_ENTERED`（数式・日付として解釈させたい場合）。                                            |

#### 処理

- `range` 省略時: Sheets API に `{sheetName}` を範囲として渡す（A1 始点で書き込み）。
- `range` 指定時: `{sheetName}!{range}` を組み立てて更新。
- `sheets.spreadsheets.values.update` を呼び出す。書き込み行数・セル数を返却。

> 補足: シート全体置換ではなく **A1 始点での書き込み** であるため、既存データがあれば values の範囲外は残る。完全クリアが必要な場合は将来 `clear_sheet` を追加検討。

#### 戻り値（例）

```
更新完了: 3 行 × 2 列（updatedCells: 6）
```

## 6. ディレクトリ構成

`mcp-voicevox` と同じレイアウト。

```
mcp-google-spreadsheet/
├── PLAN.md                  # 本ドキュメント
├── README.md
├── CLAUDE.md
├── docs/
│   └── specification.md     # 仕様書（実装後に整備）
├── src/
│   ├── index.ts             # MCP サーバーのエントリ（ツール定義 + メモリ内接続状態）
│   ├── sheets-client.ts     # Sheets API ラッパー
│   ├── auth.ts              # Service Account 認証ロジック
│   └── url.ts               # URL から spreadsheetId を抽出
├── tests/
│   └── url.test.ts
├── package.json
├── tsconfig.json
├── jest.config.js
├── .eslintrc.cjs
├── .prettierrc
└── .gitignore               # service-account.json を念のため無視
```

## 7. 実装ステップ

各ステップを 1 コミット単位として進める。

1. **プロジェクト初期化**
   - `package.json` / `tsconfig.json` / `.eslintrc.cjs` / `.prettierrc` / `jest.config.js` / `.gitignore` を mcp-voicevox から流用してセットアップ。
   - `pnpm add` の実行はユーザーに依頼。

2. **URL パーサ実装**（`src/url.ts` + テスト）
   - 各種 URL 形式から `spreadsheetId` を抽出。

3. **認証モジュール**（`src/auth.ts`）
   - Service Account JSON を読み込み、`google.auth.GoogleAuth` インスタンスを返す。
   - scope: `https://www.googleapis.com/auth/spreadsheets`

4. **Sheets API ラッパー**（`src/sheets-client.ts`）
   - `getMetadata(spreadsheetId)`
   - `getSheetInfo(spreadsheetId, sheetName?)` — グリッドサイズとデータ範囲を返す
   - `readRange(spreadsheetId, sheetName, range?)`
   - `updateRange(spreadsheetId, sheetName, values, range?, valueInputOption?)`

5. **MCP サーバー本体**（`src/index.ts`）
   - メモリ内に接続状態（`connection` 変数）を保持。
   - 5 ツールの登録とハンドラ実装。
   - エラーメッセージは日本語、セットアップ手順への誘導を含める。

6. **ドキュメント整備**
   - `README.md`: セットアップ手順（特に Service Account 作成と共有設定）を丁寧に。
   - `docs/specification.md`: 仕様書。
   - `CLAUDE.md`: mcp-voicevox 同等の内容＋本プロジェクト固有事項。

## 8. 想定される利用シーン

```
User: https://docs.google.com/spreadsheets/d/1AbC.../edit に接続してください
  → connect_spreadsheet({url: "..."})
  ← 「売上管理」に接続しました。シート: 2026年6月, 2026年5月

User: シートの構造を教えて
  → get_sheet_info()
  ← (各シートの行数・列数・データ範囲)

User: 2026年6月のシートを全部見せて
  → read_sheet({sheetName: "2026年6月"})
  ← (表形式で返す)

User: 大きいシートだから A1:D50 だけ読んで
  → read_sheet({sheetName: "2026年6月", range: "A1:D50"})
  ← (表形式で返す)

User: 末尾に「みかん, 300」を追記して
  → update_sheet({sheetName: "2026年6月", range: "A49:B49", values: [["みかん", 300]]})
  ← 更新完了

User: 接続を切って
  → disconnect_spreadsheet()
  ← 接続を解除しました
```

## 9. 制限事項（初版）

- 単一接続のみ。複数スプレッドシートの同時操作は不可。
- 接続状態は MCP サーバープロセスのメモリ内のみ。プロセス再起動で接続が失われ、再 `connect_spreadsheet` が必要。
- 認証は Service Account 方式のみ。ユーザー OAuth は将来検討。
- 全プロジェクトで Service Account を共用するため、「アクセス可能なシート集合」自体はプロジェクト間で隔離されない（共有設定で許可されたシートは、どのプロジェクトからでも `connect_spreadsheet` 可能）。プロジェクト単位で完全に権限分離したい場合は、プロジェクトごとに別 Service Account を作り、環境変数 `MCP_GSPREAD_SERVICE_ACCOUNT_PATH` で切り替える運用が可能。
- フォーマット（書式設定）操作は対象外。値の読み書きのみ。
- `update_sheet` は A1 始点書き込みであり、シート全体クリアは行わない。
