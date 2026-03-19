// ============================================================
//  HP-POS — app.js  v8.1.0  |  إصدار محسّن بالكامل
//  ✅ أمان متقدم  ✅ إدارة DB محكمة  ✅ أداء عالي
// ============================================================

const APP_VERSION = { number: '8.1.0', date: '2026-03', name: 'HP-POS' };

// ══════════════════════════════════════════════════════════════
//  IndexedDB - إدارة احترافية مع معالجة الترقيات
// ══════════════════════════════════════════════════════════════
const DB_NAME = 'POSDZ_DB';
const DB_VERSION = 8; // v8: إضافة productBatches لنظام تتبع دفعات الصلاحية

class DatabaseManager {
  constructor() {
    this.db = null;
    this.initPromise = null;
    this.stores = [
      'users', 'products', 'families', 'customers', 'suppliers',
      'sales', 'saleItems', 'debts', 'debtPayments', 'expenses',
      'purchases', 'settings', 'logs', 'counter', 'syncQueue',
      'workers', 'workerPayments', 'dailyEntries', 'transactions',
      'productBatches'
    ];
  }

  async open() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        const oldVersion = e.oldVersion;

        // إنشاء الجداول من الصفر إذا كانت أول مرة
        if (oldVersion === 0) {
          this._createStores(db);
          return;
        }

        // معالجة الترقيات بشكل آمن
        this._handleUpgrade(db, tx, oldVersion);
      };

      req.onsuccess = async (e) => {
        this.db = e.target.result;
        
        // معالجة الأخطاء العامة
        this.db.onerror = (event) => {
          console.error('IndexedDB error:', event.target.error);
        };

        await this._seedDefaults();
        resolve(this.db);
      };

      req.onerror = () => {
        this.initPromise = null;
        reject(new Error('فشل فتح قاعدة البيانات: ' + req.error?.message));
      };
    });

    return this.initPromise;
  }

  _createStores(db) {
    // المستخدمين
    const users = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
    users.createIndex('username', 'username', { unique: true });

    // المنتجات
    const products = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
    products.createIndex('name', 'name', { unique: false });
    products.createIndex('barcode', 'barcode', { unique: false });
    products.createIndex('familyId', 'familyId', { unique: false });

    // العائلات
    const families = db.createObjectStore('families', { keyPath: 'id', autoIncrement: true });
    families.createIndex('name', 'name', { unique: true });

    // العملاء
    db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });

    // الموردين
    db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });

    // المبيعات
    const sales = db.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
    sales.createIndex('date', 'date', { unique: false });
    sales.createIndex('customerId', 'customerId', { unique: false });
    sales.createIndex('invoiceNumber', 'invoiceNumber', { unique: true });

    // عناصر المبيعات
    const saleItems = db.createObjectStore('saleItems', { keyPath: 'id', autoIncrement: true });
    saleItems.createIndex('saleId', 'saleId', { unique: false });
    saleItems.createIndex('productId', 'productId', { unique: false });

    // الديون
    const debts = db.createObjectStore('debts', { keyPath: 'id', autoIncrement: true });
    debts.createIndex('customerId', 'customerId', { unique: false });
    debts.createIndex('date', 'date', { unique: false });
    debts.createIndex('status', 'isPaid', { unique: false });

    // مدفوعات الديون
    const debtPayments = db.createObjectStore('debtPayments', { keyPath: 'id', autoIncrement: true });
    debtPayments.createIndex('debtId', 'debtId', { unique: false });
    debtPayments.createIndex('customerId', 'customerId', { unique: false });
    debtPayments.createIndex('date', 'date', { unique: false });

    // المصاريف
    const expenses = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
    expenses.createIndex('date', 'date', { unique: false });
    expenses.createIndex('category', 'category', { unique: false });
    expenses.createIndex('isPaid', 'isPaid', { unique: false });
    expenses.createIndex('include_in_reports', 'include_in_reports', { unique: false });

    // المشتريات
    const purchases = db.createObjectStore('purchases', { keyPath: 'id', autoIncrement: true });
    purchases.createIndex('date', 'date', { unique: false });
    purchases.createIndex('supplierId', 'supplierId', { unique: false });

    // الإعدادات
    db.createObjectStore('settings', { keyPath: 'key' });

    // السجلات
    const logs = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
    logs.createIndex('date', 'date', { unique: false });
    logs.createIndex('action', 'action', { unique: false });

    // العداد
    db.createObjectStore('counter', { keyPath: 'id' });

    // قائمة الانتظار للمزامنة
    const syncQueue = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    syncQueue.createIndex('createdAt', 'createdAt', { unique: false });

    // العمال
    db.createObjectStore('workers', { keyPath: 'id', autoIncrement: true });

    // مدفوعات العمال
    const workerPayments = db.createObjectStore('workerPayments', { keyPath: 'id', autoIncrement: true });
    workerPayments.createIndex('workerId', 'workerId', { unique: false });
    workerPayments.createIndex('date', 'date', { unique: false });

    // المداخيل اليومية (موحدة)
    const dailyEntries = db.createObjectStore('dailyEntries', { keyPath: 'id', autoIncrement: true });
    dailyEntries.createIndex('date', 'date', { unique: false });
    dailyEntries.createIndex('type', 'type', { unique: false }); // 'sale', 'expense', 'salary'

    // الحركات المالية — المرجع الموحد للتقارير
    const transactions = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
    transactions.createIndex('date', 'date', { unique: false });
    transactions.createIndex('type', 'type', { unique: false }); // 'debt_payment' / 'expense' / 'salary'
    transactions.createIndex('ref_id', 'ref_id', { unique: false });

    // دفعات المنتجات — نظام FEFO لتتبع الصلاحية
    // كل دفعة استلام تُحفظ مستقلة: productId, quantity, expiryDate, receivedDate, note
    const productBatches = db.createObjectStore('productBatches', { keyPath: 'id', autoIncrement: true });
    productBatches.createIndex('productId',    'productId',    { unique: false });
    productBatches.createIndex('expiryDate',   'expiryDate',   { unique: false });
    productBatches.createIndex('receivedDate', 'receivedDate', { unique: false });
  }

  _handleUpgrade(db, tx, oldVersion) {
    // ترقية من الإصدار 5 إلى 6
    if (oldVersion < 6) {
      // إنشاء dailyEntries إذا لم يكن موجوداً
      if (!db.objectStoreNames.contains('dailyEntries')) {
        const dailyEntries = db.createObjectStore('dailyEntries', { keyPath: 'id', autoIncrement: true });
        dailyEntries.createIndex('date', 'date', { unique: false });
        dailyEntries.createIndex('type', 'type', { unique: false });
      }

      // إعادة بناء فهارس المنتجات بشكل آمن
      if (db.objectStoreNames.contains('products')) {
        const oldProducts = tx.objectStore('products');
        const allProductsReq = oldProducts.getAll();
        
        // لا ننتظر هنا، نستخدم نفس الـ transaction
        allProductsReq.onsuccess = () => {
          const products = allProductsReq.result;
          
          // حذف وإعادة إنشاء products
          db.deleteObjectStore('products');
          const newProducts = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          newProducts.createIndex('name', 'name', { unique: false });
          newProducts.createIndex('barcode', 'barcode', { unique: false });
          newProducts.createIndex('familyId', 'familyId', { unique: false });
          
          // إعادة إدخال البيانات
          products.forEach(p => {
            try {
              newProducts.add(p);
            } catch (err) {
              console.warn('تخطي منتج مكرر:', p.name);
            }
          });
        };
      }
    }

    // ترقية من الإصدار 6 إلى 7
    if (oldVersion < 7) {
      // إضافة جدول transactions إذا لم يكن موجوداً
      if (!db.objectStoreNames.contains('transactions')) {
        const transactions = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        transactions.createIndex('date', 'date', { unique: false });
        transactions.createIndex('type', 'type', { unique: false });
        transactions.createIndex('ref_id', 'ref_id', { unique: false });
      }

      // إضافة فهرس include_in_reports لجدول expenses إذا لم يكن موجوداً
      if (db.objectStoreNames.contains('expenses')) {
        const expStore = tx.objectStore('expenses');
        if (!expStore.indexNames.contains('include_in_reports')) {
          expStore.createIndex('include_in_reports', 'include_in_reports', { unique: false });
        }
      }
    }

    // ترقية من الإصدار 7 إلى 8 — إضافة جدول productBatches
    if (oldVersion < 8) {
      if (!db.objectStoreNames.contains('productBatches')) {
        const productBatches = db.createObjectStore('productBatches', { keyPath: 'id', autoIncrement: true });
        productBatches.createIndex('productId',    'productId',    { unique: false });
        productBatches.createIndex('expiryDate',   'expiryDate',   { unique: false });
        productBatches.createIndex('receivedDate', 'receivedDate', { unique: false });
      }
    }
  }

  // دوال مساعدة مع تحسين الأداء
  async get(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`فشل في قراءة ${store}: ${req.error}`));
    });
  }

  async getAll(store, options = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const source = tx.objectStore(store);
      
      let req;
      if (options.index && options.value !== undefined) {
        const index = source.index(options.index);
        if (options.range) {
          req = index.getAll(IDBKeyRange.only(options.value));
        } else {
          req = index.getAll(options.value);
        }
      } else {
        req = source.getAll();
      }

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`فشل في قراءة ${store}: ${req.error}`));
    });
  }

  async getPaginated(store, page = 1, pageSize = 50, index = null, value = null) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      let source = tx.objectStore(store);
      if (index && value !== null) {
        source = source.index(index);
      }

      const req = source.openCursor();
      const results = [];
      let counter = 0;
      const skip = (page - 1) * pageSize;

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) {
          resolve(results);
          return;
        }

        // تطبيق الفلترة إذا كان هناك قيمة
        if (value !== null && index) {
          const cursorValue = cursor.value[index] || cursor.value;
          if (cursorValue !== value) {
            cursor.continue();
            return;
          }
        }

        if (counter >= skip && counter < skip + pageSize) {
          results.push(cursor.value);
        }

        counter++;
        if (counter < skip + pageSize) {
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      req.onerror = () => reject(new Error(`فشل في التصفح ${store}: ${req.error}`));
    });
  }

  async put(store, data) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put({
        ...data,
        updatedAt: new Date().toISOString()
      });

      req.onsuccess = () => { resolve(req.result); window.realtimeManager?.notify(store); };
      req.onerror = () => {
        const err = new Error(`فشل في حفظ ${store}: ${req.error}`);
        window.errorLogger?.error('DB.put', `فشل حفظ البيانات في "${store}"`, err);
        reject(err);
      };
    });
  }

  async add(store, data) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).add({
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      req.onsuccess = () => { resolve(req.result); window.realtimeManager?.notify(store); };
      req.onerror = () => {
        const err = new Error(`فشل في إضافة ${store}: ${req.error}`);
        window.errorLogger?.error('DB.add', `فشل إضافة سجل في "${store}"`, err);
        reject(err);
      };
    });
  }

  async delete(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => { resolve(); window.realtimeManager?.notify(store); };
      req.onerror = () => {
        const err = new Error(`فشل في حذف ${store}: ${req.error}`);
        window.errorLogger?.error('DB.delete', `فشل حذف سجل من "${store}"`, err);
        reject(err);
      };
    });
  }

  async count(store, index = null, value = null) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      let source = tx.objectStore(store);
      if (index && value !== null) {
        source = source.index(index);
      }

      let req;
      if (value !== null) {
        req = source.count(IDBKeyRange.only(value));
      } else {
        req = source.count();
      }

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`فشل في العد ${store}: ${req.error}`));
    });
  }

  async _seedDefaults() {
    try {
      // إضافة المستخدم الافتراضي إذا لم يكن موجوداً
      const users = await this.getAll('users');
      if (users.length === 0) {
        await this.add('users', {
          username: 'ADMIN',
          password: await PasswordManager.hash('1234'),
          role: 'admin'
        });
      }

      // إعدادات افتراضية
      const defaultSettings = {
        storeName: 'اسم المتجر',
        storePhone: '',
        storeAddress: '',
        storeWelcome: 'شكراً لزيارتكم',
        storeLogo: '',
        currency: 'DA',
        language: 'ar',
        dateFormat: 'DD/MM/YYYY',
        themeColor: 'blue_purple',
        bgMode: 'dark',
        appFont: 'cairo',
        fontSize: '15',
        soundAdd: '1',
        soundSell: '1',
        soundButtons: '1',
        soundNavPage: '1',
        soundNavTab: '1',
        soundWarning: '1',
        soundOutOfStock: '1',
        soundAlert: '1',
        soundLogin: '1',
        barcodeReader: '1',
        barcodeAuto: '1',
        touchKeyboard: '0',
        paperSize: '80mm',
        printLogo: '1',
        printName: '1',
        printPhone: '1',
        printWelcome: '1',
        printAddress: '1',
        printBarcode: '1',
        barcodeFont: 'Cairo',
        barcodeType: 'CODE128',
        barcodeShowStore: '1',
        barcodeShowName: '1',
        barcodeShowPrice: '1',
        barcodeFontSize: '12',
        barcodeSize: '58x38',
        autoBackup: '1',
        lowStockAlert: '5',
        expiryAlertDays: '30',
        expiryWatchDays:    '45',
        expiryWarningDays:  '30',
        expiryCriticalDays: '15',
        stockWatchQty:      '20',
        stockWarningQty:    '15',
        stockCriticalQty:   '10',
        notifEnabled: '1',
        notifyInApp: '1',
        notifyLogin: '0',
        debtInterestRate: '0',
        debtInterestType: 'daily'
      };

      for (const [key, value] of Object.entries(defaultSettings)) {
        const existing = await this.get('settings', key);
        if (!existing) {
          await this.put('settings', { key, value });
        }
      }

      // عداد الفواتير
      const counter = await this.get('counter', 1);
      if (!counter) {
        await this.put('counter', { id: 1, number: 1, lastReset: this._todayStr() });
      }
    } catch (e) {
      console.warn('تحذير في seedDefaults:', e);
    }
  }

  _todayStr() {
    return new Date().toISOString().split('T')[0];
  }
}

// ══════════════════════════════════════════════════════════════
//  Password Manager - نظام آمن للكلمات المرور
// ══════════════════════════════════════════════════════════════
class PasswordManager {
  static async hash(password) {
    // استخدام SHA-256 مع encoding آمن
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    
    // إضافة salt ثابت للتطبيق (يمكن تحسينه لاحقاً)
    const salt = encoder.encode('POSDZ_V8_SALT');
    const combined = new Uint8Array(data.length + salt.length);
    combined.set(data);
    combined.set(salt, data.length);
    
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  static async verify(input, storedHash) {
    const inputHash = await this.hash(input);
    return inputHash === storedHash;
  }

  static generateRandomPassword(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let result = '';
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    
    for (let i = 0; i < length; i++) {
      result += chars[randomValues[i] % chars.length];
    }
    return result;
  }
}

// ══════════════════════════════════════════════════════════════
//  Session Manager - إدارة الجلسة بشكل محكم
// ══════════════════════════════════════════════════════════════
class SessionManager {
  constructor() {
    this.SESSION_MINUTES = 30;
    this.SESSION_WARN_MINUTES = 25;
    this.sessionTimer = null;
    this.warnTimer = null;
    this.sessionActive = false;
    this.user = null;
    this.listeners = [];
    // ✅ تحميل الجلسة فوراً — لأن requireAuth() قد تُستدعى قبل init()
    this._loadFromStorage();
  }

  init() {
    this._setupEventListeners();
    if (this.user) {
      this._resetTimer();
    }
  }

  _loadFromStorage() {
    try {
      const saved = sessionStorage.getItem('posdz_user');
      if (saved) {
        this.user = JSON.parse(saved);
        this.sessionActive = true;
      }
    } catch (e) {
      this.user = null;
    }
  }

  _setupEventListeners() {
    const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
    events.forEach(event => {
      document.addEventListener(event, () => this._onUserActivity(), { passive: true });
    });
  }

  _onUserActivity() {
    if (!this.user) return;
    if (!this.sessionActive) return; // الجلسة منتهية
    this._resetTimer();
  }

  _resetTimer() {
    this._clearTimers();
    
    this.warnTimer = setTimeout(() => {
      this._emit('warning', 'ستنتهي جلستك خلال 5 دقائق');
    }, this.SESSION_WARN_MINUTES * 60 * 1000);

    this.sessionTimer = setTimeout(() => {
      this.sessionActive = false;
      this._emit('expired', 'انتهت جلستك بسبب الخمول');
      this.logout(false); // تسجيل خروج بدون إعادة توجيه
    }, this.SESSION_MINUTES * 60 * 1000);
  }

  _clearTimers() {
    if (this.warnTimer) clearTimeout(this.warnTimer);
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
  }

  login(user) {
    this.user = user;
    this.sessionActive = true;
    sessionStorage.setItem('posdz_user', JSON.stringify(user));
    this._resetTimer();
    this._emit('login', user);
  }

  logout(redirect = true) {
    this.user = null;
    this.sessionActive = false;
    this._clearTimers();
    sessionStorage.removeItem('posdz_user');
    this._emit('logout');
    
    if (redirect) {
      window.location.href = 'login.html';
    }
  }

  getUser() {
    return this.user;
  }

  requireAuth(redirectUrl = 'login.html') {
    if (!this.user) {
      window.location.href = redirectUrl;
      return false;
    }
    return true;
  }

  requireRole(roles, redirectUrl = 'sale.html') {
    if (!this.requireAuth(redirectUrl)) return false;
    if (!roles.includes(this.user.role)) {
      window.location.href = redirectUrl;
      return false;
    }
    return true;
  }

  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  _emit(event, data) {
    this.listeners
      .filter(l => l.event === event)
      .forEach(l => l.callback(data));
  }
}

// ══════════════════════════════════════════════════════════════
//  Date Utilities - معالجة موحدة للتواريخ
// ══════════════════════════════════════════════════════════════
class DateUtils {
  static today() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  }

  static now() {
    return new Date().toISOString();
  }

  static formatDate(iso, format = 'DD/MM/YYYY') {
    if (!iso) return '';
    
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    
    switch (format) {
      case 'DD/MM/YYYY': return `${day}/${month}/${year}`;
      case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
      case 'YYYY/MM/DD': return `${year}/${month}/${day}`;
      default: return `${day}/${month}/${year}`;
    }
  }

  static formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return this.formatDate(iso) + ' ' + 
           String(d.getUTCHours()).padStart(2, '0') + ':' +
           String(d.getUTCMinutes()).padStart(2, '0');
  }

  static daysBetween(dateStr) {
    const d1 = new Date(dateStr + 'T00:00:00Z');
    const d2 = new Date();
    d2.setUTCHours(0, 0, 0, 0);
    return Math.floor((d2 - d1) / 86400000);
  }

  static startOfWeek() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString();
  }

  static startOfMonth() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(1);
    return d.toISOString();
  }

  static startOfYear() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMonth(0, 1);
    return d.toISOString();
  }
}

// ══════════════════════════════════════════════════════════════
//  Currency Formatter - تنسيق العملة الموحد
// ══════════════════════════════════════════════════════════════
class CurrencyFormatter {
  constructor() {
    this.symbol = 'DA';
    this.locale = 'ar-DZ';
  }

  async init() {
    const db = new DatabaseManager();
    await db.open();
    const setting = await db.get('settings', 'currency');
    this.symbol = setting?.value || 'DA';
  }

  format(amount) {
    const num = parseFloat(amount || 0);
    if (isNaN(num)) return `0 ${this.symbol}`;

    // تنسيق جزائري: نقطة للآلاف، فاصلة للكسور
    const parts = num.toFixed(2).split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    
    if (parts[1] === '00') {
      return `${intPart} ${this.symbol}`;
    }
    
    return `${intPart},${parts[1]} ${this.symbol}`;
  }

  formatWithoutSymbol(amount) {
    const num = parseFloat(amount || 0);
    if (isNaN(num)) return '0';
    
    const parts = num.toFixed(2).split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    
    if (parts[1] === '00') {
      return intPart;
    }
    
    return `${intPart},${parts[1]}`;
  }

  parse(input) {
    if (typeof input === 'number') return input;
    if (!input) return 0;
    
    // إزالة الرمز والمسافات
    const cleaned = String(input)
      .replace(new RegExp(this.symbol, 'g'), '')
      .replace(/\s/g, '')
      .replace(/\./g, '') // إزالة نقاط الآلاف
      .replace(',', '.'); // استبدال الفاصلة العشرية
    
    return parseFloat(cleaned) || 0;
  }
}

// ══════════════════════════════════════════════════════════════
//  Toast System - محسّن مع قائمة انتظار
// ══════════════════════════════════════════════════════════════
class ToastManager {
  constructor() {
    this.container = null;
    this.queue = [];
    this.isProcessing = false;
    this.durations = {
      success: 2800,
      error: 4000,
      warning: 3500,
      info: 3000
    };
  }

  _ensureContainer() {
    if (this.container) return;
    
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  show(message, type = 'success', duration = null) {
    this.queue.push({ message, type, duration });
    if (!this.isProcessing) {
      this._processQueue();
    }
  }

  async _processQueue() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const { message, type, duration } = this.queue.shift();
    
    this._ensureContainer();
    
    const icons = {
      success: '<i class="fa-solid fa-circle-check"></i>',
      error: '<i class="fa-solid fa-circle-xmark"></i>',
      warning: '<i class="fa-solid fa-triangle-exclamation"></i>',
      info: '<i class="fa-solid fa-circle-info"></i>'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `${icons[type] || ''}<span>${this._escapeHtml(message)}</span>`;
    
    this.container.appendChild(toast);
    
    const toastDuration = duration || this.durations[type] || 2800;
    
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        this._processQueue();
      }, 400);
    }, toastDuration);
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ══════════════════════════════════════════════════════════════
//  Modal System - إدارة النوافذ المنبثقة
// ══════════════════════════════════════════════════════════════
class ModalManager {
  constructor() {
    this.activeModal = null;
  }

  open(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.add('open');
      this.activeModal = modal;
      document.body.style.overflow = 'hidden';
    }
  }

  close(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('open');
      if (this.activeModal === modal) {
        this.activeModal = null;
        document.body.style.overflow = '';
      }
    }
  }

  closeAll() {
    document.querySelectorAll('.modal-overlay.open').forEach(modal => {
      modal.classList.remove('open');
    });
    this.activeModal = null;
    document.body.style.overflow = '';
  }

  async confirm(message, options = {}) {
    return new Promise((resolve) => {
      const modalId = '_confirm_' + Date.now();
      const overlay = document.createElement('div');
      overlay.id = modalId;
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      
      const yesText = options.yes || 'نعم';
      const noText = options.no || 'لا';
      
      overlay.innerHTML = `
        <div class="modal modal-sm">
          <div class="modal-header">
            <span class="modal-title"><i class="fa-solid fa-circle-question" style="color:var(--warning);"></i> تأكيد</span>
            <button class="modal-close" onclick="ModalManager._closeConfirm('${modalId}', false)">✕</button>
          </div>
          <div style="padding:20px;text-align:center;font-size:1rem;">${this._escapeHtml(message)}</div>
          <div class="modal-footer">
            <button class="btn btn-primary" onclick="ModalManager._closeConfirm('${modalId}', true)">${yesText}</button>
            <button class="btn btn-secondary" onclick="ModalManager._closeConfirm('${modalId}', false)">${noText}</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      // تخزين الدالة لحلها
      window['_confirmResolver_' + modalId] = (result) => {
        delete window['_confirmResolver_' + modalId];
        resolve(result);
      };
    });
  }

  static _closeConfirm(modalId, result) {
    const overlay = document.getElementById(modalId);
    if (overlay) {
      overlay.remove();
      if (window['_confirmResolver_' + modalId]) {
        window['_confirmResolver_' + modalId](result);
      }
    }
  }

  async alert(message, type = 'info') {
    return new Promise((resolve) => {
      const modalId = '_alert_' + Date.now();
      const overlay = document.createElement('div');
      overlay.id = modalId;
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      
      const icons = {
        info: 'fa-circle-info',
        success: 'fa-circle-check',
        warning: 'fa-triangle-exclamation',
        error: 'fa-circle-xmark'
      };
      
      const colors = {
        info: 'var(--primary)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--danger)'
      };
      
      overlay.innerHTML = `
        <div class="modal modal-sm">
          <div class="modal-header">
            <span class="modal-title"><i class="fa-solid ${icons[type]}" style="color:${colors[type]};"></i> إشعار</span>
            <button class="modal-close" onclick="ModalManager._closeAlert('${modalId}')">✕</button>
          </div>
          <div style="padding:20px;text-align:center;font-size:1rem;">${this._escapeHtml(message)}</div>
          <div class="modal-footer">
            <button class="btn btn-primary" onclick="ModalManager._closeAlert('${modalId}')">حسناً</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      window['_alertResolver_' + modalId] = resolve;
    });
  }

  static _closeAlert(modalId) {
    const overlay = document.getElementById(modalId);
    if (overlay) {
      overlay.remove();
      if (window['_alertResolver_' + modalId]) {
        window['_alertResolver_' + modalId]();
        delete window['_alertResolver_' + modalId];
      }
    }
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ══════════════════════════════════════════════════════════════
//  Notification Manager - إدارة الإشعارات
// ══════════════════════════════════════════════════════════════
class NotificationManager {
  constructor() {
    this.STORAGE_KEY = 'posdz_notifications_v2';
    this.MAX_NOTIFICATIONS = 100;
    this.notifications = [];
    this.bellElement = null;
    this.panelElement = null;
    this.db = null;
  }

  async init(db) {
    this.db = db;
    this._load();
    this._injectBell();
    this._scheduleChecks();
  }

  _load() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        this.notifications = JSON.parse(saved);
      }
    } catch (e) {
      this.notifications = [];
    }
  }

  _save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.notifications));
    } catch (e) {
      console.warn('فشل في حفظ الإشعارات:', e);
    }
  }

  push(id, icon, title, body, type = 'warning', ttl = 86400000) {
    window.SoundManager?.play('alert'); // صوت الإشعار
    const now = Date.now();
    
    // التحقق من التكرار
    const existing = this.notifications.find(n => n.id === id);
    if (existing && (now - existing.timestamp) < ttl) {
      return;
    }
    
    // إزالة القديم إذا وجد
    this.notifications = this.notifications.filter(n => n.id !== id);
    
    // إضافة الجديد
    this.notifications.unshift({
      id,
      icon,
      title,
      body,
      type,
      timestamp: now,
      read: false
    });
    
    // قص القائمة
    if (this.notifications.length > this.MAX_NOTIFICATIONS) {
      this.notifications = this.notifications.slice(0, this.MAX_NOTIFICATIONS);
    }
    
    this._save();
    this._updateBadge();
    this._updatePanel();
  }

  markRead(id) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif) {
      notif.read = true;
      this._save();
      this._updateBadge();
      this._updatePanel();
    }
  }

  markAllRead() {
    this.notifications.forEach(n => n.read = true);
    this._save();
    this._updateBadge();
    this._updatePanel();
  }

  clearAll() {
    this.notifications = [];
    this._save();
    this._updateBadge();
    this._updatePanel();
  }

  _injectBell() {
    const header = document.querySelector('.app-header');
    if (!header) return;
    
    // البحث عن الجرس الموجود
    this.bellElement = document.getElementById('_notifBell');
    if (!this.bellElement) {
      this.bellElement = document.createElement('button');
      this.bellElement.id = '_notifBell';
      this.bellElement.className = 'notif-bell';
      this.bellElement.title = 'الإشعارات';
      this.bellElement.innerHTML = `
        <i class="fa-solid fa-bell"></i>
        <span id="_notifBadge" class="notif-badge" style="display:none;"></span>
      `;
      
      const menuBtn = header.querySelector('.menu-btn');
      if (menuBtn) {
        menuBtn.insertAdjacentElement('afterend', this.bellElement);
      } else {
        header.appendChild(this.bellElement);
      }
    }
    
    this.bellElement.onclick = (e) => {
      e.stopPropagation();
      this._togglePanel();
    };
    
    // إنشاء لوحة الإشعارات
    this.panelElement = document.createElement('div');
    this.panelElement.id = '_notifPanel';
    this.panelElement.style.cssText = `
      display:none;position:fixed;top:68px;right:16px;z-index:9000;
      width:340px;max-height:480px;overflow-y:auto;
      background:var(--bg-card);border:1px solid var(--primary);
      border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.55);
      font-family:var(--font-main);
    `;
    document.body.appendChild(this.panelElement);
    
    // إغلاق عند النقر خارجاً
    document.addEventListener('click', (e) => {
      if (!this.panelElement.contains(e.target) && !this.bellElement.contains(e.target)) {
        this.panelElement.style.display = 'none';
      }
    });
    
    this._updateBadge();
    this._updatePanel();
  }

  _togglePanel() {
    if (this.panelElement.style.display === 'none' || !this.panelElement.style.display) {
      this._updatePanel();
      this.panelElement.style.display = 'block';
    } else {
      this.panelElement.style.display = 'none';
    }
  }

  _updateBadge() {
    const badge = document.getElementById('_notifBadge');
    if (!badge) return;
    
    const unread = this.notifications.filter(n => !n.read).length;
    if (unread > 0) {
      badge.style.display = 'flex';
      badge.textContent = unread > 99 ? '99+' : String(unread);
    } else {
      badge.style.display = 'none';
    }
  }

  _updatePanel() {
    if (!this.panelElement) return;
    
    const unread = this.notifications.filter(n => !n.read).length;
    const colors = {
      warning: '#f59e0b',
      danger: '#ef4444',
      success: '#10b981',
      info: '#3b82f6'
    };
    
    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:14px 16px;border-bottom:1px solid var(--border);
                  background:var(--bg-dark);border-radius:14px 14px 0 0;
                  position:sticky;top:0;z-index:1;">
        <span style="font-weight:800;font-size:1rem;color:var(--primary-light);">
          <i class="fa-solid fa-bell"></i> الإشعارات
          ${unread > 0 ? `<span style="background:#ef4444;color:#fff;border-radius:10px;
                           padding:1px 8px;font-size:0.72rem;margin-right:6px;">${unread}</span>` : ''}
        </span>
        ${unread > 0 ? 
          `<button onclick="NotificationManager._markAllRead()"
             style="background:transparent;border:1px solid var(--border);
                    color:var(--text-secondary);padding:4px 10px;border-radius:8px;
                    cursor:pointer;font-size:0.75rem;">قراءة الكل ✓</button>` : 
          '<span style="color:var(--success);font-size:0.82rem;">✅ لا جديد</span>'}
      </div>
    `;
    
    if (this.notifications.length === 0) {
      html += `
        <div style="padding:32px;text-align:center;color:var(--text-secondary);font-size:0.9rem;">
          <div style="font-size:2rem;margin-bottom:10px;"><i class="fa-solid fa-bell-slash"></i></div>
          لا توجد إشعارات
        </div>
      `;
    } else {
      const sorted = [...this.notifications].sort((a, b) => b.timestamp - a.timestamp);
      
      html += sorted.map(n => {
        const color = colors[n.type] || '#6b7280';
        const date = new Date(n.timestamp).toLocaleDateString('ar-DZ') + ' ' +
                    new Date(n.timestamp).toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });
        
        return `
          <div onclick="NotificationManager._markRead('${n.id}')"
               style="display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);
                      cursor:pointer;background:${n.read ? 'transparent' : 'rgba(124,58,237,0.06)'};
                      ${n.read ? 'opacity:0.6;' : ''}"
               onmouseenter="this.style.background='var(--bg-medium)'"
               onmouseleave="this.style.background='${n.read ? 'transparent' : 'rgba(124,58,237,0.06)'}'">
            <div style="width:36px;height:36px;border-radius:50%;background:${color}22;
                        border:2px solid ${color};display:flex;align-items:center;
                        justify-content:center;font-size:1.1rem;flex-shrink:0;">${n.icon}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:${n.read ? '600' : '800'};font-size:0.88rem;
                         color:var(--text-primary);margin-bottom:3px;">
                ${this._escapeHtml(n.title)}
                ${!n.read ? '<span style="background:#ef4444;border-radius:50%;width:8px;height:8px;display:inline-block;margin-right:4px;"></span>' : ''}
              </div>
              <div style="font-size:0.78rem;color:var(--text-secondary);line-height:1.4;">
                ${this._escapeHtml(n.body)}
              </div>
              <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:4px;opacity:0.7;">
                ${date}
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      html += `
        <div style="padding:10px 16px;text-align:center;">
          <button onclick="NotificationManager._clearAll()"
                  style="background:transparent;border:1px solid var(--danger);
                         color:var(--danger);padding:5px 14px;border-radius:8px;
                         cursor:pointer;font-size:0.78rem;">
            <i class="fa-solid fa-trash"></i> مسح جميع الإشعارات
          </button>
        </div>
      `;
    }
    
    this.panelElement.innerHTML = html;
  }

  async _scheduleChecks() {
    if (!this.db) return;
    
    const settings = await this.db.get('settings', 'notifEnabled');
    if (settings?.value !== '1') return;
    
    await this._checkConditions();
    
    // جدولة الفحص كل 6 ساعات
    setTimeout(() => this._scheduleChecks(), 6 * 60 * 60 * 1000);
  }

  async _checkConditions() {
    try {
      const products = await this.db.getAll('products');
      const debts = await this.db.getAll('debts');
      const customers = await this.db.getAll('customers');
      const settings = await this.db.getAll('settings');
      
      const settingsMap = {};
      settings.forEach(s => settingsMap[s.key] = s.value);
      
      const now = Date.now();
      
      // فحص المخزون المنخفض
      if (settingsMap.notifyLowStock !== '0') {
        const lowStockThreshold = parseInt(settingsMap.lowStockAlert) || 5;
        products
          .filter(p => p.quantity > 0 && p.quantity <= lowStockThreshold)
          .forEach(p => {
            this.push(
              `low_${p.id}`,
              '📉',
              'مخزون منخفض',
              `${p.name} — الكمية: ${p.quantity}`,
              'warning'
            );
          });
      }
      
      // فحص المنتجات المنتهية — يستخدم حدود WATCH من الإعدادات
      if (settingsMap.notifyExpiry !== '0') {
        const expiryDays = parseInt(settingsMap.expiryWatchDays) || 45;
        products
          .filter(p => p.expiryDate)
          .forEach(p => {
            const daysSince = DateUtils.daysBetween(p.expiryDate);
            // منتهي: اليوم أو ما بعده (daysSince >= 0)
            if (daysSince >= 0) {
              this.push(
                `exp_${p.id}`,
                '❌',
                'منتج منتهي الصلاحية',
                `${p.name} — انتهت الصلاحية`,
                'danger'
              );
            // ينتهي قريباً: في غضون expiryDays يوماً (daysSince سالب بين -expiryDays و -1)
            } else if (daysSince >= -expiryDays) {
              const remaining = -daysSince;
              this.push(
                `exp_${p.id}`,
                '⏰',
                'انتهاء الصلاحية قريب',
                `${p.name} — يتبقى ${remaining} يوم`,
                'warning'
              );
            }
          });
      }
      
      // فحص الديون المتأخرة
      if (settingsMap.notifyDebt !== '0') {
        debts
          .filter(d => !d.isPaid)
          .forEach(d => {
            const days = DateUtils.daysBetween(d.date);
            if (days >= 28) {
              const customer = customers.find(c => c.id === d.customerId);
              this.push(
                `debt_${d.id}`,
                days >= 30 ? '💳' : '⚠️',
                days >= 30 ? 'دين متجاوز 30 يوم' : 'دين يقترب من 30 يوم',
                `${customer?.name || 'زبون'} — ${d.amount} دج — منذ ${days} يوم`,
                days >= 30 ? 'danger' : 'warning'
              );
            }
          });
      }
      
    } catch (e) {
      console.warn('خطأ في فحص الإشعارات:', e);
    }
  }

  static _markRead(id) {
    if (window.notificationManager) {
      window.notificationManager.markRead(id);
    }
  }

  static _markAllRead() {
    if (window.notificationManager) {
      window.notificationManager.markAllRead();
    }
  }

  static _clearAll() {
    if (window.notificationManager) {
      window.notificationManager.clearAll();
    }
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ══════════════════════════════════════════════════════════════
//  Sanitizer - تعقيم النصوص
// ══════════════════════════════════════════════════════════════
class Sanitizer {
  static escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  static escapeObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const result = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.escape(value);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.escapeObject(value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  static validateNumber(value, min = -Infinity, max = Infinity) {
    const num = parseFloat(value);
    if (isNaN(num)) return 0;
    return Math.min(Math.max(num, min), max);
  }

  static validateInteger(value, min = -Infinity, max = Infinity) {
    const num = parseInt(value);
    if (isNaN(num)) return 0;
    return Math.min(Math.max(num, min), max);
  }

  static validateDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
}

// ══════════════════════════════════════════════════════════════
//  Invoice Counter - إدارة أرقام الفواتير
// ══════════════════════════════════════════════════════════════
class InvoiceCounter {
  constructor(db) {
    this.db = db;
  }

  async getNext() {
    const today = DateUtils.today();
    let counter = await this.db.get('counter', 1);
    
    if (!counter) {
      counter = { id: 1, number: 1, lastReset: today };
    }
    
    if (counter.lastReset !== today) {
      counter.number = 1;
      counter.lastReset = today;
    }
    
    const nextNumber = counter.number;
    counter.number++;
    
    await this.db.put('counter', counter);
    return '#' + String(nextNumber).padStart(3, '0');
  }

  async resetDaily() {
    await this.db.put('counter', {
      id: 1,
      number: 1,
      lastReset: DateUtils.today()
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  Theme Manager - إدارة الثيم
// ══════════════════════════════════════════════════════════════
class ThemeManager {
  constructor(db) {
    this.db = db;
  }

  async apply() {
    const [accent, bg, font, lang, fontSize] = await Promise.all([
      this._getSetting('themeColor', 'blue_purple'),
      this._getSetting('bgMode', 'dark'),
      this._getSetting('appFont', 'cairo'),
      this._getSetting('language', 'ar'),
      this._getSetting('fontSize', '15')
    ]);

    const root = document.documentElement;
    
    root.setAttribute('data-accent', accent);
    root.setAttribute('data-bg', bg);
    root.setAttribute('data-font', font);
    root.style.fontSize = parseInt(fontSize) + 'px';
    
    localStorage.setItem('posdz_lang', lang);
    
    await this._applyLanguage(lang);
  }

  async _getSetting(key, defaultValue) {
    const setting = await this.db.get('settings', key);
    return setting?.value || defaultValue;
  }

  async _applyLanguage(lang) {
    // تحديث اتجاه الصفحة
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    
    // تحديث جميع عناصر data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const translation = this._getTranslation(key, lang);
      if (translation) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = translation;
        } else {
          el.textContent = translation;
        }
      }
    });
    
    // تحديث العملة
    const currency = await this._getSetting('currency', 'DA');
    if (window.currencyFormatter) {
      window.currencyFormatter.symbol = currency;
    }
  }

  _getTranslation(key, lang) {
    // هذا سيتم استبداله بملف ترجمة كامل
    const translations = window.APP_I18N || {};
    return translations[lang]?.[key] || translations.ar?.[key] || key;
  }
}


// ══════════════════════════════════════════════════════════════
//  ExpiryRiskEngine — محرك تحليل خطر الصلاحية
//  المعيار: يحسب الخطر الحقيقي من معدل البيع الفعلي
//  المدخلات: productBatches + products + saleItems (من DB)
//  المخرجات: تقرير لكل دفعة: خطر + خسارة + إجراء مقترح
// ══════════════════════════════════════════════════════════════

const EXPIRY_LEVELS = Object.freeze({
  SAFE:     { id: 'SAFE',     sort: 4, label: '🟢 آمن',                  color: '#10b981', days: null },
  WATCH:    { id: 'WATCH',    sort: 3, label: '🟡 تنبيه مبكر',           color: '#f59e0b', days: 45  },
  WARNING:  { id: 'WARNING',  sort: 2, label: '⚠️ تحذير',                color: '#ea580c', days: 30  },
  CRITICAL: { id: 'CRITICAL', sort: 1, label: '🚨 حرج — تصرف فوراً',    color: '#ef4444', days: 15  },
  EXPIRED:  { id: 'EXPIRED',  sort: 0, label: '⛔ منتهي — سحب فوري',    color: '#6b7280', days: 0   },
});

class ExpiryRiskEngine {

  // ── الدالة الرئيسية: تحلل كل الدفعات وترجع تقرير كامل ──────
  static async analyze() {
    try {
      const db         = window.dbManager;
      const thresholds = await ExpiryRiskEngine._loadThresholds();
      const batches    = await db.getAll('productBatches');
      const products   = await db.getAll('products');
      const items      = await db.getAll('saleItems');
      const sales      = await db.getAll('sales');

      // خريطة saleId → date لربط saleItems بتواريخها
      const saleDateMap = {};
      sales.forEach(s => { saleDateMap[s.id] = s.date; });

      // تاريخ الحد: آخر 30 يوم للحساب
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString();

      // تجميع مبيعات كل منتج في آخر 30 يوم
      const salesMap = {};   // productId → كمية مباعة
      items.forEach(it => {
        const saleDate = saleDateMap[it.saleId];
        if (!saleDate || saleDate < cutoffStr) return;
        if (!it.productId) return;
        salesMap[it.productId] = (salesMap[it.productId] || 0) + (it.quantity || 0);
      });

      const results = [];

      // ── معالجة كل دفعة ──────────────────────────────────────
      for (const batch of batches) {
        if (!batch.expiryDate) continue;

        const product = products.find(p => p.id === batch.productId);
        const qty     = batch.quantity || 0;
        if (qty <= 0 && batch.isWrittenOff) continue; // مشطوبة بالفعل

        // الأيام المتبقية حتى الانتهاء
        const daysLeft = ExpiryRiskEngine._daysLeft(batch.expiryDate);

        // معدل البيع اليومي لآخر 30 يوم
        const sold30    = salesMap[batch.productId] || 0;
        const dailyRate = sold30 / 30;

        // الكمية التي ستُباع قبل الانتهاء (بالمعدل الحالي)
        const willSell   = daysLeft > 0 ? Math.min(qty, dailyRate * daysLeft) : 0;

        // الكمية المهددة بالرمي
        const atRiskQty  = Math.max(0, qty - willSell);

        // الخسارة المالية المتوقعة
        const buyPrice   = product?.buyPrice || 0;
        const lossAmount = atRiskQty * buyPrice;

        // نسبة الخصم المقترحة لاسترداد التكلفة
        // المنطق: نبيع atRiskQty بأي سعر > 0 لتقليل الخسارة
        const sellPrice     = product?.sellPrice || 0;
        const suggestedDisc = ExpiryRiskEngine._calcDiscount(
          sellPrice, buyPrice, atRiskQty, dailyRate, daysLeft, thresholds
        );

        // مستوى الخطر
        const level = ExpiryRiskEngine._calcLevel(daysLeft, atRiskQty, qty, thresholds);

        // الإجراء المقترح
        const action = ExpiryRiskEngine._suggestAction(
          level, suggestedDisc, atRiskQty, lossAmount
        );

        results.push({
          batch,
          product,
          qty,
          daysLeft,
          dailyRate:      parseFloat(dailyRate.toFixed(2)),
          willSell:       parseFloat(willSell.toFixed(1)),
          atRiskQty:      parseFloat(atRiskQty.toFixed(1)),
          lossAmount:     parseFloat(lossAmount.toFixed(2)),
          suggestedDisc,
          level,
          action,
        });
      }

      // ── fallback: منتجات قديمة بدون دفعة ────────────────────
      const batchedProductIds = new Set(batches.map(b => b.productId));
      for (const p of products) {
        if (!p.expiryDate)              continue;
        if (batchedProductIds.has(p.id)) continue; // لها دفعة بالفعل
        if ((p.quantity || 0) <= 0)     continue;

        const daysLeft   = ExpiryRiskEngine._daysLeft(p.expiryDate);
        const sold30     = salesMap[p.id] || 0;
        const dailyRate  = sold30 / 30;
        const willSell   = daysLeft > 0 ? Math.min(p.quantity, dailyRate * daysLeft) : 0;
        const atRiskQty  = Math.max(0, p.quantity - willSell);
        const lossAmount = atRiskQty * (p.buyPrice || 0);
        const suggestedDisc = ExpiryRiskEngine._calcDiscount(
          p.sellPrice || 0, p.buyPrice || 0, atRiskQty, dailyRate, daysLeft, thresholds
        );
        const level  = ExpiryRiskEngine._calcLevel(daysLeft, atRiskQty, p.quantity, thresholds);
        const action = ExpiryRiskEngine._suggestAction(level, suggestedDisc, atRiskQty, lossAmount);

        results.push({
          batch:     null,
          product:   p,
          qty:       p.quantity,
          daysLeft,
          dailyRate: parseFloat(dailyRate.toFixed(2)),
          willSell:  parseFloat(willSell.toFixed(1)),
          atRiskQty: parseFloat(atRiskQty.toFixed(1)),
          lossAmount:parseFloat(lossAmount.toFixed(2)),
          suggestedDisc,
          level,
          action,
        });
      }

      // ترتيب: الأخطر أولاً، ثم الأعلى خسارة
      results.sort((a, b) => {
        if (a.level.sort !== b.level.sort) return a.level.sort - b.level.sort;
        return b.lossAmount - a.lossAmount;
      });

      return results;

    } catch (e) {
      console.error('[ExpiryRiskEngine] خطأ في التحليل:', e);
      return [];
    }
  }

  // ── جلب حدود المستويات من الإعدادات (Single Source of Truth) ──
  static async _loadThresholds() {
    const g = window.getSetting.bind(window);
    return {
      // صلاحية
      expCritical: parseInt(await g('expiryCriticalDays')) || 15,
      expWarning:  parseInt(await g('expiryWarningDays'))  || 30,
      expWatch:    parseInt(await g('expiryWatchDays'))    || 45,
      // مخزون
      stkCritical: parseInt(await g('stockCriticalQty'))   || 10,
      stkWarning:  parseInt(await g('stockWarningQty'))    || 15,
      stkWatch:    parseInt(await g('stockWatchQty'))      || 20,
    };
  }

  // ── حساب الأيام المتبقية (سالب = منتهي) ──────────────────
  static _daysLeft(expiryDate) {
    const today    = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate  = new Date(expiryDate + 'T00:00:00Z');
    const diffMs   = expDate.getTime() - today.getTime();
    return Math.floor(diffMs / 86400000);
  }

  // ── تحديد مستوى الخطر (يقرأ الحدود من settings) ────────
  static _calcLevel(daysLeft, atRiskQty, totalQty, thresholds) {
    const t = thresholds || { expCritical:15, expWarning:30, expWatch:45 };
    if (daysLeft <= 0)                return EXPIRY_LEVELS.EXPIRED;
    if (daysLeft <= t.expCritical)    return EXPIRY_LEVELS.CRITICAL;
    if (daysLeft <= t.expWarning)     return EXPIRY_LEVELS.WARNING;
    if (daysLeft <= t.expWatch)       return EXPIRY_LEVELS.WATCH;
    // > expWatch يوم: آمن فقط إذا الكمية المهددة صفر أو ضئيلة
    if (atRiskQty <= 0 || atRiskQty / (totalQty || 1) < 0.05) return EXPIRY_LEVELS.SAFE;
    return EXPIRY_LEVELS.WATCH;
  }

  // ── حساب نسبة الخصم المقترحة ──────────────────────────────
  // الهدف: تخفيض يجعل المنتج يُباع بالكامل قبل الانتهاء
  static _calcDiscount(sellPrice, buyPrice, atRiskQty, dailyRate, daysLeft, thresholds) {
    if (atRiskQty <= 0 || daysLeft <= 0 || sellPrice <= 0) return 0;
    if (dailyRate * daysLeft >= atRiskQty) return 0;

    const t = thresholds || { expCritical:15, expWarning:30, expWatch:45 };
    // نسبة خصم تدريجية مربوطة بالإعدادات
    if (daysLeft <= t.expCritical) return Math.min(40, Math.round((1 - buyPrice / sellPrice) * 100 * 0.9));
    if (daysLeft <= t.expWarning)  return 20;
    if (daysLeft <= t.expWatch)    return 10;
    return 5;
  }

  // ── اقتراح الإجراء ────────────────────────────────────────
  static _suggestAction(level, discPct, atRiskQty, lossAmount) {
    const fmt = window.currencyFormatter?.format || (n => n + ' DA');
    switch (level.id) {
      case 'SAFE':
        return { type: 'none', label: 'لا إجراء', detail: '' };
      case 'WATCH':
        return { type: 'promote', label: 'ابدأ الترويج',
          detail: `${atRiskQty.toFixed(0)} وحدة معرضة للخطر` };
      case 'WARNING':
        return { type: 'discount', label: `خصم ${discPct}% مقترح`,
          detail: `يُنقذ ما يصل إلى ${fmt(lossAmount)}` };
      case 'CRITICAL':
        return { type: 'urgent', label: 'خصم فوري أو إرجاع',
          detail: `خسارة متوقعة: ${fmt(lossAmount)}` };
      case 'EXPIRED':
        return { type: 'writeoff', label: 'شطب إلزامي',
          detail: `خسارة محققة: ${fmt(lossAmount)}` };
      default:
        return { type: 'none', label: '', detail: '' };
    }
  }

  // ── ملخص سريع للوحة القرارات ──────────────────────────────
  static summarize(results) {
    return {
      expired:      results.filter(r => r.level.id === 'EXPIRED'),
      critical:     results.filter(r => r.level.id === 'CRITICAL'),
      warning:      results.filter(r => r.level.id === 'WARNING'),
      watch:        results.filter(r => r.level.id === 'WATCH'),
      totalLoss:    results.reduce((s, r) => s + r.lossAmount, 0),
      expiredLoss:  results.filter(r => r.level.id === 'EXPIRED')
                           .reduce((s, r) => s + r.lossAmount, 0),
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  recordExpiryLoss — تسجيل خسارة الصلاحية في expenses
//  تُستدعى من inventory.html عند الشطب
// ══════════════════════════════════════════════════════════════
async function recordExpiryLoss({ productName, batchId, qty, buyPrice, note }) {
  try {
    const amount = parseFloat(qty) * parseFloat(buyPrice || 0);
    if (amount <= 0) return;
    await window.dbManager.add('expenses', {
      category:           'خسارة صلاحية',
      amount,
      date:               window.dateUtils.today(),
      note:               note || `${productName} — ${qty} وحدة`,
      isPaid:             true,
      paidDate:           window.dateUtils.today(),
      include_in_reports: true,
      source:             'expiry_loss',
      batchId:            batchId || null,
      updatedAt:          window.dateUtils.now(),
    });
  } catch (e) {
    console.error('[recordExpiryLoss] خطأ:', e);
  }
}

// ══════════════════════════════════════════════════════════════
//  ErrorLogger — نظام مركزي للأخطاء
//  يُفرّق بين نوعين:
//  • EXPECTED  : حالة طبيعية متوقعة (خادم غائب على GitHub Pages)
//                → console.info فقط، لا إزعاج للمستخدم
//  • UNEXPECTED: خطأ حقيقي يحتاج انتباه (DB فشل، API خطأ …)
//                → console.error + toast للمستخدم + سجل داخلي
// ══════════════════════════════════════════════════════════════
class ErrorLogger {
  constructor() {
    this._log  = [];          // آخر 50 خطأ في الذاكرة
    this._MAX  = 50;
  }

  // خطأ غير متوقع — يظهر للمستخدم
  error(context, message, err) {
    const entry = {
      level:   'error',
      context,
      message,
      detail:  err?.message || String(err || ''),
      time:    new Date().toISOString(),
    };
    this._store(entry);
    console.error(`[HP-POS] ❌ [${context}] ${message}`, err || '');
    window.toast?.show(`❌ ${message}`, 'error', 5000);
  }

  // تحذير — يظهر للمستخدم لكن أقل حدة
  warn(context, message, err) {
    const entry = {
      level:   'warn',
      context,
      message,
      detail:  err?.message || String(err || ''),
      time:    new Date().toISOString(),
    };
    this._store(entry);
    console.warn(`[HP-POS] ⚠️ [${context}] ${message}`, err || '');
    window.toast?.show(`⚠️ ${message}`, 'warning', 4000);
  }

  // حالة متوقعة — console فقط بدون إزعاج
  info(context, message) {
    console.info(`[HP-POS] ℹ️ [${context}] ${message}`);
  }

  // جلب السجل للتشخيص
  getLogs() { return [...this._log]; }

  _store(entry) {
    this._log.unshift(entry);
    if (this._log.length > this._MAX) this._log.length = this._MAX;
  }
}

window.errorLogger = new ErrorLogger();
function _debounce(fn, delay) {
  let t;
  return function () { clearTimeout(t); t = setTimeout(fn, delay); };
}
window._debounce = _debounce;

// ══════════════════════════════════════════════════════════════
//  RealtimeManager — تحديثات آنية عبر BroadcastChannel
//  ✅ batch: كتابات متعددة في نفس العملية → إشعار واحد فقط
//  ✅ transactions و dailyEntries خرجا من القائمة الصامتة
// ══════════════════════════════════════════════════════════════
const _RT_SILENT = new Set([
  'settings', 'logs', 'counter', 'syncQueue'
]);

class RealtimeManager {
  constructor() {
    this._subs        = {};   // store → [callbacks]
    this._batchTimer  = null; // مؤقت الـ batch الموحّد
    this._batchStores = new Set(); // المخازن المتراكمة في الـ batch
    this._channel     = null;
    this._initChannel();
  }

  _initChannel() {
    try {
      this._channel = new BroadcastChannel('posdz_realtime');
      this._channel.onmessage = (e) => {
        const stores = e.data?.stores;
        if (Array.isArray(stores)) stores.forEach(s => this._fire(s));
      };
    } catch (e) {
      console.warn('[Realtime] BroadcastChannel غير مدعوم في هذه البيئة');
    }
  }

  // ── يُستدعى من DatabaseManager بعد كل عملية كتابة ──────────
  // يجمع كل الكتابات المتزامنة في 500ms ويُطلق إشعاراً واحداً
  notify(store) {
    if (_RT_SILENT.has(store)) return;
    this._batchStores.add(store);
    clearTimeout(this._batchTimer);
    this._batchTimer = setTimeout(() => {
      const stores = [...this._batchStores];
      this._batchStores.clear();
      this._batchTimer = null;
      // إطلاق كل المخازن المتراكمة مرة واحدة
      stores.forEach(s => this._fire(s));
      try { this._channel?.postMessage({ stores }); } catch (e) {}
    }, 500);
  }

  // ── إطلاق الكولباكات المسجّلة لهذا المخزن ──────────────────
  _fire(store) {
    (this._subs[store] || []).forEach(cb => { try { cb(store); } catch (e) {} });
    (this._subs['*']   || []).forEach(cb => { try { cb(store); } catch (e) {} });
  }

  // ── تسجيل مستمع لمخزن أو أكثر ──────────────────────────────
  subscribe(stores, cb) {
    const list = Array.isArray(stores) ? stores : [stores];
    list.forEach(s => {
      if (!this._subs[s]) this._subs[s] = [];
      if (!this._subs[s].includes(cb)) this._subs[s].push(cb);
    });
  }

  // ── إلغاء تسجيل مستمع ───────────────────────────────────────
  unsubscribe(stores, cb) {
    const list = Array.isArray(stores) ? stores : [stores];
    list.forEach(s => {
      if (this._subs[s]) this._subs[s] = this._subs[s].filter(x => x !== cb);
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  تصدير الكلاسات العامة
// ══════════════════════════════════════════════════════════════
window.dbManager = new DatabaseManager();
window.realtimeManager = new RealtimeManager();
window.passwordManager = PasswordManager;
window.sessionManager = new SessionManager();
window.dateUtils = DateUtils;
window.currencyFormatter = new CurrencyFormatter();
window.toast = new ToastManager();
window.modalManager = new ModalManager();
window.notificationManager = new NotificationManager();
window.sanitizer = Sanitizer;
window.themeManager = null; // سيتم تعيينه بعد فتح DB

// ══════════════════════════════════════════════════════════════
//  دالة التهيئة الرئيسية
// ══════════════════════════════════════════════════════════════
async function initApp() {
  try {
    // فتح قاعدة البيانات
    await window.dbManager.open();
    
    // تهيئة مدير الثيم
    window.themeManager = new ThemeManager(window.dbManager);
    await window.themeManager.apply();
    
    // تهيئة العملة
    await window.currencyFormatter.init();
    
    // تهيئة الجلسة
    window.sessionManager.init();
    
    // تهيئة الإشعارات
    await window.notificationManager.init(window.dbManager);
    
    // تحميل اسم المتجر في الهيدر
    await loadHeaderStoreName();
    
    // بدء الساعة
    startClock();
    
    // تهيئة الـ Sidebar
    initSidebar();
    
    console.log('✅ تم تهيئة التطبيق بنجاح');
    
  } catch (e) {
    window.errorLogger?.error('initApp', 'فشل تهيئة التطبيق — أعد تحميل الصفحة', e);
    console.error('❌ فشل في تهيئة التطبيق:', e);
    window.toast?.show('❌ فشل في تحميل التطبيق — أعد تحميل الصفحة', 'error', 8000);
  }
}

// ══════════════════════════════════════════════════════════════
//  دوال مساعدة متوافقة مع الكود القديم
// ══════════════════════════════════════════════════════════════
async function openDB() {
  return window.dbManager.open();
}

// ✅ دالة applyTheme العامة — مطلوبة من index.html
async function applyTheme() {
  try {
    if (!window.themeManager) {
      window.themeManager = new ThemeManager(window.dbManager);
    }
    await window.themeManager.apply();
  } catch(e) {
    console.warn('تحذير applyTheme:', e);
  }
}

function getSession() {
  return window.sessionManager.getUser();
}

function requireAuth(redirectUrl) {
  return window.sessionManager.requireAuth(redirectUrl);
}

function requireRole(roles, redirectUrl) {
  return window.sessionManager.requireRole(roles, redirectUrl);
}

function saveSession(user) {
  window.sessionManager.login(user);
}

function clearSession() {
  window.sessionManager.logout(false);
}

function toast(msg, type, duration) {
  window.toast.show(msg, type, duration);
}

function openModal(id) {
  window.modalManager.open(id);
}

function closeModal(id) {
  window.modalManager.close(id);
}

function closeAllModals() {
  window.modalManager.closeAll();
}

async function customConfirm(message) {
  return window.modalManager.confirm(message);
}

function formatDZ(amount) {
  return window.currencyFormatter.format(amount);
}

function formatMoney(amount) {
  return window.currencyFormatter.format(amount);
}

function todayStr() {
  return window.dateUtils.today();
}

function formatDate(iso, fmt) {
  return window.dateUtils.formatDate(iso, fmt);
}

function daysBetween(dateStr) {
  return window.dateUtils.daysBetween(dateStr);
}

async function getNextInvoiceNumber() {
  const counter = new InvoiceCounter(window.dbManager);
  return counter.getNext();
}

async function resetDailyCounter() {
  const counter = new InvoiceCounter(window.dbManager);
  return counter.resetDaily();
}

async function getSetting(key) {
  const setting = await window.dbManager.get('settings', key);
  return setting?.value || null;
}

async function setSetting(key, value) {
  await window.dbManager.put('settings', { key, value });
}

async function hashPassword(str) {
  return PasswordManager.hash(str);
}

async function verifyPassword(input, stored) {
  return PasswordManager.verify(input, stored);
}

// دوال DB للتوافق
async function dbGet(store, key) { return window.dbManager.get(store, key); }
async function dbGetAll(store) { return window.dbManager.getAll(store); }
async function dbPut(store, data) { return window.dbManager.put(store, data); }
async function dbAdd(store, data) { return window.dbManager.add(store, data); }
async function dbDelete(store, key) { return window.dbManager.delete(store, key); }
async function dbGetByIndex(store, idx, val) { return window.dbManager.getAll(store, { index: idx, value: val }); }
async function dbGetByRange(store, idx, lo, hi) {
  const db = await window.dbManager.open();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(store, 'readonly');
    const source = idx ? tx.objectStore(store).index(idx) : tx.objectStore(store);

    let range;
    if (lo !== undefined && lo !== null && hi !== undefined && hi !== null) {
      range = IDBKeyRange.bound(lo, hi, false, false);
    } else if (lo !== undefined && lo !== null) {
      range = IDBKeyRange.lowerBound(lo, false);
    } else if (hi !== undefined && hi !== null) {
      range = IDBKeyRange.upperBound(hi, false);
    }

    const req = range ? source.getAll(range) : source.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(new Error(`فشل dbGetByRange في ${store}: ${req.error}`));
  });
}

// دوال أخرى
function startClock() {
  // دعم البنية الجديدة (date+time منفصلان) والقديمة معاً
  const elDate = document.getElementById('clockDate');
  const elTime = document.getElementById('clockTime');
  const elLegacy = document.getElementById('clockDisplay');

  function tick() {
    const now = new Date();
    const yy  = now.getFullYear();
    const mm  = String(now.getMonth() + 1).padStart(2, '0');
    const dd  = String(now.getDate()).padStart(2, '0');
    const hh  = String(now.getHours()).padStart(2, '0');
    const mi  = String(now.getMinutes()).padStart(2, '0');
    const ss  = String(now.getSeconds()).padStart(2, '0');
    const dateStr = `${yy}/${mm}/${dd}`;
    const timeStr = `${hh}:${mi}:${ss}`;
    if (elDate) elDate.textContent = dateStr;
    if (elTime) elTime.textContent = timeStr;
    if (elLegacy) elLegacy.textContent = dateStr + '  ' + timeStr;
  }

  tick();
  setInterval(tick, 1000);
}

async function loadHeaderStoreName() {
  const el = document.getElementById('headerStoreName');
  if (!el) return;
  
  const name = await getSetting('storeName');
  if (name) el.textContent = name;
}

function initSidebar() {
  const sidebar        = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const menuBtn        = document.getElementById('menuBtn');

  if (!sidebar) return;

  // ── بناء محتوى الـ Sidebar ──────────────────────────────────
  const user        = window.sessionManager.getUser();
  const role        = user?.role || 'seller';
  const username    = user?.username || '—';
  const currentPage = location.pathname.split('/').pop() || 'sale.html';

  const roleLabels = { admin: '👑 مدير', manager: '🛡️ مدير مساعد', seller: '👤 بائع' };
  const roleLabel  = roleLabels[role] || role;

  // روابط التنقل — مع تحديد الصلاحيات
  const navLinks = [
    {
      group: 'الرئيسية',
      items: [
        { href: 'sale.html',      icon: 'fa-cash-register',  label: 'واجهة البيع',     roles: ['admin','manager','seller'] },
      ]
    },
    {
      group: 'الإدارة',
      items: [
        { href: 'inventory.html',  icon: 'fa-boxes-stacked',  label: 'المخزون',          roles: ['admin','manager'] },
        { href: 'customers.html',  icon: 'fa-users',           label: 'الزبائن والديون', roles: ['admin','manager','seller'] },
        { href: 'suppliers.html',  icon: 'fa-truck',           label: 'الموردون',         roles: ['admin','manager'] },
        { href: 'expenses.html',   icon: 'fa-wallet',          label: 'المصاريف والعمال',roles: ['admin','manager'] },
      ]
    },
    {
      group: 'التقارير',
      items: [
        { href: 'reports.html',    icon: 'fa-chart-line',      label: 'التقارير',         roles: ['admin','manager'] },
      ]
    },
    {
      group: 'النظام',
      items: [
        { href: 'users.html',      icon: 'fa-user-shield',     label: 'المستخدمون',       roles: ['admin'] },
        { href: 'settings.html',   icon: 'fa-gear',            label: 'الإعدادات',        roles: ['admin','manager'] },
      ]
    }
  ];

  // بناء HTML
  let navHTML = '';
  navLinks.forEach(group => {
    const visibleItems = group.items.filter(item => item.roles.includes(role));
    if (visibleItems.length === 0) return;

    navHTML += `<div class="nav-group-label">${group.group}</div>`;
    visibleItems.forEach(item => {
      const isActive = item.href === currentPage;
      navHTML += `
        <a href="${item.href}" class="nav-item${isActive ? ' active' : ''}">
          <span class="nav-icon"><i class="fa-solid ${item.icon}"></i></span>
          <span class="nav-label">${item.label}</span>
        </a>`;
    });
  });

  sidebar.innerHTML = `
    <!-- رأس الـ Sidebar -->
    <div class="sidebar-header">
      <div class="sidebar-header-top">
        <button class="sidebar-close-btn" id="sidebarCloseBtn" title="إغلاق">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="sidebar-user-box">
        <div class="sidebar-user-avatar">
          <i class="fa-solid fa-user"></i>
        </div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${Sanitizer.escape(username)}</div>
          <div class="sidebar-user-role">${roleLabel}</div>
        </div>
      </div>
    </div>

    <!-- قائمة التنقل -->
    <nav class="sidebar-nav">
      ${navHTML}
      <div class="nav-divider"></div>
      <button class="nav-item danger" id="sidebarLogout" style="width:100%;border:none;background:transparent;text-align:right;cursor:pointer;">
        <span class="nav-icon"><i class="fa-solid fa-right-from-bracket"></i></span>
        <span class="nav-label">تسجيل الخروج</span>
      </button>
    </nav>

    <!-- تذييل الـ Sidebar -->
    <div style="padding:10px 14px;border-top:1px solid var(--border);text-align:center;font-size:0.7rem;color:var(--text-secondary);flex-shrink:0;">
      HP-POS v${APP_VERSION.number}
    </div>
  `;

  // ── أحداث الفتح / الإغلاق ───────────────────────────────────
  function openSidebar() {
    sidebar.classList.add('open');
    if (sidebarOverlay) sidebarOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeSidebar);
  }

  document.getElementById('sidebarCloseBtn')?.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });


  // ── أصوات الانتقال والأزرار العامة ──────────────────────────
  document.addEventListener('click', (e) => {
    // انتقال بين صفحات التطبيق
    const navLink = e.target.closest('a[href]');
    if (navLink) {
      const href = navLink.getAttribute('href') || '';
      if (href.endsWith('.html') && !href.startsWith('http')) {
        window.SoundManager?.play('nav-page');
        return;
      }
    }
    // الأزرار العامة (غير أزرار التنقل)
    const btn = e.target.closest('button, .action-btn, .product-card');
    if (btn) window.SoundManager?.play('button');
  }, { capture: true, passive: true });

  // ── زر الخروج ───────────────────────────────────────────────
  document.getElementById('sidebarLogout')?.addEventListener('click', async () => {
    closeSidebar();
    const ok = await window.modalManager.confirm('هل تريد تسجيل الخروج؟', { yes: 'خروج', no: 'إلغاء' });
    if (ok) window.SoundManager?.play('login');
    window.sessionManager.logout(true);
  });
}

// ══════════════════════════════════════════════════════════════
//  وحدة الأصوات الشاملة — SoundManager v2
//  9 أحداث صوتية تغطي جميع نقاط التطبيق
//  Web Audio API — بدون ملفات خارجية
// ══════════════════════════════════════════════════════════════
const SoundManager = (() => {
  let _ctx = null;

  function _getCtx() {
    if (!_ctx || _ctx.state === 'closed') {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function _beep({ freq = 880, type = 'sine', dur = 0.12, vol = 0.4, decay = 0.08 } = {}) {
    try {
      const ctx = _getCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur + decay);
    } catch (_) {}
  }

  // ──────────────────────────────────────────────────────────
  //  تعريف الأصوات التسعة
  // ──────────────────────────────────────────────────────────

  // 1. إضافة منتج للسلة — نغمتان صاعدتان
  function playAdd() {
    _beep({ freq: 660, type: 'triangle', dur: 0.08, vol: 0.35 });
    setTimeout(() => _beep({ freq: 880, type: 'triangle', dur: 0.10, vol: 0.30 }), 90);
  }

  // 2. إتمام البيع — ثلاث نغمات احتفالية (Do Mi Sol)
  function playSell() {
    _beep({ freq: 523, type: 'sine', dur: 0.10, vol: 0.40 });
    setTimeout(() => _beep({ freq: 659, type: 'sine', dur: 0.10, vol: 0.40 }), 110);
    setTimeout(() => _beep({ freq: 784, type: 'sine', dur: 0.18, vol: 0.45 }), 220);
  }

  // 3. الأزرار العامة — نقرة قصيرة
  function playButton() {
    _beep({ freq: 440, type: 'square', dur: 0.05, vol: 0.18 });
  }

  // 4. الانتقال بين الإدارات (صفحة كاملة) — نغمة سلسة هابطة
  function playNavPage() {
    _beep({ freq: 740, type: 'sine', dur: 0.10, vol: 0.25 });
    setTimeout(() => _beep({ freq: 587, type: 'sine', dur: 0.12, vol: 0.20 }), 100);
  }

  // 5. الانتقال بين أقسام الإدارة (تبويب داخلي) — نبضة خفيفة
  function playNavTab() {
    _beep({ freq: 600, type: 'sine', dur: 0.07, vol: 0.22 });
    setTimeout(() => _beep({ freq: 720, type: 'sine', dur: 0.07, vol: 0.18 }), 75);
  }

  // 6. تحذير / خطأ — نغمتان هابطتان
  function playWarning() {
    _beep({ freq: 523, type: 'sawtooth', dur: 0.12, vol: 0.35 });
    setTimeout(() => _beep({ freq: 392, type: 'sawtooth', dur: 0.15, vol: 0.30 }), 130);
  }

  // 7. منتج نفد من المخزن — صوت تنبيه قصير متكرر
  function playOutOfStock() {
    [0, 160, 320].forEach((d) =>
      setTimeout(() => _beep({ freq: 350, type: 'square', dur: 0.10, vol: 0.28 }), d)
    );
  }

  // 8. إشعار وصول (دين / صلاحية / مخزون) — رنة تنبيهية
  function playAlert() {
    _beep({ freq: 880, type: 'sine', dur: 0.08, vol: 0.30 });
    setTimeout(() => _beep({ freq: 880, type: 'sine', dur: 0.08, vol: 0.30 }), 150);
    setTimeout(() => _beep({ freq: 1047, type: 'sine', dur: 0.14, vol: 0.35 }), 300);
  }

  // 9. تسجيل الدخول / الخروج — نغمة ترحيب
  function playLogin() {
    _beep({ freq: 392, type: 'sine', dur: 0.10, vol: 0.30 });
    setTimeout(() => _beep({ freq: 523, type: 'sine', dur: 0.10, vol: 0.30 }), 110);
    setTimeout(() => _beep({ freq: 659, type: 'sine', dur: 0.14, vol: 0.35 }), 220);
  }

  // ── خريطة النوع → المفتاح في الإعدادات ──────────────────
  const KEY_MAP = {
    'add':         'soundAdd',
    'sell':        'soundSell',
    'button':      'soundButtons',
    'nav-page':    'soundNavPage',
    'nav-tab':     'soundNavTab',
    'warning':     'soundWarning',
    'out-of-stock':'soundOutOfStock',
    'alert':       'soundAlert',
    'login':       'soundLogin',
  };

  const FN_MAP = {
    'add':          playAdd,
    'sell':         playSell,
    'button':       playButton,
    'nav-page':     playNavPage,
    'nav-tab':      playNavTab,
    'warning':      playWarning,
    'out-of-stock': playOutOfStock,
    'alert':        playAlert,
    'login':        playLogin,
  };

  // ── الواجهة العامة ────────────────────────────────────────
  async function play(type) {
    const settingKey = KEY_MAP[type];
    if (!settingKey) return;
    const enabled = await getSetting(settingKey);
    if (enabled === '0') return;           // مُعطَّل صراحةً
    const fn = FN_MAP[type];
    if (fn) fn();
  }

  // تشغيل فوري بدون فحص الإعداد (للاستخدام الداخلي الحرج)
  function playDirect(type) {
    const fn = FN_MAP[type];
    if (fn) fn();
  }

  return { play, playDirect };
})();

window.SoundManager = SoundManager;


// ══════════════════════════════════════════════════════════════
//  التصدير النهائي
// ══════════════════════════════════════════════════════════════
window.initApp              = initApp;
window.APP_VERSION          = APP_VERSION;
window.getNextInvoiceNumber = getNextInvoiceNumber;
window.resetDailyCounter    = resetDailyCounter;
window.dbGetByRange         = dbGetByRange;
window.ExpiryRiskEngine     = ExpiryRiskEngine;
window.EXPIRY_LEVELS        = EXPIRY_LEVELS;
window.recordExpiryLoss     = recordExpiryLoss;

// حوار الإدخال النصي العام (fallback إذا لم يُحمَّل print.js)
if (typeof window._inputDialog === 'undefined') {
  window._inputDialog = function(label, defaultValue) {
    const val = window.prompt(label, defaultValue || '');
    return Promise.resolve(val && val.trim() ? val.trim() : null);
  };
}

console.log('📦 HP-POS v8.1.0 - نظام محسّن بالكامل');
