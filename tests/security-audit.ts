/**
 * サービスアカウントのアクセス範囲監査スクリプト
 *
 * 各 API への接続を試み、想定外のリソースにアクセスできないことを確認する。
 * すべての操作は読み取りのみ。失敗（❌）が想定結果。
 *
 * 実行: npx ts-node --esm tmp.penetoration.ts
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const keyPath =
  process.env.MCP_GSPREAD_SERVICE_ACCOUNT_PATH ??
  join(homedir(), '.config', 'mcp-google-spreadsheet', 'service-account.json');

if (!existsSync(keyPath)) {
  console.error(`キーファイルが見つかりません: ${keyPath}`);
  process.exit(1);
}

const keyJson = JSON.parse(readFileSync(keyPath, 'utf-8')) as {
  client_email: string;
  project_id: string;
};

function auth(...scopes: string[]) {
  return new google.auth.GoogleAuth({ keyFile: keyPath, scopes });
}

async function check(label: string, fn: () => Promise<string>): Promise<void> {
  process.stdout.write(`${label}\n  `);
  try {
    const result = await fn();
    console.log(`✅ ${result}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log(`❌ ${msg}`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('サービスアカウント アクセス範囲監査');
  console.log('='.repeat(60));
  console.log(`SA メール  : ${keyJson.client_email}`);
  console.log(`プロジェクト: ${keyJson.project_id}`);
  console.log('');

  // ── 想定内: Sheets API ────────────────────────────────────
  console.log('【想定内: 正常にアクセスできるべきもの】');

  await check('Sheets API: スプレッドシート取得（ID 不明なので 404 になるが認証は通る想定）', async () => {
    const sheets = google.sheets({
      version: 'v4',
      auth: auth('https://www.googleapis.com/auth/spreadsheets.readonly'),
    });
    // 存在しない ID でアクセス → 認証は通り 404 になるはず
    await sheets.spreadsheets.get({ spreadsheetId: 'dummy-id-for-auth-check' });
    return '予期しない成功';
  });

  // ── 想定外: Drive ─────────────────────────────────────────
  console.log('\n【想定外: アクセスできてはいけないもの】');

  await check('Drive API: 共有ファイル一覧', async () => {
    const drive = google.drive({
      version: 'v3',
      auth: auth('https://www.googleapis.com/auth/drive.readonly'),
    });
    const res = await drive.files.list({
      pageSize: 10,
      fields: 'files(id, name, mimeType)',
    });
    const files = res.data.files ?? [];
    if (files.length === 0) return 'ファイルなし（スコープは通ったが共有なし）';
    return (
      `${files.length} 件アクセス可能:\n` +
      files.map((f) => `    - ${f.name} (${f.mimeType})`).join('\n')
    );
  });

  await check('Cloud Resource Manager: プロジェクト一覧', async () => {
    const rm = google.cloudresourcemanager({
      version: 'v1',
      auth: auth('https://www.googleapis.com/auth/cloud-platform.read-only'),
    });
    const res = await rm.projects.list();
    const projects = res.data.projects ?? [];
    if (projects.length === 0) return 'プロジェクトなし';
    return `${projects.length} 件: ${projects.map((p) => p.projectId).join(', ')}`;
  });

  await check(`IAM: プロジェクト内サービスアカウント一覧 (${keyJson.project_id})`, async () => {
    const iam = google.iam({
      version: 'v1',
      auth: auth('https://www.googleapis.com/auth/cloud-platform.read-only'),
    });
    const res = await iam.projects.serviceAccounts.list({
      name: `projects/${keyJson.project_id}`,
    });
    const accounts = res.data.accounts ?? [];
    if (accounts.length === 0) return 'サービスアカウントなし';
    return `${accounts.length} 件: ${accounts.map((a) => a.email).join(', ')}`;
  });

  await check('Cloud Storage: バケット一覧', async () => {
    const storage = google.storage({
      version: 'v1',
      auth: auth('https://www.googleapis.com/auth/devstorage.read_only'),
    });
    const res = await storage.buckets.list({ project: keyJson.project_id });
    const buckets = res.data.items ?? [];
    if (buckets.length === 0) return 'バケットなし';
    return `${buckets.length} 件: ${buckets.map((b) => b.name).join(', ')}`;
  });

  await check('Admin SDK: Workspace ユーザー一覧（ドメイン委任が必要）', async () => {
    const admin = google.admin({
      version: 'directory_v1',
      auth: auth(
        'https://www.googleapis.com/auth/admin.directory.user.readonly'
      ),
    });
    const res = await admin.users.list({
      customer: 'my_customer',
      maxResults: 5,
    });
    return `${res.data.users?.length ?? 0} 件`;
  });

  await check('Gmail: メッセージ一覧（ドメイン委任が必要）', async () => {
    const gmail = google.gmail({
      version: 'v1',
      auth: auth('https://www.googleapis.com/auth/gmail.readonly'),
    });
    const res = await gmail.users.messages.list({ userId: 'me', maxResults: 5 });
    return `${res.data.messages?.length ?? 0} 件`;
  });

  await check('Calendar: カレンダー一覧（ドメイン委任が必要）', async () => {
    const cal = google.calendar({
      version: 'v3',
      auth: auth('https://www.googleapis.com/auth/calendar.readonly'),
    });
    const res = await cal.calendarList.list();
    return `${res.data.items?.length ?? 0} 件`;
  });

  console.log('\n' + '='.repeat(60));
  console.log('監査完了');
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
