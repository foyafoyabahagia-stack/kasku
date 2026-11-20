// Uji logika inti tanpa dependensi eksternal: `npm test`

import { parseAmount, formatIDR, formatCompact } from '../netlify/functions/lib/amount.mjs';
import {
  todayISO, shiftMonth, monthsOfYear, monthLabel, parseDateToken,
  daysInMonth, isValidISODate, isValidMonth, shortDate,
} from '../netlify/functions/lib/dates.mjs';
import { guessCategory } from '../netlify/functions/lib/categories.mjs';
import { totals, byCategory, dailySeries, monthlySeries } from '../netlify/functions/lib/analytics.mjs';
import { parseEntry, parseNatural } from '../netlify/functions/lib/entry.mjs';
import { monthReportText, yearReportText, transactionText, receiptText } from '../netlify/functions/lib/report.mjs';
import { parseReceiptText, parseAmountToken } from '../netlify/functions/lib/receipt.mjs';

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

/* ---------- Parser struk ---------- */
eq('token 25.000', parseAmountToken('25.000'), 25000);
eq('token Rp 1.250.500', parseAmountToken('Rp 1.250.500'), 1250500);
eq('token 25000,00', parseAmountToken('25000,00'), 25000);
eq('token 1,234,567', parseAmountToken('1,234,567'), 1234567);
eq('token 87.500', parseAmountToken('87.500'), 87500);

const strukIndomaret = `INDOMARET
JL SUDIRMAN NO 12
TELP 021-5551234
18/11/2026 19:42

SUSU UHT 1L      18.500
ROTI TAWAR       15.000
SABUN MANDI      12.000
TOTAL            45.500
TUNAI            50.000
KEMBALI           4.500
TERIMA KASIH`;

const struk = parseReceiptText(strukIndomaret, { today: '2026-11-20' });
eq('struk: total bayar', struk.amount, 45500);
eq('struk: tanggal', struk.date, '2026-11-18');
eq('struk: merchant', struk.merchant, 'INDOMARET');
eq('struk: kategori', struk.category, 'Belanja');
check('struk: ok', struk.ok === true);

const strukGrand = `TOKO BANGUNAN JAYA
20/11/2026
SUBTOTAL        250.000
DISKON           10.000
GRAND TOTAL     240.000
BAYAR           250.000
KEMBALI          10.000`;
const grand = parseReceiptText(strukGrand, { today: '2026-11-20' });
eq('grand total menang dari subtotal', grand.amount, 240000);

const strukTanpaKata = `WARUNG PAK BUDI
18/11/2026
NASI GORENG   25.000
ES TEH         5.000
BAYAR         50.000
KEMBALI       20.000`;
const tanpaKata = parseReceiptText(strukTanpaKata, { today: '2026-11-20' });
eq('tanpa kata total: bayar dikurangi kembalian', tanpaKata.amount, 30000);

const strukHanyaItem = `TOKO KECIL
18/11/2026
KOPI        15.000
ROTI        12.000
GULA         8.000`;
const hanyaItem = parseReceiptText(strukHanyaItem, { today: '2026-11-20' });
eq('tanpa total & tanpa bayar: angka terbesar', hanyaItem.amount, 15000);
eq('tanpa kata total: kategori makan', tanpaKata.category, 'Makan & Minum');

const strukApotek = `APOTEK SEHAT
18 November 2026
PARACETAMOL   15.000
TOTAL         15.000`;
const apotek = parseReceiptText(strukApotek, { today: '2026-11-20' });
eq('tanggal nama bulan', apotek.date, '2026-11-18');
eq('kategori apotek', apotek.category, 'Kesehatan');

const strukKosong = parseReceiptText('', { today: '2026-11-20' });
check('struk kosong tidak ok', strukKosong.ok === false && strukKosong.amount === 0);
eq('struk kosong pakai tanggal hari ini', strukKosong.date, '2026-11-20');

const receiptMessage = receiptText({
  merchant: 'Indomaret', amount: 45500, date: '2026-11-18',
  category: 'Belanja', confidence: 1, note: 'belanja harian',
});
check('teks scan memuat total', receiptMessage.includes('45.500'), receiptMessage);
check('teks scan memuat tombol simpan', receiptMessage.includes('Simpan'), receiptMessage);

/* ---------- Kalimat bebas (tanpa perintah) ---------- */
const naturalIncome = parseNatural('masuk gaji 50k');
eq('bebas: masuk gaji 50k nominal', naturalIncome.amount, 50000);
eq('bebas: masuk gaji 50k arah', naturalIncome.type, 'in');
eq('bebas: kata masuk dibuang dari keterangan', naturalIncome.note, 'gaji');

const naturalCoffee = parseNatural('kopi 25rb');
eq('bebas: kopi 25rb nominal', naturalCoffee.amount, 25000);
eq('bebas: kopi 25rb arah', naturalCoffee.type, 'out');
check('bebas: kopi dikenali sebagai pengeluaran', naturalCoffee.explicit === true);

const naturalAngkaSaja = parseNatural('25000');
eq('bebas: angka saja jadi pengeluaran', naturalAngkaSaja.type, 'out');
check('bebas: angka saja tanpa kata kunci', naturalAngkaSaja.explicit === false);

const naturalGaji = parseNatural('gaji 5jt');
eq('bebas: gaji otomatis pemasukan', naturalGaji.type, 'in');

const naturalBelanja = parseNatural('beli bensin 50rb 18/11');
eq('bebas: beli bensin nominal', naturalBelanja.amount, 50000);
eq('bebas: beli bensin arah', naturalBelanja.type, 'out');
eq('bebas: tanggal ikut terbaca', naturalBelanja.date, '2026-11-18');

const naturalUangMasuk = parseNatural('uang masuk jualan 75000');
eq('bebas: uang masuk jadi pemasukan', naturalUangMasuk.type, 'in');
eq('bebas: uang masuk nominal', naturalUangMasuk.amount, 75000);

const naturalTanpaNominal = parseNatural('makan siang tadi');
check('bebas: tanpa nominal ditolak', /Nominalnya belum ada/.test(naturalTanpaNominal.error || ''));

/* ---------- Hasil ---------- */
if (failures.length) {
  console.error(`GAGAL: ${failures.length} pemeriksaan\n`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`OK: ${passed} pemeriksaan lulus`);
