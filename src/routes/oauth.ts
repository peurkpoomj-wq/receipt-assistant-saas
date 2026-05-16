/**
 * Google OAuth2 flow — ลูกค้าคลิกเพื่อเชื่อม Google Sheets โดยไม่ต้องรู้ technical
 *
 * Flow:
 *   GET /oauth/google/start?tenantId=xxx  → redirect ไป Google consent
 *   GET /oauth/google/callback?code=&state= → รับ token, บันทึก, redirect ไป success
 */
import { Router, Request, Response } from 'express';
import axios from 'axios';
import { updateTenant, getTenantById, createTenant } from '../db/tenants.repo';
import { ensureHeaderRow } from '../services/sheets.service';
import { logger } from '../utils/logger';

const router = Router();

const CLIENT_ID     = process.env.GOOGLE_OAUTH_CLIENT_ID     ?? '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
const BASE_URL      = process.env.WEBHOOK_BASE_URL ?? 'https://receipt-assistant-saas-production.up.railway.app';
const REDIRECT_URI  = `${BASE_URL}/oauth/google/callback`;
const SCOPES        = 'https://www.googleapis.com/auth/spreadsheets';

// ─── Step 1: เริ่ม OAuth flow ──────────────────────────────────────────────────

router.get('/google/start', (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string;
  if (!tenantId) return res.status(400).send('Missing tenantId');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', tenantId);

  res.redirect(url.toString());
});

// ─── Step 2: Google callback — รับ code แลกเป็น token ─────────────────────────

router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state: tenantId, error } = req.query as Record<string, string>;

  if (error || !code || !tenantId) {
    return res.send(errorPage(error ?? 'Missing code or tenantId'));
  }

  try {
    // แลก code → tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { refresh_token } = tokenRes.data;
    if (!refresh_token) {
      return res.send(errorPage('ไม่ได้รับ refresh_token — กรุณาลองใหม่อีกครั้ง'));
    }

    // บันทึก refresh token เข้า Supabase
    await updateTenant(tenantId, {
      google_oauth_refresh_token: refresh_token,
    });

    // ดึงข้อมูล tenant เพื่อ init header row
    const tenant = await getTenantById(tenantId);
    if (tenant?.spreadsheet_id) {
      await ensureHeaderRow(tenant).catch(() => {});
    }

    logger.info('Google OAuth connected', { tenantId });

    // หน้า success
    const webhookUrl = `${BASE_URL}/webhook/${tenantId}`;
    res.send(successPage(webhookUrl, tenantId));

  } catch (err: any) {
    logger.error('OAuth callback error', { err: err.message });
    res.send(errorPage('เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
  }
});

export default router;

// ─── HTML Pages ────────────────────────────────────────────────────────────────

function successPage(webhookUrl: string, tenantId: string): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>เชื่อมต่อสำเร็จ!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f0f9f4; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: white; border-radius: 20px; padding: 40px 36px; max-width: 560px; width: 100%; box-shadow: 0 8px 32px rgba(0,0,0,.10); }
    .check { font-size: 4rem; text-align: center; margin-bottom: 16px; }
    h1 { font-size: 1.6rem; color: #1a1a2e; text-align: center; margin-bottom: 8px; }
    .sub { color: #666; text-align: center; margin-bottom: 28px; }
    .step { background: #f8f9ff; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; border-left: 4px solid #06C755; }
    .step-num { font-size: .75rem; font-weight: 700; color: #06C755; letter-spacing: 1px; margin-bottom: 4px; }
    .step-title { font-weight: 600; color: #222; margin-bottom: 8px; }
    .step-desc { font-size: .88rem; color: #555; line-height: 1.5; }
    .url-box { background: #1a1a2e; color: #06C755; font-family: monospace; font-size: .82rem; padding: 12px 16px; border-radius: 8px; margin: 8px 0; word-break: break-all; }
    .copy-btn { display: block; width: 100%; margin-top: 6px; padding: 10px; background: #06C755; color: white; border: none; border-radius: 8px; font-size: .95rem; font-weight: 600; cursor: pointer; }
    .copy-btn:active { background: #05a847; }
    .img-hint { border-radius: 8px; background: #eef; padding: 10px 14px; font-size: .85rem; color: #444; margin-top: 6px; }
    .done-btn { display: block; width: 100%; margin-top: 20px; padding: 14px; background: #1DB446; color: white; border: none; border-radius: 10px; font-size: 1rem; font-weight: 700; cursor: pointer; text-align: center; text-decoration: none; }
  </style>
</head>
<body>
<div class="card">
  <div class="check">✅</div>
  <h1>เชื่อม Google Sheets สำเร็จ!</h1>
  <p class="sub">ขั้นตอนสุดท้าย — ตั้งค่า Webhook ใน LINE ใช้เวลาแค่ 1 นาที</p>

  <div class="step">
    <div class="step-num">ขั้นตอนที่ 1</div>
    <div class="step-title">คัดลอก Webhook URL นี้</div>
    <div class="url-box" id="webhook-url">${webhookUrl}</div>
    <button class="copy-btn" onclick="copyUrl()">📋 แตะเพื่อคัดลอก URL</button>
  </div>

  <div class="step">
    <div class="step-num">ขั้นตอนที่ 2</div>
    <div class="step-title">ไปที่ LINE Developers Console</div>
    <div class="step-desc">
      1. เปิด <strong>developers.line.biz</strong><br>
      2. เลือก Channel ของคุณ → <strong>Messaging API</strong><br>
      3. หา <strong>"Webhook URL"</strong><br>
      4. วาง URL ที่คัดลอกมา → กด <strong>Update</strong><br>
      5. เปิด <strong>Use webhook → ON</strong><br>
      6. กด <strong>Verify</strong> — ต้องขึ้น "Success"
    </div>
  </div>

  <div class="step">
    <div class="step-num">ขั้นตอนที่ 3</div>
    <div class="step-title">ทดสอบส่งรูปสลิปแรก!</div>
    <div class="step-desc">เปิด LINE → ส่งรูปใบเสร็จให้ bot → ข้อมูลจะขึ้น Google Sheet ของคุณทันที 🎉</div>
  </div>

  <a class="done-btn" href="https://developers.line.biz" target="_blank">ไปตั้งค่า LINE Console →</a>
</div>

<script>
function copyUrl() {
  const url = document.getElementById('webhook-url').textContent;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = '✅ คัดลอกแล้ว!';
    setTimeout(() => btn.textContent = '📋 แตะเพื่อคัดลอก URL', 2000);
  }).catch(() => {
    const el = document.getElementById('webhook-url');
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
}
</script>
</body>
</html>`;
}

function errorPage(msg: string): string {
  return `<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>เกิดข้อผิดพลาด</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff5f5;padding:20px;}
.box{background:white;padding:32px;border-radius:16px;text-align:center;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,.1);}
h2{color:#e74c3c;margin-bottom:12px;}p{color:#555;margin-bottom:20px;}
a{display:inline-block;padding:12px 24px;background:#e74c3c;color:white;border-radius:8px;text-decoration:none;font-weight:600;}</style>
</head>
<body><div class="box">
<h2>❌ เกิดข้อผิดพลาด</h2>
<p>${msg}</p>
<a href="javascript:history.back()">← ลองใหม่อีกครั้ง</a>
</div></body></html>`;
}
