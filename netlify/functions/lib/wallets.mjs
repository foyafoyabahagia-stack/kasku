// Dompet (tunai, e-wallet, bank) dan hitung saldo dari transaksi.

export const WALLET_KEY = 'settings/wallets';

export const DEFAULT_WALLETS = [
  { id: 'cash', name: 'Tunai' },
  { id: 'gopay', name: 'GoPay' },
  { id: 'ovo', name: 'OVO' },
  { id: 'dana', name: 'DANA' },
  { id: 'shopeepay', name: 'ShopeePay' },
];

export const MAX_WALLETS = 12;

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function slug(value) {
  return cleanName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
}

export async function getWallets(store) {
  const doc = await store.get(WALLET_KEY, { type: 'json' });
  if (!doc) return DEFAULT_WALLETS.map((wallet) => ({ ...wallet }));
  const items = Array.isArray(doc.items) ? doc.items : [];
  return items
    .filter((wallet) => wallet && typeof wallet.id === 'string' && wallet.id && cleanName(wallet.name))
    .map((wallet) => ({
      id: wallet.id,
      name: cleanName(wallet.name),
      createdAt: wallet.createdAt || null,
    }));
}

export async function saveWallets(store, wallets) {
  await store.setJSON(WALLET_KEY, { items: wallets, updatedAt: new Date().toISOString() });
}

export function newWallet(name, wallets) {
  const clean = cleanName(name);
  if (clean.length < 1) return { error: 'Nama dompet wajib diisi.' };
  if (wallets.length >= MAX_WALLETS) return { error: `Maksimal ${MAX_WALLETS} dompet.` };
  if (wallets.some((wallet) => wallet.name.toLowerCase() === clean.toLowerCase())) {
    return { error: 'Nama dompet sudah ada.' };
  }
  const base = slug(clean) || 'dompet';
  let id = base;
  let counter = 2;
  while (wallets.some((wallet) => wallet.id === id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return { wallet: { id, name: clean, createdAt: new Date().toISOString() } };
}

/** Dompet bawaan untuk transaksi tanpa wallet: "cash" bila ada, kalau tidak yang pertama. */
export function defaultWalletId(wallets) {
  if (wallets.some((wallet) => wallet.id === 'cash')) return 'cash';
  return wallets[0]?.id || 'cash';
}

/**
 * Id dompet dari nilai bebas (nama atau id). Hasil null berarti tidak dikenal.
 * Nilai kosong memakai dompet bawaan.
 */
export function resolveWalletId(wallets, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return defaultWalletId(wallets);
  const lower = raw.toLowerCase();
  const found = wallets.find((wallet) => wallet.id.toLowerCase() === lower)
    || wallets.find((wallet) => wallet.name.toLowerCase() === lower);
  return found ? found.id : null;
}

export function walletName(wallets, id) {
  const found = wallets.find((wallet) => wallet.id === id);
  return found ? found.name : '';
}

/** Saldo tiap dompet dihitung dari transaksi (pemasukan − pengeluaran). */
export function walletBalances(items, wallets) {
  const fallback = defaultWalletId(wallets);
  const rows = wallets.map((wallet) => ({
    id: wallet.id,
    name: wallet.name,
    income: 0,
    outcome: 0,
    balance: 0,
    count: 0,
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const tx of items || []) {
    const id = resolveWalletId(wallets, tx.wallet) || fallback;
    const row = byId.get(id);
    if (!row) continue;
    if (tx.type === 'in') row.income += Number(tx.amount) || 0;
    else row.outcome += Number(tx.amount) || 0;
    row.count += 1;
  }

  for (const row of rows) row.balance = row.income - row.outcome;
  return rows;
}

/** Selisih antara saldo nyata (dari aplikasi dompet) dan saldo tercatat. */
export function syncAdjustment(current, target, name) {
  const diff = Math.round(Number(target) || 0) - Math.round(Number(current) || 0);
  if (!diff) return null;
  return {
    type: diff > 0 ? 'in' : 'out',
    amount: Math.abs(diff),
    note: `Sinkron saldo ${cleanName(name) || 'dompet'}`,
  };
}

export function walletTag(text) {
  const match = String(text || '').match(/(^|\s)@([A-Za-z0-9_-]{2,24})/);
  if (!match) return { text: String(text || ''), tag: '' };
  const cleaned = String(text).replace(match[0], ' ').replace(/\s+/g, ' ').trim();
  return { text: cleaned, tag: match[2] };
}
