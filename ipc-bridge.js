/**
 * ipc-bridge.js — HP-POS · جسر IPC لتطبيق Electron  v1.0.0
 * ════════════════════════════════════════════════════════════════
 *  يربط واجهة الكاشير (Renderer) بمحرك الطباعة (Main Process)
 *  عبر قنوات IPC الآمنة.
 *
 *  ─── طريقة الاستخدام ───────────────────────────────────────
 *
 *  ① في main.js (العملية الرئيسية):
 *  ─────────────────────────────────
 *    const { setupIPCHandlers } = require('./ipc-bridge');
 *    const mainWindow = new BrowserWindow({ ... });
 *    setupIPCHandlers(mainWindow);
 *
 *  ② في preload.js (سكريبت المعالجة المسبقة):
 *  ──────────────────────────────────────────
 *    const { contextBridge, ipcRenderer } = require('electron');
 *    contextBridge.exposeInMainWorld('electronAPI', {
 *      isElectron   : true,
 *
 *      // طباعة صامتة عبر HTML+Puppeteer (طبقة 1 الأصلية)
 *      getPrinters  : () => ipcRenderer.invoke('get-printers'),
 *      printSilent  : (html, printerName, opts) =>
 *                       ipcRenderer.invoke('print-silent', { html, printerName, opts }),
 *
 *      // طباعة ESC/POS المباشرة (طبقة 0 الجديدة)
 *      printReceipt : (sale, items, cfg) =>
 *                       ipcRenderer.invoke('hp-pos:print-receipt', { sale, items, cfg }),
 *      printBarcode : (product, opts) =>
 *                       ipcRenderer.invoke('hp-pos:print-barcode', { product, opts }),
 *      getUsbPrinters: () =>
 *                       ipcRenderer.invoke('hp-pos:get-usb-printers'),
 *    });
 *
 *  ③ في print.js (جانب Renderer) — مثال الاستدعاء:
 *  ─────────────────────────────────────────────────
 *    if (window.electronAPI?.printReceipt) {
 *      const result = await window.electronAPI.printReceipt(sale, items, cfg);
 *      if (result.success) return; // طُبع بنجاح
 *    }
 *    // fallback → HTML printing ...
 *
 * ════════════════════════════════════════════════════════════════
 */

'use strict';

const escposEngine = require('./escpos-engine');

/**
 * setupIPCHandlers(mainWindow)
 * ─────────────────────────────────────────────────────────────
 * يُسجِّل جميع قنوات ipcMain للتواصل مع واجهة الكاشير.
 * @param {Electron.BrowserWindow} mainWindow — النافذة الرئيسية
 */
function setupIPCHandlers(mainWindow) {
  let ipcMain;
  try {
    ipcMain = require('electron').ipcMain;
  } catch (e) {
    throw new Error('ipc-bridge.js يجب تشغيله في بيئة Electron فقط');
  }

  /* ══ القناة 1: طباعة الفاتورة عبر ESC/POS ══════════════════
     المُرسِل (Renderer):
       ipcRenderer.invoke('hp-pos:print-receipt', { sale, items, cfg })
     ─────────────────────────────────────────────────────────── */
  ipcMain.handle('hp-pos:print-receipt', async (event, payload) => {
    const { sale, items, cfg } = payload || {};
    try {
      const result = await escposEngine.printReceipt(sale, items, cfg);
      _log('IPC', `✅ print-receipt | فاتورة: ${sale?.invoiceNumber || '-'}`);
      return result;                        // { success: true }
    } catch (e) {
      _log('IPC', `❌ print-receipt | ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  /* ══ القناة 2: طباعة ملصق الباركود عبر ESC/POS ═════════════
     المُرسِل (Renderer):
       ipcRenderer.invoke('hp-pos:print-barcode', { product, opts })
     ─────────────────────────────────────────────────────────── */
  ipcMain.handle('hp-pos:print-barcode', async (event, payload) => {
    const { product, opts } = payload || {};
    try {
      const result = await escposEngine.printBarcode(product, opts);
      _log('IPC', `✅ print-barcode | ${product?.name || '-'} × ${result.copies}`);
      return result;                        // { success: true, copies: N }
    } catch (e) {
      _log('IPC', `❌ print-barcode | ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  /* ══ القناة 3: جلب قائمة طابعات USB ════════════════════════
     المُرسِل (Renderer):
       ipcRenderer.invoke('hp-pos:get-usb-printers')
     يُعيد: [{ vid, pid }, ...]
     ─────────────────────────────────────────────────────────── */
  ipcMain.handle('hp-pos:get-usb-printers', async () => {
    try {
      const printers = escposEngine.getPrinters();
      _log('IPC', `🖨️  طابعات USB: ${printers.length}`);
      return { success: true, printers };
    } catch (e) {
      _log('IPC', `❌ get-usb-printers | ${e.message}`);
      return { success: false, printers: [], error: e.message };
    }
  });

  /* ══ القناة 4: طباعة صامتة HTML (الطبقة الأصلية) ════════════
     يُبقي هذا الـ handler قائماً للتوافق مع print.js v8.x
     ─────────────────────────────────────────────────────────── */
  ipcMain.handle('print-silent', async (event, { html, printerName, opts }) => {
    try {
      const result = await _printHtmlSilent(mainWindow, html, printerName, opts);
      return result;
    } catch (e) {
      _log('IPC', `❌ print-silent | ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  /* ══ القناة 5: جلب طابعات Windows/OS ════════════════════════ */
  ipcMain.handle('get-printers', async () => {
    try {
      const list = await mainWindow.webContents.getPrintersAsync();
      return list.map(p => p.name);
    } catch (e) {
      return [];
    }
  });

  _log('IPC', '✅ جميع قنوات IPC جاهزة (5 قنوات)');
}

/* ══════════════════════════════════════════════════════════════
   طباعة HTML صامتة — BrowserWindow مخفية
   (الطبقة الأصلية، محفوظة للتوافق)
   ══════════════════════════════════════════════════════════════ */
async function _printHtmlSilent(mainWindow, html, printerName, opts) {
  const { BrowserWindow } = require('electron');
  opts = opts || {};

  const win = new BrowserWindow({
    width  : 800,
    height : 600,
    show   : false,
    webPreferences: { javascript: true },
  });

  try {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    await win.loadURL(dataUrl);

    /* انتظر اكتمال تحميل JsBarcode */
    await new Promise(r => setTimeout(r, 1200));

    await new Promise((resolve, reject) => {
      win.webContents.print(
        {
          silent          : true,
          printBackground : true,
          deviceName      : printerName || '',
          pageSize        : { width: (opts.paperMm || 80) * 1000, height: 0 },
          margins         : { marginType: 'custom', top: 1, bottom: 2, left: 1, right: 1 },
        },
        (success, reason) => {
          if (success) resolve();
          else         reject(new Error(reason || 'فشل الطباعة'));
        }
      );
    });

    _log('IPC', `✅ print-silent HTML → [${printerName || 'افتراضية'}]`);
    return { success: true };

  } finally {
    setTimeout(() => { try { win.close(); } catch (_) {} }, 3000);
  }
}

/* تسجيل داخلي */
function _log(type, msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [HP-POS][${type}] ${msg}`);
}

module.exports = { setupIPCHandlers };
