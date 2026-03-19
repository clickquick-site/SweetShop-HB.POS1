/**
 * escpos-engine.js — HP-POS · محرك الطباعة الحرارية  v1.0.0
 * ════════════════════════════════════════════════════════════════
 *  طباعة مباشرة عبر ESC/POS بدون متصفح أو PDF
 *
 *  المتطلبات:
 *    npm install escpos escpos-usb jimp
 *
 *  الوظائف المُصدَّرة:
 *    getPrinters()                  → قائمة طابعات USB المتصلة
 *    printReceipt(sale, items, cfg) → طباعة فاتورة كاملة
 *    printBarcode(product, opts)    → طباعة ملصق باركود
 *    reshapeArabic(text)            → إعادة تشكيل النص العربي
 *
 *  إعدادات cfg / opts المدعومة:
 *    vid          Vendor  ID بالـ hex — مثال: '0x0FE6'
 *    pid          Product ID بالـ hex — مثال: '0x811E'
 *    storeName    اسم المتجر
 *    storePhone   رقم الهاتف
 *    logoPath     مسار شعار المحل (PNG/JPG)
 *    currency     العملة   (افتراضي: 'DA')
 *    storeWelcome رسالة الترحيب
 *    showBarcode  true/false  (افتراضي: true)
 *    paperWidth   عرض الورق 58 أو 80 (افتراضي: 80)
 *    barcodeType  'CODE128' | 'EAN13' | 'CODE39' (افتراضي: 'CODE128')
 *    copies       عدد النسخ للباركود (افتراضي: 1)
 * ════════════════════════════════════════════════════════════════
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ══════════════════════════════════════════════════════════════
   1. مُشكِّل النص العربي — Arabic Reshaper
   ══════════════════════════════════════════════════════════════
   يحوِّل النص العربي من ترتيبه المنطقي إلى أشكال الاتصال الصحيحة
   (isolated / final / initial / medial) ثم يعكسه لطابعات LTR.

   المصادر: Unicode Presentation Forms-B (U+FE70–U+FEFF)
   ─────────────────────────────────────────────────────────── */

/* جدول أشكال الحروف: [منفرد، نهائي، أولي، وسطي]
   القيمة 0 = لا يوجد هذا الشكل                              */
const _AF = {
  0x0621: [0xFE80, 0xFE80,      0,      0],  // ء
  0x0622: [0xFE81, 0xFE82,      0,      0],  // آ
  0x0623: [0xFE83, 0xFE84,      0,      0],  // أ
  0x0624: [0xFE85, 0xFE86,      0,      0],  // ؤ
  0x0625: [0xFE87, 0xFE88,      0,      0],  // إ
  0x0626: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C],  // ئ
  0x0627: [0xFE8D, 0xFE8E,      0,      0],  // ا
  0x0628: [0xFE8F, 0xFE90, 0xFE91, 0xFE92],  // ب
  0x0629: [0xFE93, 0xFE94,      0,      0],  // ة
  0x062A: [0xFE95, 0xFE96, 0xFE97, 0xFE98],  // ت
  0x062B: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C],  // ث
  0x062C: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0],  // ج
  0x062D: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4],  // ح
  0x062E: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8],  // خ
  0x062F: [0xFEA9, 0xFEAA,      0,      0],  // د
  0x0630: [0xFEAB, 0xFEAC,      0,      0],  // ذ
  0x0631: [0xFEAD, 0xFEAE,      0,      0],  // ر
  0x0632: [0xFEAF, 0xFEB0,      0,      0],  // ز
  0x0633: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4],  // س
  0x0634: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8],  // ش
  0x0635: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC],  // ص
  0x0636: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0],  // ض
  0x0637: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4],  // ط
  0x0638: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8],  // ظ
  0x0639: [0xFEC9, 0xFECA, 0xFECB, 0xFECC],  // ع
  0x063A: [0xFECD, 0xFECE, 0xFECF, 0xFED0],  // غ
  0x0641: [0xFED1, 0xFED2, 0xFED3, 0xFED4],  // ف
  0x0642: [0xFED5, 0xFED6, 0xFED7, 0xFED8],  // ق
  0x0643: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC],  // ك
  0x0644: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0],  // ل
  0x0645: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4],  // م
  0x0646: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8],  // ن
  0x0647: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC],  // ه
  0x0648: [0xFEED, 0xFEEE,      0,      0],  // و
  0x0649: [0xFEEF, 0xFEF0,      0,      0],  // ى
  0x064A: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4],  // ي
};

/* روابط لام-ألف الإلزامية: ل + ألف-variant → [منفرد، نهائي] */
const _LAMALF = {
  0x0622: [0xFEF5, 0xFEF6],  // ل + آ → ﻵ ﻶ
  0x0623: [0xFEF7, 0xFEF8],  // ل + أ → ﻷ ﻸ
  0x0625: [0xFEF9, 0xFEFA],  // ل + إ → ﻹ ﻺ
  0x0627: [0xFEFB, 0xFEFC],  // ل + ا → ﻻ ﻼ
};

/* هل الحرف عربي (له شكل في الجدول)؟ */
function _isAR(cp) { return _AF[cp] !== undefined; }

/* هل الحرف يتصل يساراً (له شكل أولي/وسطي)؟ */
function _connL(cp) { return _AF[cp] ? _AF[cp][2] !== 0 : false; }

/**
 * reshapeArabic(text)
 * ─────────────────────────────────────────────────────────────
 * 1. يحذف التشكيل (U+064B–U+065F) والكشيدة (U+0640)
 * 2. يُحوِّل كل حرف عربي إلى شكله الصحيح حسب السياق
 * 3. يُعالج روابط لام-ألف الإلزامية
 * 4. يعكس الترتيب لطابعات ESC/POS التي تطبع من اليسار
 *
 * للنص المختلط (عربي + أرقام/لاتيني):
 *   الأرقام والنصوص اللاتينية تُوضع على اليسار (قبل العربي)
 *   لتظهر بشكل صحيح عند القراءة من اليمين
 * ─────────────────────────────────────────────────────────────
 */
function reshapeArabic(text) {
  if (!text) return '';

  /* حذف التشكيل والكشيدة */
  text = text.replace(/[\u064B-\u065F\u0640]/g, '');

  const chars = Array.from(text);
  const n = chars.length;
  const out = [];
  let prevConnL = false;  /* هل الحرف السابق يتصل يساراً؟ */
  let i = 0;

  while (i < n) {
    const cp = chars[i].codePointAt(0);

    /* ── حرف غير عربي: يقطع سلسلة الاتصال ── */
    if (!_isAR(cp)) {
      out.push(chars[i]);
      prevConnL = false;
      i++;
      continue;
    }

    /* ── رابط لام-ألف ── */
    if (cp === 0x0644 && i + 1 < n) {
      const ncp = chars[i + 1].codePointAt(0);
      if (_LAMALF[ncp]) {
        const [isol, fin] = _LAMALF[ncp];
        /* نهائي إذا كان هناك حرف سابق يتصل يساراً (= يتصل بيمين اللام) */
        out.push(String.fromCodePoint(prevConnL ? fin : isol));
        prevConnL = false;   /* ألف لا يتصل يساراً */
        i += 2;              /* استهلاك اللام والألف معاً */
        continue;
      }
    }

    /* ── حرف عربي عادي: تحديد الشكل ── */
    const ncp = (i + 1 < n) ? chars[i + 1].codePointAt(0) : 0;

    /* هل نتصل من اليمين؟ (الحرف السابق كان يتصل يساراً إلينا) */
    const connR = prevConnL;

    /* هل نتصل يساراً؟ (لنا شكل أولي/وسطي + الحرف التالي عربي) */
    const connLnow = _connL(cp) && _isAR(ncp);

    let fi;
    if (connR && connLnow) fi = 3;       /* وسطي  */
    else if (connR)        fi = 1;       /* نهائي */
    else if (connLnow)     fi = 2;       /* أولي  */
    else                   fi = 0;       /* منفرد */

    const form = _AF[cp][fi] || _AF[cp][0];
    out.push(String.fromCodePoint(form));
    prevConnL = _connL(cp);
    i++;
  }

  /* عكس الترتيب للطابعة LTR */
  return out.reverse().join('');
}

/* ══════════════════════════════════════════════════════════════
   2. مساعدات التنسيق
   ══════════════════════════════════════════════════════════════ */

/**
 * _line(arabicLabel, value, width)
 * يُنشئ سطراً مختلطاً: القيمة (رقم/لاتيني) على اليسار،
 * العربي المُشكَّل على اليمين — يُفصل بينهما مسافات.
 *
 * مثال (عرض 32):
 *   _line('الإجمالي', '1000.00 DA', 32)
 *   → '1000.00 DA        يلامجلإا'
 */
function _line(arabicLabel, value, width) {
  const shaped = reshapeArabic(arabicLabel);
  const val    = String(value || '');
  const gap    = Math.max(1, width - shaped.length - val.length);
  return val + ' '.repeat(gap) + shaped;
}

/**
 * _center(text, width)
 * يُوسِّط النص في عرض محدد
 */
function _center(text, width) {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
}

/**
 * _divider(char, width)
 * يُنشئ خطاً فاصلاً
 */
function _divider(char, width) {
  return (char || '-').repeat(width);
}

/* ══════════════════════════════════════════════════════════════
   3. اكتشاف طابعات USB
   ══════════════════════════════════════════════════════════════ */

/**
 * getPrinters()
 * يُعيد قائمة الطابعات الحرارية USB المتصلة بالجهاز.
 * يتطلب: escpos-usb
 */
function getPrinters() {
  try {
    const USB = require('escpos-usb');
    const devices = USB.findPrinter();
    if (!devices || !devices.length) return [];
    return devices.map(d => ({
      vid: '0x' + (d.deviceDescriptor.idVendor ).toString(16).padStart(4, '0').toUpperCase(),
      pid: '0x' + (d.deviceDescriptor.idProduct).toString(16).padStart(4, '0').toUpperCase(),
    }));
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════════
   4. فتح الاتصال بالطابعة
   ══════════════════════════════════════════════════════════════ */

/**
 * _connect(vid, pid)
 * يفتح جهاز USB ويُعيد { device, printer }.
 * إذا لم يُحدَّد vid/pid يكتشف أول طابعة تلقائياً.
 */
async function _connect(vid, pid) {
  let escpos;
  try {
    escpos = require('escpos');
  } catch (e) {
    throw new Error(
      'مكتبة escpos غير مثبتة.\nنفِّذ: npm install escpos escpos-usb jimp'
    );
  }

  let USB;
  try {
    USB = require('escpos-usb');
  } catch (e) {
    throw new Error(
      'مكتبة escpos-usb غير مثبتة.\nنفِّذ: npm install escpos-usb'
    );
  }

  escpos.USB = USB;

  /* تحديد الجهاز */
  let device;
  if (vid && pid) {
    /* طابعة محددة بـ VID/PID */
    const vidInt = parseInt(String(vid).replace(/^0x/i, ''), 16);
    const pidInt = parseInt(String(pid).replace(/^0x/i, ''), 16);
    device = new USB(vidInt, pidInt);
  } else {
    /* اكتشاف تلقائي: أول طابعة USB */
    const list = USB.findPrinter();
    if (!list || !list.length) {
      throw new Error('لم يُعثر على طابعة USB — تحقق من التوصيل أو حدد VID/PID في الإعدادات');
    }
    const d = list[0];
    device = new USB(d.deviceDescriptor.idVendor, d.deviceDescriptor.idProduct);
  }

  /* فتح الاتصال */
  await new Promise((resolve, reject) => {
    device.open(err => {
      if (err) reject(new Error('فشل فتح الطابعة: ' + err.message));
      else     resolve();
    });
  });

  const printer = new escpos.Printer(device, { encoding: 'UTF-8' });
  return { device, printer };
}

/* ══════════════════════════════════════════════════════════════
   5. طباعة الفاتورة — printReceipt
   ══════════════════════════════════════════════════════════════ */

/**
 * printReceipt(sale, items, cfg)
 *
 * sale  : { invoiceNumber, invoiceKind, total, discount, paid,
 *           change, date, sellerName, customerName }
 * items : [{ name, quantity, unitPrice, total }]
 * cfg   : { vid, pid, storeName, storePhone, storeAddress,
 *           logoPath, currency, storeWelcome,
 *           showBarcode, paperWidth }
 */
async function printReceipt(sale, items, cfg) {
  if (!sale) throw new Error('بيانات البيع مفقودة');
  cfg   = cfg   || {};
  items = items || [];

  const currency    = cfg.currency    || 'DA';
  const paperWidth  = parseInt(cfg.paperWidth || 80);
  /* عدد الأعمدة: 80mm → 42 عمود، 58mm → 32 عمود (Courier 12pt) */
  const cols        = paperWidth >= 80 ? 42 : 32;
  const showBarcode = cfg.showBarcode !== false;

  const { device, printer } = await _connect(cfg.vid, cfg.pid);

  try {
    /* ── شعار المحل ── */
    if (cfg.logoPath && fs.existsSync(cfg.logoPath)) {
      try {
        const escpos = require('escpos');
        /* escpos.Image يتطلب jimp — إن لم يكن مثبتاً سيرمي استثناء */
        const logo = await new Promise((resolve, reject) => {
          escpos.Image.load(cfg.logoPath, (img) => {
            if (!img) reject(new Error('فشل تحميل الشعار'));
            else      resolve(img);
          });
        });
        printer.align('ct').raster(logo);
      } catch (_) {
        /* الشعار اختياري — الفشل لا يوقف الطباعة */
      }
    }

    /* ── اسم المتجر ── */
    if (cfg.storeName) {
      printer
        .align('ct')
        .bold(true)
        .size(1, 1)
        .text(reshapeArabic(cfg.storeName))
        .size(0, 0)
        .bold(false);
    }
    if (cfg.storePhone)   printer.align('ct').text(cfg.storePhone);
    if (cfg.storeAddress) printer.align('ct').text(reshapeArabic(cfg.storeAddress));

    printer.drawLine();

    /* ── رأس الفاتورة ── */
    const kindLabel = {
      normal : 'فاتورة',
      debt   : 'فاتورة دين',
      partial: 'فاتورة تسديد جزئي',
      payment: 'فاتورة تسديد دين',
    }[sale.invoiceKind || 'normal'] || 'فاتورة';

    const invNum  = String(sale.invoiceNumber || '');
    const dateStr = _fmtDate(sale.date);

    printer.align('lt');
    printer.text(_line(kindLabel, invNum,  cols));
    printer.text(_line('التاريخ', dateStr, cols));
    printer.text(_line('البائع',  sale.sellerName || 'ADMIN', cols));
    if (sale.customerName || sale.customerPhone) {
      printer.text(_line('الزبون', sale.customerName || sale.customerPhone || '', cols));
    }

    printer.drawLine();

    /* ── جدول المنتجات ──
       كل منتج: سطران
       السطر 1: [رقم الكمية × السعر]          اسم المنتج
       السطر 2: [المجموع]                                  */
    items.forEach(function (it) {
      const lineTotal = it.total != null
        ? parseFloat(it.total)
        : parseFloat(it.quantity || 0) * parseFloat(it.unitPrice || 0);

      const qtyPrice  = String(it.quantity || 0) + ' x ' +
                        parseFloat(it.unitPrice || 0).toFixed(2);
      const totalStr  = lineTotal.toFixed(2) + ' ' + currency;
      const nameAR    = reshapeArabic(String(it.name || ''));

      /* سطر 1: كمية×سعر على اليسار، اسم على اليمين */
      printer.text(_line('', nameAR, cols).replace(/^ +/, '') || nameAR);
      printer.text('  ' + qtyPrice + '  →  ' + totalStr);
    });

    printer.drawLine();

    /* ── المجاميع ── */
    const total    = parseFloat(sale.total    || 0);
    const discount = parseFloat(sale.discount || 0);
    const netTotal = total - discount;
    const paid     = parseFloat(sale.paid     || 0);
    const change   = parseFloat(sale.change   || 0);
    const debt     = netTotal - paid;

    printer.bold(true);
    printer.text(_line('الإجمالي', netTotal.toFixed(2) + ' ' + currency, cols));
    printer.bold(false);

    if (sale.invoiceKind === 'debt') {
      printer.text(_line('المدفوع', '0.00 '    + currency, cols));
      printer.bold(true);
      printer.text(_line('الدين',   netTotal.toFixed(2) + ' ' + currency, cols));
      printer.bold(false);
    } else if (sale.invoiceKind === 'partial') {
      printer.text(_line('المدفوع', paid.toFixed(2) + ' ' + currency, cols));
      printer.bold(true);
      printer.text(_line('الدين',   debt.toFixed(2) + ' ' + currency, cols));
      printer.bold(false);
    } else {
      printer.text(_line('المدفوع', paid.toFixed(2)   + ' ' + currency, cols));
      if (change > 0) {
        printer.text(_line('الباقي', change.toFixed(2) + ' ' + currency, cols));
      }
    }

    printer.drawLine();

    /* ── رسالة الترحيب ── */
    if (cfg.storeWelcome) {
      printer.align('ct').text(reshapeArabic(cfg.storeWelcome));
    }

    /* ── باركود الفاتورة ── */
    if (showBarcode && invNum) {
      try {
        printer
          .align('ct')
          .barcode(invNum, 'CODE128', {
            width   : 'narrow',
            height  : 80,
            position: 'BELOW',
            font    : 'A',
          });
      } catch (_) {
        /* الباركود اختياري — الفشل لا يوقف الطباعة */
      }
    }

    /* ── تغذية وقص ── */
    printer.feed(4).cut();

    /* إغلاق الاتصال */
    await _close(printer);
    return { success: true };

  } catch (e) {
    try { device.close(); } catch (_) {}
    throw e;
  }
}

/* ══════════════════════════════════════════════════════════════
   6. طباعة ملصق الباركود — printBarcode
   ══════════════════════════════════════════════════════════════ */

/**
 * printBarcode(product, opts)
 *
 * product : { name, barcode, sellPrice|price }
 * opts    : { vid, pid, copies, barcodeType, currency,
 *             showName, showPrice }
 */
async function printBarcode(product, opts) {
  if (!product) throw new Error('بيانات المنتج مفقودة');
  opts = opts || {};

  const currency    = opts.currency    || 'DA';
  const copies      = Math.min(200, Math.max(1, parseInt(opts.copies || 1)));
  const bcType      = (opts.barcodeType || 'CODE128').toUpperCase();
  const showName    = opts.showName  !== false;
  const showPrice   = opts.showPrice !== false;
  const cols        = 32; /* عرض 58mm — معيار ملصقات الباركود */

  const code     = String(product.barcode || '');
  const name     = String(product.name    || '');
  const rawPrice = product.sellPrice != null
    ? product.sellPrice
    : (product.price != null ? product.price : '');
  const priceStr = rawPrice !== '' ? parseFloat(rawPrice).toFixed(2) + ' ' + currency : '';

  /* التحقق من صحة الباركود */
  if (!code) throw new Error('رقم الباركود مفقود');

  /* التحقق من EAN13: يجب أن يكون 12 أو 13 رقماً */
  if (bcType === 'EAN13' && !/^\d{12,13}$/.test(code)) {
    throw new Error('EAN13 يتطلب 12 أو 13 رقماً — الكود الحالي: ' + code);
  }

  /* تعيين نوع الباركود لـ escpos */
  const escpsBcType = { CODE128: 'CODE128', EAN13: 'EAN13', CODE39: 'CODE39' }[bcType] || 'CODE128';

  const { device, printer } = await _connect(opts.vid, opts.pid);

  try {
    for (let c = 0; c < copies; c++) {
      /* اسم المنتج — عريض ومُشكَّل */
      if (showName && name) {
        printer
          .align('ct')
          .bold(true)
          .text(reshapeArabic(name))
          .bold(false);
      }

      /* السعر — عريض ومُوسَّط */
      if (showPrice && priceStr) {
        printer
          .align('ct')
          .bold(true)
          .size(1, 1)
          .text(priceStr)
          .size(0, 0)
          .bold(false);
      }

      /* الباركود — متوسط، الرقم أسفله */
      printer
        .align('ct')
        .barcode(code, escpsBcType, {
          width   : 'standard',
          height  : 60,
          position: 'BELOW',
          font    : 'B',
        });

      /* تغذية وقص بعد كل نسخة */
      if (c < copies - 1) {
        printer.feed(2).cut();
      }
    }

    printer.feed(3).cut();
    await _close(printer);
    return { success: true, copies };

  } catch (e) {
    try { device.close(); } catch (_) {}
    throw e;
  }
}

/* ══════════════════════════════════════════════════════════════
   7. مساعدات داخلية
   ══════════════════════════════════════════════════════════════ */

/* إغلاق الاتصال بشكل آمن */
function _close(printer) {
  return new Promise((resolve) => {
    try {
      printer.close(function () { resolve(); });
    } catch (_) {
      resolve();
    }
  });
}

/* تنسيق التاريخ */
function _fmtDate(dateVal) {
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal || '');
    return d.getFullYear() + '/' +
      String(d.getMonth() + 1).padStart(2, '0') + '/' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
  } catch (_) {
    return String(dateVal || '');
  }
}

/* ══════════════════════════════════════════════════════════════
   8. تصدير
   ══════════════════════════════════════════════════════════════ */
module.exports = {
  reshapeArabic,
  getPrinters,
  printReceipt,
  printBarcode,
};
