import { readFile } from 'node:fs/promises';

import * as XLSX from 'xlsx';

import type { WorkbookLocation } from './vendor-config';

export async function loadWorkbook(location: WorkbookLocation): Promise<XLSX.WorkBook> {
  if (location.kind === 'file') {
    const buffer = await readFile(location.path);
    return XLSX.read(buffer, { type: 'buffer', raw: false, dense: true });
  }

  const exportUrl = toGoogleSheetExportUrl(location.url);
  const response = await fetch(exportUrl);

  if (!response.ok) {
    throw new Error(`Failed to download workbook: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return XLSX.read(Buffer.from(arrayBuffer), { type: 'buffer', raw: false, dense: true });
}

export function getSheetRows(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: ''
  });
}

export function getCell(row: unknown[], columnLetter: string | null): unknown {
  if (!columnLetter) {
    return null;
  }

  const index = columnToIndex(columnLetter);
  return row[index] ?? null;
}

function columnToNumber(columnLetter: string): number {
  return columnLetter
    .toUpperCase()
    .split('')
    .reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
}

function columnToIndex(columnLetter: string): number {
  return columnToNumber(columnLetter) - 1;
}

function toGoogleSheetExportUrl(url: string): string {
  if (url.includes('/export?format=xlsx')) {
    return url;
  }

  const match = url.match(/\/d\/([^/]+)/);

  if (!match) {
    throw new Error(`Unsupported Google Sheet URL: ${url}`);
  }

  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
}
