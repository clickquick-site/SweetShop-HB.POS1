/**
 * main.js — قلب تطبيق HP-POS
 */

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// منع تشغيل أكثر من نسخة
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

let mainWindow = null;

// تشغيل الخادم المحلي (server.js) بشكل منفصل
function startServer() {
  try {
    require('./server.js');
    console.log('[MAIN] ✅ الخادم المحلي يعمل على المنفذ 3000');
  } catch (e) {
    console.log('[MAIN] ⚠️ الخادم المحلي لم يعمل:', e.message);
  }
}

// إنشاء النافذة الرئيسية
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    title: 'HP-POS',
    backgroundColor: '#0f0f23',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  // تحميل الصفحة الرئيسية
  mainWindow.loadFile('index.html');

  // إظهار النافذة عندما تكون جاهزة
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // فتح الروابط الخارجية في المتصفح
  // نسمح بـ about:blank و file:// (نوافذ الطباعة) ونحجب HTTP الخارجي فقط
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // about:blank و file:// → مسموح (نافذة طباعة fallback)
    return { action: 'allow' };
  });

  // حفظ حجم النافذة عند الإغلاق
  mainWindow.on('close', saveWindowBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// إعداد قنوات IPC
function setupIPCHandlers() {
  // فتح مجلد البيانات
  ipcMain.handle('hp-pos:open-data-folder', () => {
    const dataDir = app.getPath('userData');
    shell.openPath(dataDir);
    return { success: true, path: dataDir };
  });

  // الحصول على إصدار التطبيق
  ipcMain.handle('hp-pos:get-app-version', () => {
    return { version: app.getVersion(), electron: process.versions.electron };
  });

  // جلب قائمة الطابعات من النظام
  ipcMain.handle('get-printers', async () => {
    try {
      const list = await mainWindow.webContents.getPrintersAsync();
      return list.map(p => p.name);
    } catch (e) {
      return [];
    }
  });

  // طباعة HTML صامتة
  ipcMain.handle('print-silent', async (event, { html, printerName, opts }) => {
    try {
      const win = new BrowserWindow({ show: false, webPreferences: { javascript: true } });
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
      await win.loadURL(dataUrl);

      await new Promise(r => setTimeout(r, 800));

      const paperMm = parseInt(opts?.paperMm) || 80;

      await new Promise((resolve, reject) => {
        win.webContents.print({
          silent:          true,
          printBackground: true,
          deviceName:      printerName || '',
          pageSize: {
            width:  paperMm * 1000,   /* ميكرون */
            height: 2000    * 1000,
          },
          /* printableArea → يستخدم الهوامش الفيزيائية الحقيقية للطابعة
             ثم CSS @page{margin:2mm} تعمل فوقها بشكل صحيح
             يمنع قطع النص RTL في الطابعات الحرارية */
          margins: { marginType: 'printableArea' },
        }, (success, reason) => {
          if (success) resolve();
          else         reject(new Error(reason || 'فشل الطباعة'));
        });
      });

      setTimeout(() => { try { win.close(); } catch(_) {} }, 2000);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // محاولة تحميل ipc-bridge.js إذا وجد
  try {
    const { setupIPCHandlers } = require('./ipc-bridge.js');
    setupIPCHandlers(mainWindow);
    console.log('[MAIN] ✅ IPC Bridge جاهز');
  } catch (e) {
    console.log('[MAIN] ⚠️ IPC Bridge غير موجود');
  }
}

// حفظ وإستعادة حجم النافذة
const BOUNDS_FILE = path.join(app.getPath('userData'), 'window-bounds.json');

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify({
      ...bounds,
      maximized: mainWindow.isMaximized()
    }));
  } catch (e) {}
}

function loadWindowBounds() {
  try {
    if (fs.existsSync(BOUNDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BOUNDS_FILE));
      if (data.width >= 1024 && data.height >= 640) return data;
    }
  } catch (e) {}
  return { width: 1366, height: 768, maximized: false };
}

// دورة حياة التطبيق
app.whenReady().then(() => {
  console.log('[MAIN] ✅ بدء تشغيل HP-POS');
  startServer();
  createWindow();
  setupIPCHandlers();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
