// Perhitungan laporan: total, kategori, seri harian/bulanan.

import { daysInMonth, monthParts, monthsOfYear, BULAN_SINGKAT } from './dates.mjs';

export function totals(items) {
  let income = 0;
  let outcome = 0;
  for (const item of items) {
    if (item.type === 'in') income += item.amount;
    else outcome += item.amount;
  }
  return { income, outcome, net: income - outcome, count: items.length };
}

/** Kelompokkan pengeluaran per kategori, urut terbesar. */
export function byCategory(items, type = 'out') {
  const map = new Map();
  let total = 0;
  for (const item of items) {
    if (item.type !== type) continue;
    total += item.amount;
    map.set(item.category, (map.get(item.category) || 0) + item.amount);
  }
  const rows = [...map.entries()]
    .map(([name, amount]) => ({ name, amount, share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { rows, total };
}

/** Seri harian untuk satu bulan (lengkap 1..akhir bulan). */
export function dailySeries(items, ym) {
  const { year, month } = monthParts(ym);
  const days = daysInMonth(year, month);
  const buckets = Array.from({ length: days }, (_, i) => ({
    label: String(i + 1),
    in: 0,
    out: 0,
  }));
  for (const item of items) {
    const day = Number(item.date.slice(8, 10));
    if (day >= 1 && day <= days) {
      if (item.type === 'in') buckets[day - 1].in += item.amount;
      else buckets[day - 1].out += item.amount;
    }
  }
  return buckets;
}

/** Seri 12 bulan untuk satu tahun. */
export function monthlySeries(items, year) {
  return monthsOfYear(year).map((ym, index) => {
    const monthItems = items.filter((item) => item.date.slice(0, 7) === ym);
    const sum = totals(monthItems);
    return {
      label: BULAN_SINGKAT[index],
      ym,
      in: sum.income,
      out: sum.outcome,
      net: sum.net,
      count: sum.count,
    };
  });
}

/** Gabungkan transaksi per bulan menjadi satu daftar datar. */
export function flatten(monthsMap) {
  const all = [];
  for (const items of monthsMap.values()) all.push(...items);
  return all;
}
