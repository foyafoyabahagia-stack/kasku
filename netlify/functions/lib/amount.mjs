// Parsing & format nominal rupiah.

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatIDR(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Rp0';
  return IDR.format(Math.round(n)).replace(/\u00a0/g, ' ');
}

/** Angka ringkas untuk sumbu grafik: 1.250.000 -> "1,3 jt" */
export function formatCompact(value) {
  const n = Math.abs(Number(value) || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',')} M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} jt`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',')} rb`;
  return String(Math.round(n));
}

const SUFFIX = [
  ['miliar', 1e9],
  ['milyar', 1e9],
  ['ribuan', 1e3],
  ['ribu', 1e3],
  ['juta', 1e6],
  ['jt', 1e6],
  ['rb', 1e3],
  ['k', 1e3],
];

/**
 * Terima "35000", "35.000", "35,000", "35rb", "35k", "1,5jt", "2 juta", "Rp 35.000".
 * Mengembalikan integer >= 0, atau NaN jika tidak valid.
 */
export function parseAmount(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : NaN;
  }
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/\s+/g, '');
  s = s.replace(/^rp\.?/, '');
  s = s.replace(/^idr\.?/, '');
  if (!s) return NaN;

  let multiplier = 1;
  for (const [suffix, factor] of SUFFIX) {
    if (s.endsWith(suffix) && s.length > suffix.length) {
      multiplier = factor;
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  if (!s) return NaN;

  // Desimal gaya Indonesia: "1,5" atau "1.5" sebelum satuan (hanya bila ada 1-2 digit di belakang)
  const decimal = s.match(/^(\d+)[.,](\d{1,2})$/);
  if (decimal && multiplier > 1) {
    const value = Number(`${decimal[1]}.${decimal[2]}`);
    if (!Number.isFinite(value)) return NaN;
    return Math.round(value * multiplier);
  }

  s = s.replace(/[.,]/g, '');
  if (!/^\d+$/.test(s)) return NaN;
  const value = Number(s) * multiplier;
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value);
}

/** Token yang "terlihat seperti nominal" untuk dipisahkan dari keterangan */
export function looksLikeAmount(token) {
  if (!token) return false;
  const t = token.replace(/^rp\.?/i, '');
  return /^\d[\d.,]*(rb|ribu|ribuan|k|jt|juta|miliar|milyar)?$/i.test(t);
}
