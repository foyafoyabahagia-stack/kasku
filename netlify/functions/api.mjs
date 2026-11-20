// API dashboard KasKu. Satu function menangani semua route /api/*.

import crypto from 'node:crypto';
import {
  openStore, readMonth, readMonths, writeMonth, addTransaction,
  updateTransaction, removeTransaction, listMonths,
} from './lib/store.mjs';
import {
  isAuthenticated, checkPassword, createToken, sessionCookie, clearedCookie,
  isRateLimited, noteFailedAttempt, clearAttempts,
} from './lib/auth.mjs';
import { parseAmount } from './lib/amount.mjs';
import {
  todayISO, isValidISODate, isValidMonth, isValidYear, monthOf, monthLabel,
  monthsOfYear, prevMonth,
} from './lib/dates.mjs';
import { CATEGORIES, sanitizeCategory } from './lib/categories.mjs';
import { parseReceiptText } from './lib/receipt.mjs';
import { totals, byCategory, dailySeries, monthlySeries, flatten } from './lib/analytics.mjs';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function badRequest(message) {
  return json({ error: message }, 400);
}

async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function routePath(url) {
  let path = url.pathname
    .replace(/^\/\.netlify\/functions/, '')
    .replace(/^\/api/, '');
  if (!path) path = '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

function clientKey(request) {
  return request.headers.get('x-nf-client-connection-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
}

function newId() {
  return crypto.randomUUID();
}

async function loadAll(store) {
  const months = await listMonths(store);
  const map = await readMonths(store, months);
  return { months, map };
}

function balanceOf(map) {
  const sum = totals(flatten(map));
  return { income: sum.income, outcome: sum.outcome, balance: sum.net };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(items) {
  const rows = [['Tanggal', 'Tipe', 'Kategori', 'Keterangan', 'Nominal']];
  for (const item of items) {
    rows.push([
      item.date,
      item.type === 'in' ? 'Pemasukan' : 'Pengeluaran',
      item.category,
      item.note || '',
      String(item.amount),
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function validatePayload(body, existing = null) {
  const errors = [];
  const result = {};

  if (body.type !== undefined || !existing) {
    if (body.type !== 'in' && body.type !== 'out') errors.push('Tipe harus "in" atau "out".');
    else result.type = body.type;
  }

  if (body.amount !== undefined || !existing) {
    const amount = parseAmount(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) errors.push('Nominal tidak valid.');
    else result.amount = Math.round(amount);
  }

  if (body.date !== undefined || !existing) {
    const date = body.date || todayISO();
    if (!isValidISODate(date)) errors.push('Tanggal harus berformat YYYY-MM-DD.');
    else result.date = date;
  }

  if (body.note !== undefined || !existing) {
    result.note = String(body.note ?? '').trim().slice(0, 200);
  }

  if (body.category !== undefined || !existing) {
    const type = result.type || existing?.type || 'out';
    result.category = sanitizeCategory(type, body.category, result.note ?? existing?.note);
  }

  if (errors.length) return { errors };
  return { value: result };
}

export default async (request) => {
  const url = new URL(request.url);
  const path = routePath(url);
  const method = request.method.toUpperCase();

  try {
    if (path === '/health') {
      return json({
        ok: true,
        configured: Boolean(process.env.APP_PASSWORD),
        vision: Boolean(process.env.GEMINI_API_KEY),
        visionModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
        timezone: process.env.TZ || 'Asia/Jakarta',
        now: new Date().toISOString(),
      });
    }

    if (path === '/login' && method === 'POST') {
      const key = clientKey(request);
      if (isRateLimited(key)) {
        return json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' }, 429);
      }
      const body = await readJson(request);
      if (!checkPassword(body.password)) {
        noteFailedAttempt(key);
        await new Promise((resolve) => setTimeout(resolve, 350));
        return json({ error: 'Kata sandi salah.' }, 401);
      }
      clearAttempts(key);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(createToken()) });
    }

    if (path === '/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': clearedCookie() });
    }

    if (path === '/session') {
      return json({ authenticated: isAuthenticated(request) });
    }

    if (!isAuthenticated(request)) {
      return json({ error: 'Belum masuk.' }, 401);
    }

    const store = openStore();

    if (path === '/categories') {
      return json({ categories: CATEGORIES });
    }

    if (path === '/meta') {
      const months = await listMonths(store);
      const years = [...new Set(months.map((ym) => Number(ym.slice(0, 4))))];
      const currentYear = Number(todayISO().slice(0, 4));
      if (!years.includes(currentYear)) years.push(currentYear);
      years.sort((a, b) => b - a);
      return json({ months, years, today: todayISO(), timezone: process.env.TZ || 'Asia/Jakarta' });
    }

    if (path === '/receipt/parse' && method === 'POST') {
      const body = await readJson(request);
      const text = String(body.text || '').slice(0, 8000);
      if (!text.trim()) return badRequest('Teks struk kosong.');
      const parsed = parseReceiptText(text);
      return json(parsed);
    }

    if (path === '/summary') {
      const { months, map } = await loadAll(store);
      const allTime = balanceOf(map);
      const monthParam = url.searchParams.get('month');
      const yearParam = url.searchParams.get('year');

      if (monthParam) {
        if (!isValidMonth(monthParam)) return badRequest('Format bulan harus YYYY-MM.');
        const items = map.get(monthParam) || [];
        const sum = totals(items);
        const previous = map.get(prevMonth(monthParam)) || [];
        const prevSum = totals(previous);
        const categoriesAll = byCategory(items, 'out');
        return json({
          scope: 'month',
          month: monthParam,
          label: monthLabel(monthParam),
          totals: sum,
          prev: { income: prevSum.income, outcome: prevSum.outcome },
          categories: categoriesAll.rows,
          daily: dailySeries(items, monthParam),
          allTime,
          months
        });
      }

      const year = yearParam ? Number(yearParam) : Number(todayISO().slice(0, 4));
      if (!isValidYear(year)) return badRequest('Tahun tidak valid.');
      const yearMonths = monthsOfYear(year);
      const items = yearMonths.flatMap((ym) => map.get(ym) || []);
      const sum = totals(items);
      const categoriesAll = byCategory(items, 'out');
      return json({
        scope: 'year',
        year,
        label: `Tahun ${year}`,
        totals: sum,
        categories: categoriesAll.rows,
        monthly: monthlySeries(items, year),
        allTime,
        months
      });
    }

    if (path === '/transactions' && method === 'GET') {
      const monthParam = url.searchParams.get('month');
      const yearParam = url.searchParams.get('year');
      const type = url.searchParams.get('type') || '';
      const category = url.searchParams.get('category') || '';
      const query = (url.searchParams.get('q') || '').toLowerCase().trim();
      const limit = Math.min(Number(url.searchParams.get('limit')) || 300, 1000);

      let sourceMonths;
      if (monthParam) {
        if (!isValidMonth(monthParam)) return badRequest('Format bulan harus YYYY-MM.');
        sourceMonths = [monthParam];
      } else if (yearParam) {
        sourceMonths = monthsOfYear(Number(yearParam));
      } else {
        sourceMonths = await listMonths(store);
      }

      const map = await readMonths(store, sourceMonths);
      let items = flatten(map);
      if (type === 'in' || type === 'out') items = items.filter((item) => item.type === type);
      if (category) items = items.filter((item) => item.category === category);
      if (query) {
        items = items.filter((item) => `${item.note || ''} ${item.category}`.toLowerCase().includes(query));
      }

      items.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });

      const sum = totals(items);
      return json({
        items: items.slice(0, limit),
        total: items.length,
        sum: { income: sum.income, outcome: sum.outcome, net: sum.net },
      });
    }

    if (path === '/transactions' && method === 'POST') {
      const body = await readJson(request);
      const checked = validatePayload(body);
      if (checked.errors) return json({ error: checked.errors.join(' ') }, 400);
      const now = new Date().toISOString();
      const tx = {
        id: newId(),
        ...checked.value,
        source: 'web',
        createdAt: now,
        updatedAt: now,
      };
      await addTransaction(store, tx);
      return json({ transaction: tx }, 201);
    }

    const idMatch = path.match(/^\/transactions\/([A-Za-z0-9-]{8,64})$/);
    if (idMatch) {
      const id = idMatch[1];
      if (method === 'PATCH' || method === 'PUT') {
        const body = await readJson(request);
        const monthParam = body.month || url.searchParams.get('month');
        if (!isValidMonth(monthParam)) return badRequest('Parameter month wajib diisi (YYYY-MM).');
        const items = await readMonth(store, monthParam);
        const existing = items.find((item) => item.id === id);
        if (!existing) return json({ error: 'Transaksi tidak ditemukan.' }, 404);
        const checked = validatePayload(body, existing);
        if (checked.errors) return json({ error: checked.errors.join(' ') }, 400);
        const updated = await updateTransaction(store, monthParam, id, checked.value);
        return json({ transaction: updated });
      }

      if (method === 'DELETE') {
        const monthParam = url.searchParams.get('month');
        if (!isValidMonth(monthParam)) return badRequest('Parameter month wajib diisi (YYYY-MM).');
        const removed = await removeTransaction(store, monthParam, id);
        if (!removed) return json({ error: 'Transaksi tidak ditemukan.' }, 404);
        return json({ ok: true, removed });
      }
    }

    if (path === '/export' && method === 'GET') {
      const monthParam = url.searchParams.get('month');
      const yearParam = url.searchParams.get('year');
      const map = monthParam
        ? await readMonths(store, [monthParam])
        : await readMonths(store, monthsOfYear(Number(yearParam || todayISO().slice(0, 4))));
      const items = flatten(map).sort((a, b) => (a.date < b.date ? -1 : 1));
      if (!items.length) return json({ error: 'Tidak ada transaksi untuk periode ini.' }, 404);
      const suffix = monthParam || yearParam || items[0].date.slice(0, 4);
      return new Response(buildCsv(items), {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="kasku-${suffix}.csv"`,
          'cache-control': 'no-store',
        },
      });
    }

    if (path === '/seed-demo' && method === 'POST') {
      // Berguna untuk mencoba tampilan tanpa data asli.
      const ym = monthOf(todayISO());
      const existing = await readMonth(store, ym);
      if (existing.length) return json({ ok: false, message: 'Bulan ini sudah ada data.' });
      const { year, month } = { year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)) };
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const samples = [
        ['in', 8500000, 'Gaji bulanan', 'Gaji'],
        ['out', 1500000, 'Sewa kos', 'Rumah'],
        ['out', 850000, 'Belanja bulanan', 'Belanja'],
        ['out', 120000, 'Bensin', 'Transport'],
        ['out', 45000, 'Makan siang', 'Makan & Minum'],
        ['out', 250000, 'Listrik dan air', 'Tagihan'],
        ['in', 750000, 'Proyek freelance', 'Usaha'],
        ['out', 180000, 'Kopi dan jajan', 'Makan & Minum'],
        ['out', 300000, 'Vitamin', 'Kesehatan'],
        ['out', 99000, 'Langganan streaming', 'Tagihan'],
      ];
      const items = samples.map(([type, amount, note, category], index) => ({
        id: newId(),
        type,
        amount,
        note,
        category,
        date: `${ym}-${String(Math.min(days, 2 + index * 2)).padStart(2, '0')}`,
        source: 'demo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      await writeMonth(store, ym, items);
      return json({ ok: true, created: items.length });
    }

    return json({ error: 'Endpoint tidak ditemukan.' }, 404);
  } catch (error) {
    console.error('API error', error);
    return json({ error: 'Terjadi kesalahan di server.' }, 500);
  }
};
