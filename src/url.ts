export function extractSpreadsheetId(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) {
    throw new Error(
      `無効なスプレッドシートURLです: ${url}\n` +
        '例: https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit'
    );
  }
  return match[1];
}
