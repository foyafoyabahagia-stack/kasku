// Utilitas tanggal & periode. Semua tanggal disimpan sebagai "YYYY-MM-DD" (kalender lokal).

export const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const BULAN_SINGKAT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

export function timezone() {
  return process.env.TZ || 'Asia/Jakarta';
}

/** Tanggal hari ini di zona waktu aplikasi -> "YYYY-MM-DD" */
export function todayISO(tz = timezone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  // en-CA menghasilkan YYYY-MM-DD
  return parts;
}

/** Jam sekarang di zona waktu aplikasi -> "HH:MM" */
export function nowTime(tz = timezone()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

export function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

export function isValidMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidYear(value) {
  return Number.isInteger(value) && value >= 1970 && value <= 2200;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthOf(date) {
  return date.slice(0, 7);
}

export function yearOf(date) {
  return Number(date.slice(0, 4));
}

export function monthParts(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

/** "2026-11" -> "November 2026" */
export function monthLabel(ym) {
  const { year, month } = monthParts(ym);
  return `${BULAN[month - 1]} ${year}`;
}

export function shiftMonth(ym, delta) {
  const { year, month } = monthParts(ym);
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function prevMonth(ym) {
  return shiftMonth(ym, -1);
}

/** Daftar bulan terakhir, terbaru lebih dulu */
export function lastMonths(count, from = todayISO()) {
  const list = [];
  let cursor = monthOf(from);
  for (let i = 0; i < count; i += 1) {
    list.push(cursor);
    cursor = shiftMonth(cursor, -1);
  }
  return list;
}

/** Daftar 12 bulan dalam satu tahun -> ["2026-01", ...] */
export function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Terima "2026-11-18", "18/11/2026", "18-11-2026", "18/11" (tahun berjalan).
 * Mengembalikan "YYYY-MM-DD" atau null.
 */
export function parseDateToken(token, base = todayISO()) {
  if (!token) return null;
  const t = token.trim();
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const value = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    return isValidISODate(value) ? value : null;
  }
  const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = dmy[3] ? Number(dmy[3]) : Number(base.slice(0, 4));
    const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isValidISODate(value) ? value : null;
  }
  return null;
}

/** "2026-11-18" -> "18 Nov 2026" */
export function shortDate(date) {
  const { year, month } = monthParts(date);
  return `${Number(date.slice(8, 10))} ${BULAN_SINGKAT[month - 1]} ${year}`;
}
