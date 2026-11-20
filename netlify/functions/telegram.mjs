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

async function handleReport(store, chatId, args) {
  const parts = args.filter(Boolean);
  let targetMonth = null;
  let targetYear = null;

  if (parts.length === 0) {
    targetMonth = monthOf(todayISO());
  } else if (parts.length === 1) {
    const value = parts[0];
    if (/^\d{4}$/.test(value)) {
      targetYear = Number(value);
    } else if (/^\d{4}-\d{2}$/.test(value)) {
      targetMonth = value;
    } else if (/^\d{1,2}$/.test(value)) {
      targetYear = Number(todayISO().slice(0, 4));
      targetMonth = `${targetYear}-${value.padStart(2, '0')}`;
    } else {
      await sendMessage(chatId, 'Format laporan: /laporan, /laporan 10, /laporan 10 2026, /laporan 2026');
      return;
    }
  } else {
    const [monthToken, yearToken] = parts;
    if (!/^\d{1,2}$/.test(monthToken) || !/^\d{4}$/.test(yearToken)) {
      await sendMessage(chatId, 'Format laporan: /laporan 10 2026');
      return;
    }
    targetMonth = `${yearToken}-${monthToken.padStart(2, '0')}`;
    targetYear = Number(yearToken);
  }

  if (targetMonth) {
    if (!isValidMonth(targetMonth)) {
      await sendMessage(chatId, 'Bulan tidak valid. Gunakan 1-12.');
      return;
    }
    const items = await readMonth(store, targetMonth);
    await sendMessage(chatId, monthReportText(items, targetMonth));
    return;
  }

  if (!isValidYear(targetYear)) {
    await sendMessage(chatId, 'Tahun tidak valid.');
    return;
  }
  const yearMonths = monthsOfYear(targetYear);
  const map = await readMonths(store, yearMonths);
  const items = flatten(map);
  await sendMessage(chatId, yearReportText(items, targetYear));
}

async function handleText(store, message) {
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();
  if (!text.startsWith('/')) {
    await sendMessage(chatId, 'Gunakan perintah. Ketik /help untuk daftar perintah.');
    return;
  }

  const firstSpace = text.search(/\s/);
  const rawCommand = (firstSpace < 0 ? text : text.slice(0, firstSpace)).toLowerCase();
  const args = firstSpace < 0 ? '' : text.slice(firstSpace + 1).trim();
  const command = rawCommand.split('@')[0];

  if (command === '/start' || command === '/help') {
    const suffix = allowedChats().length
      ? ''
      : `\n\nChat ID kamu: <code>${chatId}</code>\nSimpan nilai ini di environment variable TELEGRAM_ALLOWED_CHAT_ID agar bot hanya bisa dipakai olehmu.`;
    await sendMessage(chatId, `${HELP_TEXT}${suffix}`);
    return;
  }

  if (command === '/masuk' || command === '/in' || command === '/terima') {
    const parsed = parseEntry(args);
    if (parsed.error) {
      await sendMessage(chatId, parsed.error);
      return;
    }
    const now = new Date().toISOString();
    const tx = {
      id: crypto.randomUUID(),
      type: 'in',
      amount: parsed.amount,
      note: parsed.note,
      category: parsed.category || guessCategory('in', parsed.note),
      date: parsed.date || todayISO(),
      source: 'telegram',
      chatId: String(chatId),
      createdAt: now,
      updatedAt: now,
    };
    await addTransaction(store, tx);
    await sendMessage(chatId, transactionText(tx), { reply_markup: keyboardForDeletion(tx.date.slice(0, 7), tx.id) });
    return;
  }

  if (command === '/keluar' || command === '/out') {
    const parsed = parseEntry(args);
    if (parsed.error) {
      await sendMessage(chatId, parsed.error);
      return;
    }
    const now = new Date().toISOString();
    const tx = {
      id: crypto.randomUUID(),
      type: 'out',
      amount: parsed.amount,
      note: parsed.note,
      category: parsed.category || guessCategory('out', parsed.note),
      date: parsed.date || todayISO(),
      source: 'telegram',
      chatId: String(chatId),
      createdAt: now,
      updatedAt: now,
    };
    await addTransaction(store, tx);
    await sendMessage(chatId, transactionText(tx), { reply_markup: keyboardForDeletion(tx.date.slice(0, 7), tx.id) });
    return;
  }

  if (command === '/saldo') {
    const { all } = await allData(store);
    const ym = monthOf(todayISO());
    const monthItems = await readMonth(store, ym);
    const monthSum = totals(monthItems);
    await sendMessage(chatId, balanceText({ balance: all.net }, monthSum, ym));
    return;
  }

  if (command === '/laporan' || command === '/report') {
    await handleReport(store, chatId, args.split(/\s+/).filter(Boolean));
    return;
  }

  if (command === '/tahun') {
    const year = args && /^\d{4}$/.test(args) ? Number(args) : Number(todayISO().slice(0, 4));
    const map = await readMonths(store, monthsOfYear(year));
    await sendMessage(chatId, yearReportText(flatten(map), year));
    return;
  }

  if (command === '/undo') {
    const months = await listMonths(store);
    const recent = months.slice(0, 6);
    const latest = await latestTransaction(store, recent);
    if (!latest) {
      await sendMessage(chatId, 'Tidak ada transaksi untuk dibatalkan.');
      return;
    }
    await removeTransaction(store, latest.ym, latest.tx.id);
    const label = latest.tx.type === 'in' ? 'Pemasukan' : 'Pengeluaran';
    await sendMessage(
      chatId,
      `Dibatalkan.\n${label} ${shortDate(latest.tx.date)}\n${latest.tx.note || latest.tx.category}`,
    );
    return;
  }

  if (command === '/kategori') {
    await sendMessage(
      chatId,
      `<b>Kategori pengeluaran</b>\n${CATEGORIES.out.join(', ')}\n\n<b>Kategori pemasukan</b>\n${CATEGORIES.in.join(', ')}`,
    );
    return;
  }

  await sendMessage(chatId, 'Perintah tidak dikenal. Ketik /help.');
}

async function handleCallback(store, query) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const data = String(query.data || '');

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
