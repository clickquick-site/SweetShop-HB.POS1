// ============================================================
//  HP-POS — server.js  v8.4.0
//  سيرفر Node.js: البريد Gmail + المزامنة LAN + SMS + طباعة صامتة + طباعة خام TSPL/ZPL
//  التشغيل: node server.js
//  المتطلبات: npm install express nodemailer cors puppeteer-core
// ============================================================

'use strict';

const express    = require('express');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const { exec }   = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Config file (يُحفظ بجانب server.js) ─────────────────────
const CONFIG_FILE = path.join(__dirname, 'server_config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch(e) {}
  return {
    emailSender:      '',
    emailAppPassword: '',
    emailRecipient:   '',
    smsSid:           '',
    smsToken:         '',
    smsFrom:          '',
    smsEnabled:       false,
    syncStore:        {},
  };
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); } catch(e) {}
}

let config = loadConfig();

// ── Middleware ───────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// ── Logging ─────────────────────────────────────────────────
function log(type, msg) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  console.log(`[${ts}] [${type}] ${msg}`);
}

// ════════════════════════════════════════════════════════════
//  وحدة الطباعة الاحترافية — PrintEngine v2
//
//  التدفق الكامل:
//  1. puppeteer-core يُشغِّل Edge/Chrome الموجود على الجهاز
//  2. يُحوِّل HTML → PDF بدقة كاملة مع تحميل JsBarcode
//  3. SumatraPDF يطبع PDF صامتاً على الطابعة المحددة (إن وُجد)
//  4. Fallback: PowerShell Shell.Application -Verb PrintTo
//  5. Fallback أخير: -Verb Print (الطابعة الافتراضية)
//
//  لا يحتاج أي برنامج خارجي — فقط:
//  npm install puppeteer-core   (مكتبة JS خالصة، تستخدم Edge المثبّت)
// ════════════════════════════════════════════════════════════

// ── البحث عن Chrome أو Edge على الجهاز ────────────────────
function _findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── البحث عن SumatraPDF (اختياري — يُحسِّن الطباعة) ────────
function _findSumatraPDF() {
  const candidates = [
    path.join(__dirname, 'SumatraPDF.exe'),
    path.join(__dirname, 'tools', 'SumatraPDF.exe'),
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── تنفيذ أمر shell مع انتظار النتيجة الحقيقية ────────────
function _execPromise(cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else     resolve(stdout);
    });
  });
}

// ── المحرك الرئيسي: HTML → PDF → طابعة ─────────────────────
async function _printEngine(html, printerName, paperMm) {

  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch(e) {
    throw new Error(
      'puppeteer-core غير مثبّت.\n' +
      'افتح مجلد التطبيق في Terminal ونفّذ:\n' +
      'npm install puppeteer-core'
    );
  }

  const browserPath = _findBrowser();
  if (!browserPath) {
    throw new Error('لم يُعثر على Microsoft Edge أو Chrome — تأكد من تثبيت أحدهما');
  }

  // ملفات مؤقتة
  const ts      = Date.now();
  const tmpHtml = path.join(os.tmpdir(), `hppos_${ts}.html`);
  const tmpPdf  = path.join(os.tmpdir(), `hppos_${ts}.pdf`);
  const cleanup = (files) => files.forEach(f => { try { fs.unlinkSync(f); } catch(_) {} });

  // ── المرحلة 1: كتابة HTML مؤقتاً ─────────────────────────
  fs.writeFileSync(tmpHtml, html, 'utf8');

  // ── المرحلة 2: تشغيل puppeteer ───────────────────────────
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless:       'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  try {
    const page = await browser.newPage();

    // تحميل HTML وانتظار اكتمال كل السكريبتات (JsBarcode CDN)
    const fileUrl = 'file:///' + tmpHtml.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 15000 });

    // انتظار 600ms إضافية لضمان رسم SVG الباركودات
    await new Promise(r => setTimeout(r, 600));

    // توليد PDF بأبعاد الورق الحراري الدقيقة
    const pdfBuffer = await page.pdf({
      width:           `${paperMm}mm`,
      height:          'auto',
      printBackground: true,
      margin: { top: '1mm', bottom: '2mm', left: '1mm', right: '1mm' },
    });

    fs.writeFileSync(tmpPdf, pdfBuffer);

  } finally {
    await browser.close();
    cleanup([tmpHtml]);
  }

  // ── المرحلة 3: PDF → طابعة ───────────────────────────────
  try {
    await _sendPdfToPrinter(tmpPdf, printerName);
  } finally {
    // حذف PDF بعد 8 ثوانٍ (وقت كافٍ لإرساله لـ spooler)
    setTimeout(() => cleanup([tmpPdf]), 8000);
  }
}

// ── إرسال PDF إلى طابعة محددة — ثلاث طبقات fallback ────────
async function _sendPdfToPrinter(pdfPath, printerName) {
  const printer = (printerName || '').trim();

  if (process.platform === 'win32') {

    // ── طبقة 1: SumatraPDF ─── الأدق والأسرع للطابعات الحرارية
    const sumatra = _findSumatraPDF();
    if (sumatra) {
      const pFlag = printer
        ? `-print-to "${printer}"`
        : '-print-to-default';
      await _execPromise(
        `"${sumatra}" ${pFlag} -silent -exit-when-done "${pdfPath}"`,
        20000
      );
      log('PRINT', `✅ SumatraPDF → [${printer || 'افتراضية'}]`);
      return;
    }

    // ── طبقة 2: Shell.Application InvokeVerb PrintTo ─────────
    // يستخدم Windows Shell verb handler (Edge PDF reader) لطباعة
    // على طابعة محددة — يعمل على Windows 10/11 بدون تثبيت إضافي
    if (printer) {
      // تهرُّب من الأقواس والشرطات في اسم الطابعة
      const safeFile    = pdfPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safePrinter = printer.replace(/'/g, "\\'").replace(/"/g, '\\"');

      const ps = [
        'powershell -NoProfile -WindowStyle Hidden -Command',
        `"$f = '${safeFile}';`,
        `$p = '${safePrinter}';`,
        `$sh = New-Object -ComObject 'Shell.Application';`,
        `$item = $sh.NameSpace(0).ParseName($f);`,
        `$item.InvokeVerb('PrintTo \\\"' + $p + '\\\"')"`,
      ].join(' ');

      try {
        await _execPromise(ps, 20000);
        log('PRINT', `✅ Shell PrintTo → [${printer}]`);
        return;
      } catch(e) {
        log('PRINT', `⚠️ Shell PrintTo فشل → ننتقل للـ Fallback: ${e.message}`);
      }
    }

    // ── طبقة 3: Start-Process -Verb Print ─── الطابعة الافتراضية
    const safeFile3 = pdfPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    await _execPromise(
      `powershell -NoProfile -WindowStyle Hidden -Command "Start-Process '${safeFile3}' -Verb 'Print' -Wait"`,
      20000
    );
    log('PRINT', `✅ Start-Process Print → [افتراضية]`);

  } else {
    // Linux / macOS
    const pFlag = printer ? `-d "${printer}"` : '';
    await _execPromise(`lpr ${pFlag} "${pdfPath}"`, 15000);
    log('PRINT', `✅ lpr → [${printer || 'افتراضية'}]`);
  }
}

// ════════════════════════════════════════════════════════════
//  API: Ping
// ════════════════════════════════════════════════════════════
app.get('/api/ping', (req, res) => {
  res.json({ status:'ok', version:'7.0.0', time: new Date().toISOString() });
});

// ════════════════════════════════════════════════════════════
//  API: Config
// ════════════════════════════════════════════════════════════
app.get('/api/config', (req, res) => {
  res.json({
    emailConfigured: !!(config.emailSender && config.emailAppPassword),
    smsConfigured:   !!(config.smsSid && config.smsToken),
    smsEnabled:      config.smsEnabled || false,
  });
});

app.post('/api/config', (req, res) => {
  const { emailSender, emailAppPassword, emailRecipient, smsSid, smsToken, smsFrom, smsEnabled } = req.body;
  if (emailSender      !== undefined) config.emailSender      = emailSender;
  if (emailAppPassword !== undefined) config.emailAppPassword  = emailAppPassword;
  if (emailRecipient   !== undefined) config.emailRecipient    = emailRecipient;
  if (smsSid           !== undefined) config.smsSid            = smsSid;
  if (smsToken         !== undefined) config.smsToken          = smsToken;
  if (smsFrom          !== undefined) config.smsFrom           = smsFrom;
  if (smsEnabled       !== undefined) config.smsEnabled        = smsEnabled;
  saveConfig(config);
  log('CONFIG', 'تم حفظ الإعدادات');
  res.json({ status:'ok' });
});

// ════════════════════════════════════════════════════════════
//  API: Email
// ════════════════════════════════════════════════════════════
app.post('/api/email', async (req, res) => {
  const { to, subject, body, html } = req.body;
  if (!config.emailSender || !config.emailAppPassword) {
    log('EMAIL', 'غير مُهيَّأ');
    return res.status(503).json({ error: 'email_not_configured' });
  }
  if (!to || !subject) return res.status(400).json({ error: 'missing_fields' });

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.emailSender, pass: config.emailAppPassword },
    });
    const info = await transporter.sendMail({
      from: `"HP-POS" <${config.emailSender}>`,
      to, subject,
      text: body || '',
      html: html || body || '',
    });
    log('EMAIL', `إرسال ناجح → ${to}`);
    res.json({ status:'ok', messageId: info.messageId });
  } catch(e) {
    log('EMAIL', `خطأ: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  API: SMS — Twilio
// ════════════════════════════════════════════════════════════
app.post('/api/sms', async (req, res) => {
  if (!config.smsEnabled)                               return res.status(503).json({ error: 'sms_disabled' });
  if (!config.smsSid || !config.smsToken || !config.smsFrom) return res.status(503).json({ error: 'sms_not_configured' });

  const { to, message } = req.body;
  if (!to || !message) return res.status(400).json({ error: 'missing_fields' });

  try {
    const auth  = Buffer.from(`${config.smsSid}:${config.smsToken}`).toString('base64');
    const body  = new URLSearchParams({ To:to, From:config.smsFrom, Body:message }).toString();
    const https = require('https');

    await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.twilio.com',
        path:     `/2010-04-01/Accounts/${config.smsSid}/Messages.json`,
        method:   'POST',
        headers:  {
          'Authorization':  'Basic ' + auth,
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };
      const r = https.request(options, (res2) => {
        let data = '';
        res2.on('data', d => data += d);
        res2.on('end', () => {
          try { const j = JSON.parse(data); j.sid ? resolve(j) : reject(new Error(j.message || 'SMS error')); }
          catch(e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    log('SMS', `إرسال ناجح → ${to}`);
    res.json({ status:'ok' });
  } catch(e) {
    log('SMS', `خطأ: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  API: مزامنة LAN
// ════════════════════════════════════════════════════════════
if (!config.syncStore) config.syncStore = {};
const sseClients = new Set();

app.post('/api/sync', (req, res) => {
  const { action, store, data } = req.body;
  if (!store || !action) return res.status(400).json({ error: 'missing_fields' });

  if (!config.syncStore[store]) config.syncStore[store] = [];

  if (action === 'add' || action === 'update') {
    const idx = config.syncStore[store].findIndex(r => r.id === data?.id);
    if (idx >= 0) config.syncStore[store][idx] = data;
    else          config.syncStore[store].push(data);
  } else if (action === 'delete') {
    config.syncStore[store] = config.syncStore[store].filter(r => r.id !== data?.id);
  }

  const event = JSON.stringify({ action, store, data, ts: Date.now() });
  sseClients.forEach(client => {
    try { client.write(`data: ${event}\n\n`); } catch(e) { sseClients.delete(client); }
  });

  log('SYNC', `${action.toUpperCase()} → ${store} (${sseClients.size} أجهزة)`);
  res.json({ status:'ok' });
});

app.get('/api/data/:store', (req, res) => {
  res.json(config.syncStore[req.params.store] || []);
});

app.get('/api/subscribe', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  log('SSE', `جهاز جديد — إجمالي: ${sseClients.size}`);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch(e) { clearInterval(heartbeat); }
  }, 30000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
    log('SSE', `جهاز انقطع — إجمالي: ${sseClients.size}`);
  });
});

setInterval(() => saveConfig(config), 60000);

// ════════════════════════════════════════════════════════════
//  API: تقرير يومي
// ════════════════════════════════════════════════════════════
app.post('/api/daily-report', async (req, res) => {
  const { report } = req.body;
  if (!report) return res.status(400).json({ error: 'missing_report' });

  const to = config.emailRecipient || req.body.to;
  if (!to) return res.status(400).json({ error: 'no_recipient' });

  try {
    const currency = report.currency || 'DA';
    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;">
        <h2 style="color:#7C3AED;border-bottom:2px solid #7C3AED;padding-bottom:8px;">
          📊 التقرير اليومي — ${report.date || new Date().toISOString().split('T')[0]}
        </h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <tr style="background:#f5f3ff;">
            <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">💰 مداخيل البيع</td>
            <td style="padding:10px;border:1px solid #ddd;font-weight:bold;color:#059669;">${parseFloat(report.revenue||0).toFixed(2)} ${currency}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;">📦 تكلفة الشراء</td>
            <td style="padding:10px;border:1px solid #ddd;">${parseFloat(report.cost||0).toFixed(2)} ${currency}</td>
          </tr>
          <tr style="background:#f5f3ff;">
            <td style="padding:10px;border:1px solid #ddd;">📊 الفائدة الإجمالية</td>
            <td style="padding:10px;border:1px solid #ddd;color:#059669;">${parseFloat(report.grossProfit||0).toFixed(2)} ${currency}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;">🧾 المصاريف</td>
            <td style="padding:10px;border:1px solid #ddd;color:#dc2626;">${parseFloat(report.expenses||0).toFixed(2)} ${currency}</td>
          </tr>
          <tr style="background:#f0fdf4;">
            <td style="padding:10px;border:1px solid #ddd;font-weight:bold;">✅ صافي الربح</td>
            <td style="padding:10px;border:1px solid #ddd;font-weight:bold;color:#059669;font-size:1.1em;">${parseFloat(report.netProfit||0).toFixed(2)} ${currency}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;">💳 الديون المعلقة</td>
            <td style="padding:10px;border:1px solid #ddd;color:#dc2626;">${parseFloat(report.debts||0).toFixed(2)} ${currency}</td>
          </tr>
          <tr style="background:#f5f3ff;">
            <td style="padding:10px;border:1px solid #ddd;">🛒 عدد المبيعات</td>
            <td style="padding:10px;border:1px solid #ddd;">${report.salesCount||0}</td>
          </tr>
        </table>
        <p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">HP-POS v8.4.0</p>
      </div>`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.emailSender, pass: config.emailAppPassword },
    });
    await transporter.sendMail({
      from: `"HP-POS" <${config.emailSender}>`,
      to,
      subject: `📊 التقرير اليومي ${report.date||''} — HP-POS`,
      html,
    });

    log('REPORT', `تقرير يومي أُرسل → ${to}`);
    res.json({ status:'ok' });
  } catch(e) {
    log('REPORT', `خطأ: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  API: قائمة الطابعات
// ════════════════════════════════════════════════════════════
app.get('/api/printers', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    let printers = [];

    if (process.platform === 'win32') {
      const out = execSync(
        'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
        { encoding: 'utf8', timeout: 5000 }
      );
      printers = out.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (process.platform === 'linux') {
      try {
        const out = execSync('lpstat -a 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
        printers = out.split('\n').map(l => l.split(' ')[0].trim()).filter(Boolean);
      } catch(_) {}
    } else if (process.platform === 'darwin') {
      const out = execSync('lpstat -p 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      printers = out.split('\n').filter(l => l.startsWith('printer'))
                    .map(l => l.split(' ')[1]?.trim()).filter(Boolean);
    }

    log('PRINTERS', `تم جلب ${printers.length} طابعة`);
    res.json({ status: 'ok', printers });
  } catch(e) {
    log('PRINTERS', `خطأ: ${e.message}`);
    res.json({ status: 'ok', printers: [] });
  }
});

// ════════════════════════════════════════════════════════════
//  API: الطباعة الصامتة الاحترافية  /api/print
//
//  المعطيات:
//    html        : كامل محتوى HTML (فاتورة أو باركود)
//    printerName : اسم الطابعة كما يظهر في Windows
//    paperMm     : عرض الورق بالمم (اختياري — يُستخرج من @page تلقائياً)
// ════════════════════════════════════════════════════════════
app.post('/api/print', async (req, res) => {
  const { html, htmlBase64, printerName, paperMm } = req.body;

  // ③ قبول base64 أو HTML خام للتوافق مع الإصدارات القديمة
  let rawHtml = '';
  if (htmlBase64) {
    try {
      rawHtml = Buffer.from(htmlBase64, 'base64').toString('utf8');
    } catch(e) {
      return res.status(400).json({ error: 'invalid_base64' });
    }
  } else if (html) {
    rawHtml = html;
  } else {
    return res.status(400).json({ error: 'missing_html' });
  }

  // استخراج حجم الورق من CSS @page إذا لم يُحدَّد صراحةً
  let paper = parseInt(paperMm) || 0;
  if (!paper) {
    const m = rawHtml.match(/@page\s*\{[^}]*size:\s*(\d+)mm/);
    paper = m ? parseInt(m[1]) : 80;
  }

  const printer = (printerName || '').trim();

  try {
    await _printEngine(rawHtml, printer, paper);
    const usedPrinter = printer || 'الطابعة الافتراضية';
    log('PRINT', `✅ طُبع | طابعة: [${usedPrinter}] | ورق: ${paper}mm`);
    res.json({ status: 'ok', printer: usedPrinter });

  } catch(e) {
    log('PRINT', `❌ فشل: ${e.message}`);
    // عند الفشل: print.js يعرض dialog المتصفح كـ fallback تلقائي
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  API: طباعة خام TSPL / ZPL  /api/print-raw
//
//  المعطيات (JSON):
//    commands    : نص الأوامر (TSPL أو ZPL)
//    printerName : اسم الطابعة كما يظهر في Windows (اختياري)
//    protocol    : 'TSPL' | 'ZPL'  (للتسجيل فقط)
//    vid         : Vendor  ID بالـ hex — مثال: "0x0FE6" (اختياري)
//    pid         : Product ID بالـ hex — مثال: "0x811E" (اختياري)
//
//  منهجية الإرسال (Windows):
//    1. إذا توفر printerName → PowerShell RawPrinter
//    2. إذا توفر vid/pid     → بحث عن Port الطابعة بالـ VID/PID ثم كتابة مباشرة
//    3. Fallback              → copy /B إلى أول طابعة Label متاحة
//
//  Linux / macOS:
//    lpr -l (raw mode) مباشرة
// ════════════════════════════════════════════════════════════

// ── إرسال بيانات خام إلى طابعة Windows باستخدام PowerShell ──
async function _rawPrintWindows(commands, printerName) {
  const ts      = Date.now();
  const tmpRaw  = path.join(os.tmpdir(), `hppos_raw_${ts}.tmp`);
  const cleanup = () => { try { fs.unlinkSync(tmpRaw); } catch(_) {} };

  // كتابة الأوامر كـ buffer (UTF-8 بدون BOM لـ TSPL، ASCII لـ ZPL)
  fs.writeFileSync(tmpRaw, Buffer.from(commands, 'utf8'));

  try {
    if (printerName) {
      // ── طريقة 1: PowerShell RawPrinterHelper ───────────────
      const safeFile    = tmpRaw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safePrinter = printerName.replace(/'/g, "\\'").replace(/"/g, '\\"');
      const ps = [
        'powershell -NoProfile -WindowStyle Hidden -Command',
        `"$bytes = [System.IO.File]::ReadAllBytes('${safeFile}');`,
        `$printer = '${safePrinter}';`,
        `Add-Type -TypeDefinition @'`,
        `using System;using System.Runtime.InteropServices;`,
        `public class RawPrinter {`,
        `  [DllImport(\\"winspool.drv\\",CharSet=CharSet.Auto,SetLastError=true)]`,
        `  public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);`,
        `  [DllImport(\\"winspool.drv\\",SetLastError=true)]`,
        `  public static extern bool ClosePrinter(IntPtr h);`,
        `  [DllImport(\\"winspool.drv\\",SetLastError=true)]`,
        `  public static extern int StartDocPrinter(IntPtr h,int l,int[] d);`,
        `  [DllImport(\\"winspool.drv\\",SetLastError=true)]`,
        `  public static extern bool EndDocPrinter(IntPtr h);`,
        `  [DllImport(\\"winspool.drv\\",SetLastError=true)]`,
        `  public static extern bool StartPagePrinter(IntPtr h);`,
        `  [DllImport(\\"winspool.drv\\",SetLastError=true)]`,
        `  public static extern bool EndPagePrinter(IntPtr h);`,
        `  [DllImport(\\"winspool.drv\\",SetLastError=true)]`,
        `  public static extern bool WritePrinter(IntPtr h,IntPtr buf,int cb,out int written);`,
        `}`,
        `'@ -Language CSharp;`,
        `$hPrinter = [IntPtr]::Zero;`,
        `[RawPrinter]::OpenPrinter($printer,[ref]$hPrinter,[IntPtr]::Zero) | Out-Null;`,
        `$docInfo = @(1,[System.Runtime.InteropServices.Marshal]::StringToHGlobalUni('RAW'),`,
        `[IntPtr]::Zero,[System.Runtime.InteropServices.Marshal]::StringToHGlobalUni('RAW'),0);`,
        `[RawPrinter]::StartDocPrinter($hPrinter,1,$docInfo) | Out-Null;`,
        `[RawPrinter]::StartPagePrinter($hPrinter) | Out-Null;`,
        `$buf=[System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length);`,
        `[System.Runtime.InteropServices.Marshal]::Copy($bytes,0,$buf,$bytes.Length);`,
        `$written=0;`,
        `[RawPrinter]::WritePrinter($hPrinter,$buf,$bytes.Length,[ref]$written) | Out-Null;`,
        `[System.Runtime.InteropServices.Marshal]::FreeHGlobal($buf);`,
        `[RawPrinter]::EndPagePrinter($hPrinter) | Out-Null;`,
        `[RawPrinter]::EndDocPrinter($hPrinter) | Out-Null;`,
        `[RawPrinter]::ClosePrinter($hPrinter) | Out-Null"`,
      ].join(' ');

      await _execPromise(ps, 20000);
      log('RAW', `✅ RawPrinter → [${printerName}]`);
      return;
    }

    // ── طريقة 2: copy /B إلى منفذ الطابعة الافتراضية ──────
    // البحث عن أول طابعة تحتوي "XP" أو "Label" أو "Zebra"
    const { execSync } = require('child_process');
    let portName = '';
    try {
      const out = execSync(
        'powershell -NoProfile -Command "Get-Printer | Where-Object {$_.Name -match \'XP|Label|Zebra|TSC|SATO\'} | Select-Object -First 1 -ExpandProperty PortName"',
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      portName = out;
    } catch(_) {}

    if (portName) {
      const safeFile = tmpRaw.replace(/\\/g, '\\\\');
      await _execPromise(
        `cmd /C "copy /B \\"${safeFile}\\" \\"${portName}\\""`,
        10000
      );
      log('RAW', `✅ copy /B → [${portName}]`);
    } else {
      throw new Error('لم يُعثر على طابعة ملصقات — حدد اسم الطابعة في الإعدادات');
    }

  } finally {
    setTimeout(cleanup, 5000);
  }
}

// ── إرسال بيانات خام على Linux / macOS ────────────────────
async function _rawPrintUnix(commands, printerName) {
  const ts     = Date.now();
  const tmpRaw = path.join(os.tmpdir(), `hppos_raw_${ts}.tmp`);
  fs.writeFileSync(tmpRaw, Buffer.from(commands, 'utf8'));
  try {
    const pFlag = printerName ? `-d "${printerName}"` : '';
    await _execPromise(`lpr -l ${pFlag} "${tmpRaw}"`, 10000);
    log('RAW', `✅ lpr -l → [${printerName || 'افتراضية'}]`);
  } finally {
    setTimeout(() => { try { fs.unlinkSync(tmpRaw); } catch(_) {} }, 5000);
  }
}

app.post('/api/print-raw', async (req, res) => {
  const { commands, printerName, protocol, vid, pid } = req.body;

  if (!commands || typeof commands !== 'string' || !commands.trim()) {
    return res.status(400).json({ error: 'missing_commands' });
  }

  const printer  = (printerName || '').trim();
  const proto    = (protocol    || 'TSPL').toUpperCase();

  log('RAW', `طلب طباعة ${proto} | طابعة: [${printer || 'auto'}] | VID:${vid||'-'} PID:${pid||'-'}`);

  try {
    if (process.platform === 'win32') {
      await _rawPrintWindows(commands, printer);
    } else {
      await _rawPrintUnix(commands, printer);
    }
    res.json({ status: 'ok', protocol: proto, printer: printer || 'auto' });

  } catch(e) {
    log('RAW', `❌ فشل: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  محرك الطباعة الحرارية ESC/POS
//  يُحمَّل عند الطلب (lazy) — لا يتسبب في خطأ إن لم تُثبَّت escpos
// ════════════════════════════════════════════════════════════
let _escposEngine = null;
function _getEscposEngine() {
  if (!_escposEngine) {
    try {
      _escposEngine = require('./escpos-engine');
    } catch (e) {
      throw new Error(
        'escpos-engine.js غير موجود أو مكتباته غير مثبتة.\n' +
        'نفِّذ: npm install escpos escpos-usb jimp'
      );
    }
  }
  return _escposEngine;
}

// ════════════════════════════════════════════════════════════
//  API: جلب طابعات USB  /api/printers-usb
//  يُعيد قائمة الطابعات الحرارية USB المتصلة (VID/PID)
// ════════════════════════════════════════════════════════════
app.get('/api/printers-usb', (req, res) => {
  try {
    const engine   = _getEscposEngine();
    const printers = engine.getPrinters();
    log('ESCPOS', `طابعات USB: ${printers.length}`);
    res.json({ status: 'ok', printers });
  } catch (e) {
    log('ESCPOS', `⚠️ printers-usb: ${e.message}`);
    res.json({ status: 'ok', printers: [], warning: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  API: طباعة مباشرة ESC/POS  /api/print-escpos
//
//  يقبل نوعين من الطلبات (حقل type):
//    type = 'receipt' → طباعة فاتورة
//      { type, sale, items, cfg }
//    type = 'barcode' → طباعة ملصق باركود
//      { type, product, opts }
//
//  cfg / opts يحتويان:
//    vid, pid        VID/PID الطابعة  (اختياري — auto-detect إن غاب)
//    storeName       اسم المتجر
//    storePhone      رقم الهاتف
//    logoPath        مسار شعار المحل
//    currency        العملة
//    showBarcode     true/false
//    paperWidth      58 | 80
//    barcodeType     'CODE128' | 'EAN13' | 'CODE39'
//    copies          عدد النسخ
// ════════════════════════════════════════════════════════════
app.post('/api/print-escpos', async (req, res) => {
  const { type, sale, items, cfg, product, opts } = req.body;

  if (!type || !['receipt', 'barcode'].includes(type)) {
    return res.status(400).json({ error: 'type يجب أن يكون receipt أو barcode' });
  }

  let engine;
  try {
    engine = _getEscposEngine();
  } catch (e) {
    log('ESCPOS', `❌ المحرك غير متاح: ${e.message}`);
    return res.status(503).json({ error: e.message });
  }

  try {
    let result;

    if (type === 'receipt') {
      if (!sale) return res.status(400).json({ error: 'بيانات البيع مفقودة' });
      result = await engine.printReceipt(sale, items || [], cfg || {});
      log('ESCPOS', `✅ receipt | فاتورة: ${sale.invoiceNumber || '-'} | طابعة: ${cfg?.vid || 'auto'}`);

    } else {
      if (!product) return res.status(400).json({ error: 'بيانات المنتج مفقودة' });
      result = await engine.printBarcode(product, opts || {});
      log('ESCPOS', `✅ barcode | ${product.name || '-'} × ${result.copies || 1}`);
    }

    res.json({ status: 'ok', ...result });

  } catch (e) {
    log('ESCPOS', `❌ فشل: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
//  تشغيل السيرفر
// ════════════════════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  log('SERVER', `✅ HP-POS Server v8.4.0 يعمل على المنفذ ${PORT}`);
  log('SERVER', `🌐 الوصول المحلي:    http://localhost:${PORT}`);
  log('SERVER', `📡 الشبكة المحلية:   http://<IP-الجهاز>:${PORT}`);
  log('SERVER', `📧 البريد:   ${config.emailSender ? '✅ مُهيَّأ' : '⚠️ يحتاج إعداد'}`);
  log('SERVER', `📱 SMS:      ${config.smsEnabled   ? '✅ مُفعَّل' : '⛔ معطّل'}`);

  // فحص متطلبات الطباعة عند الإطلاق
  const browser = _findBrowser();
  const sumatra = _findSumatraPDF();
  log('PRINT', `🖥️  المتصفح:    ${browser  ? `✅ ${path.basename(browser)}` : '❌ غير موجود'}`);
  log('PRINT', `📄 SumatraPDF: ${sumatra  ? `✅ ${sumatra}` : '⚠️  غير موجود (Fallback نشط)'}`);
  log('PRINT', `🏷️  TSPL/ZPL:   ✅ /api/print-raw جاهز`);
  log('PRINT', `⚡ ESC/POS:    ✅ /api/print-escpos جاهز (يتطلب escpos + escpos-usb)`);
});
