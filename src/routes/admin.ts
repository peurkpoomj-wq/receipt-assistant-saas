/**
 * Admin routes — tenant registration & management
 * ออกแบบให้คนอายุ 60 ก็ใช้งานได้
 */
import { Router, Request, Response } from 'express';
import { createTenant, getAllActiveTenants, updateTenant } from '../db/tenants.repo';
import { DEFAULT_TOUR_GROUPS, Tenant } from '../types';
import { logger } from '../utils/logger';

const router = Router();

const BASE_URL = process.env.WEBHOOK_BASE_URL ?? 'https://receipt-assistant-saas-production.up.railway.app';

// ─── Auth ──────────────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: Function) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return next();
  const provided = req.headers['x-admin-key'] ?? req.query.key;
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── หน้าลงทะเบียน (3 ช่อง ภาษาไทยชัดเจน) ──────────────────────────────────

router.get('/register', (_req: Request, res: Response) => {
  res.send(REGISTER_HTML);
});

// ─── สร้าง Tenant (รับ 3 ช่อง + redirect ไป Google OAuth) ─────────────────────

router.post('/tenants', async (req: Request, res: Response) => {
  const {
    name,
    line_channel_secret,
    line_channel_access_token,
    spreadsheet_id,
    tour_groups_raw,
  } = req.body;

  const missing = ['name', 'line_channel_secret', 'line_channel_access_token', 'spreadsheet_id'].filter(k => !req.body[k]);
  if (missing.length) {
    return res.status(400).json({ error: `กรุณากรอกให้ครบ: ${missing.join(', ')}` });
  }

  // parse tour groups จาก textarea (แต่ละบรรทัด = 1 กรุ๊ป)
  const tour_groups = tour_groups_raw
    ? (tour_groups_raw as string).split('\n').map((s: string) => s.trim()).filter(Boolean)
    : [...DEFAULT_TOUR_GROUPS];

  try {
    const tenant = await createTenant({
      name,
      line_channel_secret,
      line_channel_access_token,
      // ใช้ Google OAuth App ของระบบ (ลูกค้าไม่ต้องมีของตัวเอง)
      google_oauth_client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      google_oauth_client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      google_oauth_refresh_token: 'PENDING', // จะได้จาก OAuth flow
      spreadsheet_id,
      sheet_name: 'Expenses',
      tour_groups,
      plan: 'free',
    });

    logger.info('Tenant created (pending Google auth)', { id: tenant.id, name });

    // redirect ไปที่ Google OAuth เลย
    return res.json({
      success: true,
      tenant_id: tenant.id,
      oauth_url: `${BASE_URL}/oauth/google/start?tenantId=${tenant.id}`,
    });

  } catch (err: any) {
    logger.error('createTenant failed', { err });
    return res.status(500).json({ error: err.message ?? 'เกิดข้อผิดพลาด' });
  }
});

// ─── API สำหรับ Admin ──────────────────────────────────────────────────────────

router.get('/tenants', requireAdmin, async (_req: Request, res: Response) => {
  const tenants = await getAllActiveTenants();
  return res.json(tenants.map(t => ({
    id: t.id,
    name: t.name,
    plan: t.plan,
    monthly_receipt_count: t.monthly_receipt_count,
    google_connected: t.google_oauth_refresh_token !== 'PENDING',
    webhook_url: `${BASE_URL}/webhook/${t.id}`,
    created_at: t.created_at,
  })));
});

router.patch('/tenants/:id', requireAdmin, async (req: Request, res: Response) => {
  const allowed = ['plan', 'is_active', 'sheet_name', 'tour_groups'];
  const updates: any = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  await updateTenant(req.params.id, updates);
  return res.json({ success: true });
});

export default router;

// ─── Registration HTML (ภาษาไทยชัดเจน ใช้งานง่ายมาก) ─────────────────────────

const REGISTER_HTML = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>สมัครใช้งาน Receipt Bot</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f0f4f8; min-height: 100vh; padding: 20px; }
    .header { text-align: center; padding: 32px 20px 24px; }
    .header h1 { font-size: 1.8rem; color: #1a1a2e; }
    .header p { color: #666; margin-top: 6px; font-size: 1rem; }
    .steps-bar { display: flex; justify-content: center; gap: 0; margin: 0 auto 28px; max-width: 480px; }
    .step-item { flex: 1; text-align: center; position: relative; }
    .step-circle { width: 36px; height: 36px; border-radius: 50%; background: #dde; color: #888; font-weight: 700; display: flex; align-items: center; justify-content: center; margin: 0 auto 6px; font-size: .95rem; }
    .step-item.active .step-circle { background: #06C755; color: white; }
    .step-item.done .step-circle { background: #1DB446; color: white; }
    .step-label { font-size: .78rem; color: #888; }
    .step-item.active .step-label { color: #06C755; font-weight: 600; }
    .step-line { position: absolute; top: 18px; left: 50%; width: 100%; height: 2px; background: #dde; z-index: 0; }
    .step-item:last-child .step-line { display: none; }
    .card { background: white; border-radius: 20px; padding: 32px 28px; max-width: 540px; margin: 0 auto; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .field-group { margin-bottom: 22px; }
    label { display: block; font-weight: 600; color: #333; margin-bottom: 6px; font-size: .95rem; }
    .label-sub { font-size: .8rem; font-weight: 400; color: #888; margin-left: 6px; }
    input, textarea { width: 100%; padding: 13px 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: .95rem; transition: border .2s; font-family: inherit; }
    input:focus, textarea:focus { outline: none; border-color: #06C755; }
    .hint-box { background: #f0f9f4; border-radius: 8px; padding: 10px 14px; margin-top: 8px; font-size: .82rem; color: #444; line-height: 1.5; }
    .hint-box strong { color: #06C755; }
    .section-title { font-size: .75rem; font-weight: 700; letter-spacing: 1.5px; color: #06C755; text-transform: uppercase; margin: 24px 0 14px; border-bottom: 2px solid #e8f8ee; padding-bottom: 6px; }
    .btn-submit { width: 100%; margin-top: 10px; padding: 16px; background: #06C755; color: white; border: none; border-radius: 12px; font-size: 1.05rem; font-weight: 700; cursor: pointer; transition: background .2s; }
    .btn-submit:hover { background: #05b34b; }
    .btn-submit:disabled { background: #aaa; cursor: not-allowed; }
    .loading { display: none; text-align: center; color: #06C755; font-size: 1rem; margin-top: 16px; }
    .error-box { background: #fff0f0; border: 1px solid #f0a; border-radius: 8px; padding: 12px 16px; margin-top: 14px; color: #c00; display: none; }
    .safe-note { text-align: center; font-size: .8rem; color: #aaa; margin-top: 16px; }
    .tour-group-hint { font-size: .82rem; color: #888; margin-top: 6px; }
    textarea { resize: vertical; min-height: 90px; }
  </style>
</head>
<body>

<div class="header">
  <h1>🧾 Receipt Bot</h1>
  <p>ระบบบันทึกใบเสร็จอัตโนมัติผ่าน LINE</p>
</div>

<div class="steps-bar">
  <div class="step-item active">
    <div class="step-line"></div>
    <div class="step-circle">1</div>
    <div class="step-label">ข้อมูลบริษัท</div>
  </div>
  <div class="step-item">
    <div class="step-line"></div>
    <div class="step-circle">2</div>
    <div class="step-label">เชื่อม Google</div>
  </div>
  <div class="step-item">
    <div class="step-circle">3</div>
    <div class="step-label">ตั้งค่า LINE</div>
  </div>
</div>

<div class="card">
  <form id="form">

    <div class="section-title">📋 ข้อมูลบริษัท</div>

    <div class="field-group">
      <label>ชื่อบริษัท หรือ ชื่อกิจการ <span class="label-sub">*จำเป็น</span></label>
      <input name="name" placeholder="เช่น บริษัท ทัวร์สุขใจ จำกัด" required>
    </div>

    <div class="field-group">
      <label>Google Sheet URL <span class="label-sub">*จำเป็น</span></label>
      <input name="spreadsheet_url" id="spreadsheet_url" placeholder="วาง URL จาก Google Sheets ที่นี่" required>
      <div class="hint-box">
        📌 วิธีหา URL: เปิด Google Sheet ของคุณ → คัดลอก URL จาก address bar ของ browser<br>
        <strong>ตัวอย่าง:</strong> https://docs.google.com/spreadsheets/d/<strong>1BxiMVs0...</strong>/edit
      </div>
    </div>

    <div class="section-title">💬 ข้อมูล LINE Official Account</div>

    <div class="hint-box" style="margin-bottom:14px">
      📱 หาข้อมูลนี้ได้ที่ <strong>developers.line.biz</strong> → เลือก Channel ของคุณ → Basic Settings
    </div>

    <div class="field-group">
      <label>Channel Secret <span class="label-sub">*จำเป็น</span></label>
      <input name="line_channel_secret" placeholder="ตัวอักษร+ตัวเลข 32 หลัก" required>
      <div class="hint-box">อยู่ที่ <strong>Basic Settings → Channel secret</strong> → กด Issue ถ้ายังไม่มี</div>
    </div>

    <div class="field-group">
      <label>Channel Access Token <span class="label-sub">*จำเป็น</span></label>
      <input name="line_channel_access_token" placeholder="ตัวอักษรยาวๆ ขึ้นต้นด้วย eyJ..." required>
      <div class="hint-box">อยู่ที่ <strong>Messaging API → Channel access token</strong> → กด Issue ถ้ายังไม่มี</div>
    </div>

    <div class="section-title">🗂️ ชื่อกรุ๊ปทัวร์ (ถ้ามี)</div>

    <div class="field-group">
      <label>รายชื่อกรุ๊ปทัวร์ <span class="label-sub">ไม่บังคับ</span></label>
      <textarea name="tour_groups_raw" placeholder="กรุ๊ปญี่ปุ่น&#10;กรุ๊ปเกาหลี&#10;กรุ๊ปยุโรป&#10;กรุ๊ปจีน"></textarea>
      <div class="tour-group-hint">ใส่ชื่อกรุ๊ปละ 1 บรรทัด ถ้าว่างจะใช้ค่าเริ่มต้น</div>
    </div>

    <button type="submit" class="btn-submit" id="btn">
      ถัดไป: เชื่อม Google Sheets →
    </button>

    <div class="loading" id="loading">⏳ กำลังสร้างบัญชี รอสักครู่...</div>
    <div class="error-box" id="err"></div>
    <p class="safe-note">🔒 ข้อมูลของคุณปลอดภัย ไม่มีการเรียกเก็บเงินในขั้นตอนนี้</p>
  </form>
</div>

<script>
// แปลง Sheet URL → Spreadsheet ID
function extractSheetId(url) {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : url; // ถ้าเป็น ID อยู่แล้วก็ใช้ตรงๆ
}

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const loading = document.getElementById('loading');
  const errBox = document.getElementById('err');

  btn.disabled = true;
  loading.style.display = 'block';
  errBox.style.display = 'none';

  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());

  // แปลง Google Sheet URL → ID
  data.spreadsheet_id = extractSheetId(data.spreadsheet_url);

  try {
    const res = await fetch('/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();

    if (res.ok && json.oauth_url) {
      // redirect ไป Google OAuth
      window.location.href = json.oauth_url;
    } else {
      errBox.textContent = json.error ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      errBox.style.display = 'block';
      btn.disabled = false;
      loading.style.display = 'none';
    }
  } catch {
    errBox.textContent = 'ไม่สามารถเชื่อมต่อได้ กรุณาตรวจสอบอินเทอร์เน็ต';
    errBox.style.display = 'block';
    btn.disabled = false;
    loading.style.display = 'none';
  }
});
</script>
</body>
</html>`;
