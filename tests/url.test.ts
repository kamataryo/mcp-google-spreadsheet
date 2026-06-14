import { describe, it, expect } from '@jest/globals';
import { extractSpreadsheetId } from '../src/url.js';

describe('extractSpreadsheetId', () => {
  it('通常の編集URLからIDを抽出できる', () => {
    const url =
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit';
    expect(extractSpreadsheetId(url)).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
  });

  it('シート指定付きURLからIDを抽出できる', () => {
    const url =
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=0';
    expect(extractSpreadsheetId(url)).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
  });

  it('pub URLからIDを抽出できる', () => {
    const url =
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/pub';
    expect(extractSpreadsheetId(url)).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
  });

  it('ハイフンとアンダースコアを含むIDを抽出できる', () => {
    const url =
      'https://docs.google.com/spreadsheets/d/1Ab-Cd_EfGh/edit';
    expect(extractSpreadsheetId(url)).toBe('1Ab-Cd_EfGh');
  });

  it('無効なURLでエラーを投げる', () => {
    expect(() => extractSpreadsheetId('https://example.com')).toThrow(
      '無効なスプレッドシートURLです'
    );
  });

  it('空文字列でエラーを投げる', () => {
    expect(() => extractSpreadsheetId('')).toThrow(
      '無効なスプレッドシートURLです'
    );
  });
});
