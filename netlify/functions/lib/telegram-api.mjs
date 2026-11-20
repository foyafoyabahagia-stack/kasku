// Klien minimal Telegram Bot API.

const API = 'https://api.telegram.org';

function token() {
  const value = process.env.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error('TELEGRAM_BOT_TOKEN belum diset');
  return value;
}

async function call(method, payload) {
  const response = await fetch(`${API}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok && data?.ok === true, data };
}

export function sendMessage(chatId, text, options = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options,
  });
}

export function editMessageText(chatId, messageId, text, options = {}) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options,
  });
}

export function answerCallbackQuery(callbackQueryId, payload = {}) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...payload });
}

export function getFile(fileId) {
  return call('getFile', { file_id: fileId });
}

/** Unduh isi file (foto struk) dari server Telegram. */
export async function downloadFile(filePath) {
  const response = await fetch(`${API}/file/bot${token()}/${filePath}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Gagal mengunduh file Telegram (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export function setWebhook(url, secretToken) {
  return call('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
}

export function deleteWebhook() {
  return call('deleteWebhook', { drop_pending_updates: true });
}

export function getWebhookInfo() {
  return call('getWebhookInfo', {});
}

export function hasBotToken() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/** Escape untuk parse_mode HTML Telegram. */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
