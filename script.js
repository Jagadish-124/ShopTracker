const CREATOR_EMAIL = "jagadish12006@gmail.com";

let currency = 'INR';
let baseCurrency = 'INR';
let exchangeRates = null;
let ratesUpdatedAt = null;
let products = [];
let transactions = [];
let searchQuery = '';
let txnSearchQuery = '';
let filterCategory = 'all';
let sortBy = 'none';
let nextProdId = Date.now() + 1;
let deadStockDays = 7;
let skuCounter = 1;
let reviewedProducts = [];
let restockHistory = [];
let movementHistory = [];
let barChart = null;
let doughnutChart = null;
let authMode = 'login';
let currentUser = null;
let dailyGoal = 0;
let activeQuickSellId = null;
let bulkEntries = {};
let bulkPriceOverrides = {};
let quickSellQty = '0';
let pendingUndoTimer = null;
let notificationSettings = { enabled: false, lowStock: true, goal: true, dailySummary: true };
let firestoreUnsub = null;
let completeLoginInProgress = false;
let cameraStream = null;
let _saveDebounceTimer = null;
let _lastSyncedAt = 0;

// ── Offline detection ────────────────────────────────────────────────────────
let _isOnline = navigator.onLine;
let _saveStatus = 'idle';
const PENDING_SAVE_KEY = 'pendingSave_shoptracker';
let _savedPillTimer = null;

const VIEW_MODE_KEY = 'activeViewMode';
let activeViewMode = 'home';

const FEATURE_PANEL_KEY = 'featurePanels';
const featurePanelDefaults = { analytics: false, stock: false, timeline: false, reports: false };
let featurePanels = { ...featurePanelDefaults };

// ── FIX #1: Safe localStorage helpers ────────────────────────────────────────
// Never read raw JSON from localStorage without validation — attacker-controlled
// strings could reach JSON.parse in unexpected code paths.
function safeLocalStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* quota exceeded — silently ignore */ }
}
function safeLocalStorageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
function safeLocalStorageGetJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── FIX #2: Initialise exchangeRates from localStorage safely ─────────────────
(function initRatesFromCache() {
  exchangeRates  = safeLocalStorageGetJSON('exchangeRates');
  ratesUpdatedAt = safeLocalStorageGet('ratesUpdatedAt');
})();

// ============================================================================
// LOADING SCREEN
// ============================================================================

function showLoadingScreen() {
  const el = document.createElement('div');
  el.id = 'app-loading-screen';
  // Use DOM API instead of innerHTML for the structure to avoid any parser issues
  el.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:linear-gradient(135deg,#0a0d14,#0f1117);
    display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:0;transition:opacity 0.4s ease;
  `;

  const inner = document.createElement('div');
  inner.className = 'app-loader-inner';

  // SVG logo (safe static markup — no user data)
  const logoWrap = document.createElement('div');
  logoWrap.className = 'app-loader-logo';
  logoWrap.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none">
    <rect width="44" height="44" rx="14" fill="rgba(29,158,117,0.15)" stroke="rgba(29,158,117,0.4)" stroke-width="1.5"/>
    <path d="M12 22h6l4-8 4 16 4-8h6" stroke="#1D9E75" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const title = document.createElement('div');
  title.className = 'app-loader-title';
  title.textContent = 'Shop Tracker'; // textContent — no XSS risk

  const dots = document.createElement('div');
  dots.className = 'app-loader-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';

  inner.appendChild(logoWrap);
  inner.appendChild(title);
  inner.appendChild(dots);
  el.appendChild(inner);

  document.head.insertAdjacentHTML('beforeend', `<style>
    .app-loader-inner{display:flex;flex-direction:column;align-items:center;gap:16px;}
    .app-loader-logo{animation:loaderPop 0.5s cubic-bezier(0.34,1.56,0.64,1) both;}
    .app-loader-title{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:800;
      color:#f0f0f0;letter-spacing:-0.03em;}
    .app-loader-dots{display:flex;gap:6px;margin-top:4px;}
    .app-loader-dots span{width:7px;height:7px;border-radius:50%;background:#1D9E75;
      animation:loaderDot 1.2s ease-in-out infinite;}
    .app-loader-dots span:nth-child(2){animation-delay:0.2s;}
    .app-loader-dots span:nth-child(3){animation-delay:0.4s;}
    @keyframes loaderPop{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}
    @keyframes loaderDot{0%,80%,100%{opacity:0.2;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}
  `);
  document.body.appendChild(el);
}

function hideLoadingScreen() {
  const el = document.getElementById('app-loading-screen');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 420);
}

// ── Image Helpers ────────────────────────────────────────────────────────────

async function handleImageUpload(input) {
  const file = input.files[0];
  const preview = document.getElementById('image-preview');
  const hidden = document.getElementById('prod-image-base64');
  if (!file) return;

  // FIX #3: Validate file type (MIME + extension) before processing
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    toast('Only JPEG, PNG, GIF, or WebP images are allowed.', 'error');
    input.value = '';
    return;
  }
  // FIX #4: Enforce file size limit (2 MB) to prevent DoS via huge images
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  if (file.size > MAX_FILE_BYTES) {
    toast('Image must be under 2 MB.', 'error');
    input.value = '';
    return;
  }

  const urlInput = document.getElementById('prod-image-url');
  if (urlInput) urlInput.value = '';

  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = (e) => {
    const img = new Image();
    img.src = e.target.result;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 120;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
      else { if (h > MAX) { w *= MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const base64 = canvas.toDataURL('image/jpeg', 0.7);
      // FIX #5: Use DOM API for preview image instead of innerHTML with data
      const imgEl = document.createElement('img');
      imgEl.src = base64;
      imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      preview.innerHTML = '';
      preview.appendChild(imgEl);
      hidden.value = base64;
    };
    // FIX #6: Handle broken image load gracefully
    img.onerror = () => {
      toast('Could not read image file.', 'error');
      input.value = '';
    };
  };
  reader.onerror = () => {
    toast('Failed to read file.', 'error');
    input.value = '';
  };
}

function handleImageUrl(url) {
  const preview = document.getElementById('image-preview');
  const hidden  = document.getElementById('prod-image-base64');
  const fileInput = document.getElementById('prod-image');

  if (!url) {
    preview.innerHTML = '🖼️';
    hidden.value = '';
    return;
  }

  // FIX #7: Strict URL allowlist — only https (drop http to prevent mixed-content)
  if (!url.startsWith('https://')) {
    preview.innerHTML = '⚠️ HTTPS URL required';
    hidden.value = '';
    return;
  }

  // FIX #8: Validate URL structure via URL constructor before using as src
  try { new URL(url); } catch {
    preview.innerHTML = '⚠️ Invalid URL';
    hidden.value = '';
    return;
  }

  if (fileInput) fileInput.value = '';

  const img = document.createElement('img');
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  img.onerror = () => { preview.textContent = '⚠️'; };
  img.referrerPolicy = 'no-referrer';   // FIX #9: Don't leak referrer to 3rd-party hosts
  img.src = url;
  preview.innerHTML = '';
  preview.appendChild(img);
  hidden.value = url;
}

// ============================================================================
// DATA LAYER — Firebase Firestore
// ============================================================================

function getMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds !== undefined) return ts.seconds * 1000;
  return new Date(ts).getTime() || 0;
}

// FIX #10: esc() now handles all primitives robustly and never returns raw HTML
function esc(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function applyUserData(data) {
  if (!data) return;
  _lastSyncedAt        = getMillis(data.updatedAt);
  products             = Array.isArray(data.products)         ? data.products         : [];
  transactions         = Array.isArray(data.transactions)     ? data.transactions     : [];
  restockHistory       = Array.isArray(data.restockHistory)   ? data.restockHistory   : [];
  movementHistory      = Array.isArray(data.movementHistory)  ? data.movementHistory  : [];
  reviewedProducts     = Array.isArray(data.reviewedProducts) ? data.reviewedProducts : [];
  currency             = typeof data.currency === 'string'    ? data.currency         : 'INR';
  skuCounter           = parseInt(data.skuCounter)            || 1;
  dailyGoal            = parseFloat(data.dailyGoal)           || 0;
  notificationSettings = (data.notificationSettings && typeof data.notificationSettings === 'object')
    ? data.notificationSettings
    : { enabled: false, lowStock: true, goal: true, dailySummary: true };

  // FIX #11: Validate currency is one of the known options to prevent injection
  const validCurrencies = ['INR','USD','EUR','GBP','JPY'];
  if (!validCurrencies.includes(currency)) currency = 'INR';

  hydrateProductLinks();

  const maxId = products.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0);
  nextProdId = Math.max(Date.now(), maxId) + 1;

  const sel = document.getElementById('currency-select');
  if (sel) sel.value = currency;
}

function buildDataPayload() {
  return {
    products, transactions, restockHistory, movementHistory,
    reviewedProducts, currency, skuCounter, dailyGoal, notificationSettings
  };
}

function isSessionError(e) {
  if (!e) return false;
  const code = e.code || '';
  return code === 'permission-denied' || code === 'unauthenticated' || code.includes('auth/user-token-expired');
}

function saveCurrentUserData(immediate = false) {
  if (!currentUser) return Promise.resolve();

  const payload = buildDataPayload();
  _queuePendingSave(payload);

  if (!_isOnline) {
    updateSaveStatus('queued');
    return Promise.resolve();
  }

  if (immediate) {
    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = null;
    updateSaveStatus('saving');
    return fbSaveUserData(currentUser.uid, payload)
      .then(() => {
        _clearPendingSave();
        updateSaveStatus('saved');
      })
      .catch(e => {
        console.error('Firestore save error:', e);
        if (isSessionError(e)) { handleSessionExpired(); return; }
        _queuePendingSave(payload);
        updateSaveStatus('error');
        const msg = e.code === 'resource-exhausted'
          ? 'Cloud storage quota exceeded. Changes saved locally only.'
          : 'Cloud sync failed. Changes are saved locally.';
        if (!pendingUndoTimer) toast(msg, 'warning', null, 6000);
        if (!_isOnline) updateOfflineBanner(false);
      });
  }

  return new Promise(resolve => {
    clearTimeout(_saveDebounceTimer);
    updateSaveStatus('saving');
    _saveDebounceTimer = setTimeout(async () => {
      if (!currentUser) { resolve(); return; }
      try {
        await fbSaveUserData(currentUser.uid, payload);
        _clearPendingSave();
        updateSaveStatus('saved');
      } catch(e) {
        console.error('Firestore save error:', e);
        if (isSessionError(e)) { handleSessionExpired(); return; }
        _queuePendingSave(payload);
        updateSaveStatus('error');
        const msg = e.code === 'resource-exhausted'
          ? 'Cloud storage quota reached. Saving locally...'
          : 'Sync error. Changes saved locally.';
        if (!pendingUndoTimer) toast(msg, 'warning', null, 5000);
      }
      resolve();
    }, 800);
  });
}

function handleSessionExpired() {
  updateSaveStatus('error');
  toast('Your session has expired. Please log in again to sync your changes.', 'error', null, 10000);
  fbSignOut().then(() => {
    currentUser = null;
    if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
  });
}

function handleSyncConflict(remoteData) {
  updateSaveStatus('error');
  toast('Another tab has updated the data.', 'warning', {
    label: 'Sync Now',
    onClick: () => { applyUserData(remoteData); render(); toast('Synchronized with cloud ✓'); }
  }, 15000);
}

function _queuePendingSave(payload) {
  try {
    safeLocalStorageSet(PENDING_SAVE_KEY, JSON.stringify({
      uid: currentUser?.uid, payload, ts: Date.now()
    }));
  } catch(e) {
    console.warn('Could not queue pending save:', e);
  }
}

function _clearPendingSave() {
  safeLocalStorageRemove(PENDING_SAVE_KEY);
}

async function flushPendingSave() {
  const raw = safeLocalStorageGet(PENDING_SAVE_KEY);
  if (!raw || !currentUser) return;

  let record;
  try { record = JSON.parse(raw); } catch { _clearPendingSave(); return; }
  if (!record || record.uid !== currentUser.uid) { _clearPendingSave(); return; }

  // FIX #12: Validate that queued payload is not stale (older than 24 h) before flush
  if (record.ts && (Date.now() - record.ts) > 24 * 60 * 60 * 1000) {
    _clearPendingSave();
    return;
  }

  updateSaveStatus('saving');
  try {
    await fbSaveUserData(currentUser.uid, record.payload);
    _clearPendingSave();
    updateSaveStatus('saved');
    toast('Data synced to cloud ✓', 'success');
  } catch(e) {
    console.error('Flush failed:', e);
    updateSaveStatus('error');
    toast('Failed to sync local data to cloud. Retrying in background...', 'error');
  }
}

// ── Offline event handlers ────────────────────────────────────────────────────

function handleOffline() {
  _isOnline = false;
  updateOfflineBanner(false);
  updateSaveStatus('queued');
}

function handleOnline() {
  _isOnline = true;
  const banner = document.getElementById('offline-banner');
  if (banner) {
    banner.classList.remove('offline-banner-visible', 'offline-banner-hidden');
    banner.classList.add('offline-banner-online', 'offline-banner-visible');
    const textEl = banner.querySelector('.offline-banner-text');
    const iconEl = banner.querySelector('.offline-banner-icon');
    if (textEl) textEl.textContent = 'Back online — syncing your changes now…';
    if (iconEl) iconEl.textContent = '☁️';
    setTimeout(() => {
      banner.classList.remove('offline-banner-visible');
      banner.classList.add('offline-banner-hidden');
      setTimeout(() => {
        banner.classList.remove('offline-banner-online');
        if (textEl) textEl.textContent = "You're offline — changes are queued and will sync automatically when reconnected.";
        if (iconEl) iconEl.textContent = '📡';
      }, 340);
    }, 2800);
  }
  flushPendingSave();
}

function updateOfflineBanner(online) {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  if (online || _isOnline) {
    banner.classList.remove('offline-banner-visible');
    banner.classList.add('offline-banner-hidden');
  } else {
    banner.classList.remove('offline-banner-online', 'offline-banner-reconnecting');
    const textEl = banner.querySelector('.offline-banner-text');
    const iconEl = banner.querySelector('.offline-banner-icon');
    if (textEl) textEl.textContent = "You're offline — changes are queued and will sync automatically when reconnected.";
    if (iconEl) iconEl.textContent = '📡';
    banner.classList.remove('offline-banner-hidden');
    banner.classList.add('offline-banner-visible');
  }
}

function updateSaveStatus(status) {
  _saveStatus = status;
  const el = document.getElementById('save-status');
  if (!el) return;
  el.classList.remove('save-status-idle','save-status-saving','save-status-saved','save-status-queued','save-status-error');
  clearTimeout(_savedPillTimer);
  const labels = { idle:'', saving:'Saving…', saved:'Saved ✓', queued:'📡 Queued', error:'Save failed' };
  el.textContent = labels[status] ?? '';
  el.classList.add(`save-status-${status}`);
  if (status === 'saved') {
    _savedPillTimer = setTimeout(() => updateSaveStatus('idle'), 3000);
  }
}

function initOfflineDetection() {
  window.addEventListener('online',  handleOnline);
  window.addEventListener('offline', handleOffline);
  updateOfflineBanner(_isOnline);
  if (_isOnline) flushPendingSave();
}

// ============================================================================
// VIEW MANAGEMENT
// ============================================================================

function applyViewMode() {
  document.querySelectorAll('[data-view]').forEach(el => {
    el.classList.toggle('view-hidden', el.dataset.view !== activeViewMode);
  });
  document.querySelectorAll('.workspace-nav-btn').forEach(btn => {
    const isActive = btn.dataset.viewTarget === activeViewMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function loadViewMode() {
  const saved = safeLocalStorageGet(VIEW_MODE_KEY);
  // FIX #13: Whitelist valid view modes — don't trust raw localStorage value
  const validModes = ['home','inventory','insights','reports','timeline'];
  activeViewMode = validModes.includes(saved) ? saved : 'home';
}

function saveViewMode() {
  safeLocalStorageSet(VIEW_MODE_KEY, activeViewMode);
}

function switchViewMode(mode) {
  document.body.classList.remove('stock-only');
  activeViewMode = mode;
  saveViewMode();
  applyViewMode();
  if (mode !== 'insights') destroyCharts();
  if (mode === 'insights')        renderDashboard();
  else if (mode === 'inventory')  { renderDeadStock(); renderRestockHistory(); }
  else if (mode === 'timeline')   renderMovementHistory();
  else if (mode === 'reports')    { renderBreakEven(); renderCategoryReport(); renderDateStats(); }
}

function destroyCharts() {
  if (barChart)      { barChart.destroy();      barChart      = null; }
  if (doughnutChart) { doughnutChart.destroy(); doughnutChart = null; }
}

function loadFeaturePanels() {
  // FIX #14: Validate shape of stored panel config
  const saved = safeLocalStorageGetJSON(FEATURE_PANEL_KEY);
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    featurePanels = { ...featurePanelDefaults, ...saved };
  } else {
    featurePanels = { ...featurePanelDefaults };
  }
}

function saveFeaturePanels() {
  safeLocalStorageSet(FEATURE_PANEL_KEY, JSON.stringify(featurePanels));
}

function applyFeaturePanels() { /* superseded by applyViewMode */ }
function closeActiveFeaturePanel() { switchViewMode('home'); }

function toggleFeaturePanel(panel) {
  const modeMap = { analytics:'insights', stock:'inventory', timeline:'timeline', reports:'reports' };
  const target = modeMap[panel];
  if (!target) return;
  switchViewMode(activeViewMode === target ? 'home' : target);
}

// ============================================================================
// DATA LINKING & HELPERS
// ============================================================================

function hydrateProductLinks() {
  const nameMap = new Map(products.map(p => [p.name, p]));
  transactions = transactions.map(tx => {
    if (tx.productId && tx.category && tx.sku) return tx;
    const p = nameMap.get(tx.product);
    return p ? { ...tx, productId: tx.productId || p.id, sku: tx.sku || p.sku || '', category: tx.category || p.category || 'Uncategorized' } : tx;
  });
  restockHistory = restockHistory.map(entry => {
    if (entry.productId && entry.category && entry.sku) return entry;
    const p = nameMap.get(entry.product);
    return p ? { ...entry, productId: entry.productId || p.id, sku: entry.sku || p.sku || '', category: entry.category || p.category || 'Uncategorized' } : entry;
  });
}

function getRecordProductId(record)  { return record?.productId ?? null; }
function findProductByRecord(record) {
  const id = getRecordProductId(record);
  if (id !== null) { const byId = products.find(p => p.id === id); if (byId) return byId; }
  return products.find(p => p.name === record?.product) || null;
}
function getRecordProductName(record) {
  return findProductByRecord(record)?.name || record?.product || 'Unknown product';
}
function getRecordCategory(record) {
  return findProductByRecord(record)?.category || record?.category || 'Uncategorized';
}
function matchesProductRecord(record, product) {
  if (!record || !product) return false;
  const id = getRecordProductId(record);
  return id !== null ? id === product.id : record.product === product.name;
}
function hasChartSupport() { return typeof window.Chart === 'function'; }
function hasPdfSupport()   { return !!window.jspdf?.jsPDF; }

// ============================================================================
// AUTHENTICATION UI
// ============================================================================

function getAuthElements() {
  return {
    overlay:         document.getElementById('auth-overlay'),
    verifyScreen:    document.getElementById('verify-screen'),
    shell:           document.getElementById('app-shell'),
    title:           document.getElementById('auth-title'),
    subtitle:        document.getElementById('auth-subtitle'),
    name:            document.getElementById('auth-name'),
    nameGroup:       document.getElementById('auth-name-group'),
    email:           document.getElementById('auth-email'),
    password:        document.getElementById('auth-password'),
    confirm:         document.getElementById('auth-confirm-password'),
    confirmGroup:    document.getElementById('auth-confirm-group'),
    submit:          document.getElementById('auth-submit-btn'),
    switchBtn:       document.getElementById('auth-switch-btn'),
    forgotBtn:       document.getElementById('auth-forgot-btn'),
    message:         document.getElementById('auth-message'),
    profileMenu:     document.getElementById('header-profile-menu'),
    profileChip:     document.getElementById('header-profile-chip'),
    profileDropdown: document.getElementById('header-profile-dropdown'),
    userBadge:       document.getElementById('header-current-user-badge'),
    themeMenuIcon:   document.getElementById('header-theme-menu-icon'),
    themeMenuLabel:  document.getElementById('header-theme-menu-label'),
    userEmail:       document.getElementById('header-profile-email')
  };
}

function setAuthMessage(message, type = 'info') {
  const { message: el } = getAuthElements();
  if (!el) return;
  el.textContent = message; // FIX #15: textContent — never innerHTML for user-visible auth messages
  el.className = `auth-message ${type}`;
}

function setAuthLoading(loading) {
  const { submit } = getAuthElements();
  if (!submit) return;
  submit.disabled    = loading;
  submit.textContent = loading
    ? (authMode === 'signup' ? 'Creating account…' : 'Signing in…')
    : (authMode === 'signup' ? 'Sign Up'           : 'Log In');
}

function updateAuthMode(mode) {
  authMode = mode;
  const { title, subtitle, nameGroup, confirmGroup, submit, switchBtn, forgotBtn,
          name, email, password, confirm, message } = getAuthElements();
  if (!title) return;

  const signupMode = mode === 'signup';
  title.textContent    = signupMode ? 'Create your account' : 'Log in to Shop Tracker';
  subtitle.textContent = signupMode
    ? 'Your data syncs across all devices automatically.'
    : 'Sign in to open your inventory — works on any device.';

  nameGroup.style.display    = signupMode ? 'block' : 'none';
  confirmGroup.style.display = signupMode ? 'block' : 'none';
  submit.textContent         = signupMode ? 'Sign Up' : 'Log In';
  submit.disabled            = false;
  switchBtn.style.display    = 'inline-flex';
  switchBtn.textContent      = signupMode ? 'Already have an account?' : 'Need to create an account?';
  if (forgotBtn) forgotBtn.style.display = signupMode ? 'none' : 'inline-flex';

  if (name)     name.value     = '';
  if (email)    email.value    = '';
  if (password) password.value = '';
  if (confirm)  confirm.value  = '';
  if (message)  message.textContent = '';
  (signupMode ? name : email)?.focus();
}

function updateAuthUI(fbUser) {
  const { overlay, verifyScreen, shell, profileMenu, profileChip, profileDropdown, userBadge, userEmail } = getAuthElements();
  const authed   = !!fbUser;
  const verified = fbUser?.emailVerified ?? false;

  if (overlay)      overlay.style.display      = authed ? 'none' : 'flex';
  if (verifyScreen) verifyScreen.style.display  = (authed && !verified) ? 'flex' : 'none';
  if (shell)        shell.classList.toggle('app-shell-hidden', !(authed && verified));

  if (profileMenu) profileMenu.style.display = (authed && verified) ? 'inline-flex' : 'none';
  // FIX #16: Use textContent for display name/email — never trust Firebase display names as HTML
  if (userBadge) userBadge.textContent = fbUser ? (fbUser.displayName || fbUser.email || '') : '';
  if (userEmail) userEmail.textContent = fbUser ? (fbUser.email || '') : '';
  if (profileChip)     profileChip.setAttribute('aria-expanded', 'false');
  if (profileDropdown) profileDropdown.classList.remove('open');
}

function toggleProfileMenu() {
  const { profileDropdown, profileChip } = getAuthElements();
  if (!profileDropdown || !profileChip) return;
  const open = profileDropdown.classList.toggle('open');
  profileChip.setAttribute('aria-expanded', String(open));
}

function closeProfileMenu() {
  const { profileDropdown, profileChip } = getAuthElements();
  if (!profileDropdown || !profileChip) return;
  profileDropdown.classList.remove('open');
  profileChip.setAttribute('aria-expanded', 'false');
}

function switchAuthMode() { updateAuthMode(authMode === 'signup' ? 'login' : 'signup'); }

async function handleForgotPassword() {
  const { email } = getAuthElements();
  const addr = email?.value?.trim();
  if (!addr) { setAuthMessage('Enter your email address first.', 'error'); return; }
  try {
    await fbResetPassword(addr);
    setAuthMessage('Password reset email sent — check your inbox.', 'info');
  } catch(e) {
    setAuthMessage(friendlyFirebaseError(e), 'error');
  }
}

async function handleAuthAction() {
  const { name, email, password, confirm } = getAuthElements();
  const displayName = name?.value?.trim()     || '';
  const userEmail   = email?.value?.trim()    || '';
  const pwd         = password?.value?.trim() || '';

  if (!userEmail)     { setAuthMessage('Enter a valid email address.', 'error'); return; }
  if (pwd.length < 6) { setAuthMessage('Password must be at least 6 characters.', 'error'); return; }

  // FIX #17: Validate display name length to prevent abuse
  if (authMode === 'signup' && displayName.length > 100) {
    setAuthMessage('Name must be under 100 characters.', 'error'); return;
  }

  setAuthLoading(true);
  setAuthMessage('');

  try {
    if (authMode === 'signup') {
      if (!displayName) { setAuthMessage('Enter your name to create the account.', 'error'); setAuthLoading(false); return; }
      if (pwd !== confirm?.value?.trim()) { setAuthMessage('Passwords do not match.', 'error'); setAuthLoading(false); return; }
      await fbSignUp(userEmail, pwd, displayName);
      setAuthLoading(false);
      setAuthMessage('');
    } else {
      await fbSignIn(userEmail, pwd);
      setTimeout(() => {
        const { submit } = getAuthElements();
        if (submit && submit.disabled) setAuthLoading(false);
      }, 3000);
    }
  } catch(e) {
    setAuthMessage(friendlyFirebaseError(e), 'error');
    setAuthLoading(false);
  }
}

function friendlyFirebaseError(e) {
  const map = {
    'auth/email-already-in-use':   'That email is already registered. Log in instead.',
    'auth/invalid-email':          'Enter a valid email address.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/user-not-found':         'No account found for that email.',
    'auth/wrong-password':         'Incorrect password. Try again.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/too-many-requests':      'Too many attempts. Please wait a moment.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/user-disabled':          'This account has been disabled.',
  };
  return map[e.code] || 'Something went wrong. Please try again.'; // FIX #18: Don't leak raw e.message to UI
}

async function logout() {
  closeProfileMenu();
  completeLoginInProgress = false;
  if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
  currentUser = null;
  products = []; transactions = []; restockHistory = [];
  movementHistory = []; reviewedProducts = []; dailyGoal = 0;
  currency = 'INR'; skuCounter = 1;
  notificationSettings = { enabled: false, lowStock: true, goal: true };
  safeLocalStorageRemove(PENDING_SAVE_KEY);
  destroyCharts();
  await fbSignOut();
  updateAuthMode('login');
  updateAuthUI(null);
  toast('Signed out successfully.', 'info');
}

// ============================================================================
// DELETE ACCOUNT
// ============================================================================

function openDeleteAccountModal() {
  closeProfileMenu();
  const modal = document.getElementById('delete-account-modal');
  const pwdInput = document.getElementById('delete-acct-password');
  const msgEl = document.getElementById('delete-acct-message');
  if (!modal) return;
  if (pwdInput) pwdInput.value = '';
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'delete-acct-message'; }
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
  setTimeout(() => pwdInput?.focus(), 120);
}

function closeDeleteAccountModal() {
  const modal = document.getElementById('delete-account-modal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 280);
}

async function confirmDeleteAccount() {
  const pwdInput   = document.getElementById('delete-acct-password');
  const msgEl      = document.getElementById('delete-acct-message');
  const btnLabel   = document.getElementById('delete-acct-btn-label');
  const confirmBtn = document.getElementById('delete-acct-confirm-btn');
  const cancelBtn  = document.getElementById('delete-acct-cancel-btn');

  const pwd = pwdInput?.value?.trim() || '';
  if (!pwd) {
    if (msgEl) { msgEl.textContent = 'Please enter your password.'; msgEl.className = 'delete-acct-message error'; }
    pwdInput?.focus();
    return;
  }

  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn)  cancelBtn.disabled  = true;
  if (btnLabel)   btnLabel.textContent = 'Deleting…';
  if (msgEl)      { msgEl.textContent = ''; msgEl.className = 'delete-acct-message'; }

  if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
  completeLoginInProgress = true;

  try {
    const deletePromise  = fbDeleteAccount(pwd);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
    await Promise.race([deletePromise, timeoutPromise]);

    completeLoginInProgress = false;
    currentUser = null;
    products = []; transactions = []; restockHistory = [];
    movementHistory = []; reviewedProducts = []; dailyGoal = 0;
    currency = 'INR'; skuCounter = 1;
    notificationSettings = { enabled: false, lowStock: true, goal: true };
    destroyCharts();

    closeDeleteAccountModal();
    updateAuthMode('login');
    updateAuthUI(null);
    toast('Your account has been permanently deleted.', 'info');
  } catch(e) {
    completeLoginInProgress = false;
    if (currentUser && !firestoreUnsub) {
      firestoreUnsub = fbSubscribeUserData(currentUser.uid, remoteData => {
        applyUserData(remoteData); loadCurrency(); render();
      });
    }
    const friendlyMap = {
      'auth/wrong-password':        'Incorrect password. Please try again.',
      'auth/invalid-credential':    'Incorrect password. Please try again.',
      'auth/too-many-requests':     'Too many attempts. Please wait a moment.',
      'auth/network-request-failed':'Network error. Check your connection.',
      'auth/requires-recent-login': 'Session expired. Please log out and back in first.',
      'timeout':                    'Request timed out. Check your connection and try again.',
    };
    const key = e.message === 'timeout' ? 'timeout' : (e.code || '');
    const msg = friendlyMap[key] || 'Could not delete account. Please try again.'; // FIX #19: No raw e.message
    if (msgEl) { msgEl.textContent = msg; msgEl.className = 'delete-acct-message error'; }
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn)  cancelBtn.disabled  = false;
    if (btnLabel)   btnLabel.textContent = 'Delete my account';
    pwdInput?.focus();
  }
}

async function completeLogin(fbUser) {
  if (completeLoginInProgress) return;
  completeLoginInProgress = true;

  try {
    currentUser = fbUser;
    updateAuthUI(fbUser);
    setAuthLoading(false);
    hideLoadingScreen();
    loadViewMode();
    applyViewMode();
    render();

    const dataPromise    = fbLoadUserData(fbUser.uid);
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 8000));
    const data = await Promise.race([dataPromise, timeoutPromise]);
    applyUserData(data);
    loadCurrency();
    render();

    if (firestoreUnsub) firestoreUnsub();
    firestoreUnsub = fbSubscribeUserData(fbUser.uid, (remoteData, metadata) => {
      if (metadata && metadata.hasPendingWrites) return;
      const remoteTs = getMillis(remoteData?.updatedAt);
      if (remoteTs > 0 && remoteTs <= _lastSyncedAt) return;
      applyUserData(remoteData);
      loadCurrency();
      render();
    });

    if (activeViewMode === 'insights') renderDashboard();
    notifyImportantEvents();
    // FIX #20: Sanitise display name before inserting into toast message
    const safeName = fbUser.displayName ? esc(fbUser.displayName) : '';
    toast(`Welcome${safeName ? ', ' + safeName : ''}! 👋`);
  } catch(e) {
    console.error('completeLogin error:', e);
  } finally {
    completeLoginInProgress = false;
  }
}

async function resendVerificationEmail() {
  try {
    await fbResendVerification();
    toast('Verification email sent — check your inbox.');
  } catch(e) {
    toast('Could not send email. Try again in a moment.', 'error');
  }
}

async function checkEmailVerified() {
  try {
    const user = await fbReloadUser();
    if (user?.emailVerified) {
      toast('Email verified! Loading your dashboard…');
      await completeLogin(user);
    } else {
      toast('Not verified yet — check your inbox.', 'info');
    }
  } catch(e) {
    toast('Could not check verification status.', 'error');
  }
}

function initAuth() {
  fbOnAuthStateChanged(handleAuthChange);
  setInterval(checkDailyDigest, 60000);
}

async function handleAuthChange(fbUser) {
  setAuthLoading(false);
  if (!fbUser) {
    hideLoadingScreen();
    if (currentUser) toast('Session closed.', 'info');
    updateAuthMode('login');
    updateAuthUI(null);
    currentUser = null;
    return;
  }
  if (!fbUser.emailVerified) {
    hideLoadingScreen();
    currentUser = fbUser;
    updateAuthUI(fbUser);
    return;
  }
  const needsInit = !currentUser || currentUser.uid !== fbUser.uid || !firestoreUnsub;
  currentUser = fbUser;
  if (needsInit) {
    await completeLogin(fbUser);
  } else {
    updateAuthUI(fbUser);
  }
}

// ============================================================================
// CURRENCY & EXCHANGE RATES
// ============================================================================

function fmt(amount) {
  const symbols = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
  // FIX #21: Guard against NaN/Infinity crashing the formatter
  const n = Number(amount);
  if (!isFinite(n)) return (symbols[currency] || currency) + '0';
  const converted = convertAmount(n);
  const symbol = symbols[currency] || currency;
  return symbol + Math.round(converted).toLocaleString('en-IN');
}

function convertAmount(amount) {
  if (!exchangeRates || currency === baseCurrency) return amount;
  const inUSD    = amount / (exchangeRates['INR'] || 1);
  const inTarget = inUSD  * (exchangeRates[currency] || 1);
  return inTarget;
}

function setCurrency(val) {
  // FIX #22: Whitelist currency values from UI input
  const valid = ['INR','USD','EUR','GBP','JPY'];
  if (!valid.includes(val)) return;
  currency = val;
  saveCurrentUserData();
  render();
  toast(`Currency switched to ${val}`);
}

function loadCurrency() {
  const el = document.getElementById('currency-select');
  if (el) el.value = currency;
}

async function fetchExchangeRates() {
  const now     = Date.now();
  const oneHour = 60 * 60 * 1000;

  if (exchangeRates && ratesUpdatedAt && (now - parseInt(ratesUpdatedAt)) < oneHour) {
    updateRatesBadge('Rates cached ✓');
    return;
  }

  updateRatesBadge('Fetching rates…');
  try {
    // FIX #23: Use HTTPS and add a timeout via AbortController
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://v6.exchangerate-api.com/v6/c4700f47c7f6f17c24b3d4f6/latest/USD',
      { referrerPolicy: 'origin', signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // FIX #24: Validate API response shape before storing
    if (data.result === 'success' && data.conversion_rates && typeof data.conversion_rates === 'object') {
      exchangeRates  = data.conversion_rates;
      ratesUpdatedAt = Date.now().toString();
      safeLocalStorageSet('exchangeRates', JSON.stringify(exchangeRates));
      safeLocalStorageSet('ratesUpdatedAt', ratesUpdatedAt);
      updateRatesBadge('Live rates ✓');
      render();
    } else {
      updateRatesBadge('Rates unavailable');
    }
  } catch {
    if (exchangeRates) {
      updateRatesBadge('Cached rates (offline)');
    } else {
      updateRatesBadge('Offline mode');
    }
  }
}

function updateRatesBadge(text) {
  const el = document.getElementById('rates-badge');
  if (el) el.textContent = text; // textContent — safe
}

// ============================================================================
// CORE RENDERING
// ============================================================================

function render() {
  renderStats();
  renderProducts();
  renderTransactions();
  renderDeadStock();
  renderSmartInsights();
  renderRestockHistory();
  renderExpiryAlert();
  renderMovementHistory();
  renderCategoryReport();
  renderBreakEven();
  renderGoal();
  renderDateStats();
  if (activeViewMode === 'insights') renderDashboard();
}

function getDaysToExpiry(expiryDate) {
  if (!expiryDate) return null;
  const today  = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate); expiry.setHours(0, 0, 0, 0);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

function renderExpiryAlert() {
  const banner = document.getElementById('expiry-banner');
  const list   = document.getElementById('expiry-list');
  if (!banner || !list) return;

  const expiringItems = products
    .map(p => ({ ...p, daysToExpiry: getDaysToExpiry(p.expiryDate) }))
    .filter(p => p.daysToExpiry !== null && p.daysToExpiry >= 0 && p.daysToExpiry <= 30)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

  if (!expiringItems.length) { banner.style.display = 'none'; return; }

  banner.style.display = 'block';
  // FIX #25: Build expiry tags via DOM to avoid XSS from product names
  list.innerHTML = '';
  expiringItems.forEach(p => {
    const span = document.createElement('span');
    span.className = 'restock-tag expiry-tag';
    span.textContent = `${p.name} — ${p.daysToExpiry === 0 ? 'Expires today' : `${p.daysToExpiry} day${p.daysToExpiry === 1 ? '' : 's'} left`}`;
    list.appendChild(span);
  });
}

function addMovementEntry(type, productName, details) {
  movementHistory.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    date: new Date().toISOString(),
    type,
    product: productName || 'Inventory',
    details
  });
  movementHistory = movementHistory.slice(0, 250);
  saveCurrentUserData();
}

function renderMovementHistory() {
  const tbody = document.getElementById('movement-body');
  if (!tbody) return;

  if (!movementHistory.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No inventory movements yet.</td></tr>';
    return;
  }

  // FIX #26: All user data fields escaped through esc()
  tbody.innerHTML = movementHistory.map(entry => `
    <tr>
      <td>${esc(new Date(entry.date).toLocaleString('en-IN', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }))}</td>
      <td style="font-weight:600;">${esc(entry.product)}</td>
      <td><span class="badge" style="background:rgba(55,138,221,0.12);color:#378add;">${esc(entry.type)}</span></td>
      <td style="color:var(--muted);">${esc(entry.details)}</td>
    </tr>
  `).join('');
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

async function sendBrowserNotification(title, body, tag) {
  if (!notificationSettings.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  // FIX #27: Sanitise notification strings — they reach the OS notification system
  const safeTitle = String(title).slice(0, 200);
  const safeBody  = String(body).slice(0, 500);
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) { reg.showNotification(safeTitle, { body: safeBody, tag, icon: './icon-192.png', badge: './icon-192.png' }); return; }
  }
  new Notification(safeTitle, { body: safeBody, tag, icon: './icon-192.png' });
}

function notifyImportantEvents(force = false) {
  if (!notificationSettings.enabled || !currentUser) return;
  const today         = new Date().toISOString().split('T')[0];
  const lowStockItems = products.filter(p => getCurrentStock(p) <= p.minStock);
  const expiringItems = products.filter(p => { const d = getDaysToExpiry(p.expiryDate); return d !== null && d >= 0 && d <= 30; });
  const todayProfit   = transactions.filter(t => t.date === today).reduce((s, t) => s + t.profit, 0);

  // FIX #28: Namespace notification keys by uid to prevent cross-user key collisions
  const lowKey  = `notify:${currentUser.uid}:lowStock:${today}`;
  const expKey  = `notify:${currentUser.uid}:expiry:${today}`;
  const goalKey = `notify:${currentUser.uid}:goal:${today}`;

  if ((force || !safeLocalStorageGet(lowKey)) && lowStockItems.length && notificationSettings.lowStock) {
    const names = lowStockItems.slice(0, 3).map(p => p.name).join(', ');
    sendBrowserNotification('Low stock alert', `${lowStockItems.length} product(s) need restocking: ${names}`, 'low-stock');
    safeLocalStorageSet(lowKey, 'sent');
  }
  if ((force || !safeLocalStorageGet(expKey)) && expiringItems.length) {
    const names = expiringItems.slice(0, 3).map(p => p.name).join(', ');
    sendBrowserNotification('Near expiry alert', `${expiringItems.length} product(s) are nearing expiry: ${names}`, 'near-expiry');
    safeLocalStorageSet(expKey, 'sent');
  }
  if (dailyGoal > 0 && notificationSettings.goal && todayProfit >= dailyGoal && (force || !safeLocalStorageGet(goalKey))) {
    sendBrowserNotification('Daily goal reached', `You hit your profit goal with ${fmt(todayProfit)} today.`, 'goal-reached');
    safeLocalStorageSet(goalKey, 'sent');
  }
  checkDailyDigest();
}

function checkDailyDigest() {
  if (!notificationSettings.enabled || !notificationSettings.dailySummary || !currentUser) return;
  const now     = new Date();
  const today   = now.toISOString().split('T')[0];
  const digestKey = `notify:${currentUser.uid}:digest:${today}`;

  if (now.getHours() >= 20 && !safeLocalStorageGet(digestKey)) {
    const todayTxns = transactions.filter(t => t.date === today);
    if (!todayTxns.length) return;
    const rev    = todayTxns.reduce((s, t) => s + t.total, 0);
    const profit = todayTxns.reduce((s, t) => s + t.profit, 0);
    const items  = todayTxns.reduce((s, t) => s + t.qty, 0);
    sendBrowserNotification(
      'Daily Summary 📊',
      `Today: ${fmt(rev)} revenue, ${fmt(profit)} profit, ${items} items sold`,
      'daily-digest'
    );
    safeLocalStorageSet(digestKey, 'sent');
  }
}

// ============================================================================
// DATA OPERATIONS
// ============================================================================

function cloneData(value)   { return JSON.parse(JSON.stringify(value)); }

function createDataSnapshot() {
  return {
    products: cloneData(products), transactions: cloneData(transactions),
    restockHistory: cloneData(restockHistory), movementHistory: cloneData(movementHistory),
    reviewedProducts: cloneData(reviewedProducts), dailyGoal, currency, skuCounter,
    notificationSettings: cloneData(notificationSettings)
  };
}

function applyDataSnapshot(snapshot) {
  products             = cloneData(snapshot.products             || []);
  transactions         = cloneData(snapshot.transactions         || []);
  restockHistory       = cloneData(snapshot.restockHistory       || []);
  movementHistory      = cloneData(snapshot.movementHistory      || []);
  reviewedProducts     = cloneData(snapshot.reviewedProducts     || []);
  dailyGoal            = parseFloat(snapshot.dailyGoal)          || 0;
  currency             = snapshot.currency                       || 'INR';
  skuCounter           = snapshot.skuCounter                     || (products.length + 1);
  notificationSettings = cloneData(snapshot.notificationSettings || { enabled: false, lowStock: true, goal: true });
  saveCurrentUserData(true);
  const sel = document.getElementById('currency-select');
  if (sel) sel.value = currency;
  render();
}

function queueUndo(message, snapshot, type = 'info') {
  if (pendingUndoTimer) { clearTimeout(pendingUndoTimer); pendingUndoTimer = null; }
  toast(message, type, {
    label: 'Undo',
    onClick: () => {
      if (pendingUndoTimer) { clearTimeout(pendingUndoTimer); pendingUndoTimer = null; }
      applyDataSnapshot(snapshot);
      toast('Action undone — all values restored.', 'success');
    }
  }, 12000);
  pendingUndoTimer = setTimeout(() => { pendingUndoTimer = null; }, 12000);
}

// ============================================================================
// STATS & DASHBOARD
// ============================================================================

function getTrend(current, previous) {
  if (previous === 0) return { arrow: '', pct: '', color: 'var(--muted)' };
  const pct = (((current - previous) / previous) * 100).toFixed(1);
  if (pct > 0) return { arrow: '↑', pct: pct + '%', color: '#1D9E75' };
  if (pct < 0) return { arrow: '↓', pct: Math.abs(pct) + '%', color: '#D85A30' };
  return { arrow: '→', pct: '0%', color: '#6b7280' };
}

function renderStats() {
  const totalRevenue = transactions.reduce((s, t) => s + t.total, 0);
  const totalProfit  = transactions.reduce((s, t) => s + t.profit, 0);
  const totalCost    = transactions.reduce((s, t) => s + t.totalCost, 0);

  const now      = new Date();
  const weekAgo  = new Date(now - 7  * 86400000).toISOString().split('T')[0];
  const twoWkAgo = new Date(now - 14 * 86400000).toISOString().split('T')[0];
  const today    = now.toISOString().split('T')[0];

  const thisWeek = transactions.filter(t => t.date >= weekAgo && t.date <= today);
  const lastWeek = transactions.filter(t => t.date >= twoWkAgo && t.date < weekAgo);
  const trend    = getTrend(thisWeek.reduce((s,t)=>s+t.total,0), lastWeek.reduce((s,t)=>s+t.total,0));

  document.getElementById('total-income').textContent  = fmt(totalRevenue);
  document.getElementById('total-expense').textContent = fmt(totalCost);
  document.getElementById('net-profit').textContent    = fmt(totalProfit);
  document.getElementById('total-profit').textContent  = fmt(totalProfit);

  const trendEl = document.getElementById('revenue-trend');
  if (trendEl) {
    trendEl.textContent = `${trend.arrow} ${trend.pct} vs last week`;
    trendEl.style.color = trend.color;
  }
}

function renderDashboard() {
  if (!hasChartSupport()) {
    const legend = document.getElementById('donut-legend');
    if (legend) legend.innerHTML = '<span style="color:#6b7280;font-size:13px;">Charts unavailable offline</span>';
    return;
  }

  const today     = new Date().toISOString().split('T')[0];
  const todayTxns = transactions.filter(t => t.date === today);

  document.getElementById('kpi-sold').textContent    = todayTxns.reduce((s,t)=>s+t.qty, 0);
  document.getElementById('kpi-revenue').textContent = fmt(todayTxns.reduce((s,t)=>s+t.total, 0));
  document.getElementById('kpi-profit').textContent  = fmt(todayTxns.reduce((s,t)=>s+t.profit, 0));

  const creatorKpi = document.getElementById('creator-kpi');
  const adminPanel = document.getElementById('creator-admin-panel');
  if (currentUser && currentUser.email === CREATOR_EMAIL) {
    if (creatorKpi) creatorKpi.style.display = 'flex';
    fbGetUserCount().then(count => {
      const valEl = document.getElementById('kpi-total-users');
      if (valEl) valEl.textContent = count;
    }).catch(err => console.warn("Admin fetch failed:", err));

    if (adminPanel) {
      adminPanel.style.display = 'block';
      fbGetAllUsers().then(users => {
        const tbody = document.getElementById('admin-user-body');
        if (!tbody) return;
        tbody.innerHTML = users.map(u => {
          const lastLog  = u.lastLogin  ? new Date(getMillis(u.lastLogin)).toLocaleString()  : 'Never';
          const joined   = u.createdAt  ? new Date(getMillis(u.createdAt)).toLocaleDateString() : '—';
          const isDeleted = u.status === 'deleted';
          const rowStyle = isDeleted ? 'opacity:0.6;font-style:italic;background:rgba(216,90,48,0.02);' : '';
          return `
            <tr style="${rowStyle}">
              <td style="font-weight:600;">${esc(u.name) || 'Anonymous'} ${isDeleted ? '<span class="badge danger" style="font-size:9px;margin-left:5px;padding:2px 6px;">Deleted</span>' : ''}</td>
              <td style="color:var(--muted);font-size:12px;">${esc(u.email) || (isDeleted ? '—' : 'No Email')}</td>
              <td style="font-size:12px;">${esc(isDeleted && u.deletedAt ? 'Left: ' + new Date(getMillis(u.deletedAt)).toLocaleString() : lastLog)}</td>
              <td style="font-size:12px;color:var(--muted);">${esc(joined)}</td>
            </tr>
          `;
        }).join('');
      }).catch(err => {
        console.error("Failed to fetch user list:", err);
        if (adminPanel) adminPanel.style.display = 'none';
      });
    }
  } else {
    if (creatorKpi) creatorKpi.style.display = 'none';
    if (adminPanel) adminPanel.style.display = 'none';
  }

  const grouped = {};
  transactions.forEach(t => {
    const key = String(getRecordProductId(t) ?? t.product);
    if (!grouped[key]) grouped[key] = { name: getRecordProductName(t), qty: 0, revenue: 0 };
    grouped[key].qty     += t.qty;
    grouped[key].revenue += t.total;
  });
  const top = Object.values(grouped).sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue)[0];
  // FIX #29: esc product name in KPI display
  document.getElementById('kpi-top').textContent = top ? `${top.name} (${top.qty} sold)` : '—';

  const days = [], labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
    labels.push(d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
  }

  const revenueByDay = days.map(day => transactions.filter(t=>t.date===day).reduce((s,t)=>s+t.total,0));
  const profitByDay  = days.map(day => transactions.filter(t=>t.date===day).reduce((s,t)=>s+t.profit,0));

  destroyCharts();
  barChart = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Revenue', data:revenueByDay, backgroundColor:'rgba(29,158,117,0.7)', borderRadius:6, borderSkipped:false },
        { label:'Profit',  data:profitByDay,  backgroundColor:'rgba(124,106,247,0.7)', borderRadius:6, borderSkipped:false }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ ticks:{ color:'#6b7280', font:{ size:11 } }, grid:{ color:'rgba(255,255,255,0.05)' } },
        y:{ ticks:{ color:'#6b7280', font:{ size:11 }, callback: v => fmt(v) }, grid:{ color:'rgba(255,255,255,0.05)' } }
      }
    }
  });

  const revByProd = {};
  transactions.forEach(t => {
    const key = String(getRecordProductId(t) ?? t.product);
    if (!revByProd[key]) revByProd[key] = { name: getRecordProductName(t), total: 0 };
    revByProd[key].total += t.total;
  });

  const entries = Object.values(revByProd);
  const colors  = ['#1D9E75','#7c6af7','#D85A30','#eab308','#378ADD','#e879a0','#14b8a6','#f97316'];
  const legend  = document.getElementById('donut-legend');

  if (!entries.length) { if (legend) legend.innerHTML = '<span style="color:#6b7280;font-size:13px;">No sales yet</span>'; return; }

  doughnutChart = new Chart(document.getElementById('doughnutChart'), {
    type:'doughnut',
    data:{
      labels: entries.map(e=>e.name),
      datasets:[{ data:entries.map(e=>e.total), backgroundColor:colors.slice(0,entries.length), borderWidth:0, hoverOffset:6 }]
    },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{ display:false } } }
  });

  if (legend) {
    legend.innerHTML = '';
    entries.forEach((e, i) => {
      const span = document.createElement('span');
      span.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;';
      const dot = document.createElement('span');
      dot.style.cssText = `width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0;`;
      span.appendChild(dot);
      span.appendChild(document.createTextNode(e.name)); // FIX #30: textNode — no XSS
      legend.appendChild(span);
    });
  }
}

// ============================================================================
// PRODUCTS MANAGEMENT
// ============================================================================

function getCurrentStock(p) {
  if (!p) return 0;
  return p.stock || 0;
}

// FIX #31: Input sanitisation + length limits on all string fields
function addProduct() {
  const name        = document.getElementById('prod-name').value.trim().slice(0, 200);
  const category    = (document.getElementById('prod-category').value.trim() || 'Uncategorized').slice(0, 100);
  const brand       = (document.getElementById('prod-brand').value.trim()    || '—').slice(0, 100);
  const variant     = (document.getElementById('prod-variant').value.trim()  || '—').slice(0, 100);
  const cost        = parseFloat(document.getElementById('prod-cost').value);
  const price       = parseFloat(document.getElementById('prod-price').value);
  const stock       = parseInt(document.getElementById('prod-stock').value);
  const minStock    = parseInt(document.getElementById('prod-min').value)    || 5;
  const batchNumber = document.getElementById('prod-batch').value.trim().slice(0, 100);
  const expiryDate  = document.getElementById('prod-expiry').value;
  const skuInput    = document.getElementById('prod-sku').value.trim().slice(0, 50);
  const image       = document.getElementById('prod-image-base64').value;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all required fields correctly.', 'error'); return;
  }
  // FIX #32: Reasonable upper bound on numeric values to prevent overflow
  if (cost > 10_000_000 || price > 10_000_000) { toast('Price values seem unrealistically high.', 'error'); return; }
  if (stock > 1_000_000) { toast('Stock quantity seems unrealistically high.', 'error'); return; }
  if (cost >= price) { toast('Selling price must be higher than cost price.', 'error'); return; }

  if (products.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    toast(`"${name}" already exists. Use Edit to update it.`, 'warning'); return;
  }

  // FIX #33: Validate SKU format if manually entered to prevent injection in reports
  let sku = skuInput;
  if (sku && !/^[\w\-. ]+$/.test(sku)) {
    toast('SKU may only contain letters, numbers, spaces, hyphens, and dots.', 'error'); return;
  }
  if (!sku) {
    sku = `SKU-${String(skuCounter).padStart(3, '0')}`;
    while (products.some(p => p.sku === sku)) {
      skuCounter++;
      sku = `SKU-${String(skuCounter).padStart(3, '0')}`;
    }
  }

  // FIX #34: Validate expiry date is a real date if provided
  if (expiryDate && isNaN(new Date(expiryDate).getTime())) {
    toast('Invalid expiry date.', 'error'); return;
  }

  products.push({ id: nextProdId++, sku, name, brand, variant, category, cost, price, stock, minStock, batchNumber, expiryDate, image });
  skuCounter++;
  saveCurrentUserData();
  addMovementEntry('Added', name, `Created ${sku} with ${stock} units at ${fmt(price)}.`);
  clearProductForm();
  render();
  toast(`✓ ${name} added (${sku})`);
}

function deleteProduct(id) {
  const product  = products.find(p => p.id === id);
  const snapshot = createDataSnapshot();
  products = products.filter(p => p.id !== id);
  if (product) addMovementEntry('Deleted', product.name, `Removed product ${product.sku || ''}`.trim());
  saveCurrentUserData();
  render();
  queueUndo(`${product?.name || 'Product'} removed.`, snapshot);
}

function editProduct(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  document.getElementById('prod-name').value     = p.name;
  document.getElementById('prod-category').value = p.category || '';
  document.getElementById('prod-brand').value    = p.brand    || '';
  document.getElementById('prod-variant').value  = p.variant  || '';
  document.getElementById('prod-sku').value      = p.sku      || '';
  document.getElementById('prod-cost').value     = p.cost;
  document.getElementById('prod-price').value    = p.price;
  document.getElementById('prod-stock').value    = p.stock;
  document.getElementById('prod-min').value      = p.minStock;
  document.getElementById('prod-batch').value    = p.batchNumber || '';
  document.getElementById('prod-expiry').value   = p.expiryDate  || '';
  document.getElementById('prod-image-base64').value = p.image || '';

  const urlInput = document.getElementById('prod-image-url');
  if (urlInput) urlInput.value = (p.image && p.image.startsWith('https://')) ? p.image : '';

  const preview = document.getElementById('image-preview');
  if (p.image) {
    const img = document.createElement('img');
    img.src = p.image;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    preview.innerHTML = '';
    preview.appendChild(img);
  } else {
    preview.textContent = '🖼️';
  }

  const btn = document.querySelector('.form-section button');
  btn.textContent = '💾 Save Edit';
  btn.onclick = () => saveEdit(id);

  document.querySelector('.form-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveEdit(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  const name        = document.getElementById('prod-name').value.trim().slice(0, 200);
  const category    = (document.getElementById('prod-category').value.trim() || 'Uncategorized').slice(0, 100);
  const brand       = (document.getElementById('prod-brand').value.trim()    || '—').slice(0, 100);
  const variant     = (document.getElementById('prod-variant').value.trim()  || '—').slice(0, 100);
  const sku         = (document.getElementById('prod-sku').value.trim()      || p.sku).slice(0, 50);
  const cost        = parseFloat(document.getElementById('prod-cost').value);
  const price       = parseFloat(document.getElementById('prod-price').value);
  const stock       = parseInt(document.getElementById('prod-stock').value);
  const minStock    = parseInt(document.getElementById('prod-min').value)    || 5;
  const batchNumber = document.getElementById('prod-batch').value.trim().slice(0, 100);
  const expiryDate  = document.getElementById('prod-expiry').value;
  const image       = document.getElementById('prod-image-base64').value;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all fields correctly.', 'error'); return;
  }
  if (cost > 10_000_000 || price > 10_000_000) { toast('Price values seem unrealistically high.', 'error'); return; }
  if (stock > 1_000_000) { toast('Stock quantity seems unrealistically high.', 'error'); return; }
  if (cost >= price) { toast('Selling price must be higher than cost price.', 'error'); return; }
  if (expiryDate && isNaN(new Date(expiryDate).getTime())) { toast('Invalid expiry date.', 'error'); return; }

  Object.assign(p, { name, category, brand, variant, sku, cost, price, stock, minStock, batchNumber, expiryDate, image });
  saveCurrentUserData();
  addMovementEntry('Updated', name, `Edited product details. Stock now ${stock}, price ${fmt(price)}.`);
  clearProductForm();

  const btn = document.querySelector('.form-section button');
  btn.textContent = '+ Add Product';
  btn.onclick = addProduct;

  render();
  toast(`✓ ${name} updated`);
}

function clearProductForm() {
  ['prod-name','prod-category','prod-brand','prod-variant','prod-sku',
   'prod-cost','prod-price','prod-stock','prod-min','prod-batch','prod-expiry',
   'prod-image','prod-image-base64','prod-image-url']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  const preview = document.getElementById('image-preview');
  if (preview) preview.textContent = '🖼️';
}

// ── Camera Access ────────────────────────────────────────────────────────────

async function openCamera() {
  const modal     = document.getElementById('camera-modal');
  const video     = document.getElementById('camera-feed');
  const message   = document.getElementById('camera-message');
  const captureBtn = document.getElementById('capture-btn');

  if (!modal || !video || !message || !captureBtn) return;

  message.textContent = '';
  captureBtn.disabled = true;
  video.style.display = 'block';

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    cameraStream = stream;
    video.srcObject = stream;
    video.play();
    captureBtn.disabled = false;
    message.textContent = 'Camera active. Click Capture to take photo.';
    message.className = 'auth-message info';
  } catch (err) {
    console.error('Error accessing camera:', err);
    video.style.display = 'none';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      message.textContent = 'Camera access denied. Please allow camera permissions in your browser settings.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      message.textContent = 'No camera found on this device.';
    } else {
      message.textContent = 'Could not access camera. Please try again.';
    }
    message.className = 'auth-message error';
    captureBtn.disabled = true;
  }
}

function captureImage() {
  const video     = document.getElementById('camera-feed');
  const canvas    = document.getElementById('camera-canvas');
  const preview   = document.getElementById('image-preview');
  const hidden    = document.getElementById('prod-image-base64');
  const urlInput  = document.getElementById('prod-image-url');
  const fileInput = document.getElementById('prod-image');

  if (!video || !canvas || !preview || !hidden) return;

  const context   = canvas.getContext('2d');
  const MAX_WIDTH = 400;
  const ratio     = video.videoWidth / video.videoHeight;
  let width = MAX_WIDTH, height = MAX_WIDTH / ratio;
  if (video.videoHeight > video.videoWidth) { height = MAX_WIDTH; width = MAX_WIDTH * ratio; }

  canvas.width = width; canvas.height = height;
  context.drawImage(video, 0, 0, width, height);

  const base64 = canvas.toDataURL('image/jpeg', 0.8);
  hidden.value = base64;
  if (urlInput)  urlInput.value  = '';
  if (fileInput) fileInput.value = '';

  // FIX #35: Use DOM API for preview
  const img = document.createElement('img');
  img.src = base64;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  preview.innerHTML = '';
  preview.appendChild(img);

  closeCameraModal();
  toast('Image captured successfully!', 'success');
}

function closeCameraModal() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-feed');
  if (!modal) return;
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (video) video.srcObject = null;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 280);
}

function saveProducts() { saveCurrentUserData(); }

function renderRestockAlert() {
  const lowItems = products.filter(p => getCurrentStock(p) <= p.minStock);
  const banner   = document.getElementById('restock-banner');
  if (!lowItems.length) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  // FIX #36: Build restock tags via DOM
  const list = document.getElementById('restock-list');
  list.innerHTML = '';
  lowItems.forEach(p => {
    const span = document.createElement('span');
    span.className = 'restock-tag';
    span.textContent = `${p.name} — ${getCurrentStock(p)} left`;
    list.appendChild(span);
  });
}

function renderProducts() {
  renderRestockAlert();
  updateCategoryFilter();

  let list = [...products];
  if (searchQuery)              list = list.filter(p => p.name.toLowerCase().includes(searchQuery));
  if (filterCategory !== 'all') list = list.filter(p => (p.category || 'Uncategorized') === filterCategory);
  if (sortBy === 'stock-asc')   list.sort((a,b) => getCurrentStock(a) - getCurrentStock(b));
  if (sortBy === 'stock-desc')  list.sort((a,b) => getCurrentStock(b) - getCurrentStock(a));
  if (sortBy === 'price-asc')   list.sort((a,b) => a.price - b.price);
  if (sortBy === 'price-desc')  list.sort((a,b) => b.price - a.price);

  const tbody = document.getElementById('prod-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">No products match your search.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(p => {
    const currentStock = getCurrentStock(p);
    const margin       = (((p.price - p.cost) / p.price) * 100).toFixed(1);
    const isLow        = currentStock <= p.minStock;
    const isEmpty      = currentStock <= 0;
    const daysToExpiry = getDaysToExpiry(p.expiryDate);

    const expiryMarkup = daysToExpiry === null
      ? '<span style="color:var(--muted);font-size:11px;">No expiry set</span>'
      : daysToExpiry < 0
      ? `<span class="badge danger">Expired ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry)===1?'':'s'} ago</span>`
      : daysToExpiry <= 30
      ? `<span class="badge warning">${daysToExpiry===0?'Expires today':`${daysToExpiry} day${daysToExpiry===1?'':'s'} left`}</span>`
      : `<span class="badge income">${daysToExpiry} days left</span>`;

    const stockBadge = isEmpty
      ? `<span class="badge expense">Out of stock</span>`
      : isLow
      ? `<span class="badge danger pulse">${currentStock} units — Low</span>`
      : `<span class="badge income">${currentStock} units</span>`;

    // FIX #37: All user-supplied strings escaped in table rows
    return `
      <tr class="${isLow && !isEmpty ? 'row-low' : ''}">
        <td>
          ${p.image
            ? `<img src="${esc(p.image)}" class="prod-thumb" alt="${esc(p.name)}">`
            : `<div class="prod-thumb" style="display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--surface-2);">📦</div>`}
        </td>
        <td>
          <div style="font-weight:600;">${esc(p.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(p.sku) || '—'}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">Batch: ${esc(p.batchNumber) || '—'}</div>
          <div style="margin-top:6px;">${expiryMarkup}</div>
        </td>
        <td><span class="badge" style="background:rgba(124,106,247,0.12);color:#7c6af7;">${esc(p.category)||'Uncategorized'}</span></td>
        <td style="color:var(--muted);font-size:13px;">${esc(p.brand)||'—'}</td>
        <td style="color:var(--muted);font-size:13px;">${esc(p.variant)||'—'}</td>
        <td>${fmt(p.cost)}</td>
        <td>${fmt(p.price)}</td>
        <td><span class="badge income">${esc(margin)}% margin</span></td>
        <td>${stockBadge}</td>
        <td style="color:var(--muted);font-size:13px;">${esc(p.minStock)} units</td>
        <td>
          <button class="sell-btn" onclick="openQuickSell(${Number(p.id)})" ${isEmpty?'disabled':''}>
            ${isEmpty ? 'Out of Stock' : 'Sell'}
          </button>
        </td>
        <td>
          <input type="number" id="restock-qty-${Number(p.id)}" placeholder="Qty"
            style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;" />
          <input type="number" id="restock-cost-${Number(p.id)}" placeholder="${esc(currency)}/unit"
            style="width:70px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;margin-left:4px;" />
          <button class="restock-btn" onclick="restockProduct(${Number(p.id)})">+ Restock</button>
        </td>
        <td style="display:flex;gap:6px;">
          <button class="edit-btn" onclick="editProduct(${Number(p.id)})">✎ Edit</button>
          <button onclick="deleteProduct(${Number(p.id)})">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateCategoryFilter() {
  const cats    = ['all', ...new Set(products.map(p => p.category || 'Uncategorized'))];
  const sel     = document.getElementById('filter-category');
  const current = sel.value;
  sel.innerHTML = cats.map(c => `<option value="${esc(c)}">${esc(c === 'all' ? 'All Categories' : c)}</option>`).join('');
  sel.value = cats.includes(current) ? current : 'all';
}

function setSearch(val)    { searchQuery    = val.toLowerCase(); renderProducts(); }
function setTxnSearch(val) { txnSearchQuery = val.toLowerCase(); renderTransactions(); renderDateStats(); }
function setCategory(val)  { filterCategory = val;              renderProducts(); }
function setSort(val)      { sortBy         = val;              renderProducts(); }

// ============================================================================
// SALES & TRANSACTIONS
// ============================================================================

function sellProduct(id, manualQty = null, manualNote = null, manualPrice = null) {
  const qtyInput  = document.getElementById('qty-' + id);
  const noteInput = document.getElementById('note-' + id);

  const qty     = manualQty !== null ? manualQty : parseInt(qtyInput?.value);
  const note    = (manualNote !== null ? manualNote : (noteInput ? noteInput.value.trim() : '')).slice(0, 500); // FIX #38: Limit note length
  const product = products.find(p => p.id === id);

  if (!product) return;
  if (isNaN(qty) || qty <= 0) { toast('Enter a valid quantity.', 'error'); return; }
  const currentStock = product.stock;
  if (qty > currentStock) { toast(`Only ${currentStock} units in stock.`, 'error'); return; }

  const sellPrice = (!isNaN(parseFloat(manualPrice))) ? parseFloat(manualPrice) : product.price;
  // FIX #39: Guard against negative or zero override price
  if (sellPrice <= 0) { toast('Selling price must be positive.', 'error'); return; }
  if (sellPrice > 10_000_000) { toast('Selling price is unrealistically high.', 'error'); return; }

  if ((qty / currentStock) >= 0.8 && currentStock > 5) {
    const proceed = confirm(`You're selling ${qty} of ${currentStock} units (${Math.round((qty/currentStock)*100)}% of stock). Continue?`);
    if (!proceed) return;
  }

  // FIX #40: Create snapshot BEFORE mutation so undo restores correct state
  const snapshot  = createDataSnapshot();
  const total     = qty * sellPrice;
  const totalCost = qty * product.cost;
  const profit    = total - totalCost;
  const date      = new Date().toISOString().split('T')[0];

  product.stock -= qty;

  transactions.unshift({
    id: Date.now(), date,
    productId: product.id, product: product.name,
    sku: product.sku || '', category: product.category || 'Uncategorized',
    qty, cost: product.cost, price: sellPrice,
    total, totalCost, profit, note,
    isOverride: sellPrice !== product.price
  });

  if (qtyInput)  qtyInput.value  = '';
  if (noteInput) noteInput.value = '';
  saveCurrentUserData();
  addMovementEntry('Sold', product.name, `Sold ${qty} units for ${fmt(total)}${note ? ` — note: ${note}` : ''}.`);
  render();
  queueUndo(`Sold ${qty}× ${product.name} — profit ${fmt(profit)}`, snapshot, 'success');
  notifyImportantEvents();
}

function openQuickSell(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  activeQuickSellId = id;
  quickSellQty = '0';

  const modal        = document.getElementById('quick-sell-modal');
  const nameDisplay  = document.getElementById('qs-product-name');
  const stockDisplay = document.getElementById('qs-stock-info');
  const display      = document.getElementById('qs-display');
  const noteInput    = document.getElementById('qs-note');
  const priceInput   = document.getElementById('qs-price');

  if (nameDisplay)  nameDisplay.textContent  = p.name; // textContent — safe
  if (stockDisplay) stockDisplay.textContent = `Stock: ${getCurrentStock(p)} units`;
  if (display)      display.textContent      = '0';
  if (noteInput)    noteInput.value          = '';
  if (priceInput) {
    priceInput.value       = '';
    priceInput.placeholder = `Default: ${fmt(p.price)}`;
  }

  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
}

function closeQuickSell() {
  const modal = document.getElementById('quick-sell-modal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 280);
  activeQuickSellId = null;
}

function qsAdd(n) {
  if (quickSellQty === '0') quickSellQty = String(n);
  else quickSellQty += String(n);
  if (quickSellQty.length > 6) quickSellQty = quickSellQty.slice(0, 6);
  const display = document.getElementById('qs-display');
  if (display) display.textContent = quickSellQty;
}

function qsClear() {
  quickSellQty = '0';
  const display = document.getElementById('qs-display');
  if (display) display.textContent = '0';
}

function qsBack() {
  quickSellQty = quickSellQty.length <= 1 ? '0' : quickSellQty.slice(0, -1);
  const display = document.getElementById('qs-display');
  if (display) display.textContent = quickSellQty;
}

function confirmQuickSell() {
  if (activeQuickSellId === null) return;
  const qty = parseInt(quickSellQty);
  if (qty <= 0) { toast('Enter a quantity greater than 0.', 'error'); return; }
  const note        = document.getElementById('qs-note')?.value?.trim()  || '';
  const manualPrice = document.getElementById('qs-price')?.value?.trim() || null;
  sellProduct(activeQuickSellId, qty, note, manualPrice);
  closeQuickSell();
}

function openBulkSell() {
  bulkEntries = {};
  bulkPriceOverrides = {};
  const modal       = document.getElementById('bulk-sell-modal');
  const searchInput = document.getElementById('bulk-search-input');
  if (searchInput) searchInput.value = '';
  if (modal) modal.style.display = 'flex';
  renderBulkList();
  updateBulkFooter();
}

function closeBulkSell() {
  const modal = document.getElementById('bulk-sell-modal');
  if (modal) modal.style.display = 'none';
}

function renderBulkList() {
  const container = document.getElementById('bulk-list-container');
  const query     = document.getElementById('bulk-search-input')?.value.toLowerCase() || '';
  if (!container) return;

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(query) ||
    (p.sku && p.sku.toLowerCase().includes(query))
  );

  container.innerHTML = filtered.map(p => {
    const stock         = getCurrentStock(p);
    const qty           = bulkEntries[p.id] || '';
    const overridePrice = bulkPriceOverrides[p.id] || '';
    const effectivePrice = overridePrice !== '' ? parseFloat(overridePrice) : p.price;
    const profit        = qty ? (effectivePrice - p.cost) * qty : 0;

    // FIX #41: Numeric ids in onclick (already cast), escape display strings
    return `
      <div class="bulk-item-row" style="grid-template-columns: 1fr 100px 90px 80px;">
        <div>
          <div style="font-weight:700; font-size:14px;">${esc(p.name)}</div>
          <div style="font-size:11px; color:var(--muted);">Stock: ${stock} | Cost: ${fmt(p.cost)}</div>
        </div>
        <div style="text-align:right; font-size:12px; color:var(--green); font-weight:700;">
          ${qty ? `+${fmt(profit)}` : ''}
        </div>
        <input type="number" value="${overridePrice}" placeholder="${fmt(p.price)}"
          oninput="updateBulkPrice(${Number(p.id)}, this.value)"
          style="width:100%; height:36px; padding:0 8px; border-radius:8px; border:1px solid var(--card-border); background:var(--input-bg); color:var(--text); text-align:center;" />
        <input type="number" value="${qty}" placeholder="Qty" min="0" max="${stock}"
          oninput="updateBulkQty(${Number(p.id)}, this.value)"
          style="width:100%; height:36px; padding:0 8px; border-radius:8px; border:1px solid var(--card-border); background:var(--input-bg); color:var(--text); text-align:center;" />
      </div>
    `;
  }).join('');
}

function updateBulkQty(id, val) {
  const qty = parseInt(val);
  const p   = products.find(x => x.id === id);
  if (!p) return;
  if (isNaN(qty) || qty <= 0) { delete bulkEntries[id]; }
  else { bulkEntries[id] = Math.min(qty, getCurrentStock(p)); }
  updateBulkFooter();
}

function updateBulkPrice(id, val) {
  const price = parseFloat(val);
  if (isNaN(price) || price <= 0) { delete bulkPriceOverrides[id]; }
  else { bulkPriceOverrides[id] = price; }
  updateBulkFooter();
}

function updateBulkFooter() {
  let totalProfit = 0, count = 0;
  for (const [id, qty] of Object.entries(bulkEntries)) {
    const p = products.find(x => x.id == id);
    if (p) {
      const price = (bulkPriceOverrides[id] !== undefined) ? bulkPriceOverrides[id] : p.price;
      totalProfit += (price - p.cost) * qty;
      count++;
    }
  }
  document.getElementById('bulk-total-profit').textContent = `Total Profit: ${fmt(totalProfit)}`;
  document.getElementById('bulk-count-label').textContent  = `${count} product(s) in this tally`;
  document.getElementById('bulk-record-btn').disabled       = count === 0;
}

function confirmBulkSell() {
  const ids = Object.keys(bulkEntries);
  if (!ids.length) return;

  const snapshot = createDataSnapshot();
  const today    = new Date().toISOString().split('T')[0];
  let successCount = 0;

  ids.forEach(id => {
    const pid     = parseInt(id);
    const product = products.find(p => p.id === pid);
    if (!product) return;
    const qty       = bulkEntries[id];
    const overPrice = bulkPriceOverrides[id];
    const sellPrice = (!isNaN(parseFloat(overPrice))) ? parseFloat(overPrice) : product.price;
    if (qty <= 0 || qty > product.stock || sellPrice <= 0) return;

    product.stock -= qty;
    transactions.unshift({
      id: Date.now() + successCount, date: today,
      productId: product.id, product: product.name,
      sku: product.sku || '', category: product.category || 'Uncategorized',
      qty, cost: product.cost, price: sellPrice,
      total: qty * sellPrice, totalCost: qty * product.cost,
      profit: (qty * sellPrice) - (qty * product.cost),
      note: 'End-of-day tally',
      isOverride: sellPrice !== product.price
    });
    successCount++;
  });

  if (successCount === 0) { toast('No valid items to record.', 'error'); return; }

  saveCurrentUserData();
  addMovementEntry('Bulk Sell', 'Inventory', `Recorded ${successCount} product(s) in end-of-day tally.`);
  render();
  closeBulkSell();
  queueUndo(`Bulk sale of ${successCount} product(s) recorded.`, snapshot);
}

function deleteTransaction(id) {
  const tx = transactions.find(t => t.id == id);
  if (!tx) return;
  const snapshot = createDataSnapshot();
  const product  = findProductByRecord(tx);
  if (product) { product.stock += tx.qty; }
  transactions = transactions.filter(t => t.id != id);
  saveCurrentUserData();
  addMovementEntry(
    'Sale Deleted',
    getRecordProductName(tx),
    `Removed sale of ${tx.qty} unit${tx.qty !== 1 ? 's' : ''} — stock restored. Revenue −${fmt(tx.total)}.`
  );
  render();
  queueUndo(
    `Sale deleted — ${tx.qty}× ${getRecordProductName(tx)} (${fmt(tx.total)} revenue removed)`,
    snapshot, 'info'
  );
}

function renderTransactions() {
  const tbody      = document.getElementById('txn-body');
  const filtered   = getFilteredTransactions();
  const countBadge = document.getElementById('txn-count-badge');

  if (countBadge) {
    countBadge.textContent = filtered.length;
    countBadge.style.display = (txnSearchQuery || dateFrom || dateTo) ? 'inline-flex' : 'none';
  }

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No transactions found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(t => `
    <tr>
      <td>${esc(t.date)}</td>
      <td>
        <div style="font-weight:600;">${esc(getRecordProductName(t))}</div>
        ${t.sku ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(t.sku)}</div>` : ''}
        ${t.isOverride ? `<span class="badge warning" style="margin-top:4px;font-size:9px;padding:2px 6px;">Custom Price</span>` : ''}
        ${t.note ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">📝 ${esc(t.note)}</div>` : ''}
      </td>
      <td>${esc(String(t.qty))}</td>
      <td>${fmt(t.price)}</td>
      <td style="color:#1D9E75;font-weight:700;">+${fmt(t.total)}</td>
      <td style="color:#7c6af7;font-weight:700;">+${fmt(t.profit)}</td>
      <td><button onclick="deleteTransaction(${Number(t.id)})">✕</button></td>
    </tr>
  `).join('');
}

// ============================================================================
// RESTOCK & INVENTORY
// ============================================================================

function restockProduct(id) {
  const qtyInput  = document.getElementById('restock-qty-'  + id);
  const costInput = document.getElementById('restock-cost-' + id);
  const qty       = parseInt(qtyInput.value);
  const cost      = parseFloat(costInput.value);
  const product   = products.find(p => p.id === id);

  if (!product) return;
  if (isNaN(qty)  || qty  <= 0)          { toast('Enter a valid quantity.', 'error'); return; }
  if (isNaN(cost) || cost <  0)          { toast('Enter a valid cost.',     'error'); return; }
  if (qty  > 1_000_000)                  { toast('Quantity too large.',     'error'); return; } // FIX #42
  if (cost > 10_000_000)                 { toast('Cost value too large.',   'error'); return; }

  const snapshot = createDataSnapshot();
  product.stock += qty;

  restockHistory.unshift({
    id: Date.now(), date: new Date().toISOString().split('T')[0],
    productId: product.id, product: product.name,
    sku: product.sku || '', category: product.category || 'Uncategorized',
    qty, cost, total: qty * cost
  });

  qtyInput.value = ''; costInput.value = '';
  saveCurrentUserData();
  addMovementEntry('Restocked', product.name, `Added ${qty} units at ${fmt(cost)} each.`);
  render();
  notifyImportantEvents();
  queueUndo(`Restocked ${qty} units of ${product.name}`, snapshot, 'success');
}

function renderRestockHistory() {
  const tbody = document.getElementById('restock-body');
  if (!tbody) return;

  if (!restockHistory.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No restock history yet.</td></tr>';
    return;
  }

  tbody.innerHTML = restockHistory.map(entry => `
    <tr>
      <td>${esc(entry.date)}</td>
      <td>${esc(getRecordProductName(entry))}</td>
      <td>${esc(String(entry.qty))}</td>
      <td>${fmt(entry.cost)}</td>
      <td>${fmt(entry.total)}</td>
    </tr>
  `).join('');
}

function setDeadStockDays(val) {
  deadStockDays = parseInt(val);
  document.getElementById('days-label').textContent = val + ' days';
  renderDeadStock();
}

function markReviewed(id) {
  if (!reviewedProducts.includes(id)) {
    const snapshot = createDataSnapshot();
    reviewedProducts.push(id);
    saveCurrentUserData();
    queueUndo('Product marked as reviewed (removed from dead stock).', snapshot);
  }
  renderDeadStock();
}

function renderDeadStock() {
  const today   = new Date();
  const tbody   = document.getElementById('dead-body');
  const countEl = document.getElementById('dead-count');

  const deadList = products.filter(product => {
    if (reviewedProducts.includes(product.id)) return false;
    const currentStock = getCurrentStock(product);
    const lastSale     = transactions
      .filter(tx => matchesProductRecord(tx, product))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (!lastSale) return currentStock > 0;
    return Math.floor((today - new Date(lastSale.date)) / 86400000) >= deadStockDays && currentStock > 0;
  }).map(product => {
    const currentStock = getCurrentStock(product);
    const lastSale     = transactions
      .filter(tx => matchesProductRecord(tx, product))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return {
      ...product, lastSale: lastSale?.date || null,
      daysSince: lastSale ? Math.floor((today - new Date(lastSale.date)) / 86400000) : null,
      idleValue: currentStock * product.cost,
      currentStock
    };
  });

  countEl.textContent = deadList.length;
  if (!deadList.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No dead stock right now.</td></tr>';
    return;
  }

  tbody.innerHTML = deadList.map(p => `
    <tr>
      <td>
        <div style="font-weight:600;">${esc(p.name)}</div>
        <div style="font-size:12px;color:var(--muted);">${esc(p.category || 'Uncategorized')}</div>
      </td>
      <td><span class="badge danger">${p.daysSince === null ? 'Never sold' : `${p.daysSince} days ago`}</span></td>
      <td>${p.currentStock} units</td>
      <td style="color:#eab308;font-weight:700;">${fmt(p.idleValue)}</td>
      <td><button class="reviewed-btn" onclick="markReviewed(${Number(p.id)})">✓ Mark reviewed</button></td>
    </tr>
  `).join('');
}

// ============================================================================
// SMART INSIGHTS
// ============================================================================

function renderSmartInsights() {
  const today     = new Date().toISOString().split('T')[0];
  const todayTxns = transactions.filter(t => t.date === today);

  document.getElementById('summary-rev').textContent    = fmt(todayTxns.reduce((s,t)=>s+t.total,0));
  document.getElementById('summary-profit').textContent = fmt(todayTxns.reduce((s,t)=>s+t.profit,0));
  document.getElementById('summary-items').textContent  = todayTxns.reduce((s,t)=>s+t.qty,0);

  const dayMap = {};
  transactions.forEach(t => {
    const day = new Date(t.date).toLocaleDateString('en-IN', { weekday: 'long' });
    dayMap[day] = (dayMap[day] || 0) + t.total;
  });
  const bestDay = Object.entries(dayMap).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('best-day').textContent = bestDay
    ? `${bestDay[0]} — ${fmt(bestDay[1])} avg revenue`
    : 'Not enough data yet';

  const lowMargin = products.filter(p => ((p.price - p.cost) / p.price) * 100 < 10);
  const marginEl  = document.getElementById('margin-warnings');
  marginEl.innerHTML = '';
  if (!lowMargin.length) {
    const s = document.createElement('span');
    s.style.cssText = 'color:#1D9E75;font-size:13px;';
    s.textContent = 'All products have healthy margins.';
    marginEl.appendChild(s);
  } else {
    lowMargin.forEach(p => {
      const margin = (((p.price - p.cost) / p.price) * 100).toFixed(1);
      const span   = document.createElement('span');
      span.className = 'restock-tag';
      span.textContent = `${p.name} — ${margin}% margin`;
      marginEl.appendChild(span);
    });
  }
}

// ============================================================================
// GOALS
// ============================================================================

function setGoal() {
  const val = parseFloat(document.getElementById('goal-input').value);
  if (isNaN(val) || val <= 0)    { toast('Enter a valid goal.', 'error'); return; }
  if (val > 100_000_000)         { toast('Goal seems unrealistically high.', 'error'); return; } // FIX #43
  dailyGoal = val;
  saveCurrentUserData();
  renderGoal();
  toast('Daily goal set!');
}

function renderGoal() {
  const today       = new Date().toISOString().split('T')[0];
  const todayProfit = transactions.filter(t => t.date === today).reduce((s,t)=>s+t.profit,0);
  const pct         = dailyGoal > 0 ? Math.min((todayProfit / dailyGoal) * 100, 100).toFixed(1) : 0;
  const remaining   = Math.max(dailyGoal - todayProfit, 0);

  const bar     = document.getElementById('goal-bar');
  const label   = document.getElementById('goal-label');
  const inputEl = document.getElementById('goal-input');
  if (!bar) return;

  if (dailyGoal === 0) {
    label.textContent = 'Set a daily profit goal above';
    bar.style.width   = '0%';
    return;
  }

  bar.style.width      = pct + '%';
  bar.style.background = pct >= 100 ? '#1D9E75' : pct >= 50 ? '#eab308' : '#D85A30';

  if (pct >= 100) {
    label.textContent = `🎉 Goal reached! ${fmt(todayProfit)} profit today`;
    label.style.color = '#1D9E75';
  } else {
    label.textContent = `${fmt(todayProfit)} of ${fmt(dailyGoal)} — ${fmt(remaining)} to go (${pct}%)`;
    label.style.color = 'var(--muted)';
  }
  if (inputEl && !inputEl.value) inputEl.value = dailyGoal || '';
}

// ============================================================================
// DATE RANGE FILTER
// ============================================================================

let dateFrom = '';
let dateTo   = '';

function setDateFrom(val) { dateFrom = val; renderTransactions(); renderDateStats(); }
function setDateTo(val)   { dateTo   = val; renderTransactions(); renderDateStats(); }

function clearDateFilter() {
  dateFrom = ''; dateTo = ''; txnSearchQuery = '';
  const f1 = document.getElementById('date-from');
  const t1 = document.getElementById('date-to');
  const s1 = document.getElementById('txn-search-input');
  if (f1) f1.value = '';
  if (t1) t1.value = '';
  if (s1) s1.value = '';
  renderTransactions();
  renderDateStats();
}

function getFilteredTransactions() {
  return transactions.filter(t => {
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo   && t.date > dateTo)   return false;
    if (txnSearchQuery) {
      const name = getRecordProductName(t).toLowerCase();
      const sku  = (t.sku || '').toLowerCase();
      if (!name.includes(txnSearchQuery) && !sku.includes(txnSearchQuery)) return false;
    }
    return true;
  });
}

function renderDateStats() {
  const filtered   = getFilteredTransactions();
  const rev        = filtered.reduce((s,t)=>s+t.total,0);
  const profit     = filtered.reduce((s,t)=>s+t.profit,0);
  const cost       = filtered.reduce((s,t)=>s+t.totalCost,0);
  const items      = filtered.reduce((s,t)=>s+t.qty,0);
  const statsEl    = document.getElementById('date-stats');
  const insightsEl = document.getElementById('date-range-insights');
  const hasFilter  = !!(dateFrom || dateTo);

  if (statsEl) {
    statsEl.style.display = hasFilter ? 'flex' : 'none';
    if (hasFilter) {
      statsEl.innerHTML = `
        <div class="date-stat-card"><div class="date-stat-label">Revenue</div><div class="date-stat-value" style="color:#1D9E75;">${fmt(rev)}</div></div>
        <div class="date-stat-card"><div class="date-stat-label">Cost</div><div class="date-stat-value" style="color:#D85A30;">${fmt(cost)}</div></div>
        <div class="date-stat-card"><div class="date-stat-label">Profit</div><div class="date-stat-value" style="color:#7c6af7;">${fmt(profit)}</div></div>
        <div class="date-stat-card"><div class="date-stat-label">Items Sold</div><div class="date-stat-value">${items}</div></div>
      `;
    }
  }

  if (!insightsEl) return;
  if (!hasFilter) { insightsEl.style.display = 'none'; return; }

  if (!filtered.length) {
    insightsEl.style.display = 'grid';
    insightsEl.innerHTML = `
      <div class="range-insight-card empty-state">
        <div class="range-insight-title">Date Range Insights</div>
        <div class="range-insight-value">No transactions</div>
        <div class="range-insight-subtext">Try widening the selected dates.</div>
      </div>`;
    return;
  }

  const byProduct = {}, byCategory = {};
  filtered.forEach(t => {
    const name     = getRecordProductName(t);
    const category = getRecordCategory(t);
    if (!byProduct[name])      byProduct[name]      = { revenue:0, cost:0, profit:0, items:0 };
    if (!byCategory[category]) byCategory[category] = { revenue:0, profit:0, items:0 };
    byProduct[name].revenue += t.total; byProduct[name].cost += t.totalCost;
    byProduct[name].profit  += t.profit; byProduct[name].items += t.qty;
    byCategory[category].revenue += t.total; byCategory[category].profit += t.profit; byCategory[category].items += t.qty;
  });

  const best      = Object.entries(byProduct).sort((a,b)=>b[1].profit-a[1].profit)[0];
  const weakest   = Object.entries(byProduct).sort((a,b)=>a[1].profit-b[1].profit)[0];
  const topCat    = Object.entries(byCategory).sort((a,b)=>b[1].profit-a[1].profit)[0];
  const avgProfit = filtered.length ? profit / filtered.length : 0;
  const marginPct = rev > 0 ? ((profit / rev) * 100).toFixed(1) : '0.0';

  // FIX #44: Escape all product/category names in insight cards
  insightsEl.style.display = 'grid';
  insightsEl.innerHTML = `
    <div class="range-insight-card accent-green">
      <div class="range-insight-title">Top Category</div>
      <div class="range-insight-value">${topCat ? esc(topCat[0]) : '—'}</div>
      <div class="range-insight-subtext">${topCat ? `${fmt(topCat[1].profit)} profit across ${topCat[1].items} items` : 'No data'}</div>
    </div>
    <div class="range-insight-card accent-violet">
      <div class="range-insight-title">Best Product</div>
      <div class="range-insight-value">${best ? esc(best[0]) : '—'}</div>
      <div class="range-insight-subtext">${best ? `${fmt(best[1].profit)} profit from ${best[1].items} units` : 'No data'}</div>
    </div>
    <div class="range-insight-card accent-amber">
      <div class="range-insight-title">Lowest Performer</div>
      <div class="range-insight-value">${weakest ? esc(weakest[0]) : '—'}</div>
      <div class="range-insight-subtext">${weakest ? `${fmt(weakest[1].profit)} profit on ${fmt(weakest[1].revenue)} revenue` : 'No data'}</div>
    </div>
    <div class="range-insight-card accent-slate">
      <div class="range-insight-title">Range Quality</div>
      <div class="range-insight-value">${esc(marginPct)}% margin</div>
      <div class="range-insight-subtext">${fmt(avgProfit)} avg profit per transaction</div>
    </div>
  `;
}

// ============================================================================
// REPORTS
// ============================================================================

function renderReport(period) {
  const report = document.getElementById('report-body');
  const title  = document.getElementById('report-title');
  const groups = {};

  transactions.forEach(t => {
    const d   = new Date(t.date);
    const key = period === 'weekly'
      ? `Week ${getWeekNumber(d)}, ${d.getFullYear()}`
      : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = { revenue:0, cost:0, profit:0, items:0 };
    groups[key].revenue += t.total; groups[key].cost += t.totalCost;
    groups[key].profit  += t.profit; groups[key].items += t.qty;
  });

  title.textContent = period === 'weekly' ? 'Weekly Report' : 'Monthly Report';
  const entries = Object.entries(groups).reverse();
  if (!entries.length) { report.innerHTML = '<tr><td colspan="5" class="empty">No data yet.</td></tr>'; return; }

  report.innerHTML = entries.map(([p, d]) => `
    <tr>
      <td style="font-weight:600;">${esc(p)}</td>
      <td style="color:#1D9E75;font-weight:700;">${fmt(d.revenue)}</td>
      <td style="color:#D85A30;font-weight:700;">${fmt(d.cost)}</td>
      <td style="color:#7c6af7;font-weight:700;">${fmt(d.profit)}</td>
      <td>${d.items}</td>
    </tr>
  `).join('');
}

function getWeekNumber(d) {
  const date    = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum  = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function renderCategoryReport() {
  const catMap = {};
  transactions.forEach(t => {
    const category = getRecordCategory(t);
    if (!catMap[category]) catMap[category] = { revenue:0, cost:0, profit:0, items:0, products: new Set() };
    catMap[category].revenue += t.total; catMap[category].cost += t.totalCost;
    catMap[category].profit  += t.profit; catMap[category].items += t.qty;
    catMap[category].products.add(getRecordProductName(t));
  });

  const tbody        = document.getElementById('cat-report-body');
  const entries      = Object.entries(catMap).sort((a,b)=>b[1].profit-a[1].profit);
  if (!entries.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No sales data yet.</td></tr>'; return; }

  const totalRevenue = entries.reduce((sum,[,d])=>sum+d.revenue, 0);
  tbody.innerHTML = entries.map(([cat, d]) => {
    const share = totalRevenue > 0 ? ((d.revenue/totalRevenue)*100).toFixed(1) : 0;
    return `
      <tr>
        <td><span class="badge" style="background:rgba(124,106,247,0.12);color:#7c6af7;">${esc(cat)}</span></td>
        <td>${d.products.size} products</td>
        <td style="color:#1D9E75;font-weight:700;">${fmt(d.revenue)}</td>
        <td style="color:#D85A30;font-weight:700;">${fmt(d.cost)}</td>
        <td style="color:#7c6af7;font-weight:700;">${fmt(d.profit)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="flex:1;background:var(--card-border);border-radius:4px;height:6px;">
              <div style="width:${Number(share)}%;background:#1D9E75;border-radius:4px;height:6px;"></div>
            </div>
            <span style="font-size:12px;font-weight:600;color:var(--muted);min-width:36px;">${share}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderBreakEven() {
  const tbody = document.getElementById('breakeven-body');
  if (!products.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No products yet.</td></tr>'; return; }

  const today        = new Date().toISOString().split('T')[0];
  const todayRestock = restockHistory.filter(e => e.date === today);

  tbody.innerHTML = products.map(product => {
    const profitPerUnit = product.price - product.cost;
    const restockCost   = todayRestock.filter(e=>matchesProductRecord(e,product)).reduce((s,e)=>s+e.total,0);
    const unitsNeeded   = profitPerUnit > 0 ? Math.ceil(restockCost / profitPerUnit) : '—';
    const soldToday     = transactions.filter(tx=>tx.date===today&&matchesProductRecord(tx,product)).reduce((s,tx)=>s+tx.qty,0);

    const status = unitsNeeded === '—'
      ? '<span class="badge expense">No margin</span>'
      : soldToday >= unitsNeeded
      ? '<span class="badge income">✓ Break-even reached</span>'
      : `<span class="badge warning">${unitsNeeded - soldToday} more to go</span>`;

    return `
      <tr>
        <td style="font-weight:600;">${esc(product.name)}</td>
        <td>${fmt(product.price - product.cost)} per unit</td>
        <td>${fmt(restockCost)}</td>
        <td style="font-weight:700;">${unitsNeeded === '—' ? '—' : `${unitsNeeded} units`}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join('');

  const totalProfitToday  = transactions.filter(tx=>tx.date===today).reduce((s,tx)=>s+tx.profit,0);
  const totalRestockToday = todayRestock.reduce((s,e)=>s+e.total,0);
  const overallEl         = document.getElementById('breakeven-overall');
  if (!overallEl) return;

  if (totalRestockToday === 0) {
    overallEl.textContent = 'No restock costs today.';
    overallEl.style.color = 'var(--muted)';
  } else if (totalProfitToday >= totalRestockToday) {
    overallEl.textContent = `✓ Break-even reached — ${fmt(totalProfitToday - totalRestockToday)} surplus today`;
    overallEl.style.color = '#1D9E75';
  } else {
    overallEl.textContent = `Need ${fmt(totalRestockToday - totalProfitToday)} more profit to break even today`;
    overallEl.style.color = '#D85A30';
  }
}

// ============================================================================
// EXPORT & IMPORT
// ============================================================================

function exportCSV() {
  closeProfileMenu();
  const rows = [
    ['--- SALES TRANSACTIONS ---'],
    ['Date','Product','Qty','Unit Price','Total','Cost','Profit'],
    ...transactions.map(t=>[t.date,getRecordProductName(t),t.qty,t.price,t.total,t.totalCost,t.profit]),
    [],
    ['--- RESTOCK HISTORY ---'],
    ['Date','Product','Qty Added','Cost Per Unit','Total Paid'],
    ...restockHistory.map(r=>[r.date,getRecordProductName(r),r.qty,r.cost,r.total])
  ];
  // FIX #45: Quote CSV fields that contain commas or quotes to produce valid CSV
  const csvRows = rows.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  ).join('\n');
  const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `shop-tracker-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  closeProfileMenu();
  if (!hasPdfSupport()) { toast('PDF export unavailable right now.','error'); return; }

  const { jsPDF } = window.jspdf;
  const doc   = new jsPDF();
  const today = new Date().toISOString().split('T')[0];
  const green = [29,158,117];
  const dark  = [30,30,40];

  doc.setFillColor(...dark); doc.rect(0,0,210,30,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('Shop Tracker — Daily Report',14,18);
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(180,180,180);
  doc.text(`Generated: ${today}`,14,26);

  const totalRev    = transactions.reduce((s,t)=>s+t.total,0);
  const totalProfit = transactions.reduce((s,t)=>s+t.profit,0);
  const totalCost   = transactions.reduce((s,t)=>s+t.totalCost,0);

  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...dark); doc.text('Summary',14,42);
  doc.autoTable({
    startY:46,
    head:[['Total Revenue','Total Cost','Gross Profit','Items Sold']],
    body:[[fmt(totalRev),fmt(totalCost),fmt(totalProfit),transactions.reduce((s,t)=>s+t.qty,0)]],
    headStyles:{fillColor:green,textColor:255,fontStyle:'bold'},
    bodyStyles:{textColor:dark}, margin:{left:14,right:14}
  });

  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
  doc.text('Sales Transactions',14,doc.lastAutoTable.finalY+14);
  doc.autoTable({
    startY:doc.lastAutoTable.finalY+18,
    head:[['Date','Product','Qty','Unit Price','Total','Profit']],
    body:transactions.map(tx=>[tx.date,getRecordProductName(tx),tx.qty,fmt(tx.price),fmt(tx.total),fmt(tx.profit)]),
    headStyles:{fillColor:green,textColor:255,fontStyle:'bold'},
    bodyStyles:{textColor:dark},
    alternateRowStyles:{fillColor:[245,245,245]},
    margin:{left:14,right:14}
  });

  const todayDate = new Date();
  const deadList  = products.filter(p => {
    const ls = transactions.filter(tx=>matchesProductRecord(tx,p)).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
    if (!ls) return getCurrentStock(p) > 0;
    return Math.floor((todayDate-new Date(ls.date))/86400000) >= deadStockDays && getCurrentStock(p) > 0;
  });

  if (deadList.length) {
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...dark);
    doc.text('Dead Stock',14,doc.lastAutoTable.finalY+14);
    doc.autoTable({
      startY:doc.lastAutoTable.finalY+18,
      head:[['Product','Stock','Idle Value']],
      body:deadList.map(p=>[p.name,`${getCurrentStock(p)} units`,fmt(getCurrentStock(p)*p.cost)]),
      headStyles:{fillColor:[216,90,48],textColor:255,fontStyle:'bold'},
      bodyStyles:{textColor:dark}, margin:{left:14,right:14}
    });
  }

  doc.setFontSize(9); doc.setTextColor(150,150,150);
  doc.text('Generated by Shop Tracker',14,290);
  doc.save(`shop-report-${today}.pdf`);
}

function backupData() {
  closeProfileMenu();
  const data = {
    user: currentUser ? { id: currentUser.uid, name: currentUser.displayName, email: currentUser.email } : null,
    products, transactions, restockHistory, movementHistory, reviewedProducts,
    dailyGoal, currency, exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `shop-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup created');
}

function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;
  closeProfileMenu();

  // FIX #46: Enforce backup file size limit (10 MB) to prevent DoS via huge JSON
  if (file.size > 10 * 1024 * 1024) {
    toast('Backup file too large (max 10 MB).', 'error');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      // FIX #47: Basic shape validation before trusting the backup
      if (!data || typeof data !== 'object' || !Array.isArray(data.products)) {
        toast('Invalid backup file format.', 'error'); return;
      }
      if (!confirm('This will replace all current data. Are you sure?')) return;
      const snapshot = createDataSnapshot();
      applyDataSnapshot({
        products:         data.products         || [],
        transactions:     data.transactions     || [],
        restockHistory:   data.restockHistory   || [],
        movementHistory:  data.movementHistory  || [],
        reviewedProducts: data.reviewedProducts || [],
        dailyGoal:        parseFloat(data.dailyGoal) || 0,
        currency:         data.currency         || 'INR',
        skuCounter:       (data.products || []).length + 1
      });
      addMovementEntry('Restored','Inventory','Restored inventory data from backup file.');
      queueUndo('Backup restored.', snapshot);
    } catch { toast('Invalid backup file.', 'error'); }
    finally  { event.target.value = ''; }
  };
  reader.readAsText(file);
}

// ============================================================================
// THEME & UI
// ============================================================================

function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  safeLocalStorageSet('theme', isLight ? 'light' : 'dark');
  updateThemeButton();
  syncProfileMenuTheme();
}

function loadTheme() {
  // FIX #48: Only apply 'light' class — don't trust arbitrary stored class names
  if (safeLocalStorageGet('theme') === 'light') document.body.classList.add('light');
  syncProfileMenuTheme();
}

function updateThemeButton() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const isLight = document.body.classList.contains('light');
  btn.textContent = isLight ? '☾' : '✺';
  btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  btn.setAttribute('aria-label', btn.title);
}

function syncProfileMenuTheme() {
  const { themeMenuIcon, themeMenuLabel } = getAuthElements();
  const isLight = document.body.classList.contains('light');
  if (themeMenuIcon)  themeMenuIcon.textContent  = isLight ? '☾' : '✺';
  if (themeMenuLabel) themeMenuLabel.textContent = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  closeProfileMenu();
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================

function toast(message, type = 'success', action = null, duration = 2800) {
  const existing = document.getElementById('toast');
  if (existing) {
    existing.style.transform = 'translateY(-64px)';
    existing.style.opacity   = '0.4';
    setTimeout(() => existing.remove(), 200);
  }

  const icons  = { success:'✓', error:'✕', info:'i', warning:'⚠' };
  const labels = { success:'Success', error:'Action needed', info:'Heads up', warning:'Warning' };

  const t = document.createElement('div');
  t.id        = 'toast';
  t.className = `toast toast-${type}`;

  // FIX #49: Build toast via DOM — never innerHTML with message (user-controlled)
  const iconEl    = document.createElement('div');
  iconEl.className = 'toast-icon';
  iconEl.textContent = icons[type] || '✓';

  const copyEl    = document.createElement('div');
  copyEl.className = 'toast-copy';

  const labelEl   = document.createElement('div');
  labelEl.className = 'toast-label';
  labelEl.textContent = labels[type] || 'Notice';

  const msgEl     = document.createElement('div');
  msgEl.className = 'toast-message';
  msgEl.textContent = message; // textContent — safe

  copyEl.appendChild(labelEl);
  copyEl.appendChild(msgEl);
  t.appendChild(iconEl);
  t.appendChild(copyEl);

  if (action) {
    const actionBtn = document.createElement('button');
    actionBtn.type      = 'button';
    actionBtn.className = 'toast-action';
    actionBtn.textContent = action.label;
    t.appendChild(actionBtn);
    actionBtn.addEventListener('click', () => { clearTimeout(dismiss); t.remove(); action.onClick(); });
  }

  const progress = document.createElement('div');
  progress.className = 'toast-progress';
  progress.style.animationDuration = `${duration}ms`;
  t.appendChild(progress);

  document.body.appendChild(t);

  const dismiss = setTimeout(() => {
    t.classList.add('toast-exit');
    setTimeout(() => t.remove(), 320);
  }, duration);
}

// ============================================================================
// CONFIRMATION DIALOGS
// ============================================================================

function showConfirm(message, onYes) {
  const existing = document.getElementById('confirm-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirm-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9998;';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:28px 32px;max-width:400px;width:90%;text-align:center;';

  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:16px;font-weight:600;color:var(--text);margin-bottom:20px;';
  msg.textContent = message; // textContent — safe

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';

  const cancelBtn = document.createElement('button');
  cancelBtn.style.cssText = 'padding:10px 24px;border-radius:8px;border:1px solid var(--card-border);background:transparent;color:var(--muted);font-size:14px;font-weight:600;cursor:pointer;';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => overlay.remove();

  const yesBtn = document.createElement('button');
  yesBtn.id = 'confirm-yes';
  yesBtn.style.cssText = 'padding:10px 24px;border-radius:8px;border:none;background:#D85A30;color:#fff;font-size:14px;font-weight:600;cursor:pointer;';
  yesBtn.textContent = 'Yes, delete';
  yesBtn.onclick = () => { overlay.remove(); onYes(); };

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(yesBtn);
  box.appendChild(msg);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function clearAllData() {
  closeProfileMenu();
  showConfirm('Delete all data for this account? This cannot be undone.', async () => {
    if (!currentUser) return;
    const snapshot = createDataSnapshot();
    products=[]; transactions=[]; restockHistory=[]; movementHistory=[]; reviewedProducts=[];
    dailyGoal=0; currency='INR'; skuCounter=1;
    notificationSettings={enabled:false,lowStock:true,goal:true};
    await saveCurrentUserData(true);
    loadCurrency();
    render();
    queueUndo('All account data cleared.', snapshot, 'error');
  });
}

// ============================================================================
// INITIALIZATION & EVENT LISTENERS
// ============================================================================

window.addEventListener('load', () => {
  showLoadingScreen();
  loadFeaturePanels();
  loadViewMode();
  loadTheme();
  updateThemeButton();
  syncProfileMenuTheme();
  applyViewMode();
  fetchExchangeRates();
  initOfflineDetection();
  initAuth();

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _saveDebounceTimer) {
      saveCurrentUserData(true);
    }
  });
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeProfileMenu();
    const csvBackdrop = document.getElementById('csv-import-backdrop');
    if (csvBackdrop && csvBackdrop.style.display !== 'none') { closeCsvImport(); return; }
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal) { confirmModal.remove(); return; }
    const qsModal = document.getElementById('quick-sell-modal');
    if (qsModal && qsModal.style.display !== 'none') { closeQuickSell(); return; }
    if (activeViewMode !== 'home') { switchViewMode('home'); return; }
  }

  const qsModal = document.getElementById('quick-sell-modal');
  if (qsModal && qsModal.style.display !== 'none') {
    const isInput = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA';
    if (event.key === 'Enter') { confirmQuickSell(); return; }
    if (!isInput) {
      if (event.key >= '0' && event.key <= '9') { qsAdd(parseInt(event.key)); return; }
      if (event.key === 'Backspace') { qsBack(); return; }
    }
  }

  if (event.key === 'Enter') {
    const overlay = document.getElementById('auth-overlay');
    if (overlay && overlay.style.display !== 'none') { handleAuthAction(); return; }
  }

  const appShell = document.getElementById('app-shell');
  if (!appShell || appShell.classList.contains('app-shell-hidden')) return;
  if (!event.ctrlKey && !event.metaKey) return;

  switch(event.key.toLowerCase()) {
    case 'h': event.preventDefault(); switchViewMode('home');      break;
    case 'i': event.preventDefault(); switchViewMode('insights');  break;
    case 'r': event.preventDefault(); switchViewMode('reports');   break;
    case 'k': event.preventDefault(); switchViewMode('inventory'); break;
    case 't': event.preventDefault(); switchViewMode('timeline');  break;
    case 'e': event.preventDefault(); exportCSV();                 break;
  }
});

document.addEventListener('click', event => {
  const { profileMenu } = getAuthElements();
  if (event.target && event.target.id === 'quick-sell-modal') closeQuickSell();
  if (!profileMenu) return;
  if (!profileMenu.contains(event.target)) closeProfileMenu();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service worker registered'))
    .catch(err => console.log('SW error:', err));
}

// ============================================================================
// BULK CSV IMPORT MODULE
// ============================================================================

const CSV_FIELDS = [
  { key: 'name',        label: 'Product Name',   required: true  },
  { key: 'category',    label: 'Category',        required: false },
  { key: 'brand',       label: 'Brand',           required: false },
  { key: 'variant',     label: 'Variant / Size',  required: false },
  { key: 'sku',         label: 'SKU / Item ID',   required: false },
  { key: 'cost',        label: 'Cost Price',      required: true  },
  { key: 'price',       label: 'Selling Price',   required: true  },
  { key: 'stock',       label: 'Stock (units)',   required: true  },
  { key: 'minStock',    label: 'Min Stock Alert', required: false },
  { key: 'batchNumber', label: 'Batch Number',    required: false },
  { key: 'expiryDate',  label: 'Expiry Date',     required: false },
];

let csvState = {
  phase: 'upload', rawRows: [], headers: [], mapping: {}, parsed: [], fileLoaded: false,
};

function openCsvImport() {
  csvReset();
  const backdrop = document.getElementById('csv-import-backdrop');
  backdrop.style.display = 'flex';
  backdrop.classList.remove('closing');
  document.getElementById('csv-modal').classList.remove('closing');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('csv-paste-input')?.focus(), 120);
}

function closeCsvImport() {
  const backdrop = document.getElementById('csv-import-backdrop');
  const modal    = document.getElementById('csv-modal');
  backdrop.classList.add('closing');
  modal.classList.add('closing');
  document.body.style.overflow = '';
  setTimeout(() => {
    backdrop.style.display = 'none';
    backdrop.classList.remove('closing');
    modal.classList.remove('closing');
  }, 230);
}

document.addEventListener('click', e => {
  if (e.target && e.target.id === 'csv-import-backdrop') closeCsvImport();
});

function downloadCsvTemplate() {
  const header  = CSV_FIELDS.map(f => f.label).join(',');
  const example = [
    'Rice 5kg,Grains,Tata,5kg,SKU-001,80,120,50,10,LOT-001,2025-12-31',
    'Wheat Flour 1kg,Grains,Aashirvaad,1kg,,40,65,30,5,,',
    'Sunflower Oil 1L,Oils,Fortune,1L,,95,145,20,5,LOT-A,2026-06-30',
  ].join('\n');
  const blob = new Blob([header + '\n' + example], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: 'shop-tracker-template.csv' }).click();
  URL.revokeObjectURL(url);
}

function csvDragOver(e)  { e.preventDefault(); document.getElementById('csv-drop-zone').classList.add('drag-over'); }
function csvDragLeave(e) { document.getElementById('csv-drop-zone').classList.remove('drag-over'); }
function csvDrop(e) {
  e.preventDefault();
  document.getElementById('csv-drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) csvReadFile(file);
}
function csvFileSelected(e) { const f = e.target.files[0]; if (f) csvReadFile(f); e.target.value = ''; }

function csvReadFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
    toast('Please upload a .csv file', 'error'); return;
  }
  // FIX #50: Enforce max CSV size (5 MB) to prevent tab freeze
  if (file.size > 5 * 1024 * 1024) {
    toast('CSV file must be under 5 MB.', 'error'); return;
  }
  const reader = new FileReader();
  reader.onload  = ev => csvLoadRawText(ev.target.result);
  reader.onerror = ()  => toast('Failed to read CSV file.', 'error');
  reader.readAsText(file);
}

function csvPasteChanged() {
  const val = document.getElementById('csv-paste-input').value.trim();
  if (val.length > 10) {
    clearTimeout(csvState._pasteTimer);
    // FIX #51: Enforce max paste size to prevent DoS
    if (val.length > 500_000) {
      toast('Pasted data is too large. Please use a file upload instead.', 'warning');
      return;
    }
    csvState._pasteTimer = setTimeout(() => csvLoadRawText(val), 380);
  } else {
    csvState.fileLoaded = false;
    csvSetNextEnabled(false);
    document.getElementById('csv-footer-info').textContent = 'Upload a CSV file or paste data above to get started.';
  }
}

function csvParseText(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows  = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = []; let field = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i], next = line[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field.trim()); field = ''; }
        else field += ch;
      }
    }
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function csvLoadRawText(text) {
  const rows = csvParseText(text);
  if (rows.length < 2) { toast('CSV needs at least a header row and one data row', 'error'); return; }
  // FIX #52: Cap rows to prevent the UI from freezing on huge files
  const MAX_ROWS = 2000;
  const trimmed  = rows.slice(0, MAX_ROWS + 1);
  const wasTrimmed = rows.length > MAX_ROWS + 1;
  csvState.rawRows = trimmed; csvState.headers = trimmed[0]; csvState.fileLoaded = true;
  csvState.mapping = autoDetectMapping(csvState.headers);
  const dataCount  = trimmed.length - 1;
  document.getElementById('csv-footer-info').innerHTML =
    `<strong>${dataCount} row${dataCount !== 1 ? 's' : ''}</strong> detected${wasTrimmed ? ` (first ${MAX_ROWS} rows only)` : ''} — review column mapping below.`;
  csvSetPhase('map'); csvBuildMapper(); csvSetNextEnabled(true);
}

function autoDetectMapping(headers) {
  const aliases = {
    name:        ['name','product','product name','item','item name','title'],
    category:    ['category','cat','type','department','group'],
    brand:       ['brand','manufacturer','make','company','mfr'],
    variant:     ['variant','size','weight','unit','pack size','variation'],
    sku:         ['sku','item id','item code','code','barcode','upc','id'],
    cost:        ['cost','cost price','purchase price','buy price','cp','buying price'],
    price:       ['price','selling price','sell price','mrp','sale price','retail price','sp'],
    stock:       ['stock','qty','quantity','units','inventory','on hand','available'],
    minStock:    ['min stock','minimum stock','reorder point','reorder level','min qty','alert'],
    batchNumber: ['batch','batch number','lot','lot number','batch no'],
    expiryDate:  ['expiry','expiry date','exp date','expiration','best before','use by','exp'],
  };
  const mapping = {};
  CSV_FIELDS.forEach(f => { mapping[f.key] = -1; });
  headers.forEach((h, idx) => {
    const n = h.toLowerCase().trim();
    for (const [key, list] of Object.entries(aliases)) {
      if (mapping[key] !== -1) continue;
      if (list.some(a => n.includes(a) || a.includes(n))) { mapping[key] = idx; break; }
    }
  });
  return mapping;
}

function csvBuildMapper() {
  const grid = document.getElementById('csv-mapper-grid');
  grid.innerHTML = '';
  const headerOptions = csvState.headers.map((h,i) => `<option value="${i}">${esc(h) || `Column ${i+1}`}</option>`).join('');
  CSV_FIELDS.forEach(field => {
    grid.insertAdjacentHTML('beforeend', `
      <div class="csv-mapper-col-label">
        <span class="${field.required ? 'csv-required-dot' : 'csv-optional-dot'}"></span>
        ${esc(field.label)}${field.required ? ' *' : ''}
      </div>
      <div class="csv-mapper-arrow">→</div>
      <select class="csv-mapper-select" data-field="${esc(field.key)}"
        onchange="csvUpdateMapping('${esc(field.key)}', parseInt(this.value))"
        aria-label="Map ${esc(field.label)}">
        <option value="-1">— Skip —</option>${headerOptions}
      </select>
    `);
    const sel = grid.querySelector(`select[data-field="${field.key}"]`);
    if (sel) sel.value = csvState.mapping[field.key] ?? -1;
  });
}

function csvUpdateMapping(key, idx) {
  csvState.mapping[key] = idx;
  if (csvState.phase === 'preview') csvBuildPreview();
}

const REQUIRED_FIELDS = CSV_FIELDS.filter(f => f.required).map(f => f.key);

function csvValidateMapping() {
  return REQUIRED_FIELDS.filter(k => (csvState.mapping[k] ?? -1) === -1);
}

function csvParseAndValidateRows() {
  const results = [];
  csvState.rawRows.slice(1).forEach((row, rowIdx) => {
    const errors = [], warnings = [], data = {};
    CSV_FIELDS.forEach(field => {
      const colIdx = csvState.mapping[field.key] ?? -1;
      const raw = colIdx >= 0 ? (row[colIdx] || '').trim() : '';
      if (field.key === 'name') {
        data.name = raw.slice(0, 200);
        if (!raw) errors.push(`Row ${rowIdx+2}: Product name is required`);
      } else if (field.key === 'cost') {
        data.cost = parseFloat(raw);
        if (!raw) errors.push(`Row ${rowIdx+2}: Cost price is required`);
        else if (isNaN(data.cost) || data.cost <= 0) errors.push(`Row ${rowIdx+2}: Cost must be a positive number`);
        else if (data.cost > 10_000_000) errors.push(`Row ${rowIdx+2}: Cost price is unrealistically large`);
      } else if (field.key === 'price') {
        data.price = parseFloat(raw);
        if (!raw) errors.push(`Row ${rowIdx+2}: Selling price is required`);
        else if (isNaN(data.price) || data.price <= 0) errors.push(`Row ${rowIdx+2}: Price must be a positive number`);
        else if (data.price > 10_000_000) errors.push(`Row ${rowIdx+2}: Selling price is unrealistically large`);
      } else if (field.key === 'stock') {
        data.stock = parseInt(raw);
        if (!raw) errors.push(`Row ${rowIdx+2}: Stock quantity is required`);
        else if (isNaN(data.stock) || data.stock < 0) errors.push(`Row ${rowIdx+2}: Stock must be non-negative`);
        else if (data.stock > 1_000_000) errors.push(`Row ${rowIdx+2}: Stock quantity is unrealistically large`);
      } else if (field.key === 'minStock') {
        data.minStock = raw ? parseInt(raw) : 5;
        if (raw && isNaN(data.minStock)) warnings.push(`Row ${rowIdx+2}: Min stock ignored, defaulting to 5`);
      } else if (field.key === 'expiryDate') {
        data.expiryDate = raw || '';
        if (raw && isNaN(new Date(raw).getTime())) warnings.push(`Row ${rowIdx+2}: Expiry date "${raw}" could not be parsed`);
      } else {
        data[field.key] = raw.slice(0, 200) || ''; // FIX #53: Cap field lengths in CSV import
      }
    });
    if (!isNaN(data.cost) && !isNaN(data.price) && data.cost > 0 && data.price > 0 && data.cost >= data.price)
      errors.push(`Row ${rowIdx+2}: Cost must be less than selling price`);
    data.category    = (data.category    || 'Uncategorized').slice(0, 100);
    data.brand       = (data.brand       || '—').slice(0, 100);
    data.variant     = (data.variant     || '—').slice(0, 100);
    data.batchNumber = (data.batchNumber || '').slice(0, 100);
    if (!data.minStock || isNaN(data.minStock)) data.minStock = 5;
    results.push({ data, errors, warnings, rowIdx });
  });
  csvState.parsed = results;
  return results;
}

function csvBuildPreview() {
  const results   = csvParseAndValidateRows();
  const okCount   = results.filter(r => !r.errors.length).length;
  const warnCount = results.filter(r => r.warnings.length).length;
  const errCount  = results.filter(r => r.errors.length).length;
  const allErrors = results.flatMap(r => r.errors);

  document.getElementById('csv-validation-bar').innerHTML = `
    <span class="csv-val-chip ok">✓ ${okCount} valid</span>
    ${warnCount ? `<span class="csv-val-chip warn">⚠ ${warnCount} warnings</span>` : ''}
    ${errCount  ? `<span class="csv-val-chip err">✕ ${errCount} errors</span>`  : ''}
    <span class="csv-val-detail">${results.length} total rows</span>
  `;
  const errorList = document.getElementById('csv-error-list');
  errorList.style.display = allErrors.length ? 'flex' : 'none';
  // FIX #54: esc() error messages (they contain row-level data)
  errorList.innerHTML = allErrors.map(e => `<div class="csv-error-item">${esc(e)}</div>`).join('');

  const mappedFields = CSV_FIELDS.filter(f => (csvState.mapping[f.key] ?? -1) >= 0);
  document.getElementById('csv-preview-thead').innerHTML =
    `<tr>${mappedFields.map(f=>`<th>${esc(f.label)}</th>`).join('')}<th>Status</th></tr>`;
  document.getElementById('csv-preview-tbody').innerHTML = results.map(r => {
    const cls = r.errors.length ? 'csv-row-err' : r.warnings.length ? 'csv-row-warn' : 'csv-row-ok';
    const status = r.errors.length
      ? `<span style="color:#D85A30;font-size:11px;font-weight:700;">✕ Error</span>`
      : r.warnings.length
      ? `<span style="color:#eab308;font-size:11px;font-weight:700;">⚠ Warning</span>`
      : `<span style="color:#1D9E75;font-size:11px;font-weight:700;">✓ OK</span>`;
    return `<tr class="${cls}">${mappedFields.map(f=>`<td>${esc(String(r.data[f.key]??''))}</td>`).join('')}<td>${status}</td></tr>`;
  }).join('');

  const nextBtn = document.getElementById('csv-next-btn');
  nextBtn.textContent = `Import ${okCount} Product${okCount !== 1 ? 's' : ''} →`;
  nextBtn.disabled    = okCount === 0;
  document.getElementById('csv-footer-info').innerHTML =
    `<strong>${okCount}</strong> product${okCount!==1?'s':''} ready to import` +
    (errCount ? ` — <span style="color:#D85A30;">${errCount} row${errCount!==1?'s':''} will be skipped</span>` : '');
}

function csvSetPhase(phase) {
  csvState.phase = phase;
  const pUpload  = document.getElementById('csv-phase-upload');
  const pMap     = document.getElementById('csv-phase-map');
  const pPreview = document.getElementById('csv-phase-preview');

  if (pUpload)  { pUpload.style.display  = phase === 'upload'  ? 'flex' : 'none'; pUpload.style.flexDirection  = 'column'; pUpload.style.gap  = '16px'; }
  if (pMap)     { pMap.style.display     = phase === 'map'     ? 'block' : 'none'; }
  if (pPreview) { pPreview.style.display = phase === 'preview' ? 'flex' : 'none'; pPreview.style.flexDirection = 'column'; pPreview.style.gap = '14px'; }

  const phaseIdx = { upload:0, map:1, preview:2, done:3 }[phase] ?? 0;
  ['csv-step-1','csv-step-2','csv-step-3','csv-step-4'].forEach((id,i) => {
    const el = document.getElementById(id); if (!el) return;
    el.classList.toggle('active', i === phaseIdx);
    el.classList.toggle('done',   i < phaseIdx);
  });
  const nextBtn = document.getElementById('csv-next-btn');
  if (phase === 'upload') { nextBtn.textContent = 'Next →';    nextBtn.disabled = !csvState.fileLoaded; }
  if (phase === 'map')    { nextBtn.textContent = 'Preview →'; nextBtn.disabled = false; }
}

function csvNextStep() {
  if (csvState.phase === 'upload') {
    if (!csvState.fileLoaded) { toast('Upload or paste CSV data first', 'error'); return; }
    csvSetPhase('map');
  } else if (csvState.phase === 'map') {
    const missing = csvValidateMapping();
    if (missing.length) { toast(`Map required fields: ${missing.join(', ')}`, 'error'); return; }
    csvBuildPreview(); csvSetPhase('preview');
  } else if (csvState.phase === 'preview') {
    csvDoImport();
  }
}

function csvDoImport() {
  const validRows = csvState.parsed.filter(r => !r.errors.length);
  if (!validRows.length) { toast('No valid rows to import', 'error'); return; }
  const snapshot = createDataSnapshot();
  let imported   = 0;
  validRows.forEach(({ data }) => {
    // FIX #55: Don't trust auto-generated SKUs from import to be collision-free — re-check
    let sku = (data.sku || '').slice(0, 50);
    if (!sku) {
      sku = `SKU-${String(skuCounter).padStart(3,'0')}`;
      while (products.some(p => p.sku === sku)) {
        skuCounter++;
        sku = `SKU-${String(skuCounter).padStart(3,'0')}`;
      }
    }
    // Silently skip duplicate names to maintain the duplicate-name invariant
    if (products.some(p => p.name.toLowerCase() === data.name.toLowerCase())) return;
    products.push({
      id: nextProdId++, sku,
      name: data.name, brand: data.brand||'—', variant: data.variant||'—',
      category: data.category||'Uncategorized', cost: data.cost, price: data.price,
      stock: data.stock, minStock: data.minStock||5,
      batchNumber: data.batchNumber||'', expiryDate: data.expiryDate||'',
    });
    skuCounter++; imported++;
  });
  if (imported === 0) { toast('All rows were duplicates — nothing imported.', 'warning'); return; }
  saveCurrentUserData();
  addMovementEntry('Bulk Import', 'Inventory', `Imported ${imported} product${imported!==1?'s':''} via CSV.`);
  render();
  queueUndo(`${imported} product${imported!==1?'s':''} imported.`, snapshot);
  showCsvSuccess(imported);
}

function showCsvSuccess(count) {
  const bodyEl = document.getElementById('csv-modal-body');
  if (bodyEl) {
    // FIX #56: Build success screen via DOM
    bodyEl.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'csv-success-screen';
    const icon  = document.createElement('div');
    icon.className = 'csv-success-icon';
    icon.textContent = '✓';
    const title = document.createElement('div');
    title.className = 'csv-success-title';
    title.textContent = `${count} Product${count!==1?'s':''} Imported!`;
    const sub   = document.createElement('div');
    sub.className = 'csv-success-sub';
    sub.textContent = 'Your inventory has been updated.';
    screen.appendChild(icon); screen.appendChild(title); screen.appendChild(sub);
    bodyEl.appendChild(screen);
  }
  document.getElementById('csv-modal-footer').innerHTML = `
    <div class="csv-footer-info"><strong>${count} product${count!==1?'s':''}</strong> added.</div>
    <div class="csv-footer-actions">
      <button class="csv-btn-secondary" onclick="csvReset()">Import More</button>
      <button class="csv-btn-primary" onclick="closeCsvImport()">Done ✓</button>
    </div>`;
  ['csv-step-1','csv-step-2','csv-step-3','csv-step-4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.classList.add('done'); }
  });
}

function csvSetNextEnabled(e) { const b = document.getElementById('csv-next-btn'); if (b) b.disabled = !e; }

function csvReset() {
  csvState = { phase:'upload', rawRows:[], headers:[], mapping:{}, parsed:[], fileLoaded:false };
  const body = document.getElementById('csv-modal-body');
  if (body && !document.getElementById('csv-phase-upload')) {
    body.innerHTML = `
      <div class="csv-steps" id="csv-steps">
        <div class="csv-step active" id="csv-step-1"><div class="csv-step-dot">1</div><span>Upload</span></div>
        <div class="csv-step-line"></div>
        <div class="csv-step" id="csv-step-2"><div class="csv-step-dot">2</div><span>Map</span></div>
        <div class="csv-step-line"></div>
        <div class="csv-step" id="csv-step-3"><div class="csv-step-dot">3</div><span>Review</span></div>
        <div class="csv-step-line"></div>
        <div class="csv-step" id="csv-step-4"><div class="csv-step-dot">4</div><span>Import</span></div>
      </div>
      <div id="csv-phase-upload" style="display:flex;flex-direction:column;gap:16px;">
        <div class="csv-template-strip">
          <div><strong>New to this?</strong> Download our template to get started.</div>
          <button class="csv-dl-btn" onclick="downloadCsvTemplate()">⬇ Template</button>
        </div>
        <div class="csv-drop-zone" id="csv-drop-zone"
          onclick="document.getElementById('csv-file-input').click()"
          ondragover="csvDragOver(event)" ondragleave="csvDragLeave(event)" ondrop="csvDrop(event)"
          role="button" tabindex="0" aria-label="Drop CSV file here">
          <span class="csv-drop-icon">📂</span>
          <div class="csv-drop-title">Drop your CSV file here</div>
          <div class="csv-drop-sub">Drag &amp; drop a <strong>.csv</strong> file, or click to browse.</div>
          <button class="csv-file-btn" type="button" onclick="event.stopPropagation();document.getElementById('csv-file-input').click()">📁 Browse File</button>
          <input type="file" id="csv-file-input" accept=".csv,text/csv" style="display:none;" onchange="csvFileSelected(event)" />
        </div>
        <div class="csv-paste-area">
          <div class="csv-paste-label"><span></span>Or paste CSV data directly</div>
          <textarea class="csv-paste-input" id="csv-paste-input"
            placeholder="Name,Category,Brand,CostPrice,SellingPrice,Stock,MinStock"
            spellcheck="false" oninput="csvPasteChanged()" aria-label="Paste CSV data"></textarea>
        </div>
      </div>
      <div id="csv-phase-map" style="display:none;">
        <div class="csv-mapper">
          <div class="csv-mapper-header"><span>🔗</span> Map your columns to product fields</div>
          <div class="csv-mapper-grid" id="csv-mapper-grid"></div>
        </div>
      </div>
      <div id="csv-phase-preview" style="display:none;">
        <div class="csv-validation-bar" id="csv-validation-bar"></div>
        <div class="csv-error-list" id="csv-error-list" style="display:none;"></div>
        <div class="csv-preview-wrap">
          <table class="csv-preview-table">
            <thead id="csv-preview-thead"></thead>
            <tbody id="csv-preview-tbody"></tbody>
          </table>
        </div>
      </div>`;
  }
  const footer = document.getElementById('csv-modal-footer');
  if (footer) footer.innerHTML = `
    <div class="csv-footer-info" id="csv-footer-info">Upload a CSV file or paste data above to get started.</div>
    <div class="csv-footer-actions">
      <button class="csv-btn-secondary" onclick="csvReset()">Reset</button>
      <button class="csv-btn-primary" id="csv-next-btn" onclick="csvNextStep()" disabled>Next →</button>
    </div>`;
  csvSetPhase('upload');
}