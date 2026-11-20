// Pembacaan struk lewat Gemini (vision). Hanya dipakai jalur Telegram;
// jalur web memakai Tesseract.js di browser sehingga foto tidak keluar dari perangkat.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function hasVision() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function visionModel() {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

const PROMPT = `Kamu membaca foto struk belanja Indonesia. Kembalikan JSON dengan field:
- "merchant": nama toko/restoran sebaris pendek tanpa alamat (string)
- "date": tanggal transaksi format YYYY-MM-DD (string)
- "total": jumlah akhir yang dibayar dalam rupiah, angka bulat tanpa titik/koma (number)
- "note": ringkasan singkat isi belanja, maksimal 6 kata (string)

Aturan: "total" adalah nominal yang benar-benar dibayar (baris TOTAL/GRAND TOTAL/JUMLAH BAYAR),
bukan subtotal, bukan uang tunai, dan bukan kembalian. Jika struk tidak menampilkan tanggal,
pakai string kosong. Jangan mengarang nilai; jika tidak terbaca, isi 0.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING' },
    date: { type: 'STRING' },
    total: { type: 'NUMBER' },
    note: { type: 'STRING' },
  },
  required: ['merchant', 'date', 'total', 'note'],
};

/**
 * @param {string} base64 gambar ter-encode base64
 * @param {string} mimeType
 * @returns {Promise<{merchant: string, date: string, total: number, note: string, text: string}>}
 */
export async function readReceiptImage(base64, mimeType = 'image/jpeg') {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY belum diset');

  const model = visionModel();
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      response_mime_type: 'application/json',
      response_schema: SCHEMA,
    },
  };

  const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error?.message || `Gemini menolak permintaan (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();

  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  return {
    merchant: String(parsed.merchant || '').slice(0, 60),
    date: String(parsed.date || ''),
    total: Number(parsed.total) || 0,
    note: String(parsed.note || '').slice(0, 80),
    text,
  };
}
