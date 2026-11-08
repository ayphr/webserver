export type ExportFormat = 'csv' | 'json';

export type ExportRow = Record<string, unknown>;

function serializeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function escapeCsvValue(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: ExportRow[]): string {
  if (rows.length === 0) return '';

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }

  const header = columns.map(escapeCsvValue).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvValue(serializeCell(row[column]))).join(','),
  );

  return [header, ...body].join('\r\n');
}

export function rowsToJson(rows: ExportRow[]): string {
  return JSON.stringify(rows, (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    return value;
  }, 2);
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadRows(rows: ExportRow[], format: ExportFormat, basename: string): void {
  if (format === 'csv') {
    downloadTextFile(`${basename}.csv`, rowsToCsv(rows), 'text/csv');
    return;
  }

  downloadTextFile(`${basename}.json`, rowsToJson(rows), 'application/json');
}

export function slugifyFilename(value: string, fallback = 'export'): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}
