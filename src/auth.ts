import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_KEY_PATH = join(
  homedir(),
  '.config',
  'mcp-google-spreadsheet',
  'service-account.json'
);

const SETUP_GUIDE = `
サービスアカウントの設定が見つかりません。以下の手順でセットアップしてください:

1. Google Cloud Console でプロジェクトを作成（または既存を利用）
2. Google Sheets API を有効化
3. サービスアカウントを作成し、JSON キーをダウンロード
4. キーを以下のいずれかの場所に配置:
   - ${DEFAULT_KEY_PATH}
   - 環境変数 MCP_GSPREAD_SERVICE_ACCOUNT_PATH で指定したパス
5. アクセスしたいスプレッドシートに、サービスアカウントのメールアドレスを共有設定で追加
`.trim();

export function createAuth(): GoogleAuth {
  const keyPath =
    process.env.MCP_GSPREAD_SERVICE_ACCOUNT_PATH ?? DEFAULT_KEY_PATH;

  if (!existsSync(keyPath)) {
    throw new Error(SETUP_GUIDE);
  }

  return new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}
