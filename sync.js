// ============================================================
//  HP-POS — sync.js  v8.1.0
//  مزامنة LAN من جانب العميل — نسخة مُصلَحة
//  ✅ إصلاح: SYNC._ind غير معرّف → _syncSetIndicator()
//  ✅ إصلاح: db غير معرّف → window.dbManager
//  ✅ استخدام dbDelete / dbPut المتوافقة مع app.js v8
// ============================================================

const SYNC_CLIENT = {
  _es:         null,
  _retryTimer: null,
  _handlers:   {},

  // ── تهيئة SSE ──────────────────────────────────────────────
  async initSSE() {
    if (await getSetting('syncEnabled') !== '1') return;

    const ip   = (await getSetting('syncServerIP'))   || '192.168.1.1';
    const port = (await getSetting('syncServerPort')) || '3000';
    const url  = `http://${ip}:${port}/api/subscribe`;

    if (this._es) { this._es.close(); this._es = null; }

    try {
      this._es = new EventSource(url);

      this._es.onopen = () => {
        _syncSetIndicator(true);
      };

      this._es.onmessage = (e) => {
        try {
          const { action, store, data } = JSON.parse(e.data);
          // إشعار المستمعين المسجّلين
          (this._handlers[store] || []).forEach(cb => {
            try { cb(action, data); } catch (x) {}
          });
          // تطبيق التغيير محلياً
          this._applyLocally(action, store, data);
        } catch (x) {}
      };

      this._es.onerror = () => {
        _syncSetIndicator(false);
        this._es.close();
        this._es = null;
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => this.initSSE(), 15000);
      };

    } catch (e) {
      _syncSetIndicator(false);
    }
  },

  // ── تطبيق التغيير محلياً ──────────────────────────────────
  async _applyLocally(action, store, data) {
    // استخدام window.dbManager بدلاً من المتغير db غير المعرَّف
    if (!window.dbManager || !data) return;
    try {
      if (action === 'delete') {
        await window.dbManager.delete(store, data.id);
      } else {
        await window.dbManager.put(store, data);
      }
    } catch (e) {
      console.warn(`[SYNC] فشل تطبيق ${action} على ${store}:`, e);
    }
  },

  // ── إدارة المستمعين ────────────────────────────────────────
  on(store, cb) {
    if (!this._handlers[store]) this._handlers[store] = [];
    this._handlers[store].push(cb);
  },

  off(store, cb) {
    if (this._handlers[store]) {
      this._handlers[store] = this._handlers[store].filter(x => x !== cb);
    }
  },

  // ── قطع الاتصال ────────────────────────────────────────────
  disconnect() {
    clearTimeout(this._retryTimer);
    if (this._es) { this._es.close(); this._es = null; }
    _syncSetIndicator(false);
  }
};


/* ─────────────────────────────────────────────────────────────
   دالة مساعدة: تحديث مؤشر حالة المزامنة في الـ UI
   تعمل بأمان حتى لو العنصر غير موجود في الصفحة الحالية
   ───────────────────────────────────────────────────────────── */
function _syncSetIndicator(online) {
  // محاولة تحديث عناصر settings.html (syncDot / syncStatusText)
  const dot  = document.getElementById('syncDot');
  const text = document.getElementById('syncStatusText');

  if (dot) {
    dot.classList.toggle('online',  online);
    dot.classList.toggle('offline', !online);
  }
  if (text) {
    text.textContent = online ? 'متصل ✅' : 'غير متصل';
  }

  // مؤشر عام في الهيدر (إن وُجد في أي صفحة أخرى)
  const hdrDot = document.getElementById('_syncHdrDot');
  if (hdrDot) {
    hdrDot.style.background = online ? '#10b981' : '#6b7280';
    hdrDot.title = online ? 'المزامنة متصلة' : 'المزامنة غير متصلة';
  }
}

// نشرها عالمياً لأي صفحة تحتاجها
window._syncSetIndicator = _syncSetIndicator;


/* ─────────────────────────────────────────────────────────────
   تشغيل تلقائي بعد تحميل الصفحة
   ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // انتظار init التطبيق أولاً قبل بدء المزامنة
  const startSync = async () => {
    try {
      if (await getSetting('syncEnabled') === '1') {
        SYNC_CLIENT.initSSE();
      }
    } catch (e) {
      console.warn('[SYNC] فشل بدء المزامنة:', e);
    }
  };

  // تأخير خفيف للتأكد من انتهاء initApp()
  setTimeout(startSync, 2500);
});
