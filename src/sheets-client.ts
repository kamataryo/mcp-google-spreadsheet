import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

export interface SheetMeta {
  title: string;
  sheetId: number;
  rowCount: number;
  columnCount: number;
  dataRange: string;
  frozenRowCount: number;
  frozenColumnCount: number;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  sheets: SheetMeta[];
}

function columnIndexToLetter(index: number): string {
  let result = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export class SheetsClient {
  private sheetsApi: sheets_v4.Sheets;

  constructor(auth: GoogleAuth) {
    this.sheetsApi = google.sheets({ version: 'v4', auth });
  }

  async getMetadata(spreadsheetId: string): Promise<SpreadsheetMeta> {
    const res = await this.sheetsApi.spreadsheets.get({
      spreadsheetId,
      includeGridData: false,
    });

    const data = res.data;
    const sheets: SheetMeta[] = (data.sheets ?? []).map((sheet) => {
      const props = sheet.properties ?? {};
      const grid = props.gridProperties ?? {};
      return {
        title: props.title ?? '',
        sheetId: props.sheetId ?? 0,
        rowCount: grid.rowCount ?? 0,
        columnCount: grid.columnCount ?? 0,
        dataRange: '',
        frozenRowCount: grid.frozenRowCount ?? 0,
        frozenColumnCount: grid.frozenColumnCount ?? 0,
      };
    });

    return {
      spreadsheetId,
      title: data.properties?.title ?? '',
      sheets,
    };
  }

  async getSheetInfo(
    spreadsheetId: string,
    sheetName?: string
  ): Promise<SpreadsheetMeta> {
    const meta = await this.getMetadata(spreadsheetId);

    const targetSheets = sheetName
      ? meta.sheets.filter((s) => s.title === sheetName)
      : meta.sheets;

    if (sheetName && targetSheets.length === 0) {
      throw new Error(`シート「${sheetName}」が見つかりません。`);
    }

    // データ範囲を各シートごとに取得
    const sheetsWithDataRange = await Promise.all(
      targetSheets.map(async (sheet) => {
        try {
          const res = await this.sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: sheet.title,
          });
          const values = res.data.values ?? [];
          const rowCount = values.length;
          const colCount = values.reduce(
            (max, row) => Math.max(max, row.length),
            0
          );
          const dataRange =
            rowCount > 0 && colCount > 0
              ? `A1:${columnIndexToLetter(colCount - 1)}${rowCount}`
              : '（データなし）';
          return { ...sheet, dataRange };
        } catch {
          return { ...sheet, dataRange: '（取得失敗）' };
        }
      })
    );

    return {
      ...meta,
      sheets: sheetsWithDataRange,
    };
  }

  async readRange(
    spreadsheetId: string,
    sheetName: string,
    range?: string
  ): Promise<string[][]> {
    const rangeParam = range ? `${sheetName}!${range}` : sheetName;

    const res = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: rangeParam,
    });

    return (res.data.values ?? []).map((row) =>
      (row as string[]).map((cell) => (cell == null ? '' : String(cell)))
    );
  }

  async updateRange(
    spreadsheetId: string,
    sheetName: string,
    values: string[][],
    range?: string,
    valueInputOption: string = 'RAW'
  ): Promise<{ updatedRows: number; updatedColumns: number; updatedCells: number }> {
    const rangeParam = range ? `${sheetName}!${range}` : sheetName;

    const res = await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: rangeParam,
      valueInputOption,
      requestBody: { values },
    });

    return {
      updatedRows: res.data.updatedRows ?? 0,
      updatedColumns: res.data.updatedColumns ?? 0,
      updatedCells: res.data.updatedCells ?? 0,
    };
  }
}
