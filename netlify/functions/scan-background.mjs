// Function background: memproses foto struk tanpa menahan webhook.
// Dipanggil oleh telegram.mjs lewat POST + header x-scan-token.

import { openStore } from './lib/store.mjs';
import { processReceiptScan } from './lib/receipt-scan.mjs';

export const handler = async (event) => {
  const headers = event.headers || {};
  const token = headers['x-scan-token'] || headers['X-Scan-Token'] || '';
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && token !== secret) {
    return { statusCode: 403, body: 'forbidden' };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'bad request' };
  }

  if (!payload.chatId || !payload.fileId) {
    return { statusCode: 400, body: 'chatId dan fileId wajib' };
  }

  console.log(`scan mulai chat=${payload.chatId} ack=${payload.ackId || '-'} file=${String(payload.fileId).slice(0, 12)}`);
  await processReceiptScan(openStore(), payload);
  return { statusCode: 200, body: 'ok' };
};
