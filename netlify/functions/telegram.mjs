// Webhook Telegram: /masuk, /keluar, /saldo, /laporan, /tahun, /undo.

import crypto from 'node:crypto';
import {
  openStore, readMonth, readMonths, addTransaction, removeTransaction,
  listMonths, latestTransaction,
} from './lib/store.mjs';
import { todayISO, monthOf, isValidMonth, isValidYear, monthsOfYear, shortDate } from './lib/dates.mjs';
import { parseEntry } from './lib/entry.mjs';
import { guessCategory, CATEGORIES } from './lib/categories.mjs';
import { totals, flatten } from './lib/analytics.mjs';
import {
  sendMessage, editMessageText, answerCallbackQuery, escapeHtml, hasBotToken,
} from './lib/telegram-api.mjs';
import {
  HELP_TEXT, transactionText, monthReportText, yearReportText, balanceText,
} from './lib/report.mjs';
import { hasVision } from './lib/vision.mjs';

function allowedChats() {
  return String(process.env.TELEGRAM_ALLOWED_CHAT_ID || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowed(chatId) {
  const list = allowedChats();
  if (!list.length) return true; // belum dikunci: terbuka, chat id ditampilkan agar bisa dikunci
  return list.includes(String(chatId));
}

async function allData(store) {
  const months = await listMonths(store);
  const map = await readMonths(store, months);
  return { months, map, all: totals(flatten(map)) };
}

function keyboardForDeletion(ym, id) {
  return { inline_keyboard: [[{ text: 'Hapus transaksi ini', callback_data: `del:${ym}:${id}` }]] };
}

/* ---------- Scan struk ---------- */

function scanLimit() {
  const value = Number(process.env.RECEIPT_DAILY_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

async function scanUsage(store) {
  const doc = await store.get(`scan/usage-${todayISO()}`, { type: 'json' });
  return Number(doc?.count) || 0;
}

function isImageMessage(message) {
  if (Array.isArray(message.photo) && message.photo.length) return true;
  const mime = String(message.document?.mime_type || '');
  return Boolean(message.document) && mime.startsWith('image/');
}

function bestPhotoFileId(message) {
  if (Array.isArray(message.photo) && message.photo.length) {
    return message.photo[message.photo.length - 1].file_id;
  }
  return message.document?.file_id || '';
}

async function handleReceipt(store, message, requestUrl) {
  const chatId = message.chat.id;

  if (!hasVision()) {
    await sendMessage(
      chatId,
      'Scan struk belum aktif: <code>GEMINI_API_KEY</code> belum diisi di environment variable Netlify.',
    );
    return;
  }

  const limit = scanLimit();
  if ((await scanUsage(store)) >= limit) {
    await sendMessage(chatId, `Batas scan hari ini tercapai (${limit} foto). Coba lagi besok.`);
    return;
  }

  const ack = await sendMessage(chatId, 'Membaca struk…');
  const ackId = ack.ok ? ack.data?.result?.message_id : null;

  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(requestUrl).origin;
  const endpoint = new URL('/.netlify/functions/scan-background', origin);
  let status = 0;

  try {
    const fileId = bestPhotoFileId(message);
    if (!fileId) throw new Error('Foto tidak ditemukan pada pesan.');

    // Pekerjaan berat (unduh foto + Gemini) dijalankan di function background
    // supaya webhook tetap membalas jauh di bawah batas waktu Netlify.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-scan-token': process.env.TELEGRAM_WEBHOOK_SECRET || '',
      },
      body: JSON.stringify({
        chatId,
        fileId,
        mimeType: message.document?.mime_type || 'image/jpeg',
        ackId,
      }),
      signal: AbortSignal.timeout(8000),
    });
    status = response.status;

    if (!response.ok && response.status !== 202) {
      throw new Error(`background gagal (${response.status})`);
    }
  } catch (error) {
    console.error('Gagal menjadwalkan scan struk', error);
    const text = 'Gagal memulai pembacaan struk. Coba kirim ulang fotonya.';
    if (ackId) await editMessageText(chatId, ackId, text);
    else await sendMessage(chatId, text);
  }
}

async function handleCallback(store, query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const data = String(query.data || '');

  if (data.startsWith('rcpt:')) {
    await handleReceiptCallback(store, query, chatId, messageId, data);
    return;
  }

  if (!data.startsWith('del:')) {
    await answerCallbackQuery(query.id);
    return;
  }

  const [, ym, id] = data.split(':');
  if (!isValidMonth(ym) || !id) {
    await answerCallbackQuery(query.id, { text: 'Data tidak valid.' });
    return;
  }

  const removed = await removeTransaction(store, ym, id);
  if (!removed) {
    await answerCallbackQuery(query.id, { text: 'Transaksi sudah tidak ada.' });
    return;
  }

  await answerCallbackQuery(query.id, { text: 'Transaksi dihapus.' });
  if (chatId && messageId) {
    const label = removed.type === 'in' ? 'Pemasukan' : 'Pengeluaran';
    await editMessageText(
      chatId,
      messageId,
      `<s>${escapeHtml(label)} ${escapeHtml(shortDate(removed.date))} - ${escapeHtml(removed.note || removed.category)}</s>\n\nTransaksi dihapus.`,
    );
  }
}

async function handleReceiptCallback(store, query, chatId, messageId, data) {
  const [, action, id] = data.split(':');
  const key = `scan/pending-${id}`;
  const pending = id ? await store.get(key, { type: 'json' }) : null;

  if (!pending) {
    await answerCallbackQuery(query.id, { text: 'Scan ini sudah kedaluwarsa.' });
    return;
  }
  if (String(pending.chatId) !== String(chatId)) {
    await answerCallbackQuery(query.id, { text: 'Scan ini bukan milikmu.' });
    return;
  }

  const age = Date.now() - new Date(pending.createdAt).getTime();
  if (!Number.isFinite(age) || age > 60 * 60 * 1000) {
    await store.delete(key);
    await answerCallbackQuery(query.id, { text: 'Scan kedaluwarsa, kirim ulang fotonya.' });
    return;
  }

  if (action === 'cancel') {
    await store.delete(key);
    await answerCallbackQuery(query.id, { text: 'Dibatalkan.' });
    if (chatId && messageId) {
      await editMessageText(chatId, messageId, '<s>Scan struk dibatalkan.</s>');
    }
    return;
  }

  if (action !== 'save') {
    await answerCallbackQuery(query.id);
    return;
  }

  const now = new Date().toISOString();
  const tx = {
    id: crypto.randomUUID(),
    type: 'out',
    amount: pending.amount,
    note: pending.note,
    category: pending.category,
    date: pending.date,
    source: 'scan',
    chatId: String(chatId),
    createdAt: now,
    updatedAt: now,
  };

  await addTransaction(store, tx);
  await store.delete(key);
  await answerCallbackQuery(query.id, { text: 'Tersimpan.' });

  if (chatId && messageId) {
    await editMessageText(
      chatId,
      messageId,
      `${transactionText(tx)}\n\n<i>Tersimpan dari scan struk.</i>`,
      { reply_markup: keyboardForDeletion(tx.date.slice(0, 7), tx.id) },
    );
  }
}

export default async (request) => {
  if (request.method === 'GET') {
    return new Response('KasKu webhook aktif.', { status: 200 });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  if (!hasBotToken()) {
    console.error('TELEGRAM_BOT_TOKEN belum diset');
    return new Response('ok');
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('ok');
  }

  const store = openStore();

  try {
    // Deduplikasi: Telegram bisa mengirim ulang update yang sama.
    const state = (await store.get('state/last-update', { type: 'json' })) || { id: 0 };
    if (update.update_id && update.update_id <= Number(state.id || 0)) {
      return new Response('ok');
    }

    if (update.callback_query) {
      const query = update.callback_query;
      if (isAllowed(query.message?.chat?.id)) {
        await handleCallback(store, query);
      } else {
        await answerCallbackQuery(query.id, { text: 'Tidak diizinkan.' });
      }
    } else if (update.message && !update.message.from?.is_bot) {
      const message = update.message;
      if (!isAllowed(message.chat.id)) {
        await sendMessage(message.chat.id, 'Bot ini privat. Hubungi pemilik untuk mendapatkan akses.');
      } else if (isImageMessage(message)) {
        await handleReceipt(store, message, request.url);
      } else {
        await handleText(store, message);
      }
    }

    if (update.update_id) {
      await store.setJSON('state/last-update', { id: update.update_id, at: new Date().toISOString() });
    }
  } catch (error) {
    console.error('Telegram handler error', error);
  }

  return new Response('ok');
};
