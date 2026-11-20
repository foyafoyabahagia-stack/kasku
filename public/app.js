// KasKu dashboard — tanpa framework, tanpa build step.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const PALETTE = ['#0f766e', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#94a3b8'];

const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
});

const state = {
  authed: false,
  meta: null,
  scope: 'month',
  month: '',
  year: 0,
  summary: null,
  list: { items: [], total: 0, sum: { income: 0, outcome: 0, net: 0 } },
  filters: { q: '', type: '', category: '' },
  visible: 100,
  categories: { in: [], out: [] },
  wallets: [],
  walletsMax: 12,
  syncTarget: null,
  editing: null,
  formType: 'out',
};

const WALLET_PRESETS = ['GoPay', 'OVO', 'DANA', 'ShopeePay', 'Bank Jago', 'SeaBank', 'Jenius'];

/* ---------- Utilitas ---------- */

function money(value) {
  return idr.format(Number(value) || 0).replace(/\u00a0/g, ' ');
}

function compact(value) {
  const n = Math.abs(Number(value) || 0);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',')} M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} jt`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.', ',')} rb`;
  return String(Math.round(n));
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function localISO(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function shiftMonth(ym, delta) {
  const [year, month] = ym.split('-').map(Number);
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function shortDate(date) {
  const day = Number(date.slice(8, 10));
  const month = Number(date.slice(5, 7));
  return `${day} ${BULAN_SINGKAT[month - 1]}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });

  if (response.status === 401) {
    showLogin();
    throw new Error('Sesi berakhir. Silakan masuk kembali.');
  }

  if (!response.ok) {
    let message = 'Terjadi kesalahan.';
    try {
      const data = await response.json();
      if (data && data.error) message = data.error;
    } catch { /* abaikan */ }
    throw new Error(message);
  }

  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.text();
}

let toastTimer = null;
function toast(message, kind = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${kind === 'error' ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------- Sesi & tampilan awal ---------- */

function showLogin() {
  state.authed = false;
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
  const input = $('#password');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 60);
  }
}

async function boot() {
  applyTheme(localStorage.getItem('kasku-theme') || 'light');
  bindStaticEvents();

  try {
    const session = await api('/api/session');
    if (session.authenticated) await startApp();
    else showLogin();
  } catch {
    showLogin();
  }
}

async function startApp() {
  state.authed = true;
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#app').hidden = false;

  try {
    const [catData, meta] = await Promise.all([api('/api/categories'), api('/api/meta')]);
    state.categories = catData.categories;
    state.meta = meta;

    const today = meta.today || localISO();
    state.year = Number(today.slice(0, 4));
    state.month = today.slice(0, 7);

    buildPeriodControls();
    buildCategoryOptions();
    buildFilterCategories();
    await refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------- Kontrol periode ---------- */

function buildPeriodControls() {
  const monthSelect = $('#sel-month');
  const yearSelect = $('#sel-year');
  const years = new Set(state.meta.years || []);
  years.add(state.year);
  for (let y = state.year - 2; y <= state.year + 1; y += 1) years.add(y);

  yearSelect.innerHTML = [...years]
    .sort((a, b) => b - a)
    .map((year) => `<option value="${year}">${year}</option>`)
    .join('');

  monthSelect.innerHTML = [
    '<option value="">Rekap setahun</option>',
    ...BULAN.map((name, index) => {
      const value = String(index + 1).padStart(2, '0');
      return `<option value="${value}">${name}</option>`;
    }),
  ].join('');

  monthSelect.value = state.month.slice(5, 7);
  yearSelect.value = String(state.year);
  markQuickActive();
}

function markQuickActive() {
  const today = localISO();
  const currentMonth = today.slice(0, 7);
  const previousMonth = shiftMonth(currentMonth, -1);
  const map = {
    'current-month': state.scope === 'month' && state.month === currentMonth,
    'last-month': state.scope === 'month' && state.month === previousMonth,
    'current-year': state.scope === 'year' && state.year === Number(today.slice(0, 4)),
  };
  $$('.chip[data-quick]').forEach((chip) => {
    chip.classList.toggle('active', Boolean(map[chip.dataset.quick]));
  });
}

/* ---------- Pemuatan data ---------- */

function periodParams() {
  return state.scope === 'month' ? { month: state.month } : { year: String(state.year) };
}

async function refresh() {
  try {
    await Promise.all([loadSummary(), loadList(), loadWallets()]);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadSummary() {
  const query = new URLSearchParams(periodParams()).toString();
  const data = await api(`/api/summary?${query}`);
  state.summary = data;
  renderKpis(data);
  renderFlow(data);
  renderDonut(data);
}

async function loadList() {
  const params = new URLSearchParams(periodParams());
  params.set('limit', '500');
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.type) params.set('type', state.filters.type);
  if (state.filters.category) params.set('category', state.filters.category);

  const data = await api(`/api/transactions?${params.toString()}`);
  state.list = data;
  renderTable();
}

/* ---------- Dompet ---------- */

function walletLabelOf(id) {
  const found = state.wallets.find((wallet) => wallet.id === id);
  return found ? found.name : '';
}

async function loadWallets() {
  const data = await api('/api/wallets');
  state.wallets = data.wallets || [];
  state.walletsMax = data.max || 12;
  renderWallets(data);
  buildWalletOptions($('#f-wallet') ? $('#f-wallet').value : '');
}

function renderWallets(data) {
  const box = $('#wallets');
  if (!box) return;
  const rows = data.wallets || [];
  const total = Number(data.total) || 0;
  $('#wallets-sub').textContent = rows.length
    ? `Total ${money(total)} di ${rows.length} dompet`
    : 'Belum ada dompet.';

  box.innerHTML = rows.map((row) => `
    <article class="wallet" data-id="${escapeHtml(row.id)}">
      <header class="wallet-head">
        <span class="wallet-name">${escapeHtml(row.name)}</span>
        <span class="wallet-count">${row.count} transaksi</span>
      </header>
      <strong class="wallet-balance ${row.balance < 0 ? 'neg' : ''}">${money(row.balance)}</strong>
      <div class="wallet-foot">
        <span class="muted">masuk ${money(row.income)} · keluar ${money(row.outcome)}</span>
        <button type="button" class="btn ghost small" data-act="sync">Sinkron</button>
      </div>
    </article>
  `).join('');
}

function buildWalletOptions(selected = '') {
  const select = $('#f-wallet');
  if (!select) return;
  const value = selected || select.value || '';
  select.innerHTML = state.wallets
    .map((wallet) => `<option value="${escapeHtml(wallet.id)}">${escapeHtml(wallet.name)}</option>`)
    .join('');
  select.value = state.wallets.some((wallet) => wallet.id === value)
    ? value
    : (state.wallets[0]?.id || '');
}

function openSync(walletId) {
  const row = state.wallets.find((wallet) => wallet.id === walletId);
  if (!row) return;
  state.syncTarget = row;
  $('#sync-title').textContent = `Sinkron ${row.name}`;
  $('#sync-sub').textContent = `Saldo tercatat dari transaksi: ${money(row.balance)}. Masukkan saldo yang terlihat di aplikasi ${row.name}.`;
  $('#sync-amount').value = '';
  $('#sync-diff').textContent = 'Selisih akan disimpan sebagai satu transaksi penyesuaian.';
  $('#sync-error').hidden = true;
  $('#sync-delete').hidden = false;
  $('#sync-modal').hidden = false;
  setTimeout(() => $('#sync-amount').focus(), 40);
}

function closeSync() {
  $('#sync-modal').hidden = true;
  state.syncTarget = null;
}

function updateSyncDiff() {
  const row = state.syncTarget;
  if (!row) return;
  const digits = String($('#sync-amount').value).replace(/[^\d]/g, '');
  const target = Number(digits) || 0;
  const diff = target - Number(row.balance);
  if (!digits) {
    $('#sync-diff').textContent = 'Selisih akan disimpan sebagai satu transaksi penyesuaian.';
    return;
  }
  if (!diff) {
    $('#sync-diff').textContent = 'Saldo sudah cocok, tidak ada penyesuaian.';
    return;
  }
  $('#sync-diff').textContent = diff > 0
    ? `Selisih +${money(diff)} dicatat sebagai pemasukan penyesuaian.`
    : `Selisih −${money(Math.abs(diff))} dicatat sebagai pengeluaran penyesuaian.`;
}

async function saveSync(event) {
  event.preventDefault();
  const row = state.syncTarget;
  if (!row) return;
  const errorBox = $('#sync-error');
  errorBox.hidden = true;
  const digits = String($('#sync-amount').value).replace(/[^\d]/g, '');
  if (!digits) {
    errorBox.textContent = 'Isi saldo yang terlihat di aplikasi dompet.';
    errorBox.hidden = false;
    return;
  }

  const button = $('#sync-save');
  button.disabled = true;
  try {
    const result = await api('/api/wallets/sync', {
      method: 'POST',
      body: JSON.stringify({ id: row.id, balance: Number(digits) }),
    });
    toast(result.adjustment
      ? `Saldo ${result.wallet.name} disinkronkan ke ${money(result.wallet.balance)}.`
      : `Saldo ${result.wallet.name} sudah cocok.`);
    closeSync();
    await refresh();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function deleteWallet() {
  const row = state.syncTarget;
  if (!row) return;
  if (!window.confirm(`Hapus dompet ${row.name}?`)) return;
  try {
    await api(`/api/wallets/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
    toast('Dompet dihapus.');
    closeSync();
    await refresh();
  } catch (error) {
    const box = $('#sync-error');
    box.textContent = error.message;
    box.hidden = false;
  }
}

function openWalletModal() {
  $('#wallet-name').value = '';
  $('#wallet-error').hidden = true;
  $('#wallet-presets').innerHTML = WALLET_PRESETS
    .map((name) => `<button type="button" class="chip" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
    .join('');
  $('#wallet-modal').hidden = false;
  setTimeout(() => $('#wallet-name').focus(), 40);
}

function closeWalletModal() {
  $('#wallet-modal').hidden = true;
}

async function saveWallet(event) {
  event.preventDefault();
  const errorBox = $('#wallet-error');
  errorBox.hidden = true;
  const name = $('#wallet-name').value.trim();
  if (!name) {
    errorBox.textContent = 'Nama dompet wajib diisi.';
    errorBox.hidden = false;
    return;
  }

  const button = $('#wallet-save');
  button.disabled = true;
  try {
    await api('/api/wallets', { method: 'POST', body: JSON.stringify({ name }) });
    toast(`Dompet ${name} ditambahkan.`);
    closeWalletModal();
    await refresh();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
  }
}

/* ---------- KPI ---------- */

function trendHtml(current, previous, invert = false) {
  if (!previous) return '<span class="trend flat">tanpa pembanding</span>';
  const delta = ((current - previous) / previous) * 100;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) {
    return '<span class="trend flat">sama seperti sebelumnya</span>';
  }
  const good = invert ? delta < 0 : delta > 0;
  const arrow = delta > 0 ? '▲' : '▼';
  const cls = good ? 'up' : 'down';
  return `<span class="trend ${cls}">${arrow} ${Math.abs(delta).toFixed(0)}%</span>`;
}

function renderKpis(summary) {
  const t = summary.totals;
  const prev = summary.prev;
  const comparison = prev ? 'vs periode sebelumnya' : '';

  const cards = [
    {
      cls: 'balance',
      label: 'Saldo total',
      value: money(summary.allTime.balance),
      foot: 'Pemasukan dikurangi pengeluaran',
    },
    {
      label: 'Pemasukan',
      value: money(t.income),
      foot: prev ? `${trendHtml(t.income, prev.income)} ${comparison}` : `${t.count} transaksi`,
    },
    {
      label: 'Pengeluaran',
      value: money(t.outcome),
      foot: prev
        ? `${trendHtml(t.outcome, prev.outcome, true)} ${comparison}`
        : t.income > 0
          ? `${Math.round((t.outcome / t.income) * 100)}% dari pemasukan`
          : `${t.count} transaksi`,
    },
    {
      label: 'Selisih',
      value: money(t.net),
      foot: t.net >= 0 ? 'surplus periode ini' : 'defisit periode ini',
    },
  ];

  $('#kpis').innerHTML = cards.map((card) => `
    <article class="kpi ${card.cls || ''}">
      <span class="kpi-label">${card.label}</span>
      <strong class="kpi-value">${card.value}</strong>
      <span class="kpi-foot">${card.foot}</span>
    </article>
  `).join('');
}

/* ---------- Grafik batang ---------- */

function barChart(series, { width = 720, labelEvery = 5 } = {}) {
  const hasData = series.some((item) => item.in > 0 || item.out > 0);
  if (!hasData) {
    return `<div class="chart-empty"><strong>Belum ada arus kas</strong><span>Catat transaksi pertama untuk melihat grafik.</span></div>`;
  }

  const W = Math.max(300, Math.round(width));
  const H = W < 520 ? 200 : 240;
  const pad = { top: 14, right: 8, bottom: 26, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = Math.max(1, ...series.flatMap((item) => [item.in, item.out]));
  const niceMax = niceCeil(max);
  const y = (value) => pad.top + plotH - (value / niceMax) * plotH;

  const n = series.length;
  const groupW = plotW / n;
  const barW = Math.max(2.5, Math.min(9, groupW * 0.34));

  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = niceMax * fraction;
    const yPos = y(value);
    return `
      <line x1="${pad.left}" y1="${yPos}" x2="${W - pad.right}" y2="${yPos}" stroke="var(--line)" stroke-width="1" />
      <text x="${pad.left - 8}" y="${yPos + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${compact(value)}</text>
    `;
  }).join('');

  const bars = series.map((item, index) => {
    const center = pad.left + groupW * index + groupW / 2;
    const xIn = center - barW - 1;
    const xOut = center + 1;
    const hIn = Math.max(item.in > 0 ? 2 : 0, pad.top + plotH - y(item.in));
    const hOut = Math.max(item.out > 0 ? 2 : 0, pad.top + plotH - y(item.out));
    const label = labelEvery && (index % labelEvery === 0 || index === n - 1)
      ? `<text x="${center}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${item.label}</text>`
      : '';
    return `
      <g>
        <title>${item.label}: masuk ${money(item.in)}, keluar ${money(item.out)}</title>
        ${item.in > 0 ? `<rect x="${xIn}" y="${y(item.in)}" width="${barW}" height="${hIn}" rx="2" fill="var(--in)"><title>Masuk ${money(item.in)}</title></rect>` : ''}
        ${item.out > 0 ? `<rect x="${xOut}" y="${y(item.out)}" width="${barW}" height="${hOut}" rx="2" fill="var(--out)"><title>Keluar ${money(item.out)}</title></rect>` : ''}
        ${label}
      </g>
    `;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik arus kas">
    ${grid}
    ${bars}
  </svg>`;
}

function niceCeil(value) {
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

function renderFlow(summary) {
  const title = $('#flow-title');
  const sub = $('#flow-sub');
  const box = $('#chart-flow');
  const width = Math.round(box.clientWidth || 720);

  if (summary.scope === 'month') {
    title.textContent = 'Arus kas harian';
    sub.textContent = summary.label;
    box.innerHTML = barChart(summary.daily, { width, labelEvery: 5 });
    return;
  }

  title.textContent = 'Arus kas bulanan';
  sub.textContent = summary.label;
  box.innerHTML = barChart(summary.monthly, { width, labelEvery: 1 });
}

/* ---------- Grafik donat ---------- */

function renderDonut(summary) {
  const box = $('#chart-donut');
  const sub = $('#donut-sub');
  const rows = (summary.categories || []).filter((row) => row.amount > 0);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  if (!rows.length || !total) {
    sub.textContent = '';
    box.className = 'chart donut';
    box.innerHTML = `<div class="chart-empty" style="flex:1"><strong>Belum ada pengeluaran</strong><span>Rincian kategori muncul di sini.</span></div>`;
    return;
  }

  sub.textContent = `${rows.length} kategori, total ${money(total)}`;
  box.className = 'chart donut';

  const top = rows.slice(0, 6);
  const restTotal = rows.slice(6).reduce((sum, row) => sum + row.amount, 0);
  const items = restTotal > 0 ? [...top, { name: 'Lainnya', amount: restTotal }] : top;

  const size = 168;
  const radius = 62;
  const thickness = 18;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = items.map((row, index) => {
    const share = row.amount / total;
    const length = Math.max(0, share * circumference - 2);
    const color = PALETTE[index % PALETTE.length];
    const segment = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none"
      stroke="${color}" stroke-width="${thickness}" stroke-linecap="butt"
      stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${size / 2} ${size / 2})"><title>${escapeHtml(row.name)}: ${money(row.amount)}</title></circle>`;
    offset += share * circumference;
    return segment;
  }).join('');

  const legend = items.map((row, index) => {
    const share = Math.round((row.amount / total) * 100);
    return `<li>
      <i style="background:${PALETTE[index % PALETTE.length]}"></i>
      <span class="name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
      <span class="val">${money(row.amount)} · ${share}%</span>
    </li>`;
  }).join('');

  box.innerHTML = `
    <div class="donut-figure" style="width:${size}px">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Kategori pengeluaran">
        ${segments}
      </svg>
      <div class="donut-center">
        <small>Total</small>
        <b>${compact(total)}</b>
      </div>
    </div>
    <ul class="donut-legend">${legend}</ul>
  `;
}

/* ---------- Tabel transaksi ---------- */

function renderTable() {
  const body = $('#tx-body');
  const empty = $('#tx-empty');
  const items = state.list.items || [];
  const shown = items.slice(0, state.visible);

  $('#tx-sub').textContent = state.scope === 'month' && state.summary
    ? state.summary.label
    : state.summary
      ? state.summary.label
      : '';

  if (!items.length) {
    body.innerHTML = '';
    const filtering = Boolean(state.filters.q || state.filters.type || state.filters.category);
    empty.innerHTML = filtering
      ? `<p class="empty-title">Tidak ada transaksi yang cocok.</p>
         <p class="muted">Coba ubah kata kunci atau filter tipe/kategori.</p>`
      : `<p class="empty-title">Belum ada transaksi di periode ini.</p>
         <p class="muted">Catat lewat tombol <strong>Catat</strong> atau kirim <code>/keluar 35000 makan siang</code> ke bot Telegram.</p>`;
    empty.hidden = false;
    $('#tx-total').textContent = '';
    $('#btn-more').hidden = true;
    return;
  }

  empty.hidden = true;

  body.innerHTML = shown.map((tx) => {
    const isIn = tx.type === 'in';
    const source = tx.source === 'telegram'
      ? 'via bot'
      : tx.source === 'scan'
        ? 'scan struk'
        : tx.source === 'demo' ? 'contoh' : 'via web';
    return `
      <tr data-id="${tx.id}" data-month="${tx.date.slice(0, 7)}">
        <td class="col-date">${shortDate(tx.date)}</td>
        <td>
          <span class="tx-note">${escapeHtml(tx.note || '(tanpa keterangan)')}</span>
          <span class="tx-meta">
            <span class="cat">${escapeHtml(tx.category)}</span>
            ${walletLabelOf(tx.wallet) ? `<span class="wallet-chip">${escapeHtml(walletLabelOf(tx.wallet))}</span>` : ''}
            <span class="src">${source}</span>
          </span>
        </td>
        <td class="col-amount ${isIn ? 'amount-in' : 'amount-out'}">
          ${isIn ? '+' : '−'}${money(tx.amount)}
        </td>
        <td class="col-actions">
          <span class="row-actions">
            <button type="button" data-act="edit" aria-label="Ubah transaksi" title="Ubah">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M13.6 3.4a1.8 1.8 0 0 1 2.5 2.5l-8 8-3.1.6.6-3.1 8-8Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/></svg>
            </button>
            <button type="button" data-act="del" class="del" aria-label="Hapus transaksi" title="Hapus">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 6h12M8 6V4.6c0-.3.3-.6.6-.6h2.8c.3 0 .6.3.6.6V6m-7 0 .7 9.4c0 .7.6 1.2 1.3 1.2h4.8c.7 0 1.3-.5 1.3-1.2L16 6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
            </button>
          </span>
        </td>
      </tr>
    `;
  }).join('');

  const sum = state.list.sum || { income: 0, outcome: 0 };
  $('#tx-total').textContent = `${state.list.total} transaksi · masuk ${money(sum.income)} · keluar ${money(sum.outcome)}`;
  $('#btn-more').hidden = items.length <= state.visible;
}

/* ---------- Modal form ---------- */

function buildCategoryOptions(type = state.formType, selected = '') {
  const list = state.categories[type] || [];
  const values = [...list];
  if (selected && !values.includes(selected)) values.push(selected);
  $('#f-cat').innerHTML = values
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join('');
  if (selected) $('#f-cat').value = selected;
}

function buildFilterCategories() {
  const all = [...new Set([...(state.categories.out || []), ...(state.categories.in || [])])].sort();
  $('#f-category').innerHTML = [
    '<option value="">Semua kategori</option>',
    ...all.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`),
  ].join('');
  $('#f-category').value = state.filters.category;
}

function setFormType(type) {
  state.formType = type === 'in' ? 'in' : 'out';
  $$('#type-toggle button').forEach((button) => {
    button.classList.toggle('active', button.dataset.type === state.formType);
  });
  const selected = $('#f-cat').value;
  buildCategoryOptions(state.formType, selected);
}

function defaultFormDate() {
  const today = localISO();
  if (state.scope === 'month' && state.month && state.month !== today.slice(0, 7)) {
    return `${state.month}-01`;
  }
  return today;
}

function openModal(tx = null) {
  state.editing = tx;
  $('#modal-title').textContent = tx ? 'Ubah transaksi' : 'Catat transaksi';
  $('#btn-delete').hidden = !tx;
  $('#form-error').hidden = true;
  const scanHint = $('#scan-hint');
  if (scanHint) scanHint.hidden = true;

  const type = tx ? tx.type : 'out';
  setFormType(type);
  buildCategoryOptions(type, tx ? tx.category : '');

  $('#f-amount').value = tx ? Number(tx.amount).toLocaleString('id-ID') : '';
  buildWalletOptions(tx ? tx.wallet : '');
  $('#f-date').value = tx ? tx.date : defaultFormDate();
  $('#f-note').value = tx ? (tx.note || '') : '';

  $('#modal').hidden = false;
  setTimeout(() => $('#f-amount').focus(), 40);
}

function closeModal() {
  $('#modal').hidden = true;
  state.editing = null;
}

async function saveForm(event) {
  event.preventDefault();
  const errorBox = $('#form-error');
  errorBox.hidden = true;

  const amount = Number(String($('#f-amount').value).replace(/\D/g, ''));
  const date = $('#f-date').value;
  const category = $('#f-cat').value;
  const note = $('#f-note').value.trim();

  if (!amount || amount <= 0) {
    errorBox.textContent = 'Nominal harus lebih dari nol.';
    errorBox.hidden = false;
    return;
  }
  if (!date) {
    errorBox.textContent = 'Tanggal wajib diisi.';
    errorBox.hidden = false;
    return;
  }

  const payload = { type: state.formType, amount, date, category, note, wallet: $('#f-wallet').value };
  const saveButton = $('#btn-save');
  saveButton.disabled = true;

  try {
    if (state.editing) {
      const oldMonth = state.editing.date.slice(0, 7);
      await api(`/api/transactions/${state.editing.id}?month=${oldMonth}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...payload, month: oldMonth }),
      });
      toast('Transaksi diperbarui.');
    } else {
      await api('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
      toast('Transaksi tersimpan.');
    }
    closeModal();
    await refresh();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteTransaction(tx) {
  const label = `${tx.note || tx.category} (${money(tx.amount)})`;
  if (!window.confirm(`Hapus transaksi "${label}"?`)) return;
  try {
    await api(`/api/transactions/${tx.id}?month=${tx.date.slice(0, 7)}`, { method: 'DELETE' });
    toast('Transaksi dihapus.');
    closeModal();
    await refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------- Scan struk (OCR di perangkat) ---------- */

let scanToken = 0;
let tesseractPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.async = true;
    script.onload = () => (window.Tesseract
      ? resolve(window.Tesseract)
      : reject(new Error('Mesin OCR gagal dimuat.')));
    script.onerror = () => reject(new Error('Tidak bisa memuat mesin OCR. Periksa koneksi internet.'));
    document.head.appendChild(script);
  });
  return tesseractPromise;
}

function showScan() {
  const modal = $('#scan-modal');
  $('#scan-title').textContent = 'Membaca struk…';
  setScanProgress(0.05, 'Menyiapkan mesin OCR…');
  modal.hidden = false;
}

function hideScan() {
  $('#scan-modal').hidden = true;
}

function setScanProgress(value, status) {
  const percent = Math.max(0, Math.min(1, Number(value) || 0));
  $('#scan-bar-fill').style.width = `${Math.round(percent * 100)}%`;
  if (status) $('#scan-status').textContent = status;
}

async function startScan(file) {
  if (!file) return;
  const token = ++scanToken;
  showScan();

  try {
    const Tesseract = await loadTesseract();
    if (token !== scanToken) return;

    const { data } = await Tesseract.recognize(file, 'ind', {
      logger: (event) => {
        if (token !== scanToken) return;
        if (event.status === 'loading language traineddata') {
          setScanProgress(0.12, 'Mengunduh data bahasa…');
        } else if (event.status === 'initializing api') {
          setScanProgress(0.2, 'Menyiapkan pembacaan…');
        } else if (event.status === 'recognizing text') {
          setScanProgress(0.2 + (Number(event.progress) || 0) * 0.7, 'Membaca teks struk…');
        }
      },
    });
    if (token !== scanToken) return;

    setScanProgress(0.94, 'Menyusun data transaksi…');
    const parsed = await api('/api/receipt/parse', {
      method: 'POST',
      body: JSON.stringify({ text: data.text || '' }),
    });
    if (token !== scanToken) return;

    hideScan();
    if (!parsed.ok) {
      toast('Nominal tidak terbaca dari foto itu. Coba foto lebih dekat dan terang.', 'error');
      return;
    }
    prefillFromScan(parsed);
  } catch (error) {
    if (token !== scanToken) return;
    hideScan();
    toast(error.message || 'Gagal membaca struk.', 'error');
  } finally {
    $('#scan-input').value = '';
  }
}

function prefillFromScan(parsed) {
  openModal();
  setFormType('out');
  buildCategoryOptions('out', parsed.category || '');
  $('#f-amount').value = Number(parsed.amount).toLocaleString('id-ID');
  $('#f-date').value = parsed.date || defaultFormDate();
  $('#f-note').value = parsed.merchant || '';

  const hint = $('#scan-hint');
  const percent = Math.round((Number(parsed.confidence) || 0) * 100);
  hint.textContent = `Terisi dari scan struk (keyakinan ${percent}%). Periksa nominal dan tanggal sebelum menyimpan.`;
  hint.hidden = false;

  toast('Struk terbaca. Periksa lalu simpan.');
}

/* ---------- Tema & event ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem('kasku-theme', theme === 'dark' ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#080f1c' : '#0f766e');
}

function bindStaticEvents() {
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('#login-error');
    const button = $('#login-btn');
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = 'Memeriksa…';
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('#password').value }),
      });
      await startApp();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Masuk';
    }
  });

  $('#sel-month').addEventListener('change', async (event) => {
    const value = event.target.value;
    if (!value) {
      state.scope = 'year';
    } else {
      state.scope = 'month';
      state.month = `${state.year}-${value}`;
    }
    state.visible = 100;
    markQuickActive();
    await refresh();
  });

  $('#sel-year').addEventListener('change', async (event) => {
    state.year = Number(event.target.value);
    if (state.scope === 'month') {
      state.month = `${state.year}-${state.month.slice(5, 7)}`;
    }
    state.visible = 100;
    await refresh();
  });

  $$('.chip[data-quick]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const today = localISO();
      const currentMonth = today.slice(0, 7);
      if (chip.dataset.quick === 'current-month') {
        state.scope = 'month';
        state.month = currentMonth;
        state.year = Number(today.slice(0, 4));
      } else if (chip.dataset.quick === 'last-month') {
        state.scope = 'month';
        state.month = shiftMonth(currentMonth, -1);
        state.year = Number(state.month.slice(0, 4));
      } else {
        state.scope = 'year';
        state.year = Number(today.slice(0, 4));
      }
      $('#sel-year').value = String(state.year);
      $('#sel-month').value = state.scope === 'month' ? state.month.slice(5, 7) : '';
      state.visible = 100;
      markQuickActive();
      await refresh();
    });
  });

  let searchTimer = null;
  $('#search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value.trim();
    searchTimer = setTimeout(async () => {
      state.filters.q = value;
      state.visible = 100;
      try {
        await loadList();
      } catch (error) {
        toast(error.message, 'error');
      }
    }, 280);
  });

  $('#f-type').addEventListener('change', async (event) => {
    state.filters.type = event.target.value;
    state.visible = 100;
    try {
      await loadList();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#f-category').addEventListener('change', async (event) => {
    state.filters.category = event.target.value;
    state.visible = 100;
    try {
      await loadList();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  $('#btn-more').addEventListener('click', () => {
    state.visible += 100;
    renderTable();
  });

  $('#btn-add').addEventListener('click', () => openModal());

  $('#btn-wallet-add').addEventListener('click', openWalletModal);
  $('#wallets').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="sync"]');
    if (!button) return;
    const card = button.closest('.wallet');
    if (card) openSync(card.dataset.id);
  });

  $('#sync-close').addEventListener('click', closeSync);
  $('#sync-cancel').addEventListener('click', closeSync);
  $('#sync-modal').addEventListener('click', (event) => {
    if (event.target.id === 'sync-modal') closeSync();
  });
  $('#sync-form').addEventListener('submit', saveSync);
  $('#sync-amount').addEventListener('input', (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 15);
    event.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
    updateSyncDiff();
  });
  $('#sync-delete').addEventListener('click', deleteWallet);

  $('#wallet-close').addEventListener('click', closeWalletModal);
  $('#wallet-cancel').addEventListener('click', closeWalletModal);
  $('#wallet-modal').addEventListener('click', (event) => {
    if (event.target.id === 'wallet-modal') closeWalletModal();
  });
  $('#wallet-form').addEventListener('submit', saveWallet);
  $('#wallet-presets').addEventListener('click', (event) => {
    const chip = event.target.closest('button[data-name]');
    if (!chip) return;
    $('#wallet-name').value = chip.dataset.name;
    $('#wallet-name').focus();
  });

  $('#btn-scan').addEventListener('click', () => {
    $('#scan-hint').hidden = true;
    $('#scan-input').click();
  });

  $('#scan-input').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) startScan(file);
  });

  $('#scan-cancel').addEventListener('click', () => {
    scanToken += 1;
    hideScan();
    toast('Pembacaan struk dibatalkan.');
  });
  $('#modal-close').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target === $('#modal')) closeModal();
  });

  $('#type-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-type]');
    if (button) setFormType(button.dataset.type);
  });

  $('#f-amount').addEventListener('input', (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 15);
    event.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
  });

  $('#tx-form').addEventListener('submit', saveForm);

  $('#btn-delete').addEventListener('click', () => {
    if (state.editing) deleteTransaction(state.editing);
  });

  $('#tx-body').addEventListener('click', (event) => {
    const row = event.target.closest('tr');
    if (!row) return;
    const tx = state.list.items.find((item) => item.id === row.dataset.id);
    if (!tx) return;

    const button = event.target.closest('button[data-act]');
    if (button) {
      if (button.dataset.act === 'edit') openModal(tx);
      else deleteTransaction(tx);
      return;
    }

    // Di ponsel kolom aksi disembunyikan: ketuk baris untuk mengubah.
    if (window.matchMedia('(max-width: 640px)').matches) openModal(tx);
  });

  $('#btn-export').addEventListener('click', () => {
    if (!state.summary || !state.summary.totals.count) {
      toast('Tidak ada transaksi untuk diexport di periode ini.', 'error');
      return;
    }
    const params = new URLSearchParams(periodParams());
    window.location.href = `/api/export?${params.toString()}`;
  });

  $('#btn-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    if (state.summary) {
      renderFlow(state.summary);
      renderDonut(state.summary);
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch { /* abaikan */ }
    state.summary = null;
    state.list = { items: [], total: 0, sum: { income: 0, outcome: 0, net: 0 } };
    showLogin();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#modal').hidden) closeModal();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.summary) renderFlow(state.summary);
    }, 160);
  });
}

boot();
