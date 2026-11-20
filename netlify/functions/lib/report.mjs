// Penyusun teks laporan untuk bot Telegram (HTML).

import { formatIDR } from './amount.mjs';
import { BULAN, monthLabel, shortDate } from './dates.mjs';
import { byCategory, totals } from './analytics.mjs';
import { escapeHtml } from './telegram-api.mjs';

const LINE = '────────────────';

function signed(amount, type) {
  return `${type === 'in' ? '+' : '-'}${formatIDR(amount)}`;
}

export function transactionText(tx) {
  const label = tx.type === 'in' ? 'Pemasukan' : 'Pengeluaran';
  return [
    `<b>${label} tercatat</b>`,
    `${signed(tx.amount, tx.type)}`,
    `Kategori: ${escapeHtml(tx.category)}`,
    tx.note ? `Catatan: ${escapeHtml(tx.note)}` : null,
    `Tanggal: ${shortDate(tx.date)}`,
  ].filter(Boolean).join('\n');
}

export function monthReportText(items, ym) {
  const sum = totals(items);
  const categories = byCategory(items, 'out').rows.slice(0, 5);
  const rows = [
    `<b>Laporan ${monthLabel(ym)}</b>`,
    LINE,
    `Masuk      ${formatIDR(sum.income)}`,
    `Keluar     ${formatIDR(sum.outcome)}`,
    `Selisih    ${formatIDR(sum.net)}${sum.net >= 0 ? ' (surplus)' : ' (defisit)'}`,
    `Transaksi  ${sum.count}`,
  ];
  if (categories.length) {
    rows.push('', '<b>Pengeluaran terbesar</b>');
    categories.forEach((row, index) => {
      rows.push(`${index + 1}. ${escapeHtml(row.name)} - ${formatIDR(row.amount)} (${Math.round(row.share * 100)}%)`);
    });
  } else {
    rows.push('', 'Belum ada pengeluaran bulan ini.');
  }
  return rows.join('\n');
}

export function yearReportText(items, year) {
  const sum = totals(items);
  const lines = [
    `<b>Rekap Tahun ${year}</b>`,
    LINE,
    `Masuk      ${formatIDR(sum.income)}`,
    `Keluar     ${formatIDR(sum.outcome)}`,
    `Selisih    ${formatIDR(sum.net)}`,
    LINE,
  ];
  for (let month = 1; month <= 12; month += 1) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const monthItems = items.filter((item) => item.date.slice(0, 7) === ym);
    const monthSum = totals(monthItems);
    if (!monthSum.count) continue;
    lines.push(
      `${BULAN[month - 1].slice(0, 3).padEnd(3, ' ')}  +${formatIDR(monthSum.income)}  -${formatIDR(monthSum.outcome)}  (${monthSum.count})`,
    );
  }
  if (!sum.count) lines.push('Belum ada transaksi di tahun ini.');
  return lines.join('\n');
}

export function balanceText(allTime, todayTx, ym) {
  const label = monthLabel(ym);
  const rows = [
    '<b>Saldo saat ini</b>',
    LINE,
    `<b>${formatIDR(allTime.balance)}</b>`,
    '',
    `${label}: masuk ${formatIDR(todayTx.income)}, keluar ${formatIDR(todayTx.outcome)}`,
  ];
  return rows.join('\n');
}

export function receiptText(result) {
  const confidence = Math.round((Number(result.confidence) || 0) * 100);
  const rows = [
    '<b>Hasil scan struk</b>',
    LINE,
    result.merchant ? `Toko      ${escapeHtml(result.merchant)}` : null,
    result.note ? `Isi       ${escapeHtml(result.note)}` : null,
    `Total     <b>${formatIDR(result.amount)}</b>`,
    `Tanggal   ${shortDate(result.date)}`,
    `Kategori  ${escapeHtml(result.category)}`,
    `Keyakinan ${confidence}%`,
    '',
    'Periksa dulu. Tekan <b>Simpan</b> kalau sudah benar.',
  ];
  return rows.filter((row) => row !== null).join('\n');
}

export const HELP_TEXT = [
  '<b>KasKu - bot keuangan</b>',
  '',
  'Tanpa perintah juga bisa:',
  'kopi 25rb  -> pengeluaran',
  'masuk gaji 5jt  -> pemasukan',
  'beli bensin 50rb 18/11  -> pengeluaran bertanggal',
  '',
  'Perintah yang tersedia:',
  '/masuk 500000 gaji november',
  '/keluar 35000 makan siang',
  '/keluar 35rb kopi 18/11',
  '/saldo',
  '/laporan',
  '/laporan 10',
  '/laporan 10 2026',
  '/laporan 2026',
  '/tahun',
  '/undo',
  '',
  'Scan struk: kirim foto struk, bot membaca nominalnya lalu menawarkan tombol Simpan.',
  '',
  'Catatan:',
  '- Nominal bisa ditulis 35000, 35rb, 35k, 1,5jt.',
  '- Tanggal opsional di akhir pesan: 2026-11-18 atau 18/11.',
].join('\n');
