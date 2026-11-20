// Parser teks struk belanja Indonesia.
// Menerima teks hasil OCR (dari Gemini atau Tesseract) lalu menebak nominal total,
// tanggal transaksi, nama toko, dan kategori.

import { guessCategory } from './categories.mjs';
import { todayISO, isValidISODate } from './dates.mjs';

const MONTHS = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, pebruari: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11, nop: 11, nopember: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

// Baris yang menyebut kata kunci ini bukan total yang dibayar.
const NOT_TOTAL = [
  'kembali', 'kembalian', 'change', 'tunai', 'cash', 'debit', 'kredit', 'credit',
  'qris', 'ovo', 'gopay', 'dana', 'shopeepay', 'diskon', 'potongan', 'pajak',
  'ppn', 'dpp', 'hutang', 'sisa', 'saldo',
];

const PAY_WORDS = ['bayar', 'pembayaran', 'tunai', 'cash', 'debit', 'kredit', 'qris', 'ovo', 'gopay', 'dana', 'shopeepay'];
const CHANGE_WORDS = ['kembali', 'kembalian', 'change'];

const TOTAL_STRONG = ['grand total', 'total bayar', 'total belanja', 'total harga', 'total akhir', 'jumlah bayar', 'jumlah total', 'total tagihan'];
const TOTAL_SOFT = ['total', 'jumlah', 'tagihan', 'subtotal', 'sub total'];

const MERCHANT_NOISE = [
  'struk', 'nota', 'invoice', 'faktur', 'kwitansi', 'kasir', 'tanggal', 'jam',
  'npwp', 'telp', 'telpon', 'phone', 'alamat', 'jl', 'jalan', 'no.', 'no ',
  'member', 'pelanggan', 'terima kasih', 'selamat', 'www', 'http', 'npwp',
];

function clean(text) {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ubah potongan angka gaya struk ("25.000", "Rp 1.250.500", "25000,00") jadi integer. */
export function parseAmountToken(raw) {
  const text = String(raw ?? '').replace(/\s/g, '').replace(/[^\d.,]/g, '');
  if (!text) return 0;

  const dot = text.lastIndexOf('.');
  const comma = text.lastIndexOf(',');
  let normalized = text;

  if (dot >= 0 && comma >= 0) {
    // Pemisah terakhir dianggap desimal, sisanya pemisah ribuan.
    const decimalSep = dot > comma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    normalized = text.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? '.' : ',';
    const parts = text.split(sep);
    const last = parts[parts.length - 1];
    // "25.000" -> ribuan; "2500,00" -> desimal.
    normalized = (parts.length > 1 && last.length === 3)
      ? parts.join('')
      : `${parts.slice(0, -1).join('')}.${last}`;
  }

  const value = Number.parseFloat(normalized.replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function amountsIn(line) {
  const matches = String(line).match(/(?:rp\.?\s*)?\d[\d.,]*/gi) || [];
  return matches
    .map(parseAmountToken)
    .filter((value) => value >= 100 && value <= 1e12);
}

function hasAny(text, words) {
  const value = ` ${text.toLowerCase()} `;
  return words.some((word) => value.includes(` ${word} `));
}

const DATE_LIKE = /\d{1,2}:\d{2}|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b\d{1,2}-\d{1,2}(-\d{2,4})?\b/;

function lineAmount(line, words) {
  if (!hasAny(line, words)) return 0;
  const values = amountsIn(line);
  return values.length ? Math.max(...values) : 0;
}

function scoreTotalLine(line) {
  const lower = line.toLowerCase();
  if (!hasAny(lower, TOTAL_STRONG) && !hasAny(lower, TOTAL_SOFT)) return 0;
  let score = hasAny(lower, TOTAL_STRONG) ? 3 : 2;
  if (hasAny(lower, NOT_TOTAL) && !hasAny(lower, TOTAL_STRONG)) score -= 2;
  return score;
}

function parseDateFromText(text) {
  const value = String(text);

  const isoMatch = value.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoMatch) {
    const iso = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    if (isValidISODate(iso)) return iso;
  }

  const numeric = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const named = value.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})\b/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    let year = Number(named[3]);
    if (year < 100) year += 2000;
    if (month && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function findMerchant(lines) {
  for (const line of lines.slice(0, 6)) {
    const text = clean(line);
    if (text.length < 3 || text.length > 60) continue;
    if (!/[A-Za-z]{3}/.test(text)) continue;
    if (/\d{2}[:/.-]\d{2}/.test(text)) continue;
    if (hasAny(text, MERCHANT_NOISE)) continue;
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3) continue;
    return text.replace(/\s{2,}/g, ' ').slice(0, 60);
  }
  return '';
}

/** Tanggal dari model bisa ISO, dd/mm/yyyy, atau nama bulan; samakan ke ISO. */
export function normalizeReceiptDate(value, fallback = todayISO()) {
  const text = String(value || '').trim();
  if (isValidISODate(text)) return text;
  return parseDateFromText(text) || fallback;
}

/**
 * @param {string} rawText teks hasil OCR
 * @param {{today?: string}} [options]
 * @returns {{ok: boolean, amount: number, date: string, merchant: string, category: string, confidence: number, basis: string}}
 */
export function parseReceiptText(rawText, options = {}) {
  const today = options.today || todayISO();
  const lines = String(rawText ?? '')
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  let best = null;
  lines.forEach((line, index) => {
    const score = scoreTotalLine(line);
    if (!score) return;
    const values = amountsIn(line);
    if (!values.length) return;
    const amount = Math.max(...values);
    const candidate = { amount, score, index };
    if (!best
      || candidate.score > best.score
      || (candidate.score === best.score && candidate.index > best.index)) {
      best = candidate;
    }
  });

  let basis = 'kata kunci total';

  if (!best) {
    // Struk tanpa baris TOTAL: hitung dari uang dibayar dikurangi kembalian.
    const paid = lines.reduce((total, line) => total || lineAmount(line, PAY_WORDS), 0);
    const change = lines.reduce((total, line) => total || lineAmount(line, CHANGE_WORDS), 0);
    if (paid > 0 && change > 0 && paid > change) {
      basis = 'bayar dikurangi kembalian';
      best = { amount: paid - change, score: 0, index: 0 };
    }
  }

  if (!best) {
    // Masih kosong: pakai angka terbesar dari baris yang bukan kembalian/uang tunai.
    basis = 'angka terbesar';
    lines.forEach((line) => {
      if (hasAny(line, NOT_TOTAL)) return;
      if (DATE_LIKE.test(line)) return;
      const values = amountsIn(line);
      if (!values.length) return;
      const amount = Math.max(...values);
      if (!best || amount > best.amount) best = { amount, score: 0, index: 0 };
    });
  }

  const amount = best ? best.amount : 0;
  const date = parseDateFromText(String(rawText || '')) || today;
  const merchant = findMerchant(lines);
  const context = `${merchant} ${lines.slice(-6).join(' ')}`;
  const category = guessCategory('out', context);

  let confidence = 0;
  if (best && best.score >= 3) confidence += 0.5;
  else if (best && best.score === 2) confidence += 0.35;
  else if (amount) confidence += 0.2;
  if (parseDateFromText(String(rawText || ''))) confidence += 0.25;
  if (merchant) confidence += 0.25;
  if (!amount) confidence = 0;

  return {
    ok: amount > 0,
    amount,
    date,
    merchant,
    category,
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
    basis,
  };
}
