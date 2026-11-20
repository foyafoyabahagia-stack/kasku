// Pemrosesan foto struk: unduh dari Telegram, baca dengan Gemini, simpan sebagai
// "pending" lalu balas ringkasan bertombol Simpan/Batal.
// Dipanggil dari function scan-background agar webhook bisa langsung membalas.

import crypto from 'node:crypto';
import { todayISO } from './dates.mjs';
import { guessCategory } from './categories.mjs';
import { getFile, downloadFile, sendMessage, editMessageText } from './telegram-api.mjs';
import { readReceiptImage } from './vision.mjs';
import { normalizeReceiptDate } from './receipt.mjs';
import { receiptText } from './report.mjs';

export function scanKeyboard(id) {
  return {
    inline_keyboard: [[
      { text: 'Simpan', callback_data: `rcpt:save:${id}` },
      { text: 'Batal', callback_data: `rcpt:cancel:${id}` },
    ]],
  };
}

async function noteScan(store) {
  const key = `scan/usage-${todayISO()}`;
  const doc = (await store.get(key, { type: 'json' })) || {};
  await store.setJSON(key, { count: (Number(doc.count) || 0) + 1, updatedAt: new Date().toISOString() });
}

export async function processReceiptScan(store, payload) {
  const chatId = payload.chatId;
  const ackId = payload.ackId || null;
  const mimeType = payload.mimeType || 'image/jpeg';

  const editAck = async (text, options = {}) => {
    if (ackId) await editMessageText(chatId, ackId, text, options);
    else await sendMessage(chatId, text, options);
  };

  try {
    if (!payload.fileId) throw new Error('Foto tidak ditemukan pada pesan.');

    const info = await getFile(payload.fileId);
    if (!info.ok) throw new Error('Telegram menolak permintaan file struk.');
    const bytes = await downloadFile(info.data.result.file_path);
    const base64 = Buffer.from(bytes).toString('base64');
    const vision = await readReceiptImage(base64, mimeType);

    const amount = Math.round(Number(vision.total) || 0);
    if (!amount || amount < 100) {
      await editAck('Nominal tidak terbaca dari foto itu. Coba foto ulang lebih dekat dan pastikan baris TOTAL terlihat.');
      return { ok: false, reason: 'amount' };
    }

    const date = normalizeReceiptDate(vision.date, todayISO());
    const merchant = vision.merchant || '';
    const detail = [merchant, vision.note].filter(Boolean).join(' - ').slice(0, 120) || 'Struk belanja';
    const category = guessCategory('out', `${merchant} ${vision.note}`);

    let confidence = 0.6;
    if (merchant) confidence += 0.2;
    if (vision.date) confidence += 0.2;

    const id = crypto.randomUUID();
    const pending = {
      id,
      chatId: String(chatId),
      amount,
      date,
      merchant,
      note: detail,
      category,
      confidence: Math.round(confidence * 100) / 100,
      createdAt: new Date().toISOString(),
    };

    await store.setJSON(`scan/pending-${id}`, pending);
    await noteScan(store);
    await editAck(receiptText(pending), { reply_markup: scanKeyboard(id) });
    return { ok: true, id };
  } catch (error) {
    console.error('Scan struk gagal', error);
    const text = /quota|kuota|429|RESOURCE_EXHAUSTED/i.test(String(error.message))
      ? 'Kuota pembacaan struk sedang penuh. Coba lagi beberapa saat lagi.'
      : 'Gagal membaca struk. Coba kirim ulang fotonya.';
    await editAck(text);
    return { ok: false, reason: 'error' };
  }
}
