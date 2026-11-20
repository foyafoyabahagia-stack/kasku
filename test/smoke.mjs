// Uji logika inti tanpa dependensi eksternal: `npm test`

import { parseAmount, formatIDR, formatCompact } from '../netlify/functions/lib/amount.mjs';
import {
  todayISO, shiftMonth, monthsOfYear, monthLabel, parseDateToken,
  daysInMonth, isValidISODate, isValidMonth, shortDate,
} from '../netlify/functions/lib/dates.mjs';
import { guessCategory } from '../netlify/functions/lib/categories.mjs';
import { totals, byCategory, dailySeries, monthlySeries } from '../netlify/functions/lib/analytics.mjs';
import { parseEntry } from '../netlify/functions/lib/entry.mjs';
import { monthReportText, yearReportText, transactionText } from '../netlify/functions/lib/report.mjs';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`);
}

/* ---------- Nominal ---------- */
eq('parseAmount 35000', parseAmount('35000'), 35000);
eq('parseAmount 35.000', parseAmount('35.000'), 35000);
eq('parseAmount 35,000', parseAmount('35,000'), 35000);
eq('parseAmount 35rb', parseAmount('35rb'), 35000);
eq('parseAmount 35k', parseAmount('35k'), 35000);
eq('parseAmount 35 RIBU', parseAmount('35 RIBU'), 35000);
eq('parseAmount 1,5jt', parseAmount('1,5jt'), 1500000);
eq('parseAmount 2 juta', parseAmount('2 juta'), 2000000);
eq('parseAmount Rp 35.000', parseAmount('Rp 35.000'), 35000);
eq('parseAmount 1.250.000', parseAmount('1.250.000'), 1250000);
check('parseAmount sampah -> NaN', Number.isNaN(parseAmount('makan')));
check('parseAmount kosong -> NaN', Number.isNaN(parseAmount('')));
check('formatIDR 35000', formatIDR(35000).includes('35.000'), formatIDR(35000));
check('formatCompact 1500000', formatCompact(1500000).includes('jt'), formatCompact(1500000));

/* ---------- Tanggal ---------- */
check('todayISO format', /^\d{4}-\d{2}-\d{2}$/.test(todayISO('Asia/Jakarta')), todayISO('Asia/Jakarta'));
eq('shiftMonth Des -> Jan', shiftMonth('2026-01', -1), '2025-12');
eq('shiftMonth Nov -> Des', shiftMonth('2026-11', 1), '2026-12');
eq('monthsOfYear length', monthsOfYear(2026).length, 12);
eq('monthLabel', monthLabel('2026-11'), 'November 2026');
eq('daysInMonth Feb 2024', daysInMonth(2024, 2), 29);
eq('parseDateToken iso', parseDateToken('2026-11-18', '2026-11-20'), '2026-11-18');
eq('parseDateToken d/m', parseDateToken('18/11', '2026-11-20'), '2026-11-18');
eq('parseDateToken d-m-y', parseDateToken('18-11-2026', '2026-11-20'), '2026-11-18');
eq('parseDateToken invalid', parseDateToken('32/11/2026', '2026-11-20'), null);
check('isValidISODate 2026-02-30', isValidISODate('2026-02-30') === false);
check('isValidMonth 2026-13', isValidMonth('2026-13') === false);
eq('shortDate', shortDate('2026-11-18'), '18 Nov 2026');

/* ---------- Kategori ---------- */
eq('kategori makan', guessCategory('out', 'makan siang di warung'), 'Makan & Minum');
eq('kategori bensin', guessCategory('out', 'isi bensin pertamax'), 'Transport');
eq('kategori listrik', guessCategory('out', 'bayar listrik bulan ini'), 'Tagihan');
eq('kategori gaji', guessCategory('in', 'gaji november'), 'Gaji');
eq('kategori tak dikenal', guessCategory('out', 'sesuatu yang aneh'), 'Lainnya');

/* ---------- Input bot ---------- */
const a = parseEntry('35000 makan siang');
eq('entry amount', a.amount, 35000);
eq('entry note', a.note, 'makan siang');
check('entry tanpa tanggal -> null', a.date === null);

const b = parseEntry('35rb kopi 18/11');
eq('entry shorthand amount', b.amount, 35000);
eq('entry note kedua', b.note, 'kopi');
check('entry tanggal 18/11', /-11-18$/.test(String(b.date)), String(b.date));

const c = parseEntry('parkir 5000 #Transport');
eq('entry kategori manual', c.category, 'Transport');
eq('entry amount ketiga', c.amount, 5000);

const d = parseEntry('makan tanpa nominal');
check('entry tanpa nominal -> error', typeof d.error === 'string', JSON.stringify(d));

/* ---------- Analitik ---------- */
const items = [
  { type: 'in', amount: 5000000, category: 'Gaji', date: '2026-11-01' },
  { type: 'out', amount: 35000, category: 'Makan & Minum', date: '2026-11-02' },
  { type: 'out', amount: 65000, category: 'Makan & Minum', date: '2026-11-18' },
  { type: 'out', amount: 120000, category: 'Transport', date: '2026-11-18' },
];

const sum = totals(items);
eq('total income', sum.income, 5000000);
eq('total outcome', sum.outcome, 220000);
eq('total net', sum.net, 4780000);
eq('total count', sum.count, 4);

const cat = byCategory(items, 'out');
eq('kategori urut terbesar', cat.rows[0].name, 'Transport');
const makan = cat.rows.find((row) => row.name === 'Makan & Minum');
eq('kategori nilai', makan.amount, 100000);
check('kategori share', Math.abs(makan.share - 100000 / 220000) < 1e-9);

const daily = dailySeries(items, '2026-11');
eq('daily panjang', daily.length, 30);
eq('daily 2 Nov keluar', daily[1].out, 35000);
eq('daily 1 Nov masuk', daily[0].in, 5000000);

const monthly = monthlySeries(items, 2026);
eq('monthly panjang', monthly.length, 12);
eq('monthly Nov', monthly[10].out, 220000);

/* ---------- Teks laporan ---------- */
const report = monthReportText(items, '2026-11');
check('laporan memuat judul', report.includes('Laporan November 2026'), report);
check('laporan memuat masuk', report.includes('5.000.000'));
check('laporan memuat selisih', report.includes('4.780.000'));

const yearly = yearReportText(items, 2026);
check('rekap tahun memuat total', yearly.includes('Rekap Tahun 2026'));
check('rekap tahun memuat baris Nov', /\bNov\b/.test(yearly), yearly);

const txText = transactionText(items[1]);
check('teks transaksi', txText.includes('Pengeluaran tercatat') && txText.includes('Makan &amp; Minum'), txText);

const escaped = transactionText({ type: 'out', amount: 1000, category: '<b>X</b>', note: 'a & b', date: '2026-11-18' });
check('teks transaksi escape HTML', escaped.includes('&lt;b&gt;X&lt;/b&gt;') && escaped.includes('a &amp; b'), escaped);

/* ---------- Hasil ---------- */
if (failures.length) {
  console.error(`GAGAL: ${failures.length} pemeriksaan\n`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`OK: ${passed} pemeriksaan lulus`);
