// Kategori & penebakan otomatis dari keterangan transaksi.

export const CATEGORIES = {
  out: [
    'Makan & Minum', 'Transport', 'Belanja', 'Tagihan', 'Kesehatan',
    'Hiburan', 'Pendidikan', 'Rumah', 'Cicilan', 'Donasi', 'Lainnya',
  ],
  in: ['Gaji', 'Bonus', 'Usaha', 'Investasi', 'Hadiah', 'Lainnya'],
};

const RULES_OUT = [
  ['Makan & Minum', [
    'makan', 'minum', 'sarapan', 'brunch', 'lunch', 'makan siang', 'dinner', 'kopi',
    'cafe', 'kafe', 'coffee', 'resto', 'restoran', 'warung', 'warteg', 'bakso', 'mie',
    'nasi', 'ayam', 'sate', 'padang', 'pizza', 'burger', 'kfc', 'mcd', 'starbucks',
    'gofood', 'grabfood', 'shopeefood', 'jajan', 'snack', 'camilan', 'boba', 'teh',
    'jus', 'es', 'katering', 'catering', 'food',
  ]],
  ['Transport', [
    'transport', 'bensin', 'pertalite', 'pertamax', 'solar', 'bbm', 'parkir', 'tol',
    'grab', 'gojek', 'gocar', 'goride', 'ojek', 'ojol', 'taxi', 'taksi', 'krl', 'mrt',
    'lrt', 'transjakarta', 'bus', 'angkot', 'tiket pesawat', 'travel', 'servis motor',
    'servis mobil', 'ganti oli',
  ]],
  ['Belanja', [
    'belanja', 'belanja bulanan', 'groceries', 'indomaret', 'alfamart', 'supermarket',
    'hypermart', 'carrefour', 'shopee', 'tokopedia', 'lazada', 'tiktok shop', 'baju',
    'sepatu', 'celana', 'kaos', 'skincare', 'kosmetik', 'elektronik', 'gadget',
  ]],
  ['Tagihan', [
    'tagihan', 'listrik', 'pln', 'air', 'pdam', 'internet', 'wifi', 'indihome', 'telkom',
    'pulsa', 'kuota', 'paket data', 'bpjs', 'asuransi', 'pajak', 'iuran', 'langganan',
    'netflix', 'spotify', 'youtube premium', 'icloud', 'google one', 'hosting', 'domain',
    'aplikasi', 'subscription',
  ]],
  ['Kesehatan', [
    'kesehatan', 'dokter', 'rumah sakit', 'klinik', 'obat', 'apotek', 'vitamin',
    'periksa', 'lab', 'dental', 'gigi', 'vaksin', 'fisioterapi', 'bpjs kesehatan',
  ]],
  ['Hiburan', [
    'hiburan', 'nonton', 'bioskop', 'cinema', 'game', 'steam', 'konser', 'karaoke',
    'wisata', 'liburan', 'hotel', 'penginapan', 'tiket', 'spotify', 'club', 'hobi',
  ]],
  ['Pendidikan', [
    'pendidikan', 'sekolah', 'kuliah', 'kursus', 'les', 'buku', 'seminar', 'workshop',
    'udemy', 'coursera', 'spp', 'uang pangkal', 'uang gedung',
  ]],
  ['Rumah', [
    'rumah', 'sewa', 'kontrakan', 'kos', 'furnitur', 'kasur', 'lemari', 'perbaikan',
    'renovasi', 'kebersihan', 'laundry', 'dapur', 'peralatan rumah', 'gas', 'galon',
  ]],
  ['Cicilan', [
    'cicilan', 'angsuran', 'kredit', 'kpr', 'leasing', 'kartu kredit', 'pinjaman',
    'utang', 'hutang',
  ]],
  ['Donasi', [
    'donasi', 'sedekah', 'zakat', 'infaq', 'sumbangan', 'amal', 'kolekte',
  ]],
];

const RULES_IN = [
  ['Gaji', ['gaji', 'salary', 'gajian', 'upah', 'payroll', 'thr', 'tunjangan', 'bonus tahunan']],
  ['Bonus', ['bonus', 'insentif', 'komisi', 'reward', 'cashback', 'hadiah']],
  ['Usaha', ['usaha', 'bisnis', 'jualan', 'omzet', 'penjualan', 'klien', 'proyek', 'freelance', 'invoice']],
  ['Investasi', ['investasi', 'dividen', 'bunga', 'reksadana', 'saham', 'deposito', 'profit trading']],
  ['Hadiah', ['hadiah', 'hadiah ulang tahun', 'angpao', 'kado', 'hibah']],
];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tebak kategori berdasarkan keterangan. Mengembalikan string kategori. */
export function guessCategory(type, note) {
  const text = ` ${normalize(note)} `;
  const rules = type === 'in' ? RULES_IN : RULES_OUT;
  if (text.trim()) {
    let best = null;
    let bestLen = 0;
    for (const [category, keywords] of rules) {
      for (const keyword of keywords) {
        // Cocokkan sebagai kata/frasa utuh agar "es" tidak menangkap "sesuatu".
        if (text.includes(` ${keyword} `) && keyword.length > bestLen) {
          best = category;
          bestLen = keyword.length;
        }
      }
    }
    if (best) return best;
  }
  return 'Lainnya';
}

export function isKnownCategory(type, category) {
  return CATEGORIES[type]?.includes(category) === true;
}

export function sanitizeCategory(type, category, note) {
  const value = String(category || '').trim().slice(0, 40);
  if (value) return value;
  return guessCategory(type, note);
}
