// Lapisan penyimpanan di Netlify Blobs.
// Satu blob per bulan: key "tx/YYYY-MM" -> { items: [...] }. Kecil, cepat, atomik per operasi.

import { getStore } from '@netlify/blobs';

export const STORE_NAME = 'kasku';

export function openStore() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

export function monthKey(ym) {
  return `tx/${ym}`;
}

export async function readMonth(store, ym) {
  const blob = await store.get(monthKey(ym), { type: 'json' });
  if (!blob || !Array.isArray(blob.items)) return [];
  return blob.items;
}

export async function writeMonth(store, ym, items) {
  await store.setJSON(monthKey(ym), {
    items,
    updatedAt: new Date().toISOString(),
  });
}

function sortItems(items) {
  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

export async function addTransaction(store, tx) {
  const ym = tx.date.slice(0, 7);
  const items = await readMonth(store, ym);
  items.push(tx);
  await writeMonth(store, ym, sortItems(items));
  return tx;
}

export async function updateTransaction(store, ym, id, patch) {
  const items = await readMonth(store, ym);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const updated = { ...items[index], ...patch, id, updatedAt: new Date().toISOString() };
  const newYm = updated.date.slice(0, 7);
  if (newYm === ym) {
    items[index] = updated;
    await writeMonth(store, ym, sortItems(items));
  } else {
    items.splice(index, 1);
    await writeMonth(store, ym, items);
    const target = await readMonth(store, newYm);
    target.push(updated);
    await writeMonth(store, newYm, sortItems(target));
  }
  return updated;
}

export async function removeTransaction(store, ym, id) {
  const items = await readMonth(store, ym);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const [removed] = items.splice(index, 1);
  await writeMonth(store, ym, items);
  return removed;
}

/** Kumpulan key blob dengan prefix tertentu. */
export async function listKeys(store, prefix) {
  const keys = [];
  const push = (blob) => {
    if (blob && typeof blob.key === 'string') keys.push(blob.key);
  };

  try {
    // `paginate: true` mengembalikan async iterator berisi halaman ({ blobs }), bukan blob tunggal.
    for await (const page of store.list({ prefix, paginate: true })) {
      if (page && Array.isArray(page.blobs)) page.blobs.forEach(push);
      else push(page);
    }
  } catch {
    const result = await store.list({ prefix });
    (result.blobs || []).forEach(push);
  }

  return [...new Set(keys)];
}

/** Daftar bulan yang punya data, terbaru lebih dulu -> ["2026-11", ...] */
export async function listMonths(store) {
  const keys = await listKeys(store, 'tx/');
  const months = keys
    .map((key) => key.slice(3))
    .filter((ym) => /^\d{4}-(0[1-9]|1[0-2])$/.test(ym));
  return [...new Set(months)].sort().reverse();
}

/** Baca beberapa bulan sekaligus -> Map(ym -> items) */
export async function readMonths(store, months) {
  const entries = await Promise.all(
    months.map(async (ym) => [ym, await readMonth(store, ym)]),
  );
  return new Map(entries);
}

/** Cari transaksi berdasarkan id di antara bulan-bulan tertentu. */
export async function findTransaction(store, id, months) {
  const docs = await readMonths(store, months);
  for (const [ym, items] of docs) {
    const found = items.find((item) => item.id === id);
    if (found) return { ym, tx: found };
  }
  return null;
}

/** Transaksi terbaru dari beberapa bulan (untuk /undo). */
export async function latestTransaction(store, months) {
  const docs = await readMonths(store, months);
  let best = null;
  for (const [ym, items] of docs) {
    for (const item of items) {
      if (!best) {
        best = { ym, tx: item };
        continue;
      }
      const a = `${item.date}T${item.createdAt || ''}`;
      const b = `${best.tx.date}T${best.tx.createdAt || ''}`;
      if (a > b) best = { ym, tx: item };
    }
  }
  return best;
}
