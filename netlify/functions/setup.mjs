// Pendaftaran webhook Telegram. Buka /setup?token=SETUP_TOKEN setelah deploy.

import { setWebhook, getWebhookInfo, deleteWebhook, hasBotToken } from './lib/telegram-api.mjs';

function page(title, body) {
  return new Response(
    `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f6fb;color:#0f172a;margin:0;padding:40px 20px}
    main{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 8px 30px -18px rgba(15,23,42,.4)}
    h1{font-size:20px;margin:0 0 12px}pre{background:#0f172a;color:#e2e8f0;padding:14px;border-radius:10px;overflow:auto;font-size:12px;line-height:1.5}
    code{background:#eef2f7;padding:2px 6px;border-radius:6px;font-size:13px}a{color:#0f766e}</style></head>
    <body><main><h1>${title}</h1>${body}</main></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export default async (request) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const action = url.searchParams.get('action') || 'set';

  if (!process.env.SETUP_TOKEN) {
    return page('Setup belum siap', '<p>Environment variable <code>SETUP_TOKEN</code> belum diisi di Netlify.</p>');
  }
  if (!token || token !== process.env.SETUP_TOKEN) {
    return page('Akses ditolak', '<p>Token setup salah. Buka <code>/setup?token=...</code> dengan token yang benar.</p>');
  }
  if (!hasBotToken()) {
    return page('Token bot belum ada', '<p>Isi environment variable <code>TELEGRAM_BOT_TOKEN</code> terlebih dahulu, lalu deploy ulang.</p>');
  }

  try {
    if (action === 'delete') {
      const result = await deleteWebhook();
      return page('Webhook dihapus', `<pre>${JSON.stringify(result.data, null, 2)}</pre>`);
    }

    if (action === 'info') {
      const info = await getWebhookInfo();
      return page('Status webhook', `<pre>${JSON.stringify(info.data, null, 2)}</pre>`);
    }

    const webhookUrl = `${url.origin}/telegram`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
    const result = await setWebhook(webhookUrl, secret);
    const info = await getWebhookInfo();

    if (!result.ok) {
      return page('Gagal mendaftarkan webhook', `<pre>${JSON.stringify(result.data, null, 2)}</pre>`);
    }

    return page(
      'Webhook terdaftar',
      `<p>Bot sekarang mengirim update ke <code>${webhookUrl}</code>.</p>
       <p>Buka Telegram, kirim <code>/start</code> ke bot kamu, lalu coba <code>/keluar 25000 kopi</code>.</p>
       <pre>${JSON.stringify(info.data?.result ?? info.data, null, 2)}</pre>`,
    );
  } catch (error) {
    return page('Error', `<pre>${String(error?.message || error)}</pre>`);
  }
};
