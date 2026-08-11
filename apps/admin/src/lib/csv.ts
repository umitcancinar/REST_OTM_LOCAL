function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Excel formula injection: kullanici kaynakli degerler =, +, - veya @ ile
  // basliyorsa Excel bunlari komut olarak yorumlamamali.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function downloadCsv(rows: Array<Record<string, unknown>>, filename: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const body = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\r\n');
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
