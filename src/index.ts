#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createAuth, getServiceAccountEmail } from './auth.js';
import { SheetsClient } from './sheets-client.js';
import { extractSpreadsheetId } from './url.js';

interface Connection {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  connectedAt: string;
}

let connection: Connection | null = null;

function requireConnection(): Connection {
  if (!connection) {
    throw new Error(
      '先に connect_spreadsheet でURLを指定して接続してください。'
    );
  }
  return connection;
}

function valuesToMarkdown(values: string[][]): string {
  if (values.length === 0) return '（データなし）';

  const colCount = values.reduce((max, row) => Math.max(max, row.length), 0);
  const normalize = (row: string[]) => {
    const cells = [...row];
    while (cells.length < colCount) cells.push('');
    return cells;
  };

  const rows = values.map(normalize);
  const header = rows[0];
  const separator = header.map(() => '---');
  const body = rows.slice(1);

  const toLine = (cells: string[]) =>
    '| ' + cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ') + ' |';

  return [toLine(header), toLine(separator), ...body.map(toLine)].join('\n');
}

class SpreadsheetMCPServer {
  private server: Server;
  private sheetsClient: SheetsClient | null = null;

  constructor() {
    this.server = new Server(
      { name: 'mcp-google-spreadsheet', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers();
  }

  private getSheetsClient(): SheetsClient {
    if (!this.sheetsClient) {
      const auth = createAuth();
      this.sheetsClient = new SheetsClient(auth);
    }
    return this.sheetsClient;
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'connect_spreadsheet',
          description:
            'Google スプレッドシートに接続します。URLを指定してください。',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description:
                  'Google Spreadsheet の URL（例: https://docs.google.com/spreadsheets/d/{id}/edit）',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'disconnect_spreadsheet',
          description: '現在接続中のスプレッドシートとの接続を解除します。',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'list_sheets',
          description:
            '接続中のスプレッドシートのシート名一覧を返します。軽量な確認用ツールです。',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_sheet_info',
          description:
            '接続中のスプレッドシートのメタ情報（シート一覧、行数、列数、データ範囲）を取得します。',
          inputSchema: {
            type: 'object',
            properties: {
              sheetName: {
                type: 'string',
                description:
                  '特定シートの情報のみ取得する場合はシート名を指定。省略時は全シートのサマリを返します。',
              },
            },
            required: [],
          },
        },
        {
          name: 'read_sheet',
          description:
            '接続中のスプレッドシートから値を読み取ります。Markdown 表形式で返します。',
          inputSchema: {
            type: 'object',
            properties: {
              sheetName: {
                type: 'string',
                description: '対象シート名',
              },
              range: {
                type: 'string',
                description:
                  'A1 表記の範囲（例: A1:D10、A:C）。省略時はシート全体を読み取ります。',
              },
            },
            required: ['sheetName'],
          },
        },
        {
          name: 'update_sheet',
          description:
            '接続中のスプレッドシートに値を書き込みます。省略時は A1 始点で書き込みます。',
          inputSchema: {
            type: 'object',
            properties: {
              sheetName: {
                type: 'string',
                description: '対象シート名',
              },
              values: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'string' },
                },
                description:
                  '2次元配列（行 × 列）。空セルは空文字 "" で表現。',
              },
              range: {
                type: 'string',
                description:
                  'A1 表記の更新範囲（例: A2:C2）。省略時はシート名のみを範囲指定し A1 始点で書き込みます。',
              },
              valueInputOption: {
                type: 'string',
                enum: ['RAW', 'USER_ENTERED'],
                description:
                  'RAW（既定）または USER_ENTERED（数式・日付として解釈）',
              },
            },
            required: ['sheetName', 'values'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === 'connect_spreadsheet') {
          return await this.handleConnect(args as { url: string });
        }
        if (name === 'disconnect_spreadsheet') {
          return this.handleDisconnect();
        }
        if (name === 'list_sheets') {
          return await this.handleListSheets();
        }
        if (name === 'get_sheet_info') {
          return await this.handleGetSheetInfo(
            args as { sheetName?: string }
          );
        }
        if (name === 'read_sheet') {
          return await this.handleReadSheet(
            args as { sheetName: string; range?: string }
          );
        }
        if (name === 'update_sheet') {
          return await this.handleUpdateSheet(
            args as {
              sheetName: string;
              values: string[][];
              range?: string;
              valueInputOption?: string;
            }
          );
        }
        throw new Error(`Unknown tool: ${name}`);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `エラー: ${error instanceof Error ? error.message : '不明なエラー'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleConnect(args: { url: string }) {
    const spreadsheetId = extractSpreadsheetId(args.url);
    const client = this.getSheetsClient();

    let meta;
    try {
      meta = await client.getMetadata(spreadsheetId);
    } catch (error) {
      const isPermissionError =
        error instanceof Error &&
        /403|forbidden|permission|access/i.test(error.message);

      if (isPermissionError) {
        const email = getServiceAccountEmail();
        const emailLine = email
          ? `  ${email}`
          : '  （サービスアカウントのメールアドレスを取得できませんでした）';
        throw new Error(
          `このスプレッドシートにアクセスできません。\n` +
            `以下のサービスアカウントに「編集者」として共有してください:\n\n` +
            `${emailLine}\n\n` +
            `共有手順:\n` +
            `  1. スプレッドシートを開く → ${args.url}\n` +
            `  2. 右上「共有」ボタンをクリック\n` +
            `  3. 上記メールアドレスを入力して「編集者」で共有\n` +
            `  4. 再度 connect_spreadsheet を実行`
        );
      }
      throw error;
    }

    connection = {
      spreadsheetId,
      spreadsheetUrl: args.url,
      title: meta.title,
      connectedAt: new Date().toISOString(),
    };

    const sheetLines = meta.sheets
      .map(
        (s) =>
          `  - ${s.title}（rows: ${s.rowCount}, cols: ${s.columnCount}）`
      )
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `スプレッドシート「${meta.title}」に接続しました。\nシート一覧:\n${sheetLines}`,
        },
      ],
    };
  }

  private handleDisconnect() {
    if (!connection) {
      return {
        content: [{ type: 'text', text: '現在接続中のスプレッドシートはありません。' }],
      };
    }
    const title = connection.title;
    connection = null;
    return {
      content: [{ type: 'text', text: `「${title}」との接続を解除しました。` }],
    };
  }

  private async handleListSheets() {
    const conn = requireConnection();
    const client = this.getSheetsClient();
    const meta = await client.getMetadata(conn.spreadsheetId);

    const lines = meta.sheets.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
    return {
      content: [
        {
          type: 'text',
          text: `スプレッドシート「${meta.title}」のシート一覧:\n${lines}`,
        },
      ],
    };
  }

  private async handleGetSheetInfo(args: { sheetName?: string }) {
    const conn = requireConnection();
    const client = this.getSheetsClient();
    const meta = await client.getSheetInfo(conn.spreadsheetId, args.sheetName);

    const sheetLines = meta.sheets
      .map((s) => {
        const lines = [
          `- ${s.title}`,
          `  sheetId: ${s.sheetId}`,
          `  グリッド: ${s.rowCount} 行 × ${s.columnCount} 列`,
          `  データ範囲: ${s.dataRange}`,
        ];
        if (s.frozenRowCount > 0) lines.push(`  固定行: ${s.frozenRowCount}`);
        if (s.frozenColumnCount > 0)
          lines.push(`  固定列: ${s.frozenColumnCount}`);
        return lines.join('\n');
      })
      .join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `スプレッドシート: ${meta.title}\n\nシート一覧:\n${sheetLines}`,
        },
      ],
    };
  }

  private async handleReadSheet(args: {
    sheetName: string;
    range?: string;
  }) {
    const conn = requireConnection();
    const client = this.getSheetsClient();
    const values = await client.readRange(
      conn.spreadsheetId,
      args.sheetName,
      args.range
    );
    return {
      content: [{ type: 'text', text: valuesToMarkdown(values) }],
    };
  }

  private async handleUpdateSheet(args: {
    sheetName: string;
    values: string[][];
    range?: string;
    valueInputOption?: string;
  }) {
    const conn = requireConnection();
    const client = this.getSheetsClient();
    const result = await client.updateRange(
      conn.spreadsheetId,
      args.sheetName,
      args.values,
      args.range,
      args.valueInputOption
    );
    return {
      content: [
        {
          type: 'text',
          text: `更新完了: ${result.updatedRows} 行 × ${result.updatedColumns} 列（updatedCells: ${result.updatedCells}）`,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Google Spreadsheet Server running on stdio');

    process.on('SIGINT', () => {
      console.error('Received SIGINT, shutting down...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.error('Received SIGTERM, shutting down...');
      process.exit(0);
    });
  }
}

async function main() {
  const server = new SpreadsheetMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
