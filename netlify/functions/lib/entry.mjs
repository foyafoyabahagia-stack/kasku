// Parsing input bebas dari Telegram: nominal, keterangan, tanggal, #kategori.

import { parseAmount, looksLikeAmount } from './amount.mjs';
import { parseDateToken } from './dates.mjs';

/**
 * Contoh: "35rb makan siang 18/11 #Makan_&_Minum"
 * -> { amount: 35000, note: "makan siang", date: "2026-11-18", category: "Makan & Minum" }
 */
export function parseEntry(rest) {
  const tokens = String(rest || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return { error: 'Format: /keluar 35000 makan siang' };

  let date = null;
  const parsedDate = parseDateToken(tokens[tokens.length - 1]);
  if (parsedDate) {
    date = parsedDate;
    tokens.pop();
  }

  let category = '';
  const noteParts = [];
  let amount = NaN;

  for (const token of tokens) {
    if (token.startsWith('#') && token.length > 1 && !category) {
      category = token.slice(1).replace(/_/g, ' ');
      continue;
    }
    if (!Number.isFinite(amount) && looksLikeAmount(token)) {
      const value = parseAmount(token);
      if (Number.isFinite(value) && value > 0) {
        amount = value;
        continue;
      }
    }
    noteParts.push(token);
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'Nominal tidak ditemukan atau tidak valid. Contoh: /keluar 35000 makan siang' };
  }
  if (amount > 1e13) {
    return { error: 'Nominal terlalu besar.' };
  }

  return {
    amount,
    note: noteParts.join(' ').slice(0, 200),
    date,
    category: category.slice(0, 40),
  };
}

// Kata yang menandakan arah transaksi pada kalimat bebas.
const INCOME_WORDS = new Set([
  'masuk', 'masukin', 'pemasukan', 'terima', 'diterima', 'dapat', 'cair',
  'income', 'in', 'pendapatan', 'gaji', 'bonus', 'thr', 'komisi', 'refund',
]);

const EXPENSE_WORDS = new Set([
  'keluar', 'keluarin', 'pengeluaran', 'out', 'belanja', 'beli', 'bayar',
  'bayarin', 'jajan', 'makan', 'minum', 'kopi', 'bensin', 'parkir', 'topup',
  'isi', 'transfer', 'donasi', 'sedekah',
]);

// Kata yang dibuang dari keterangan karena hanya penanda arah.
const STRIP_WORDS = new Set(['masuk', 'masukin', 'pemasukan', 'keluar', 'keluarin', 'pengeluaran']);

/**
 * Kalimat bebas tanpa perintah, contoh:
 * "masuk gaji 50k"  -> { type: 'in',  amount: 50000, note: 'gaji' }
 * "kopi 25rb"       -> { type: 'out', amount: 25000, note: 'kopi' }
 */
export function parseNatural(text) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'Belum ada isinya. Contoh: kopi 25rb atau masuk gaji 5jt.' };

  const words = raw.split(/\s+/);
  const first = words[0].toLowerCase();
  const pair = words.slice(0, 2).join(' ').toLowerCase();

  let type = 'out';
  let explicit = false;
  let rest = raw;

  if (pair === 'uang masuk' || pair === 'uang keluar') {
    type = pair === 'uang masuk' ? 'in' : 'out';
    explicit = true;
    rest = words.slice(2).join(' ');
  } else if (INCOME_WORDS.has(first)) {
    type = 'in';
    explicit = true;
    if (STRIP_WORDS.has(first)) rest = words.slice(1).join(' ');
  } else if (EXPENSE_WORDS.has(first)) {
    explicit = true;
    if (STRIP_WORDS.has(first)) rest = words.slice(1).join(' ');
  }

  const parsed = parseEntry(rest);
  if (parsed.error) {
    return { error: 'Nominalnya belum ada. Contoh: kopi 25rb, bensin 50rb, masuk gaji 5jt.' };
  }
  return { ...parsed, type, explicit };
}
