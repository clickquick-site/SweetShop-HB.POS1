/**
 * print.js — HP-POS · وحدة الطباعة الاحترافية  v8.5.0
 * ═══════════════════════════════════════════════════════
 *  • فاتورة: 4 أنواع (عادية / دين / جزئي / تسديد)
 *  • باركود: SVG حقيقي داخل نافذة الطباعة عبر JsBarcode
 *  • @page دقيق لكل حجم ورق / ملصق
 *  • ملصقات TSPL/ZPL لطابعات Zebra/Xprinter المخصصة
 *  • PID/VID لكل طابعة في ملف الإعدادات
 *  • ESC/POS مباشر عبر escpos-engine + دعم عربي كامل
 *
 *  v8.5.0 — طبقة ESC/POS + Arabic Reshaper + IPC Electron
 *  ══════════════════════════════════════════════════════
 *  خمس طبقات بترتيب الأولوية لـ printInvoice:
 *
 *  [ 0 ] ESC/POS مباشر ← escpos-engine عبر /api/print-escpos
 *         يُفعَّل بإعداد: useEscpos = '1'
 *         في Electron: window.electronAPI.printReceipt()
 *         في Node:     /api/print-escpos  { type:'receipt', ... }
 *
 *  [ 1 ] electronAPI.printSilent  ← exe بدون أي نافذة (HTML)
 *  [ 2 ] server.js /api/print     ← node محلي + Puppeteer (HTML)
 *  [ 3 ] window.open fallback     ← متصفح عادي
 *
 *  طبقات printBarcode (ملصق الباركود):
 *  [ 0 ] ESC/POS مباشر ← /api/print-escpos { type:'barcode', ... }
 *  [ 1 ] TSPL/ZPL → /api/print-raw
 *  [ 2 ] HTML fallback (JsBarcode + window.open/server)
 *
 *  v8.3.0 — طبقة Electron للتطبيقات المكتبية .exe
 *  ══════════════════════════════════════════════════════
 *  ثلاث طبقات بترتيب الأولوية:
 *
 *  [ 1 ] electronAPI  ← .exe / Electron — صامتة 100٪ بدون أي نافذة
 *         المطلوب في preload.js عند بناء الـ exe:
 *         ┌────────────────────────────────────────────────────────┐
 *         │ const { contextBridge, ipcRenderer } = require('electron')
 *         │ contextBridge.exposeInMainWorld('electronAPI', {
 *         │   isElectron: true,
 *         │   getPrinters: () => ipcRenderer.invoke('get-printers'),
 *         │   printSilent: (html, printerName, opts) =>
 *         │     ipcRenderer.invoke('print-silent', { html, printerName, opts })
 *         │ })
 *         └────────────────────────────────────────────────────────┘
 *         المطلوب في main.js:
 *         ┌────────────────────────────────────────────────────────┐
 *         │ ipcMain.handle('get-printers', async () => {
 *         │   return win.webContents.getPrintersAsync()
 *         │     .then(list => list.map(p => p.name))
 *         │ })
 *         │ ipcMain.handle('print-silent', async (e, { html, printerName, opts }) => {
 *         │   // فتح BrowserWindow مخفية → loadURL(dataURL) → webContents.print()
 *         │   // راجع: https://www.electronjs.org/docs/api/web-contents#contentsprintoptions
 *         │   return { success: true }
 *         │ })
 *         └────────────────────────────────────────────────────────┘
 *
 *  [ 2 ] server.js   ← تشغيل محلي مع node server.js (الوضع الحالي)
 *  [ 3 ] window.open ← متصفح عادي / GitHub Pages (fallback نهائي)
 *
 *  إصلاحات v8.2.0 محفوظة بالكامل:
 *  ① XSS: JSON.stringify بدل دمج النصوص في JsBarcode
 *  ② AbortController بدل AbortSignal.timeout (دعم أوسع)
 *  ③ HTML → base64 قبل الإرسال (يمنع crash السيرفر)
 *  ④ حساب topMm مصحح (خطأ قسمة مزدوجة على PX_MM)
 *  ⑤ window.open: فحص محكم قبل الاستخدام
 *  ⑥ حد أقصى 200 نسخة باركود (بدل 500)
 *  ⑦ Toast "جاري الطباعة..." أثناء الانتظار
 *  ⑧ @media print للطابعات الحرارية
 *  ⑨ عرض الباركود قابل للضبط من الإعدادات
 *  ⑩ Cache للإعدادات (يقرأ IndexedDB مرة واحدة فقط)
 * ═══════════════════════════════════════════════════════
 */

;(function (window) {
  'use strict';

  /* CDN */
  var JSBC_CDN = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';

  /* احجام الملصقات بالمم */
  var LABEL_SIZES = {
    '30x20' :{w:30 ,h:20}, '40x20' :{w:40 ,h:20},
    '38x25' :{w:38 ,h:25}, '40x25' :{w:40 ,h:25},
    '40x30' :{w:40 ,h:30}, '50x30' :{w:50 ,h:30},
    '50x40' :{w:50 ,h:40}, '57x32' :{w:57 ,h:32},
    '58x20' :{w:58 ,h:20}, '58x30' :{w:58 ,h:30},
    '58x40' :{w:58 ,h:40}, '60x40' :{w:60 ,h:40},
    '70x50' :{w:70 ,h:50}, '100x50':{w:100,h:50},
  };

  /* ══════════════════════════════════════════════════════
     ⑩ Cache للإعدادات — يقرأ IndexedDB مرة واحدة لكل مفتاح
     ══════════════════════════════════════════════════════ */
  var _SETTINGS_CACHE = {};

  function cfg(key, def) {
    if (def === undefined) def = '';
    // إذا موجود في Cache أرجعه فوراً
    if (_SETTINGS_CACHE[key] !== undefined) {
      return Promise.resolve(_SETTINGS_CACHE[key]);
    }
    return window.getSetting(key).then(function(v) {
      var val = (v != null && v !== '') ? v : def;
      _SETTINGS_CACHE[key] = val;
      return val;
    }).catch(function() {
      _SETTINGS_CACHE[key] = def;
      return def;
    });
  }

  /* مسح Cache عند الحاجة (يُستدعى من settings.html بعد الحفظ) */
  function clearSettingsCache() {
    _SETTINGS_CACHE = {};
  }

  /* تنسيق رقم */
  function fmt(n, dec) {
    if (dec === undefined) dec = 2;
    return (parseFloat(n) || 0).toFixed(dec);
  }

  /* تنظيف HTML */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ③ تحويل HTML إلى base64 للإرسال الآمن */
  function _toBase64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch(e) {
      return btoa(str);
    }
  }

  /* مساعد: جلب عنوان الخادم */
  function _serverUrl() {
    return (localStorage.getItem('posdz_server_url') || 'http://localhost:3000')
           .replace(/\/$/, '');
  }

  /* ══════════════════════════════════════════════════════
     كشف بيئة التشغيل
     true  → تطبيق مكتبي Electron (.exe) — window.electronAPI موجود
     false → متصفح عادي (GitHub Pages أو server.js محلي)
     ══════════════════════════════════════════════════════ */
  function _isElectron() {
    return !!(window.electronAPI && window.electronAPI.isElectron === true);
  }

  /* ══════════════════════════════════════════════════════
     طباعة صامتة — ثلاث طبقات بترتيب الأولوية:
     [ 1 ] electronAPI.printSilent  ← exe بدون أي نافذة
     [ 2 ] server.js /api/print     ← node محلي + Puppeteer
     [ 3 ] window.open fallback     ← يُستدعى من الخارج عند false

     القاعدة:
     • خطأ EXPECTED  (خادم غائب)  → صامت، ننتقل للطبقة التالية
     • خطأ UNEXPECTED (API موجود لكن فشل) → إشعار واضح
     ══════════════════════════════════════════════════════ */
  async function _silentPrint(html, css, printerName, paperMm) {
    var fullHtml =
      '<!DOCTYPE html>\n<html dir="rtl" lang="ar">\n<head>\n' +
      '<meta charset="UTF-8"/>\n' +
      '<script src="' + JSBC_CDN + '"><\/script>\n' +
      '<style>' + css + '</style>\n</head>\n<body>' + html + '</body>\n</html>';

    /* ══ الطبقة 1: Electron — UNEXPECTED إذا فشل ══ */
    if (_isElectron() && typeof window.electronAPI.printSilent === 'function') {
      if (window.toast) window.toast.show('🖨️ جاري الطباعة...', 'info', 8000);
      try {
        var result = await window.electronAPI.printSilent(
          fullHtml,
          printerName || '',
          { paperMm: paperMm || 80 }
        );
        if (result && result.success !== false) {
          if (window.toast) window.toast.show(
            '✅ تمت الطباعة' + (printerName ? ' على: ' + printerName : ''),
            'success'
          );
          return true;
        }
        // Electron رد بـ success:false — خطأ غير متوقع
        var errMsg = result?.error || 'فشل الطباعة — تحقق من الطابعة';
        window.errorLogger?.error('print.Electron', errMsg);
        if (window.toast) window.toast.show('❌ ' + errMsg, 'error', 6000);
        return false;
      } catch (e) {
        // استثناء في electronAPI — غير متوقع
        window.errorLogger?.error('print.Electron', 'خطأ في واجهة الطباعة', e);
        if (window.toast) window.toast.show('❌ خطأ في واجهة الطباعة — تحقق من التطبيق', 'error', 6000);
        return false;
      }
    }

    /* ══ الطبقة 2: server.js — EXPECTED إذا غائب ══ */
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 30000);

    if (window.toast) window.toast.show('🖨️ جاري الطباعة...', 'info', 30000);

    try {
      var res = await fetch(_serverUrl() + '/api/print', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          htmlBase64  : _toBase64(fullHtml),
          printerName : printerName || '',
          paperMm     : paperMm    || 80,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      var data = await res.json();

      if (data.status === 'ok') {
        if (window.toast) window.toast.show(
          '✅ تمت الطباعة على: ' + (printerName || 'الطابعة الافتراضية'),
          'success'
        );
        return true;
      }
      // الخادم يعمل لكن أعاد خطأ — UNEXPECTED
      var srvErr = data.error || 'خطأ في خادم الطباعة';
      window.errorLogger?.warn('print.server', srvErr);
      if (window.toast) window.toast.show('⚠️ ' + srvErr, 'warning', 5000);
      return false;

    } catch (e) {
      clearTimeout(timer);
      // الخادم غير متاح — EXPECTED — ننتقل لـ window.open بصمت
      window.errorLogger?.info('print.server', 'الخادم غير متاح — سيُستخدم window.open');
      return false;
    }
  }

  /* ══════════════════════════════════════════════════════
     طبقة 0: ESC/POS مباشر
     ─────────────────────────────────────────────────────
     تُجرِّب مسارَين بالترتيب:
     أ) Electron IPC — window.electronAPI.printReceipt/printBarcode
     ب) server.js    — /api/print-escpos

     تُعيد true عند النجاح، false عند الفشل أو غياب الدعم.
     ══════════════════════════════════════════════════════ */

  /* فاتورة ESC/POS */
  async function _escposPrintReceipt(sale, items, escposCfg) {
    /* مسار أ: Electron IPC */
    if (_isElectron() && typeof window.electronAPI.printReceipt === 'function') {
      if (window.toast) window.toast.show('🖨️ جاري الطباعة ESC/POS...', 'info', 8000);
      try {
        var res = await window.electronAPI.printReceipt(sale, items, escposCfg);
        if (res && res.success !== false) {
          if (window.toast) window.toast.show('✅ تمت الطباعة (ESC/POS)', 'success');
          return true;
        }
        /* Electron رد بـ success:false — خطأ حقيقي */
        var em = res?.error || 'فشل ESC/POS في Electron';
        window.errorLogger?.warn('escpos.electron', em);
        if (window.toast) window.toast.show('⚠️ ' + em, 'warning', 5000);
        return false;
      } catch(e) {
        window.errorLogger?.error('escpos.electron', 'استثناء IPC', e);
        if (window.toast) window.toast.show('❌ خطأ في IPC: ' + e.message, 'error', 5000);
        return false;
      }
    }

    /* مسار ب: server.js /api/print-escpos */
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 20000);
    if (window.toast) window.toast.show('🖨️ جاري الطباعة ESC/POS...', 'info', 20000);
    try {
      var r = await fetch(_serverUrl() + '/api/print-escpos', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ type: 'receipt', sale: sale, items: items, cfg: escposCfg }),
        signal : controller.signal,
      });
      clearTimeout(timer);
      var data = await r.json();
      if (data.status === 'ok') {
        if (window.toast) window.toast.show('✅ تمت الطباعة (ESC/POS)', 'success');
        return true;
      }
      var srvErr2 = data.error || 'خطأ في ESC/POS';
      window.errorLogger?.warn('escpos.server', srvErr2);
      if (window.toast) window.toast.show('⚠️ ' + srvErr2, 'warning', 5000);
      return false;
    } catch(e) {
      clearTimeout(timer);
      /* الخادم غائب أو لا يدعم escpos — EXPECTED — ننتقل للطبقة التالية */
      window.errorLogger?.info('escpos.server', 'ESC/POS غير متاح — fallback HTML');
      return false;
    }
  }

  /* باركود ESC/POS */
  async function _escposPrintBarcode(product, escposOpts) {
    /* مسار أ: Electron IPC */
    if (_isElectron() && typeof window.electronAPI.printBarcode === 'function') {
      if (window.toast) window.toast.show('🖨️ جاري طباعة الباركود ESC/POS...', 'info', 8000);
      try {
        var res = await window.electronAPI.printBarcode(product, escposOpts);
        if (res && res.success !== false) {
          if (window.toast) window.toast.show('✅ تم الباركود (ESC/POS) × ' + (res.copies || 1), 'success');
          return true;
        }
        var em = res?.error || 'فشل باركود ESC/POS';
        if (window.toast) window.toast.show('⚠️ ' + em, 'warning', 5000);
        return false;
      } catch(e) {
        if (window.toast) window.toast.show('❌ ' + e.message, 'error', 5000);
        return false;
      }
    }

    /* مسار ب: server.js /api/print-escpos */
    var controller2 = new AbortController();
    var timer2 = setTimeout(function() { controller2.abort(); }, 20000);
    if (window.toast) window.toast.show('🖨️ جاري طباعة الباركود ESC/POS...', 'info', 20000);
    try {
      var r2 = await fetch(_serverUrl() + '/api/print-escpos', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ type: 'barcode', product: product, opts: escposOpts }),
        signal : controller2.signal,
      });
      clearTimeout(timer2);
      var data2 = await r2.json();
      if (data2.status === 'ok') {
        if (window.toast) window.toast.show('✅ تم الباركود (ESC/POS)', 'success');
        return true;
      }
      var bErr = data2.error || 'خطأ باركود ESC/POS';
      if (window.toast) window.toast.show('⚠️ ' + bErr, 'warning', 5000);
      return false;
    } catch(e) {
      clearTimeout(timer2);
      window.errorLogger?.info('escpos.barcode', 'ESC/POS غير متاح — fallback HTML');
      return false;
    }
  }

  /* ══════════════════════════════════════════════════════
     فتح نافذة طباعة — fallback عند غياب الخادم
     ⑤ فحص محكم لـ window.open
     ══════════════════════════════════════════════════════ */
  function openWin(html, css, title) {
    var w = window.open('', '_blank',
      'width=700,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes');
    /* ⑤ فحص محكم: null أو مغلق أو محجوب */
    if (!w || w.closed || typeof w.closed === 'undefined') {
      if (window.toast) {
        window.toast.show('⚠️ فعّل النوافذ المنبثقة في المتصفح لتتمكن من الطباعة', 'warning', 5000);
      }
      return null;
    }
    w.document.write(
      '<!DOCTYPE html>\n<html dir="rtl" lang="ar">\n<head>\n' +
      '<meta charset="UTF-8"/>\n<title>' + esc(title) + '</title>\n' +
      '<script src="' + JSBC_CDN + '"><\/script>\n' +
      '<style>' + css + '</style>\n</head>\n<body>' + html + '</body>\n</html>'
    );
    w.document.close();
    return w;
  }

  /* تشغيل الطباعة — fallback */
  function doPrint(w) {
    if (!w || w.closed || typeof w.closed === 'undefined') return;
    setTimeout(function() {
      if (!w.closed) {
        w.focus();
        w.print();
        setTimeout(function() { try { w.close(); } catch(e) {} }, 800);
      }
    }, 700);
  }

  /* ══════════════════════════════════════════════════════
     1. طباعة الفاتورة
     ══════════════════════════════════════════════════════ */
  async function printInvoice(sale, items) {
    if (!sale) return;

    /* اعدادات — مستفيدة من Cache ⑩ */
    var paper      = await cfg('paperSize',    '80mm');
    var storeName  = await cfg('storeName',    '');
    var storePhone = await cfg('storePhone',   '');
    var storeAddr  = await cfg('storeAddress', '');
    var welcome    = await cfg('storeWelcome', 'شكراً لزيارتكم');
    var currency   = await cfg('currency',     'DA');
    var showName   = (await cfg('printName',    '1')) === '1';
    var showPhone  = (await cfg('printPhone',   '1')) === '1';
    var showAddr   = (await cfg('printAddress', '1')) === '1';
    var showWelc   = (await cfg('printWelcome', '1')) === '1';
    var showBC     = (await cfg('printBarcode', '1')) === '1';
    var useEscpos  = (await cfg('useEscpos',    '0')) === '1';

    var paperMm  = paper === '58mm' ? 58 : 80;
    var printW   = paper === '58mm' ? 46 : 68;
    var fontSize = paper === '58mm' ? '9pt' : '10.5pt';

    /* ══ الطبقة 0: ESC/POS مباشر — إذا كان مُفعَّلاً ══ */
    if (useEscpos) {
      var escposCfg = {
        vid         : await cfg('printerInvoiceVID', ''),
        pid         : await cfg('printerInvoicePID', ''),
        storeName   : showName  ? storeName  : '',
        storePhone  : showPhone ? storePhone : '',
        storeAddress: showAddr  ? storeAddr  : '',
        storeWelcome: showWelc  ? welcome    : '',
        logoPath    : await cfg('logoPath', ''),
        currency    : currency,
        showBarcode : showBC,
        paperWidth  : paperMm,
      };
      var escposDone = await _escposPrintReceipt(sale, items, escposCfg);
      if (escposDone) return;
      /* فشل ESC/POS → الاستمرار بالطباعة HTML */
    }

    /* تحليل البيع */
    var invNum   = sale.invoiceNumber || '';
    var kind     = sale.invoiceKind || (sale.isDebt ? 'debt' : 'normal');
    var total    = parseFloat(sale.total)    || 0;
    var discount = parseFloat(sale.discount) || 0;
    var netTotal = total - discount;
    var paid     = parseFloat(sale.paid)     || 0;
    var change   = parseFloat(sale.change)   || 0;
    var debt     = netTotal - paid;

    var kindLabel = {
      normal : 'فاتورة',
      debt   : 'فاتورة دين',
      partial: 'فاتورة تسديد جزئي',
      payment: 'فاتورة تسديد دين',
    }[kind] || 'فاتورة';

    /* تاريخ */
    var dateStr = '';
    try {
      var d = new Date(sale.date);
      dateStr = d.getFullYear() + '/' +
        String(d.getMonth()+1).padStart(2,'0') + '/' +
        String(d.getDate()).padStart(2,'0') + ' ' +
        String(d.getHours()).padStart(2,'0') + ':' +
        String(d.getMinutes()).padStart(2,'0');
    } catch(e) {}

    /* صفوف المنتجات */
    var rows = '';
    (items || []).forEach(function(it) {
      var lineTotal = it.total != null ? it.total : (it.quantity * it.unitPrice);
      rows +=
        '<tr>' +
        '<td class="cn">' + esc(it.name || '') + '</td>' +
        '<td class="cq">' + fmt(it.quantity, 0) + '</td>' +
        '<td class="cp">' + fmt(it.unitPrice) + '</td>' +
        '<td class="ct">' + fmt(lineTotal) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    });

    /* المجاميع */
    var sumRows =
      '<tr class="total-row">' +
      '<td style="text-align:right;"><b>الإجمالي:</b></td>' +
      '<td style="text-align:left;direction:ltr;">' + fmt(netTotal) + ' ' + esc(currency) + '</td>' +
      '</tr>';

    if (kind === 'normal') {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(paid) + ' ' + esc(currency) + '</td>' +
        '</tr>';
      if (change > 0) sumRows +=
        '<tr class="hdr-row">' +
        '<td style="text-align:right;">الباقي:</td>' +
        '<td style="text-align:left;direction:ltr;color:#1a6b2e;font-weight:900;">' + fmt(change) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    } else if (kind === 'debt') {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">0.00 ' + esc(currency) + '</td>' +
        '</tr>' +
        '<tr class="total-row" style="color:#000;font-weight:900;">' +
        '<td style="text-align:right;">الدين:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(netTotal) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    } else if (kind === 'partial') {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(paid) + ' ' + esc(currency) + '</td>' +
        '</tr>' +
        '<tr class="total-row" style="color:#000;font-weight:900;">' +
        '<td style="text-align:right;">الدين:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(debt) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    } else {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(paid) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    }

    /* ① باركود الفاتورة — JSON.stringify بدل دمج النصوص */
    var bcSection = showBC && invNum ?
      '<div style="text-align:center;margin:4px 0 2px;">' +
      '<svg id="invBC" style="display:block;margin:0 auto;max-width:100%;"></svg>' +
      '<div class="barcode-num">' + esc(invNum) + '</div>' +
      '</div>' +
      '<script>' +
      'window.addEventListener("load",function(){' +
      'try{JsBarcode("#invBC",' + JSON.stringify(invNum) + ',{' +
      'format:"CODE128",width:1.4,height:36,displayValue:false,margin:0,' +
      'background:"#fff",lineColor:"#000"' +
      '});}catch(e){}});' +
      '<\/script>' : '';

    /* رأس الفاتورة */
    var custRow = (sale.customerName || sale.customerPhone) ?
      '<tr class="hdr-row">' +
      '<td style="text-align:right;">الزبون:</td>' +
      '<td style="text-align:left;direction:ltr;">' + esc(sale.customerName || sale.customerPhone || '') + '</td>' +
      '</tr>' : '';

    var storeBlock = '';
    if (showName && storeName)  storeBlock += '<div class="store-name">' + esc(storeName) + '</div>';
    if (showPhone && storePhone) storeBlock += '<div style="text-align:center;font-weight:900;margin:1px 0;">' + esc(storePhone) + '</div>';
    if (showAddr  && storeAddr)  storeBlock += '<div style="text-align:center;font-size:0.88em;margin:1px 0;">' + esc(storeAddr) + '</div>';
    var hr2after = storeBlock ? '<hr class="d2">' : '';

    var html =
      '<div class="content">' +
      '<table class="t2"><colgroup><col><col></colgroup><tbody>' +
      '<tr class="hdr-row"><td colspan="2" style="text-align:right;padding-bottom:1px;">' + esc(kindLabel) + ': ' + esc(invNum) + '</td></tr>' +
      '<tr class="hdr-row"><td colspan="2" style="text-align:right;direction:ltr;padding-top:0;">' + esc(dateStr) + '</td></tr>' +
      '<tr class="hdr-row"><td style="text-align:right;">البائع:</td><td style="text-align:left;direction:ltr;">' + esc(sale.sellerName || 'ADMIN') + '</td></tr>' +
      custRow +
      '</tbody></table>' +
      '<hr class="d2">' +
      storeBlock + hr2after +
      '<table class="ti"><colgroup>' +
      '<col class="cn"><col class="cq"><col class="cp"><col class="ct">' +
      '</colgroup><thead><tr>' +
      '<th class="cn">المنتج</th><th class="cq">ك</th>' +
      '<th class="cp">السعر</th><th class="ct">المجموع</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<hr class="d1">' +
      '<table class="t2"><colgroup><col><col></colgroup><tbody>' + sumRows + '</tbody></table>' +
      '<hr class="d2">' +
      (showWelc && welcome ? '<div class="welcome">' + esc(welcome) + '</div>' : '') +
      bcSection +
      '<hr class="db">' +
      '<div style="height:8mm;"></div>' +
      '</div>';

    /* ⑧ CSS + @media print للطابعات الحرارية */
    var css =
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}' +
      '@page{size:' + paperMm + 'mm auto;margin:2mm;}' +
      'html,body{width:100%;max-width:' + (paperMm-4) + 'mm;background:#fff;margin:0;padding:0;' +
      'font-family:"Courier New",Courier,monospace;' +
      'font-size:' + fontSize + ';font-weight:800;direction:rtl;color:#000;}' +
      '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '.content{width:' + printW + 'mm;margin:0 auto;}' +
      '.hdr-row td{font-size:' + fontSize + ';font-weight:900;padding:2px 0;}' +
      '.store-name{font-size:1.35em;font-weight:900;letter-spacing:.5px;margin:4px 0;text-align:center;}' +
      '.welcome{font-size:1.2em;font-weight:900;margin:4px 0 2px;text-align:center;}' +
      '.barcode-num{font-family:"Courier New",monospace;font-size:.82em;letter-spacing:3px;margin:2px 0;font-weight:700;text-align:center;}' +
      '.t2{width:100%;border-collapse:collapse;table-layout:fixed;}' +
      '.t2 col:nth-child(1){width:42%;}.t2 col:nth-child(2){width:58%;}' +
      '.t2 td{padding:2px 0;vertical-align:baseline;overflow:hidden;word-break:break-all;}' +
      '.ti{width:100%;border-collapse:collapse;table-layout:fixed;' +
      'font-size:' + fontSize + ';font-weight:800;margin:3px 0;}' +
      '.ti thead tr{border-bottom:2px solid #000;}' +
      '.ti th{font-size:.92em;font-weight:900;padding:3px 1px;text-align:right;}' +
      '.ti td{padding:3px 1px;font-weight:800;vertical-align:top;overflow:hidden;word-break:break-word;}' +
      '.ti tbody tr+tr{border-top:1px dashed #aaa;}' +
      '.cn{width:34%;text-align:right;}' +
      '.cq{width:9%;text-align:center;}' +
      '.cp{width:24%;text-align:right;white-space:nowrap;}' +
      '.ct{width:33%;text-align:right;direction:ltr;font-weight:900;}' +
      '.total-row td{font-size:1.3em;font-weight:900;padding:3px 0;}' +
      '.paid-row td{font-size:1.15em;font-weight:800;padding:2px 0;}' +
      'hr{border:none;margin:4px 0;}' +
      '.d1{border-top:1px dashed #555;}' +
      '.d2{border-top:2px solid #000;}' +
      '.db{border-top:1px dashed #999;margin-top:5px;}';

    var printerName = await cfg('printerInvoice', '');
    var silent = await _silentPrint(html, css, printerName, paperMm);
    if (!silent) {
      var w = openWin(html, css, kindLabel + ' ' + invNum);
      doPrint(w);
    }
  }

  /* ══════════════════════════════════════════════════════
     2. طباعة الباركود
     ══════════════════════════════════════════════════════ */
  async function printBarcode(product, copies) {
    if (!product) return;
    if (!copies) copies = 1;

    var rawSize  = (await cfg('barcodeSize',     '40x30')).replace(/[×*]/g,'x');
    var bcType   =  await cfg('barcodeType',      'CODE128');
    var fontSize = parseInt(await cfg('barcodeFontSize','12')) || 12;
    var showStore= (await cfg('barcodeShowStore', '0')) === '1';
    var showName = (await cfg('barcodeShowName',  '1')) === '1';
    var showPrice= (await cfg('barcodeShowPrice', '1')) === '1';
    var storeName=  await cfg('storeName', '');
    var currency =  await cfg('currency',  'DA');
    var useEscpos= (await cfg('useEscpos', '0')) === '1';
    /* ⑨ عرض الباركود قابل للضبط من الإعدادات */
    var bcWidth  = parseFloat(await cfg('barcodeWidth', '1.4')) || 1.4;

    /* ══ الطبقة 0: ESC/POS مباشر ══ */
    if (useEscpos) {
      var escposOpts = {
        vid        : await cfg('printerBarcodeVID', ''),
        pid        : await cfg('printerBarcodePID', ''),
        copies     : copies,
        barcodeType: bcType,
        currency   : currency,
        showName   : showName,
        showPrice  : showPrice,
      };
      var escposBcDone = await _escposPrintBarcode(product, escposOpts);
      if (escposBcDone) return;
      /* فشل ESC/POS → الاستمرار بالطباعة HTML */
    }

    var sz = LABEL_SIZES[rawSize] || {w:40,h:30};
    /* ⑥ حد أقصى 200 نسخة بدل 500 */
    var n  = Math.max(1, Math.min(200, parseInt(copies) || 1));

    var code     = String(product.barcode || '');
    var name     = String(product.name    || '');
    var rawPrice = product.sellPrice != null ? product.sellPrice : (product.price != null ? product.price : '');
    var priceStr = rawPrice !== '' ? fmt(rawPrice) + ' ' + esc(currency) : '';

    /* خطوط */
    var FSstore = Math.max(5, fontSize - 1);
    var FSname  = Math.max(5, fontSize);
    var FScode  = Math.max(5, fontSize - 2);
    var FSprice = Math.max(5, fontSize + 1);
    var PX_MM   = 3.7795; /* 1mm = 3.7795 px على 96dpi */

    /* ④ ارتفاع الباركود SVG — حساب مصحح (لا قسمة مزدوجة) */
    var topMm  = (showStore && storeName ? (FSstore + 1.5) / PX_MM : 0)
               + (showName  && name      ? (FSname  + 1.5) / PX_MM : 0);
    var botMm  = (FScode + 2)  / PX_MM
               + (showPrice && priceStr ? (FSprice + 2) / PX_MM : 0);
    var bcH_mm = Math.max(4, sz.h - topMm - botMm - 2);
    var bcH_px = Math.round(bcH_mm * PX_MM);

    /* خيارات JsBarcode — ⑨ استخدام bcWidth */
    var formats = {
      CODE128:{format:'CODE128', width: bcWidth},
      CODE39 :{format:'CODE39',  width: Math.max(1.0, bcWidth - 0.2)},
      EAN13  :{format:'EAN13',   width: bcWidth},
      EAN8   :{format:'EAN8',    width: bcWidth},
      UPCA   :{format:'UPC',     width: bcWidth},
      ITF14  :{format:'ITF14',   width: bcWidth},
      MSI    :{format:'MSI',     width: bcWidth},
    };
    var bcOpt = formats[bcType] || formats.CODE128;

    /* بناء الملصقات */
    var labels = '';
    for (var i = 0; i < n; i++) {
      var sid = 'bc_' + i;
      labels +=
        '<div class="label">' +
        (showStore && storeName ? '<div class="lstore">' + esc(storeName) + '</div>' : '') +
        (showName  && name      ? '<div class="lname">'  + esc(name)      + '</div>' : '') +
        '<div class="lbc"><svg id="' + sid + '" style="display:block;margin:0 auto;"></svg></div>' +
        '<div class="lcode">' + esc(code) + '</div>' +
        (showPrice && priceStr  ? '<div class="lprice">' + esc(priceStr) + '</div>' : '') +
        '</div>';
    }

    /* ① JsBarcode — JSON.stringify بدل دمج النصوص */
    var initJS =
      '<script>' +
      'window.addEventListener("load",function(){' +
      'var opt={format:' + JSON.stringify(bcOpt.format) + ',width:' + bcOpt.width + ',' +
      'height:' + bcH_px + ',displayValue:false,margin:0,' +
      'background:"#fff",lineColor:"#000"};' +
      'var code=' + JSON.stringify(code) + ';' +
      'for(var i=0;i<' + n + ';i++){' +
      'try{JsBarcode("#bc_"+i,code,opt);}catch(e){}' +
      '}});' +
      '<\/script>';

    /* ⑧ CSS + @media print للطابعات الحرارية */
    var css =
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}' +
      '@page{size:' + sz.w + 'mm ' + sz.h + 'mm;margin:0;}' +
      'html,body{width:' + sz.w + 'mm;background:#fff;' +
      'font-family:"Tahoma","Arial",sans-serif;color:#000;}' +
      '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '.label{width:' + sz.w + 'mm;height:' + sz.h + 'mm;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'padding:.8mm 1mm;overflow:hidden;' +
      'page-break-after:always;break-after:page;}' +
      '.label:last-child{page-break-after:avoid;break-after:avoid;}' +
      '.lstore{font-size:' + FSstore + 'px;font-weight:900;text-align:center;' +
      'line-height:1.1;white-space:nowrap;overflow:hidden;max-width:100%;margin-bottom:.4mm;}' +
      '.lname{font-size:' + FSname + 'px;font-weight:900;text-align:center;' +
      'line-height:1.1;white-space:nowrap;overflow:hidden;max-width:100%;margin-bottom:.4mm;}' +
      '.lbc{flex:1;display:flex;align-items:center;justify-content:center;' +
      'width:100%;overflow:hidden;padding:0 1mm;}' +
      '.lbc svg{max-width:100%;height:auto;}' +
      '.lcode{font-size:' + FScode + 'px;font-family:"Courier New",monospace;' +
      'text-align:center;letter-spacing:1px;margin-top:.3mm;}' +
      '.lprice{font-size:' + FSprice + 'px;font-weight:900;text-align:center;margin-top:.3mm;}';

    var printerName = await cfg('printerBarcode', '');
    var silent = await _silentPrint(labels + initJS, css, printerName, sz.w);
    if (!silent) {
      var w = openWin(labels + initJS, css, 'باركود: ' + name);
      doPrint(w);
    }
  }


  /* ══════════════════════════════════════════════════════
     3. بنّاء أوامر TSPL (Xprinter / TSC / SATO …)
        203 DPI = 8 نقطة/مم  —  تمركز تلقائي
     ══════════════════════════════════════════════════════ */
  function _buildTSPL(product, opts) {
    var w        = opts.width    || 40;
    var h        = opts.height   || 30;
    var n        = opts.copies   || 1;
    var code     = String(product.barcode || '');
    var name     = String(product.name    || '');
    var currency = opts.currency || 'DA';
    var rawPrice = product.sellPrice != null ? product.sellPrice
                 : (product.price   != null  ? product.price : '');
    var priceStr = rawPrice !== '' ? fmt(rawPrice) + ' ' + currency : '';

    var DPM  = 8;                          /* 203 DPI → 8 pt/mm */
    var W_pt = Math.round(w * DPM);
    var H_pt = Math.round(h * DPM);

    var ln = [];
    ln.push('SIZE '     + w + ' mm,' + h + ' mm');
    ln.push('GAP 2 mm,0 mm');
    ln.push('DIRECTION 1,0');
    ln.push('REFERENCE 0,0');
    ln.push('OFFSET 0 mm');
    ln.push('SET PEEL OFF');
    ln.push('SET CUTTER OFF');
    ln.push('CLS');

    var y = 8;

    if (name) {
      var nx = Math.max(4, Math.round((W_pt - Math.min(name.length * 12, W_pt - 8)) / 2));
      ln.push('TEXT ' + nx + ',' + y + ',"3",0,1,1,"' + name.replace(/"/g, '\\"') + '"');
      y += 22;
    }
    if (priceStr) {
      var px = Math.max(4, Math.round((W_pt - Math.min(priceStr.length * 10, W_pt - 8)) / 2));
      ln.push('TEXT ' + px + ',' + y + ',"3",0,1,1,"' + priceStr + '"');
      y += 20;
    }
    if (code) {
      var bcH    = Math.max(20, H_pt - y - 24);
      var estBcW = Math.round(code.length * 11 + 22);
      var bcX    = Math.max(4, Math.round((W_pt - estBcW) / 2));
      ln.push('BARCODE ' + bcX + ',' + y + ',"128",' + bcH + ',1,0,2,2,"' + code + '"');
      y += bcH + 4;
      var codeX = Math.max(4, Math.round((W_pt - code.length * 8) / 2));
      ln.push('TEXT ' + codeX + ',' + y + ',"0",0,1,1,"' + code + '"');
    }
    ln.push('PRINT ' + n + ',1');
    ln.push('');
    return ln.join('\r\n');
  }

  /* ══════════════════════════════════════════════════════
     4. بنّاء أوامر ZPL (Zebra / Honeywell …)
        ^FB للتمركز — ^BC Code128
     ══════════════════════════════════════════════════════ */
  function _buildZPL(product, opts) {
    var w        = opts.width    || 40;
    var h        = opts.height   || 30;
    var n        = opts.copies   || 1;
    var code     = String(product.barcode || '');
    var name     = String(product.name    || '');
    var currency = opts.currency || 'DA';
    var rawPrice = product.sellPrice != null ? product.sellPrice
                 : (product.price   != null  ? product.price : '');
    var priceStr = rawPrice !== '' ? fmt(rawPrice) + ' ' + currency : '';

    var DPM  = 8;
    var W_pt = Math.round(w * DPM);
    var H_pt = Math.round(h * DPM);

    var ln = [];
    ln.push('^XA');
    ln.push('^PW'  + W_pt);
    ln.push('^LL'  + H_pt);
    ln.push('^LH0,0');
    ln.push('^CI28');
    ln.push('^MMT');

    var y = 16;

    if (name) {
      ln.push('^FO0,' + y +
        '^FB' + W_pt + ',1,,C' +
        '^A0N,20,20' +
        '^FH^FD' + name + '^FS');
      y += 26;
    }
    if (priceStr) {
      ln.push('^FO0,' + y +
        '^FB' + W_pt + ',1,,C' +
        '^A0N,18,18' +
        '^FD' + priceStr + '^FS');
      y += 24;
    }
    if (code) {
      var bcH  = Math.max(20, H_pt - y - 28);
      var estW = Math.round(code.length * 11 + 22);
      var bcX  = Math.max(4, Math.round((W_pt - estW) / 2));
      ln.push('^FO' + bcX + ',' + y +
        '^BY2,3,' + bcH +
        '^BCN,' + bcH + ',N,N,N' +
        '^FD' + code + '^FS');
      y += bcH + 4;
      ln.push('^FO0,' + y +
        '^FB' + W_pt + ',1,,C' +
        '^A0N,14,14' +
        '^FD' + code + '^FS');
    }
    ln.push('^PQ' + n + ',0,1,Y');
    ln.push('^XZ');
    return ln.join('\n');
  }

  /* ══════════════════════════════════════════════════════
     5. إرسال الأوامر الخام إلى /api/print-raw
        vid/pid اختياريان — يُمررهما server.js لتحديد المنفذ
        Fallback صامت → false
     ══════════════════════════════════════════════════════ */
  async function _sendRawCommands(commands, printerName, protocol, vid, pid) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 15000);
    if (window.toast) window.toast.show('🖨️ جاري إرسال الأوامر للطابعة...', 'info', 15000);
    try {
      var res = await fetch(_serverUrl() + '/api/print-raw', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          commands    : commands,
          printerName : printerName || '',
          protocol    : protocol    || 'TSPL',
          vid         : vid         || '',
          pid         : pid         || '',
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      var data = await res.json();
      if (data.status === 'ok') {
        if (window.toast) window.toast.show('✅ تمت طباعة الملصق', 'success');
        return true;
      }
      var err = data.error || 'خطأ في طباعة الملصق';
      window.errorLogger?.warn('print.raw', err);
      if (window.toast) window.toast.show('⚠️ ' + err, 'warning', 5000);
      return false;
    } catch(e) {
      clearTimeout(timer);
      window.errorLogger?.info('print.raw', 'الخادم غير متاح — fallback إلى HTML');
      return false;
    }
  }

  /* ══════════════════════════════════════════════════════
     6. printLabels — دالة الملصقات الموحدة
        printLabels(product, opts)
          opts.width  = عرض الملصق (مم)  — يُلغي الإعداد المحفوظ
          opts.height = ارتفاع الملصق (مم)
          opts.copies = عدد النسخ
        تدفق البروتوكول:
          TSPL → _buildTSPL → _sendRawCommands → ✅
          ZPL  → _buildZPL  → _sendRawCommands → ✅
          فشل الخادم أو ESC → printBarcode (HTML) ← fallback دائم
     ══════════════════════════════════════════════════════ */
  async function printLabels(product, opts) {
    if (!product) return;
    opts = opts || {};

    var protocol    = await cfg('labelPrinterProtocol', 'ESC');
    var labelW      = opts.width   || parseFloat(await cfg('labelWidth',  '40')) || 40;
    var labelH      = opts.height  || parseFloat(await cfg('labelHeight', '30')) || 30;
    var copies      = opts.copies  || Math.max(1, parseInt(await cfg('labelCopies', '1')) || 1);
    var currency    = await cfg('currency', 'DA');
    var printerName = await cfg('printerLabel', '');
    var vid         = await cfg('printerLabelVID', '');
    var pid         = await cfg('printerLabelPID', '');

    copies = Math.min(200, copies);

    var buildOpts = { width: labelW, height: labelH, copies: copies, currency: currency };

    if (protocol === 'TSPL') {
      var sent = await _sendRawCommands(_buildTSPL(product, buildOpts), printerName, 'TSPL', vid, pid);
      if (sent) return;
    } else if (protocol === 'ZPL') {
      var sentZ = await _sendRawCommands(_buildZPL(product, buildOpts), printerName, 'ZPL', vid, pid);
      if (sentZ) return;
    }
    /* ESC أو Fallback */
    return printBarcode(product, copies);
  }

  /* ══════════════════════════════════════════════════════
     7. اختيار الطابعة
     ══════════════════════════════════════════════════════ */
  async function choosePrinter(type) {
    /* مفاتيح الإعدادات لكل نوع طابعة */
    var CFG = {
      invoice: {
        nameKey: 'printerInvoice',
        vidKey : 'printerInvoiceVID',
        pidKey : 'printerInvoicePID',
        cardId : 'invoicePrinterCard',
        nameEl : 'invoicePrinterName',
        label  : 'طابعة الفواتير',
      },
      barcode: {
        nameKey: 'printerBarcode',
        vidKey : '',
        pidKey : '',
        cardId : 'barcodePrinterCard',
        nameEl : 'barcodePrinterName',
        label  : 'طابعة الباركود',
      },
      label: {
        nameKey: 'printerLabel',
        vidKey : 'printerLabelVID',
        pidKey : 'printerLabelPID',
        cardId : 'labelPrinterCard',
        nameEl : 'labelPrinterName',
        label  : 'طابعة الملصقات (TSPL/ZPL)',
      },
    };
    var c = CFG[type] || CFG.invoice;

    /* اسم الطابعة */
    var curName = await cfg(c.nameKey, '');
    var newName = prompt(
      'اسم ' + c.label + ' (كما يظهر في Windows):\n(اتركه فارغاً للطابعة الافتراضية)',
      curName
    );
    if (newName == null) return;
    newName = newName.trim();

    /* VID/PID — فقط للطابعات التي تدعمه */
    var newVid = '', newPid = '';
    if (c.vidKey) {
      var curVid = await cfg(c.vidKey, '');
      var vidInput = prompt(
        'Vendor ID (VID) — مثال: 0x0FE6\n(فارغ لتجاهل USB المباشر)',
        curVid
      );
      if (vidInput == null) return;
      newVid = vidInput.trim();
      if (newVid) {
        var curPid = await cfg(c.pidKey, '');
        var pidInput = prompt('Product ID (PID) — مثال: 0x811E', curPid);
        if (pidInput == null) return;
        newPid = pidInput.trim();
      }
    }

    /* حفظ في IndexedDB */
    try {
      await window.setSetting(c.nameKey, newName);
      delete _SETTINGS_CACHE[c.nameKey];
      if (c.vidKey) {
        await window.setSetting(c.vidKey, newVid);
        await window.setSetting(c.pidKey, newPid);
        delete _SETTINGS_CACHE[c.vidKey];
        delete _SETTINGS_CACHE[c.pidKey];
      }
    } catch(e) {}

    /* تحديث واجهة الإعدادات */
    var elName = document.getElementById(c.nameEl);
    var elCard = document.getElementById(c.cardId);
    if (elName) elName.textContent = newName || 'الطابعة الافتراضية';
    if (elCard) elCard.classList.toggle('selected', !!(newName || newVid));

    var msg = 'تم حفظ ' + c.label;
    if (newName) msg += ': ' + newName;
    if (newVid)  msg += ' | VID: ' + newVid + (newPid ? ' PID: ' + newPid : '');
    if (window.toast) window.toast.show(msg, 'success');
  }


  /* ══════════════════════════════════════════════════════
     تصدير
     ══════════════════════════════════════════════════════ */
  window.printInvoice       = printInvoice;
  window.clearPrintCache    = clearSettingsCache;
  window.POSDZ_PRINT        = {
    invoice           : printInvoice,
    barcode           : printBarcode,
    labels            : printLabels,
    choosePrinter     : choosePrinter,
    LABEL_SIZES       : LABEL_SIZES,
    clearSettingsCache: clearSettingsCache,
    /* مساعدات للاختبار */
    _buildTSPL        : _buildTSPL,
    _buildZPL         : _buildZPL,
    /* طبقة ESC/POS — للاستدعاء المباشر من الكود الخارجي */
    escposReceipt     : _escposPrintReceipt,
    escposBarcode     : _escposPrintBarcode,
  };

})(window);
