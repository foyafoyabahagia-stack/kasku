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
