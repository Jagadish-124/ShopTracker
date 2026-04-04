import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
const firebaseConfig = {
  apiKey: "AIzaSyBoJB8XfdS2hIJdBFiIa1jD-ohSGKVewsA",
  authDomain: "shop-tracker-7b6fd.firebaseapp.com",
  projectId: "shop-tracker-7b6fd",
  storageBucket: "shop-tracker-7b6fd.firebasestorage.app",
  messagingSenderId: "250701408991",
  appId: "1:250701408991:web:bf664d5879eb528da4976a",
  measurementId: "G-DJ8165SBRH"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const USERS_KEY = 'shopUsers';
const CURRENT_USER_KEY = 'currentUserId';

let currency = 'INR';
let baseCurrency = 'INR';
let exchangeRates = JSON.parse(localStorage.getItem('exchangeRates')) || null;
let ratesUpdatedAt = localStorage.getItem('ratesUpdatedAt') || null;
let products = [];
let transactions = [];
let searchQuery = '';
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
let pendingUndoTimer = null;
let notificationSettings = { enabled: false, lowStock: true, goal: true };

const VIEW_MODE_KEY = 'activeViewMode';

// Valid view modes:
//   'home'      – default dashboard
//   'inventory' – Stock Watch only
//   'insights'  – Analytics Dashboard only
//   'reports'   – Reports Lab only
//   'timeline'  – Inventory Timeline only
let activeViewMode = 'home';

// ── Legacy panel state (kept so old localStorage keys don't break anything) ──
const FEATURE_PANEL_KEY = 'featurePanels';
const featurePanelDefaults = { analytics: false, stock: false, timeline: false, reports: false };
let featurePanels = { ...featurePanelDefaults };

// ============================================================================
// AUTHENTICATION & USER MANAGEMENT
// ============================================================================

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const encoded = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return bufferToHex(digest);
}

function getUsers() {
  return JSON.parse(localStorage.getItem(USERS_KEY)) || [];
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function getCurrentUserId() {
  return sessionStorage.getItem(CURRENT_USER_KEY) || null;
}

function setCurrentUserId(userId) {
  if (userId) {
    sessionStorage.setItem(CURRENT_USER_KEY, userId);
  } else {
    sessionStorage.removeItem(CURRENT_USER_KEY);
  }
}

function isAuthenticated() {
  return sessionStorage.getItem('isAuthenticated') === 'true' && !!getCurrentUserId();
}

function getUserStorageKey(userId, key) {
  return `user:${userId}:${key}`;
}

function getUserValue(userId, key, fallback) {
  const raw = localStorage.getItem(getUserStorageKey(userId, key));
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return raw; }
}

function setUserValue(userId, key, value) {
  localStorage.setItem(getUserStorageKey(userId, key), JSON.stringify(value));
}

function removeUserValue(userId, key) {
  localStorage.removeItem(getUserStorageKey(userId, key));
}

function migrateLegacyDataToUser(userId) {
  const hasLegacyData = ['products', 'transactions', 'restockHistory', 'reviewed', 'currency', 'skuCounter', 'dailyGoal']
    .some(key => localStorage.getItem(key) !== null);
  if (!hasLegacyData) return;
  if (localStorage.getItem(getUserStorageKey(userId, 'products')) !== null) return;

  setUserValue(userId, 'products',       JSON.parse(localStorage.getItem('products'))       || []);
  setUserValue(userId, 'transactions',   JSON.parse(localStorage.getItem('transactions'))   || []);
  setUserValue(userId, 'restockHistory', JSON.parse(localStorage.getItem('restockHistory')) || []);
  setUserValue(userId, 'reviewed',       JSON.parse(localStorage.getItem('reviewed'))       || []);
  setUserValue(userId, 'currency',       localStorage.getItem('currency')                   || 'INR');
  setUserValue(userId, 'skuCounter',     parseInt(localStorage.getItem('skuCounter'))       || 1);
  setUserValue(userId, 'dailyGoal',      parseFloat(localStorage.getItem('dailyGoal'))      || 0);
  setUserValue(userId, 'movementHistory', []);
  setUserValue(userId, 'notificationSettings', { enabled: false, lowStock: true, goal: true });
}

function loadCurrentUserData() {
  if (!currentUser) return;
  migrateLegacyDataToUser(currentUser.id);

  products             = getUserValue(currentUser.id, 'products',             []);
  transactions         = getUserValue(currentUser.id, 'transactions',         []);
  restockHistory       = getUserValue(currentUser.id, 'restockHistory',       []);
  movementHistory      = getUserValue(currentUser.id, 'movementHistory',      []);
  reviewedProducts     = getUserValue(currentUser.id, 'reviewed',             []);
  currency             = getUserValue(currentUser.id, 'currency',             'INR');
  skuCounter           = parseInt(getUserValue(currentUser.id, 'skuCounter',  1)) || 1;
  dailyGoal            = parseFloat(getUserValue(currentUser.id, 'dailyGoal', 0)) || 0;
  notificationSettings = getUserValue(currentUser.id, 'notificationSettings', { enabled: false, lowStock: true, goal: true });

  hydrateProductLinks();
  nextProdId = Math.max(Date.now(), ...products.map(p => Number(p.id) || 0)) + 1;

  const currencySelect = document.getElementById('currency-select');
  if (currencySelect) currencySelect.value = currency;
}

function saveCurrentUserData() {
  if (!currentUser) return;
  setUserValue(currentUser.id, 'products',             products);
  setUserValue(currentUser.id, 'transactions',         transactions);
  setUserValue(currentUser.id, 'restockHistory',       restockHistory);
  setUserValue(currentUser.id, 'movementHistory',      movementHistory);
  setUserValue(currentUser.id, 'reviewed',             reviewedProducts);
  setUserValue(currentUser.id, 'currency',             currency);
  setUserValue(currentUser.id, 'skuCounter',           skuCounter);
  setUserValue(currentUser.id, 'dailyGoal',            dailyGoal);
  setUserValue(currentUser.id, 'notificationSettings', notificationSettings);
}

// ============================================================================
// VIEW MANAGEMENT  (rewritten for exclusive per-view display)
// ============================================================================

/**
 * All sections carry  data-view="<mode>"  in the HTML.
 * applyViewMode() shows only the sections matching activeViewMode,
 * hides everything else, and keeps the nav buttons in sync.
 */
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
  const saved = localStorage.getItem(VIEW_MODE_KEY);
  activeViewMode = saved || 'home';
}

function saveViewMode() {
  localStorage.setItem(VIEW_MODE_KEY, activeViewMode);
}

/**
 * Switch to a view mode.
 * Each mode is exclusive — no other sections are visible.
 *
 *  'home'      → goal, summary, insights grid, product form/table, transactions
 *  'insights'  → Analytics Dashboard only
 *  'inventory' → Stock Watch (dead stock + restock history) only
 *  'reports'   → Reports Lab only
 *  'timeline'  → Inventory Timeline only
 */
function switchViewMode(mode) {
  document.body.classList.remove('stock-only');
  activeViewMode = mode;
  saveViewMode();
  applyViewMode();

  // Destroy charts when leaving analytics to avoid canvas reuse errors
  if (mode !== 'insights') {
    destroyCharts();
  }

  // Trigger renders for the newly visible view
  if (mode === 'insights') {
    renderDashboard();
  } else if (mode === 'inventory') {
    renderDeadStock();
    renderRestockHistory();
  } else if (mode === 'timeline') {
    renderMovementHistory();
  } else if (mode === 'reports') {
    renderBreakEven();
    renderCategoryReport();
    renderDateStats();
  }
}

function destroyCharts() {
  if (barChart)      { barChart.destroy();      barChart      = null; }
  if (doughnutChart) { doughnutChart.destroy(); doughnutChart = null; }
}

// ── Legacy feature-panel helpers (kept for any residual calls) ──────────────

function loadFeaturePanels() {
  try {
    const saved = JSON.parse(localStorage.getItem(FEATURE_PANEL_KEY));
    featurePanels = { ...featurePanelDefaults, ...(saved || {}) };
  } catch {
    featurePanels = { ...featurePanelDefaults };
  }
}

function saveFeaturePanels() {
  localStorage.setItem(FEATURE_PANEL_KEY, JSON.stringify(featurePanels));
}

// applyFeaturePanels() is no longer the driver — applyViewMode() is.
// Kept as a no-op so any lingering callers don't throw.
function applyFeaturePanels() { /* superseded by applyViewMode */ }

function closeActiveFeaturePanel() {
  switchViewMode('home');
}

// toggleFeaturePanel() previously toggled panels independently.
// Now each "feature" maps to its own exclusive view mode.
function toggleFeaturePanel(panel) {
  const modeMap = {
    analytics: 'insights',
    stock:     'inventory',
    timeline:  'timeline',
    reports:   'reports'
  };
  const target = modeMap[panel];
  if (!target) return;
  // If already in that view, go back home; otherwise switch to it
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

function getRecordProductId(record) { return record?.productId ?? null; }

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
    message:         document.getElementById('auth-message'),
    profileMenu:     document.getElementById('header-profile-menu'),
    profileChip:     document.getElementById('header-profile-chip'),
    profileDropdown: document.getElementById('header-profile-dropdown'),
    userBadge:       document.getElementById('header-current-user-badge'),
    themeMenuIcon:   document.getElementById('header-theme-menu-icon'),
    themeMenuLabel:  document.getElementById('header-theme-menu-label')
  };
}

function setAuthMessage(message, type = 'info') {
  const { message: el } = getAuthElements();
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${type}`;
}

function updateAuthMode(mode) {
  authMode = mode;
  const { title, subtitle, nameGroup, confirmGroup, submit, switchBtn, name, email, password, confirm, message } = getAuthElements();
  if (!title) return;

  const signupMode = mode === 'signup';
  title.textContent    = signupMode ? 'Create your account' : 'Log in to Shop Tracker';
  subtitle.textContent = signupMode
    ? 'Create an account to keep products, sales, and goals separate for each user.'
    : 'Sign in to open your own inventory and sales dashboard.';

  nameGroup.style.display    = signupMode ? 'block' : 'none';
  confirmGroup.style.display = signupMode ? 'block' : 'none';
  submit.textContent         = signupMode ? 'Sign Up' : 'Log In';
  switchBtn.style.display    = 'inline-flex';
  switchBtn.textContent      = signupMode ? 'Already have an account?' : 'Need to create an account?';

  name.value = ''; email.value = ''; password.value = ''; confirm.value = ''; message.textContent = '';
  (signupMode ? name : email).focus();
}

function updateAuthUI() {
  const { overlay, shell, profileMenu, profileChip, profileDropdown, userBadge } = getAuthElements();
  const authed = isAuthenticated();

  if (overlay)         overlay.style.display = authed ? 'none' : 'flex';
  if (shell)           shell.classList.toggle('app-shell-hidden', !authed);
  if (profileMenu)     profileMenu.style.display = authed && currentUser ? 'inline-flex' : 'none';
  if (userBadge)       userBadge.textContent = currentUser ? currentUser.name || currentUser.email : '';
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

function switchAuthMode() {
  updateAuthMode(authMode === 'signup' ? 'login' : 'signup');
}

function completeLogin(user) {
  currentUser = user;
  setCurrentUserId(user.id);
  sessionStorage.setItem('isAuthenticated', 'true');
  loadCurrentUserData();
  loadCurrency();
  render();
  renderDashboard();
  renderDateStats();
  updateAuthUI();
}

async function handleAuthAction() {
  const { name, email, password, confirm } = getAuthElements();
  const displayName = name.value.trim();
  const userEmail   = normalizeEmail(email.value);
  const pwd         = password.value.trim();

  if (!userEmail) { setAuthMessage('Enter a valid email address.', 'error'); return; }
  if (pwd.length < 4) { setAuthMessage('Use at least 4 characters for the password.', 'error'); return; }

  if (authMode === 'signup') {
    if (!displayName) { setAuthMessage('Enter your name to create the account.', 'error'); return; }
    if (pwd !== confirm.value.trim()) { setAuthMessage('Passwords do not match.', 'error'); return; }

    const users = getUsers();
    if (users.some(u => u.email === userEmail)) { setAuthMessage('That email is already registered. Log in instead.', 'error'); return; }

    const salt         = generateSalt();
    const passwordHash = await hashPassword(pwd, salt);
    const user = { id: `user-${Date.now()}`, name: displayName, email: userEmail, salt, passwordHash, createdAt: new Date().toISOString() };
    users.push(user);
    saveUsers(users);
    completeLogin(user);
    toast(`Welcome, ${user.name}`);
    return;
  }

  const users = getUsers();
  const user  = users.find(u => u.email === userEmail);
  if (!user) { setAuthMessage('No account found for that email.', 'error'); return; }

  const passwordHash = await hashPassword(pwd, user.salt);
  if (passwordHash !== user.passwordHash) { setAuthMessage('Incorrect password. Try again.', 'error'); return; }

  completeLogin(user);
  setAuthMessage('');
  toast(`Welcome back, ${user.name}`);
}

function logout() {
  closeProfileMenu();
  sessionStorage.removeItem('isAuthenticated');
  setCurrentUserId(null);
  currentUser      = null;
  products         = [];
  transactions     = [];
  restockHistory   = [];
  reviewedProducts = [];
  dailyGoal        = 0;
  currency         = 'INR';
  skuCounter       = 1;
  updateAuthMode(getUsers().length ? 'login' : 'signup');
  updateAuthUI();
}

function initAuth() {
  const userId = getCurrentUserId();
  currentUser  = getUsers().find(u => u.id === userId) || null;
  if (isAuthenticated() && currentUser) loadCurrentUserData();
  updateAuthMode(getUsers().length ? 'login' : 'signup');
  updateAuthUI();
}

// ============================================================================
// CURRENCY & EXCHANGE RATES
// ============================================================================

function fmt(amount) {
  const symbols = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
  const converted = convertAmount(amount);
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
    updateRatesBadge('Rates cached');
    return;
  }

  updateRatesBadge('Fetching rates…');
  try {
    const res  = await fetch('https://v6.exchangerate-api.com/v6/c4700f47c7f6f17c24b3d4f6/latest/USD');
    const data = await res.json();
    if (data.result === 'success') {
      exchangeRates  = data.conversion_rates;
      ratesUpdatedAt = Date.now().toString();
      localStorage.setItem('exchangeRates', JSON.stringify(exchangeRates));
      localStorage.setItem('ratesUpdatedAt', ratesUpdatedAt);
      updateRatesBadge('Rates updated');
      render();
      toast('✓ Live exchange rates loaded');
    } else {
      updateRatesBadge('Rates unavailable');
      toast('Could not fetch rates', 'error');
    }
  } catch {
    updateRatesBadge('Offline — cached rates');
    toast('Using cached rates', 'info');
  }
}

function updateRatesBadge(text) {
  const el = document.getElementById('rates-badge');
  if (el) el.textContent = text;
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
  // Re-render analytics only if that view is currently active
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
  list.innerHTML = expiringItems.map(p => `
    <span class="restock-tag expiry-tag">
      ${p.name} — ${p.daysToExpiry === 0 ? 'Expires today' : `${p.daysToExpiry} day${p.daysToExpiry === 1 ? '' : 's'} left`}
    </span>
  `).join('');
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

  tbody.innerHTML = movementHistory.map(entry => `
    <tr>
      <td>${new Date(entry.date).toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td style="font-weight:600;">${entry.product}</td>
      <td><span class="badge" style="background:rgba(55,138,221,0.12);color:#378add;">${entry.type}</span></td>
      <td style="color:var(--muted);">${entry.details}</td>
    </tr>
  `).join('');
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

async function sendBrowserNotification(title, body, tag) {
  if (!notificationSettings.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) { reg.showNotification(title, { body, tag, icon: './icon-192.png', badge: './icon-192.png' }); return; }
  }
  new Notification(title, { body, tag, icon: './icon-192.png' });
}

function notifyImportantEvents(force = false) {
  if (!notificationSettings.enabled || !currentUser) return;
  const today       = new Date().toISOString().split('T')[0];
  const lowStockItems = products.filter(p => p.stock <= p.minStock);
  const expiringItems = products.filter(p => { const d = getDaysToExpiry(p.expiryDate); return d !== null && d >= 0 && d <= 30; });
  const todayProfit   = transactions.filter(t => t.date === today).reduce((s, t) => s + t.profit, 0);

  const lowKey  = `notify:${currentUser.id}:lowStock:${today}`;
  const expKey  = `notify:${currentUser.id}:expiry:${today}`;
  const goalKey = `notify:${currentUser.id}:goal:${today}`;

  if ((force || !localStorage.getItem(lowKey)) && lowStockItems.length && notificationSettings.lowStock) {
    const names = lowStockItems.slice(0, 3).map(p => p.name).join(', ');
    sendBrowserNotification('Low stock alert', `${lowStockItems.length} product(s) need restocking: ${names}${lowStockItems.length > 3 ? '…' : ''}`, 'low-stock');
    localStorage.setItem(lowKey, 'sent');
  }
  if ((force || !localStorage.getItem(expKey)) && expiringItems.length) {
    const names = expiringItems.slice(0, 3).map(p => p.name).join(', ');
    sendBrowserNotification('Near expiry alert', `${expiringItems.length} product(s) are nearing expiry: ${names}${expiringItems.length > 3 ? '…' : ''}`, 'near-expiry');
    localStorage.setItem(expKey, 'sent');
  }
  if (dailyGoal > 0 && notificationSettings.goal && todayProfit >= dailyGoal && (force || !localStorage.getItem(goalKey))) {
    sendBrowserNotification('Daily goal reached', `You hit your profit goal with ${fmt(todayProfit)} today.`, 'goal-reached');
    localStorage.setItem(goalKey, 'sent');
  }
}

// ============================================================================
// DATA OPERATIONS
// ============================================================================

function cloneData(value) { return JSON.parse(JSON.stringify(value)); }

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

  saveCurrentUserData();
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
      toast('Last action undone.');
    }
  }, 7000);
  pendingUndoTimer = setTimeout(() => { pendingUndoTimer = null; }, 7000);
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

  const now     = new Date();
  const weekAgo = new Date(now - 7  * 86400000).toISOString().split('T')[0];
  const twoWkAgo= new Date(now - 14 * 86400000).toISOString().split('T')[0];
  const today   = now.toISOString().split('T')[0];

  const thisWeek = transactions.filter(t => t.date >= weekAgo && t.date <= today);
  const lastWeek = transactions.filter(t => t.date >= twoWkAgo && t.date < weekAgo);
  const trend    = getTrend(thisWeek.reduce((s,t)=>s+t.total,0), lastWeek.reduce((s,t)=>s+t.total,0));

  document.getElementById('total-income').textContent  = fmt(totalRevenue);
  document.getElementById('total-expense').textContent = fmt(totalCost);
  document.getElementById('net-profit').textContent    = fmt(totalProfit);
  document.getElementById('total-profit').textContent  = fmt(totalProfit);

  const trendEl = document.getElementById('revenue-trend');
  if (trendEl) { trendEl.textContent = `${trend.arrow} ${trend.pct} vs last week`; trendEl.style.color = trend.color; }
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

  const grouped = {};
  transactions.forEach(t => {
    const key = String(getRecordProductId(t) ?? t.product);
    if (!grouped[key]) grouped[key] = { name: getRecordProductName(t), qty: 0, revenue: 0 };
    grouped[key].qty     += t.qty;
    grouped[key].revenue += t.total;
  });
  const top = Object.values(grouped).sort((a,b)=>b.qty-a.qty||b.revenue-a.revenue)[0];
  document.getElementById('kpi-top').textContent = top ? `${top.name} (${top.qty} sold)` : '—';

  // Build last-7-days labels
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
        { label: 'Revenue', data: revenueByDay, backgroundColor: 'rgba(29,158,117,0.7)', borderRadius: 6, borderSkipped: false },
        { label: 'Profit',  data: profitByDay,  backgroundColor: 'rgba(124,106,247,0.7)', borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#6b7280', font: { size: 11 }, callback: v => fmt(v) }, grid: { color: 'rgba(255,255,255,0.05)' } }
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
    type: 'doughnut',
    data: {
      labels: entries.map(e=>e.name),
      datasets: [{ data: entries.map(e=>e.total), backgroundColor: colors.slice(0,entries.length), borderWidth: 0, hoverOffset: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
  });

  if (legend) {
    legend.innerHTML = entries.map((e,i) => `
      <span style="display:flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;">
        <span style="width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0;"></span>
        ${e.name}
      </span>
    `).join('');
  }
}

// ============================================================================
// PRODUCTS MANAGEMENT
// ============================================================================

function addProduct() {
  const name        = document.getElementById('prod-name').value.trim();
  const category    = document.getElementById('prod-category').value.trim() || 'Uncategorized';
  const brand       = document.getElementById('prod-brand').value.trim()    || '—';
  const variant     = document.getElementById('prod-variant').value.trim()  || '—';
  const cost        = parseFloat(document.getElementById('prod-cost').value);
  const price       = parseFloat(document.getElementById('prod-price').value);
  const stock       = parseInt(document.getElementById('prod-stock').value);
  const minStock    = parseInt(document.getElementById('prod-min').value)    || 5;
  const batchNumber = document.getElementById('prod-batch').value.trim();
  const expiryDate  = document.getElementById('prod-expiry').value;
  const skuInput    = document.getElementById('prod-sku').value.trim();
  const sku         = skuInput || `SKU-${String(skuCounter).padStart(3, '0')}`;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all fields correctly', 'error'); return;
  }
  if (cost >= price) { toast('Selling price must be greater than cost price', 'error'); return; }

  products.push({ id: nextProdId++, sku, name, brand, variant, category, cost, price, stock, minStock, batchNumber, expiryDate });
  skuCounter++;
  saveCurrentUserData();
  addMovementEntry('Added', name, `Created ${sku} with ${stock} units at ${fmt(price)}.`);
  saveProducts();
  clearProductForm();
  render();
  toast(`✓ ${name} added (${sku})`);
}

function deleteProduct(id) {
  const product  = products.find(p => p.id === id);
  const snapshot = createDataSnapshot();
  products = products.filter(p => p.id !== id);
  if (product) addMovementEntry('Deleted', product.name, `Removed product ${product.sku || ''}`.trim());
  saveProducts();
  render();
  queueUndo(`${product?.name || 'Product'} removed.`, snapshot);
}

function editProduct(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  document.getElementById('prod-name').value    = p.name;
  document.getElementById('prod-category').value= p.category || '';
  document.getElementById('prod-brand').value   = p.brand    || '';
  document.getElementById('prod-variant').value = p.variant  || '';
  document.getElementById('prod-sku').value     = p.sku      || '';
  document.getElementById('prod-cost').value    = p.cost;
  document.getElementById('prod-price').value   = p.price;
  document.getElementById('prod-stock').value   = p.stock;
  document.getElementById('prod-min').value     = p.minStock;
  document.getElementById('prod-batch').value   = p.batchNumber || '';
  document.getElementById('prod-expiry').value  = p.expiryDate  || '';

  const btn = document.querySelector('.form-section button');
  btn.textContent = '💾 Save Edit';
  btn.onclick = () => saveEdit(id);
}

function saveEdit(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  const name        = document.getElementById('prod-name').value.trim();
  const category    = document.getElementById('prod-category').value.trim() || 'Uncategorized';
  const brand       = document.getElementById('prod-brand').value.trim()    || '—';
  const variant     = document.getElementById('prod-variant').value.trim()  || '—';
  const sku         = document.getElementById('prod-sku').value.trim()      || p.sku;
  const cost        = parseFloat(document.getElementById('prod-cost').value);
  const price       = parseFloat(document.getElementById('prod-price').value);
  const stock       = parseInt(document.getElementById('prod-stock').value);
  const minStock    = parseInt(document.getElementById('prod-min').value)    || 5;
  const batchNumber = document.getElementById('prod-batch').value.trim();
  const expiryDate  = document.getElementById('prod-expiry').value;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all fields correctly', 'error'); return;
  }
  if (cost >= price) { toast('Selling price must be greater than cost price', 'error'); return; }

  Object.assign(p, { name, category, brand, variant, sku, cost, price, stock, minStock, batchNumber, expiryDate });
  saveProducts();
  addMovementEntry('Updated', name, `Edited product details. Stock now ${stock}, price ${fmt(price)}.`);
  clearProductForm();

  const btn = document.querySelector('.form-section button');
  btn.textContent = '+ Add Product';
  btn.onclick = addProduct;

  render();
  toast(`✓ ${name} updated`);
}

function clearProductForm() {
  ['prod-name','prod-category','prod-brand','prod-variant','prod-sku','prod-cost','prod-price','prod-stock','prod-min','prod-batch','prod-expiry']
    .forEach(id => { document.getElementById(id).value = ''; });
}

function saveProducts() { saveCurrentUserData(); }

function renderRestockAlert() {
  const lowItems = products.filter(p => p.stock <= p.minStock);
  const banner   = document.getElementById('restock-banner');
  if (!lowItems.length) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  document.getElementById('restock-list').innerHTML = lowItems.map(p =>
    `<span class="restock-tag">${p.name} — ${p.stock} left</span>`
  ).join('');
}

function renderProducts() {
  renderRestockAlert();
  updateCategoryFilter();

  let list = [...products];
  if (searchQuery)           list = list.filter(p => p.name.toLowerCase().includes(searchQuery));
  if (filterCategory !== 'all') list = list.filter(p => (p.category || 'Uncategorized') === filterCategory);
  if (sortBy === 'stock-asc')  list.sort((a,b) => a.stock - b.stock);
  if (sortBy === 'stock-desc') list.sort((a,b) => b.stock - a.stock);
  if (sortBy === 'price-asc')  list.sort((a,b) => a.price - b.price);
  if (sortBy === 'price-desc') list.sort((a,b) => b.price - a.price);

  const tbody = document.getElementById('prod-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">No products match your search.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(p => {
    const margin        = (((p.price - p.cost) / p.price) * 100).toFixed(1);
    const isLow         = p.stock <= p.minStock;
    const isEmpty       = p.stock === 0;
    const daysToExpiry  = getDaysToExpiry(p.expiryDate);

    const expiryMarkup = daysToExpiry === null
      ? '<span style="color:var(--muted);font-size:11px;">No expiry set</span>'
      : daysToExpiry < 0
      ? `<span class="badge danger">Expired ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry) === 1 ? '' : 's'} ago</span>`
      : daysToExpiry <= 30
      ? `<span class="badge warning">${daysToExpiry === 0 ? 'Expires today' : `${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'} left`}</span>`
      : `<span class="badge income">${daysToExpiry} days left</span>`;

    const stockBadge = isEmpty
      ? `<span class="badge expense">Out of stock</span>`
      : isLow
      ? `<span class="badge danger pulse">${p.stock} units — Low</span>`
      : `<span class="badge income">${p.stock} units</span>`;

    return `
      <tr class="${isLow && !isEmpty ? 'row-low' : ''}">
        <td>
          <div style="font-weight:600;">${p.name}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${p.sku || '—'}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">Batch: ${p.batchNumber || '—'}</div>
          <div style="margin-top:6px;">${expiryMarkup}</div>
        </td>
        <td><span class="badge" style="background:rgba(124,106,247,0.12);color:#7c6af7;">${p.category || 'Uncategorized'}</span></td>
        <td style="color:var(--muted);font-size:13px;">${p.brand || '—'}</td>
        <td style="color:var(--muted);font-size:13px;">${p.variant || '—'}</td>
        <td>${fmt(p.cost)}</td>
        <td>${fmt(p.price)}</td>
        <td><span class="badge income">${margin}% margin</span></td>
        <td>${stockBadge}</td>
        <td style="color:var(--muted);font-size:13px;">${p.minStock} units</td>
        <td>
          <input type="number" id="qty-${p.id}" placeholder="Qty" min="1" max="${p.stock}"
            style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;" />
          <input type="text" id="note-${p.id}" placeholder="Note (optional)"
            style="width:110px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;margin-left:4px;" />
          <button class="sell-btn" onclick="sellProduct(${p.id})" ${isEmpty ? 'disabled' : ''}>
            ${isEmpty ? 'Out of stock' : 'Sell'}
          </button>
        </td>
        <td>
          <input type="number" id="restock-qty-${p.id}" placeholder="Qty"
            style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;" />
          <input type="number" id="restock-cost-${p.id}" placeholder="${currency}/unit"
            style="width:70px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;margin-left:4px;" />
          <button class="restock-btn" onclick="restockProduct(${p.id})">+ Restock</button>
        </td>
        <td style="display:flex;gap:6px;">
          <button class="edit-btn" onclick="editProduct(${p.id})">✎ Edit</button>
          <button onclick="deleteProduct(${p.id})">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateCategoryFilter() {
  const cats    = ['all', ...new Set(products.map(p => p.category || 'Uncategorized'))];
  const sel     = document.getElementById('filter-category');
  const current = sel.value;
  sel.innerHTML = cats.map(c => `<option value="${c}">${c === 'all' ? 'All Categories' : c}</option>`).join('');
  sel.value = cats.includes(current) ? current : 'all';
}

function setSearch(val)   { searchQuery = val.toLowerCase(); renderProducts(); }
function setCategory(val) { filterCategory = val;             renderProducts(); }
function setSort(val)     { sortBy = val;                     renderProducts(); }

// ============================================================================
// SALES & TRANSACTIONS
// ============================================================================

function sellProduct(id) {
  const qtyInput  = document.getElementById('qty-' + id);
  const noteInput = document.getElementById('note-' + id);
  const qty       = parseInt(qtyInput.value);
  const note      = noteInput ? noteInput.value.trim() : '';
  const product   = products.find(p => p.id === id);

  if (!product) return;
  if (isNaN(qty) || qty <= 0)  { toast('Enter a valid quantity', 'error'); return; }
  if (qty > product.stock)     { toast('Not enough stock', 'error');        return; }

  const total     = qty * product.price;
  const totalCost = qty * product.cost;
  const profit    = total - totalCost;
  const date      = new Date().toISOString().split('T')[0];

  product.stock -= qty;
  transactions.unshift({
    id: Date.now(), date,
    productId: product.id, product: product.name,
    sku: product.sku || '', category: product.category || 'Uncategorized',
    qty, cost: product.cost, price: product.price,
    total, totalCost, profit, note
  });

  qtyInput.value = '';
  if (noteInput) noteInput.value = '';
  saveProducts();
  addMovementEntry('Sold', product.name, `Sold ${qty} units for ${fmt(total)}${note ? ` — note: ${note}` : ''}.`);
  render();
  toast(`✓ Sold ${qty}× ${product.name} for ${fmt(total)}`);
  notifyImportantEvents();
}

function deleteTransaction(id) {
  const tx       = transactions.find(t => t.id === id);
  if (!tx) return;
  const snapshot = createDataSnapshot();
  const product  = findProductByRecord(tx);
  if (product) product.stock += tx.qty;
  transactions = transactions.filter(t => t.id !== id);
  saveProducts();
  addMovementEntry('Sale Deleted', getRecordProductName(tx), `Removed sale of ${tx.qty} units and restored stock.`);
  render();
  queueUndo(`Sale deleted for ${getRecordProductName(tx)}.`, snapshot);
}

function renderTransactions() {
  const tbody    = document.getElementById('txn-body');
  const filtered = getFilteredTransactions();

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No transactions found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(t => `
    <tr>
      <td>${t.date}</td>
      <td>
        <div style="font-weight:600;">${getRecordProductName(t)}</div>
        ${t.sku ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${t.sku}</div>` : ''}
        ${t.note ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">📝 ${t.note}</div>` : ''}
      </td>
      <td>${t.qty}</td>
      <td>${fmt(t.price)}</td>
      <td style="color:#1D9E75;font-weight:700;">+${fmt(t.total)}</td>
      <td style="color:#7c6af7;font-weight:700;">+${fmt(t.profit)}</td>
      <td><button onclick="deleteTransaction(${t.id})">✕</button></td>
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
  if (isNaN(qty) || qty <= 0)  { toast('Enter a valid quantity', 'error'); return; }
  if (isNaN(cost) || cost < 0) { toast('Enter a valid cost',     'error'); return; }

  product.stock += qty;
  restockHistory.unshift({
    id: Date.now(), date: new Date().toISOString().split('T')[0],
    productId: product.id, product: product.name,
    sku: product.sku || '', category: product.category || 'Uncategorized',
    qty, cost, total: qty * cost
  });

  qtyInput.value = ''; costInput.value = '';
  saveCurrentUserData();
  saveProducts();
  addMovementEntry('Restocked', product.name, `Added ${qty} units at ${fmt(cost)} each.`);
  render();
  notifyImportantEvents();
  toast(`✓ Restocked ${qty} units of ${product.name}`);
}

function renderRestockHistory() {
  const tbody = document.getElementById('restock-body');
  if (!restockHistory.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No restock history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = restockHistory.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${getRecordProductName(r)}</td>
      <td>${r.qty} units</td>
      <td>${fmt(r.cost)} per unit</td>
      <td style="color:#eab308;font-weight:700;">${fmt(r.total)}</td>
    </tr>
  `).join('');
}

function setDeadStockDays(val) {
  deadStockDays = parseInt(val);
  document.getElementById('days-label').textContent = val + ' days';
  renderDeadStock();
}

function markReviewed(id) {
  if (!reviewedProducts.includes(id)) { reviewedProducts.push(id); saveCurrentUserData(); }
  renderDeadStock();
}

function renderDeadStock() {
  const today   = new Date();
  const tbody   = document.getElementById('dead-body');
  const countEl = document.getElementById('dead-count');

  const deadList = products.filter(product => {
    if (reviewedProducts.includes(product.id)) return false;
    const lastSale = transactions
      .filter(tx => matchesProductRecord(tx, product))
      .sort((a,b) => new Date(b.date) - new Date(a.date))[0];
    if (!lastSale) return product.stock > 0;
    return Math.floor((today - new Date(lastSale.date)) / 86400000) >= deadStockDays && product.stock > 0;
  }).map(product => {
    const lastSale = transactions
      .filter(tx => matchesProductRecord(tx, product))
      .sort((a,b) => new Date(b.date) - new Date(a.date))[0];
    return { ...product, lastSale: lastSale?.date || null, daysSince: lastSale ? Math.floor((today - new Date(lastSale.date)) / 86400000) : null, idleValue: product.stock * product.cost };
  });

  countEl.textContent = deadList.length;
  if (!deadList.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No dead stock right now.</td></tr>';
    return;
  }

  tbody.innerHTML = deadList.map(p => `
    <tr>
      <td>
        <div style="font-weight:600;">${p.name}</div>
        <div style="font-size:12px;color:var(--muted);">${p.category || 'Uncategorized'}</div>
      </td>
      <td><span class="badge danger">${p.daysSince === null ? 'Never sold' : `${p.daysSince} days ago`}</span></td>
      <td>${p.stock} units</td>
      <td style="color:#eab308;font-weight:700;">${fmt(p.idleValue)}</td>
      <td><button class="reviewed-btn" onclick="markReviewed(${p.id})">✓ Mark reviewed</button></td>
    </tr>
  `).join('');
}

// ============================================================================
// SMART INSIGHTS
// ============================================================================

function renderSmartInsights() {
  const today      = new Date().toISOString().split('T')[0];
  const todayTxns  = transactions.filter(t => t.date === today);

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
  if (!lowMargin.length) {
    marginEl.innerHTML = '<span style="color:#1D9E75;font-size:13px;">All products have healthy margins.</span>';
  } else {
    marginEl.innerHTML = lowMargin.map(p => {
      const margin = (((p.price - p.cost) / p.price) * 100).toFixed(1);
      return `<span class="restock-tag">${p.name} — ${margin}% margin</span>`;
    }).join('');
  }
}

// ============================================================================
// GOALS
// ============================================================================

function setGoal() {
  const val = parseFloat(document.getElementById('goal-input').value);
  if (isNaN(val) || val <= 0) { toast('Enter a valid goal', 'error'); return; }
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

  const bar    = document.getElementById('goal-bar');
  const label  = document.getElementById('goal-label');
  const inputEl= document.getElementById('goal-input');
  if (!bar) return;

  if (dailyGoal === 0) {
    label.textContent = 'Set a daily profit goal above';
    bar.style.width   = '0%';
    return;
  }

  bar.style.width      = pct + '%';
  bar.style.background = pct >= 100 ? '#1D9E75' : pct >= 50 ? '#eab308' : '#D85A30';

  if (pct >= 100) {
    label.textContent  = `🎉 Goal reached! ${fmt(todayProfit)} profit today`;
    label.style.color  = '#1D9E75';
  } else {
    label.textContent  = `${fmt(todayProfit)} of ${fmt(dailyGoal)} — ${fmt(remaining)} to go (${pct}%)`;
    label.style.color  = 'var(--muted)';
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
  dateFrom = ''; dateTo = '';
  const f1 = document.getElementById('date-from');
  const t1 = document.getElementById('date-to');
  const f2 = document.getElementById('date-from-reports');
  const t2 = document.getElementById('date-to-reports');
  if (f1) f1.value = ''; if (t1) t1.value = '';
  if (f2) f2.value = ''; if (t2) t2.value = '';
  renderTransactions();
  renderDateStats();
}

function getFilteredTransactions() {
  return transactions.filter(t => {
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo   && t.date > dateTo)   return false;
    return true;
  });
}

function renderDateStats() {
  const filtered     = getFilteredTransactions();
  const rev          = filtered.reduce((s,t)=>s+t.total,0);
  const profit       = filtered.reduce((s,t)=>s+t.profit,0);
  const cost         = filtered.reduce((s,t)=>s+t.totalCost,0);
  const items        = filtered.reduce((s,t)=>s+t.qty,0);

  // There are two possible date-stats containers (home view & reports view)
  const statsEls    = [document.getElementById('date-stats'), document.querySelector('#feature-reports #date-stats')].filter(Boolean);
  const insightsEls = [document.getElementById('date-range-insights'), document.querySelector('#feature-reports #date-range-insights')].filter(Boolean);

  const hasFilter = !!(dateFrom || dateTo);

  statsEls.forEach(el => {
    el.style.display = hasFilter ? 'flex' : 'none';
    if (hasFilter) {
      el.innerHTML = `
        <div class="date-stat-card"><div class="date-stat-label">Revenue</div><div class="date-stat-value" style="color:#1D9E75;">${fmt(rev)}</div></div>
        <div class="date-stat-card"><div class="date-stat-label">Cost</div><div class="date-stat-value" style="color:#D85A30;">${fmt(cost)}</div></div>
        <div class="date-stat-card"><div class="date-stat-label">Profit</div><div class="date-stat-value" style="color:#7c6af7;">${fmt(profit)}</div></div>
        <div class="date-stat-card"><div class="date-stat-label">Items Sold</div><div class="date-stat-value">${items}</div></div>
      `;
    }
  });

  insightsEls.forEach(el => {
    if (!hasFilter) { el.style.display = 'none'; return; }
    if (!filtered.length) {
      el.style.display = 'grid';
      el.innerHTML = `
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
      if (!byProduct[name])     byProduct[name]     = { revenue:0, cost:0, profit:0, items:0 };
      if (!byCategory[category]) byCategory[category] = { revenue:0, profit:0, items:0 };
      byProduct[name].revenue += t.total; byProduct[name].cost += t.totalCost; byProduct[name].profit += t.profit; byProduct[name].items += t.qty;
      byCategory[category].revenue += t.total; byCategory[category].profit += t.profit; byCategory[category].items += t.qty;
    });

    const best      = Object.entries(byProduct).sort((a,b)=>b[1].profit-a[1].profit)[0];
    const weakest   = Object.entries(byProduct).sort((a,b)=>a[1].profit-b[1].profit)[0];
    const topCat    = Object.entries(byCategory).sort((a,b)=>b[1].profit-a[1].profit)[0];
    const avgProfit = filtered.length ? profit / filtered.length : 0;
    const marginPct = rev > 0 ? ((profit / rev) * 100).toFixed(1) : '0.0';

    el.style.display = 'grid';
    el.innerHTML = `
      <div class="range-insight-card accent-green">
        <div class="range-insight-title">Top Category</div>
        <div class="range-insight-value">${topCat ? topCat[0] : '—'}</div>
        <div class="range-insight-subtext">${topCat ? `${fmt(topCat[1].profit)} profit across ${topCat[1].items} items` : 'No data'}</div>
      </div>
      <div class="range-insight-card accent-violet">
        <div class="range-insight-title">Best Product</div>
        <div class="range-insight-value">${best ? best[0] : '—'}</div>
        <div class="range-insight-subtext">${best ? `${fmt(best[1].profit)} profit from ${best[1].items} units` : 'No data'}</div>
      </div>
      <div class="range-insight-card accent-amber">
        <div class="range-insight-title">Lowest Performer</div>
        <div class="range-insight-value">${weakest ? weakest[0] : '—'}</div>
        <div class="range-insight-subtext">${weakest ? `${fmt(weakest[1].profit)} profit on ${fmt(weakest[1].revenue)} revenue` : 'No data'}</div>
      </div>
      <div class="range-insight-card accent-slate">
        <div class="range-insight-title">Range Quality</div>
        <div class="range-insight-value">${marginPct}% margin</div>
        <div class="range-insight-subtext">${fmt(avgProfit)} avg profit per transaction</div>
      </div>
    `;
  });
}

// ============================================================================
// REPORTS
// ============================================================================

function renderReport(period) {
  const report = document.getElementById('report-body');
  const title  = document.getElementById('report-title');
  const groups = {};

  transactions.forEach(t => {
    const d = new Date(t.date);
    const key = period === 'weekly'
      ? `Week ${getWeekNumber(d)}, ${d.getFullYear()}`
      : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = { revenue:0, cost:0, profit:0, items:0 };
    groups[key].revenue += t.total; groups[key].cost += t.totalCost; groups[key].profit += t.profit; groups[key].items += t.qty;
  });

  title.textContent = period === 'weekly' ? 'Weekly Report' : 'Monthly Report';
  const entries = Object.entries(groups).reverse();
  if (!entries.length) { report.innerHTML = '<tr><td colspan="5" class="empty">No data yet.</td></tr>'; return; }

  report.innerHTML = entries.map(([p, d]) => `
    <tr>
      <td style="font-weight:600;">${p}</td>
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

  const tbody   = document.getElementById('cat-report-body');
  const entries = Object.entries(catMap).sort((a,b)=>b[1].profit-a[1].profit);
  if (!entries.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No sales data yet.</td></tr>'; return; }

  const totalRevenue = entries.reduce((sum,[,d])=>sum+d.revenue,0);
  tbody.innerHTML = entries.map(([cat,d]) => {
    const share = totalRevenue > 0 ? ((d.revenue/totalRevenue)*100).toFixed(1) : 0;
    return `
      <tr>
        <td><span class="badge" style="background:rgba(124,106,247,0.12);color:#7c6af7;">${cat}</span></td>
        <td>${d.products.size} products</td>
        <td style="color:#1D9E75;font-weight:700;">${fmt(d.revenue)}</td>
        <td style="color:#D85A30;font-weight:700;">${fmt(d.cost)}</td>
        <td style="color:#7c6af7;font-weight:700;">${fmt(d.profit)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="flex:1;background:var(--card-border);border-radius:4px;height:6px;">
              <div style="width:${share}%;background:#1D9E75;border-radius:4px;height:6px;"></div>
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
        <td style="font-weight:600;">${product.name}</td>
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
  const csv  = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=`shop-tracker-${new Date().toISOString().split('T')[0]}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  closeProfileMenu();
  if (!hasPdfSupport()) { toast('PDF export unavailable right now.','error'); return; }

  const { jsPDF } = window.jspdf;
  const doc       = new jsPDF();
  const today     = new Date().toISOString().split('T')[0];
  const green     = [29,158,117];
  const dark      = [30,30,40];

  doc.setFillColor(...dark); doc.rect(0,0,210,30,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('Shop Tracker — Daily Report',14,18);
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(180,180,180);
  doc.text(`Generated: ${today}`,14,26);

  const totalRev    = transactions.reduce((s,t)=>s+t.total,0);
  const totalProfit = transactions.reduce((s,t)=>s+t.profit,0);
  const totalCost   = transactions.reduce((s,t)=>s+t.totalCost,0);

  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...dark); doc.text('Summary',14,42);
  doc.autoTable({ startY:46, head:[['Total Revenue','Total Cost','Gross Profit','Items Sold']], body:[[fmt(totalRev),fmt(totalCost),fmt(totalProfit),transactions.reduce((s,t)=>s+t.qty,0)]], headStyles:{fillColor:green,textColor:255,fontStyle:'bold'}, bodyStyles:{textColor:dark}, margin:{left:14,right:14} });

  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...dark); doc.text('Sales Transactions',14,doc.lastAutoTable.finalY+14);
  doc.autoTable({ startY:doc.lastAutoTable.finalY+18, head:[['Date','Product','Qty','Unit Price','Total','Profit']], body:transactions.map(tx=>[tx.date,getRecordProductName(tx),tx.qty,fmt(tx.price),fmt(tx.total),fmt(tx.profit)]), headStyles:{fillColor:green,textColor:255,fontStyle:'bold'}, bodyStyles:{textColor:dark}, alternateRowStyles:{fillColor:[245,245,245]}, margin:{left:14,right:14} });

  const todayDate = new Date();
  const deadList  = products.filter(p => {
    const ls = transactions.filter(tx=>matchesProductRecord(tx,p)).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
    if (!ls) return p.stock > 0;
    return Math.floor((todayDate-new Date(ls.date))/86400000) >= deadStockDays && p.stock > 0;
  });

  if (deadList.length) {
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...dark); doc.text('Dead Stock',14,doc.lastAutoTable.finalY+14);
    doc.autoTable({ startY:doc.lastAutoTable.finalY+18, head:[['Product','Stock','Idle Value']], body:deadList.map(p=>[p.name,`${p.stock} units`,fmt(p.stock*p.cost)]), headStyles:{fillColor:[216,90,48],textColor:255,fontStyle:'bold'}, bodyStyles:{textColor:dark}, margin:{left:14,right:14} });
  }

  doc.setFontSize(9); doc.setTextColor(150,150,150); doc.text('Generated by Shop Tracker',14,290);
  doc.save(`shop-report-${today}.pdf`);
}

function backupData() {
  closeProfileMenu();
  const data = { user: currentUser ? { id:currentUser.id, name:currentUser.name, email:currentUser.email } : null, products, transactions, restockHistory, movementHistory, reviewedProducts, dailyGoal, currency, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=`shop-backup-${new Date().toISOString().split('T')[0]}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('Backup created');
}

function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;
  closeProfileMenu();
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data     = JSON.parse(e.target.result);
      if (!confirm('This will replace all current data. Are you sure?')) return;
      const snapshot = createDataSnapshot();
      applyDataSnapshot({ products: data.products||[], transactions: data.transactions||[], restockHistory: data.restockHistory||[], movementHistory: data.movementHistory||[], reviewedProducts: data.reviewedProducts||[], dailyGoal: parseFloat(data.dailyGoal)||0, currency: data.currency||'INR', skuCounter: (data.products||[]).length+1 });
      addMovementEntry('Restored','Inventory','Restored inventory data from backup file.');
      queueUndo('Backup restored.', snapshot);
    } catch { toast('Invalid backup file.','error'); }
    finally { event.target.value=''; }
  };
  reader.readAsText(file);
}

// ============================================================================
// THEME & UI
// ============================================================================

function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeButton();
  syncProfileMenuTheme();
}

function loadTheme() {
  if (localStorage.getItem('theme') === 'light') document.body.classList.add('light');
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

function toast(message, type = 'success', action = null, duration = 2600) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const icons = { success: '✓', error: '!', info: 'i' };
  const t = document.createElement('div');
  t.id        = 'toast';
  t.className = `toast toast-${type}`;
  t.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.success}</div>
    <div class="toast-copy">
      <div class="toast-label">${type==='error'?'Action needed':type==='info'?'Heads up':'Success'}</div>
      <div class="toast-message">${message}</div>
    </div>
    ${action ? `<button type="button" class="toast-action">${action.label}</button>` : ''}
    <div class="toast-progress"></div>
  `;
  document.body.appendChild(t);

  const progress = t.querySelector('.toast-progress');
  if (progress) progress.style.animationDuration = `${duration}ms`;

  const dismiss = setTimeout(() => { t.classList.add('toast-exit'); setTimeout(()=>t.remove(),320); }, duration);

  if (action) {
    t.querySelector('.toast-action')?.addEventListener('click', () => {
      clearTimeout(dismiss); t.remove(); action.onClick();
    });
  }
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
  overlay.innerHTML = `
    <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:28px 32px;max-width:400px;width:90%;text-align:center;">
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:20px;">${message}</div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button onclick="document.getElementById('confirm-modal').remove()"
          style="padding:10px 24px;border-radius:8px;border:1px solid var(--card-border);background:transparent;color:var(--muted);font-size:14px;font-weight:600;cursor:pointer;">
          Cancel
        </button>
        <button id="confirm-yes"
          style="padding:10px 24px;border-radius:8px;border:none;background:#D85A30;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">
          Yes, delete
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('confirm-yes').onclick = () => { overlay.remove(); onYes(); };
}

function clearAllData() {
  closeProfileMenu();
  showConfirm('Delete all data for this account? This cannot be undone.', () => {
    if (!currentUser) return;
    const snapshot = createDataSnapshot();
    ['products','transactions','restockHistory','movementHistory','reviewed','currency','skuCounter','dailyGoal','notificationSettings']
      .forEach(key => removeUserValue(currentUser.id, key));
    products=[];transactions=[];restockHistory=[];movementHistory=[];reviewedProducts=[];
    dailyGoal=0;currency='INR';skuCounter=1;
    notificationSettings={enabled:false,lowStock:true,goal:true};
    loadCurrency();
    render();
    queueUndo('All account data cleared.', snapshot, 'error');
  });
}
// ============================================================================
// BULK CSV IMPORT MODULE
// Paste this entire block into script.js (before the closing event listeners)
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
  phase:       'upload',   // 'upload' | 'map' | 'preview'
  rawRows:     [],         // array of string[] (all rows including header)
  headers:     [],         // detected header row
  mapping:     {},         // { fieldKey: colIndex | -1 }
  parsed:      [],         // array of { data, errors, warnings }
  fileLoaded:  false,
};

// ── Modal open / close ────────────────────────────────────────────────────────

function openCsvImport() {
  csvReset();
  const backdrop = document.getElementById('csv-import-backdrop');
  backdrop.style.display = 'flex';
  backdrop.classList.remove('closing');
  document.getElementById('csv-modal').classList.remove('closing');
  document.body.style.overflow = 'hidden';
  // Focus trap seed
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

// Close on backdrop click
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'csv-import-backdrop') closeCsvImport();
});

// Close on Escape — appended to existing keydown listener
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('csv-import-backdrop')?.style.display !== 'none') {
    closeCsvImport();
  }
});

// ── Template download ─────────────────────────────────────────────────────────

function downloadCsvTemplate() {
  const header = CSV_FIELDS.map(f => f.label).join(',');
  const example = [
    'Rice 5kg,Grains,Tata,5kg,SKU-001,80,120,50,10,LOT-001,2025-12-31',
    'Wheat Flour 1kg,Grains,Aashirvaad,1kg,,40,65,30,5,,',
    'Sunflower Oil 1L,Oils,Fortune,1L,,95,145,20,5,LOT-A,2026-06-30',
  ].join('\n');
  const csv  = header + '\n' + example;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'shop-tracker-import-template.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Drag & drop ───────────────────────────────────────────────────────────────

function csvDragOver(e) {
  e.preventDefault();
  document.getElementById('csv-drop-zone').classList.add('drag-over');
}

function csvDragLeave(e) {
  document.getElementById('csv-drop-zone').classList.remove('drag-over');
}

function csvDrop(e) {
  e.preventDefault();
  document.getElementById('csv-drop-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) csvReadFile(file);
}

function csvFileSelected(e) {
  const file = e.target.files[0];
  if (file) csvReadFile(file);
  e.target.value = '';
}

function csvReadFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
    toast('Please upload a .csv file', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => csvLoadRawText(ev.target.result);
  reader.readAsText(file);
}

// ── Paste input ───────────────────────────────────────────────────────────────

function csvPasteChanged() {
  const val = document.getElementById('csv-paste-input').value.trim();
  if (val.length > 10) {
    // Debounce slightly so it doesn't re-parse on every keystroke
    clearTimeout(csvState._pasteTimer);
    csvState._pasteTimer = setTimeout(() => csvLoadRawText(val), 380);
  } else {
    csvState.fileLoaded = false;
    csvSetNextEnabled(false);
    document.getElementById('csv-footer-info').textContent = 'Upload a CSV file or paste data above to get started.';
  }
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function csvParseText(text) {
  // Handles quoted fields, commas inside quotes, CRLF and LF
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows  = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const row    = [];
    let field    = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch   = line[i];
      const next = line[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"')            { inQuotes = false; }
        else                            { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { row.push(field.trim()); field = ''; }
        else { field += ch; }
      }
    }
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function csvLoadRawText(text) {
  const rows = csvParseText(text);
  if (rows.length < 2) {
    toast('CSV needs at least a header row and one data row', 'error');
    return;
  }

  csvState.rawRows    = rows;
  csvState.headers    = rows[0];
  csvState.fileLoaded = true;

  // Auto-detect mapping using fuzzy header matching
  csvState.mapping = autoDetectMapping(csvState.headers);

  const dataCount = rows.length - 1;
  document.getElementById('csv-footer-info').innerHTML =
    `<strong>${dataCount} row${dataCount !== 1 ? 's' : ''}</strong> detected — review column mapping below.`;

  csvSetPhase('map');
  csvBuildMapper();
  csvSetNextEnabled(true);
}

// ── Auto column detection ────────────────────────────────────────────────────

function autoDetectMapping(headers) {
  const aliases = {
    name:        ['name', 'product', 'product name', 'item', 'item name', 'title', 'description'],
    category:    ['category', 'cat', 'type', 'department', 'group'],
    brand:       ['brand', 'manufacturer', 'make', 'company', 'mfr'],
    variant:     ['variant', 'size', 'weight', 'unit', 'pack size', 'variation'],
    sku:         ['sku', 'item id', 'item code', 'code', 'barcode', 'upc', 'id'],
    cost:        ['cost', 'cost price', 'purchase price', 'buy price', 'cp', 'buying price', 'cost per unit'],
    price:       ['price', 'selling price', 'sell price', 'mrp', 'sale price', 'retail price', 'sp'],
    stock:       ['stock', 'qty', 'quantity', 'units', 'inventory', 'on hand', 'available'],
    minStock:    ['min stock', 'minimum stock', 'reorder point', 'reorder level', 'min qty', 'alert'],
    batchNumber: ['batch', 'batch number', 'lot', 'lot number', 'batch no'],
    expiryDate:  ['expiry', 'expiry date', 'exp date', 'expiration', 'best before', 'use by', 'exp'],
  };

  const mapping = {};
  CSV_FIELDS.forEach(f => { mapping[f.key] = -1; });

  headers.forEach((h, idx) => {
    const normalized = h.toLowerCase().trim();
    for (const [key, aliasList] of Object.entries(aliases)) {
      if (mapping[key] !== -1) continue; // already mapped
      if (aliasList.some(a => normalized.includes(a) || a.includes(normalized))) {
        mapping[key] = idx;
        break;
      }
    }
  });

  return mapping;
}

// ── Column mapper UI ──────────────────────────────────────────────────────────

function csvBuildMapper() {
  const grid = document.getElementById('csv-mapper-grid');
  grid.innerHTML = '';

  const headerOptions = csvState.headers.map((h, i) =>
    `<option value="${i}">${h || `Column ${i + 1}`}</option>`
  ).join('');
  const skipOption = `<option value="-1">— Skip this field —</option>`;

  CSV_FIELDS.forEach(field => {
    const selectedIdx = csvState.mapping[field.key] ?? -1;

    grid.insertAdjacentHTML('beforeend', `
      <div class="csv-mapper-col-label">
        <span class="${field.required ? 'csv-required-dot' : 'csv-optional-dot'}"></span>
        ${field.label}${field.required ? ' *' : ''}
      </div>
      <div class="csv-mapper-arrow">→</div>
      <select
        class="csv-mapper-select"
        data-field="${field.key}"
        onchange="csvUpdateMapping('${field.key}', parseInt(this.value))"
        aria-label="Map ${field.label}"
      >
        ${skipOption}${headerOptions}
      </select>
    `);

    // Set selected
    const sel = grid.querySelector(`select[data-field="${field.key}"]`);
    if (sel) sel.value = selectedIdx;
  });
}

function csvUpdateMapping(fieldKey, colIdx) {
  csvState.mapping[fieldKey] = colIdx;
  // Re-run preview if already in preview phase
  if (csvState.phase === 'preview') csvBuildPreview();
}

// ── Validation & preview ─────────────────────────────────────────────────────

const REQUIRED_FIELDS = CSV_FIELDS.filter(f => f.required).map(f => f.key);

function csvValidateMapping() {
  const missing = REQUIRED_FIELDS.filter(k => (csvState.mapping[k] ?? -1) === -1);
  return missing;
}

function csvParseAndValidateRows() {
  const dataRows = csvState.rawRows.slice(1); // skip header
  const results  = [];

  dataRows.forEach((row, rowIdx) => {
    const errors   = [];
    const warnings = [];
    const data     = {};

    CSV_FIELDS.forEach(field => {
      const colIdx = csvState.mapping[field.key] ?? -1;
      const raw    = colIdx >= 0 ? (row[colIdx] || '').trim() : '';

      if (field.key === 'name') {
        data.name = raw;
        if (!raw) errors.push(`Row ${rowIdx + 2}: Product name is required`);
      } else if (field.key === 'cost') {
        data.cost = parseFloat(raw);
        if (!raw)                  errors.push(`Row ${rowIdx + 2}: Cost price is required`);
        else if (isNaN(data.cost) || data.cost <= 0) errors.push(`Row ${rowIdx + 2}: Cost price must be a positive number (got "${raw}")`);
      } else if (field.key === 'price') {
        data.price = parseFloat(raw);
        if (!raw)                   errors.push(`Row ${rowIdx + 2}: Selling price is required`);
        else if (isNaN(data.price) || data.price <= 0) errors.push(`Row ${rowIdx + 2}: Selling price must be a positive number (got "${raw}")`);
      } else if (field.key === 'stock') {
        data.stock = parseInt(raw);
        if (!raw)                   errors.push(`Row ${rowIdx + 2}: Stock quantity is required`);
        else if (isNaN(data.stock) || data.stock < 0) errors.push(`Row ${rowIdx + 2}: Stock must be a non-negative integer (got "${raw}")`);
      } else if (field.key === 'minStock') {
        data.minStock = raw ? parseInt(raw) : 5;
        if (raw && isNaN(data.minStock)) warnings.push(`Row ${rowIdx + 2}: Min stock ignored (not a number), defaulting to 5`);
      } else if (field.key === 'expiryDate') {
        data.expiryDate = raw || '';
        if (raw && isNaN(new Date(raw).getTime())) warnings.push(`Row ${rowIdx + 2}: Expiry date "${raw}" could not be parsed, will be skipped`);
      } else {
        data[field.key] = raw || '';
      }
    });

    // Cross-field validation
    if (!isNaN(data.cost) && !isNaN(data.price) && data.cost > 0 && data.price > 0 && data.cost >= data.price) {
      errors.push(`Row ${rowIdx + 2}: Cost price (${data.cost}) must be less than selling price (${data.price})`);
    }

    // Defaults
    data.category    = data.category    || 'Uncategorized';
    data.brand       = data.brand       || '—';
    data.variant     = data.variant     || '—';
    data.batchNumber = data.batchNumber || '';
    if (!data.minStock || isNaN(data.minStock)) data.minStock = 5;

    results.push({ data, errors, warnings, rowIdx });
  });

  csvState.parsed = results;
  return results;
}

function csvBuildPreview() {
  const results = csvParseAndValidateRows();

  const okCount   = results.filter(r => r.errors.length === 0).length;
  const warnCount = results.filter(r => r.warnings.length > 0).length;
  const errCount  = results.filter(r => r.errors.length  > 0).length;
  const allErrors = results.flatMap(r => r.errors);

  // Validation bar
  document.getElementById('csv-validation-bar').innerHTML = `
    <span class="csv-val-chip ok">✓ ${okCount} valid</span>
    ${warnCount ? `<span class="csv-val-chip warn">⚠ ${warnCount} warnings</span>` : ''}
    ${errCount  ? `<span class="csv-val-chip err">✕ ${errCount} errors</span>`   : ''}
    <span class="csv-val-detail">${results.length} total row${results.length !== 1 ? 's' : ''}</span>
  `;

  // Error list
  const errorList = document.getElementById('csv-error-list');
  if (allErrors.length) {
    errorList.style.display = 'flex';
    errorList.innerHTML = allErrors.map(e => `<div class="csv-error-item">${e}</div>`).join('');
  } else {
    errorList.style.display = 'none';
  }

  // Preview columns (only mapped fields)
  const mappedFields = CSV_FIELDS.filter(f => (csvState.mapping[f.key] ?? -1) >= 0);

  const thead = document.getElementById('csv-preview-thead');
  thead.innerHTML = `<tr>${mappedFields.map(f => `<th>${f.label}</th>`).join('')}<th>Status</th></tr>`;

  const tbody = document.getElementById('csv-preview-tbody');
  tbody.innerHTML = results.map(r => {
    const cls  = r.errors.length ? 'csv-row-err' : r.warnings.length ? 'csv-row-warn' : 'csv-row-ok';
    const status = r.errors.length
      ? `<span style="color:#D85A30;font-size:11px;font-weight:700;">✕ Error</span>`
      : r.warnings.length
      ? `<span style="color:#eab308;font-size:11px;font-weight:700;">⚠ Warning</span>`
      : `<span style="color:#1D9E75;font-size:11px;font-weight:700;">✓ OK</span>`;

    const cells = mappedFields.map(f => {
      const val = r.data[f.key] ?? '';
      return `<td title="${String(val)}">${String(val)}</td>`;
    }).join('');

    return `<tr class="${cls}">${cells}<td>${status}</td></tr>`;
  }).join('');

  // Footer
  const importable = okCount;
  document.getElementById('csv-footer-info').innerHTML =
    `<strong>${importable}</strong> product${importable !== 1 ? 's' : ''} ready to import` +
    (errCount ? ` — <span style="color:#D85A30;">${errCount} row${errCount !== 1 ? 's' : ''} with errors will be skipped</span>` : '');

  const nextBtn = document.getElementById('csv-next-btn');
  nextBtn.textContent = `Import ${importable} Product${importable !== 1 ? 's' : ''} →`;
  nextBtn.disabled    = importable === 0;
}

// ── Phase controller ──────────────────────────────────────────────────────────

function csvSetPhase(phase) {
  csvState.phase = phase;

  document.getElementById('csv-phase-upload').style.display  = phase === 'upload'  ? 'flex' : 'none';
  document.getElementById('csv-phase-map').style.display     = phase === 'map'     ? 'block' : 'none';
  document.getElementById('csv-phase-preview').style.display = phase === 'preview' ? 'flex' : 'none';

  // Upload phase needs column flex-direction
  const uploadPhase = document.getElementById('csv-phase-upload');
  if (uploadPhase) uploadPhase.style.flexDirection = 'column';
  if (uploadPhase) uploadPhase.style.gap = '16px';

  // Ensure preview phase also stacks
  const previewPhase = document.getElementById('csv-phase-preview');
  if (previewPhase) { previewPhase.style.flexDirection = 'column'; previewPhase.style.gap = '14px'; }

  // Step indicators
  const steps = ['upload','map','preview','done'];
  const phaseIdx = { upload: 0, map: 1, preview: 2, done: 3 }[phase] ?? 0;

  ['csv-step-1','csv-step-2','csv-step-3','csv-step-4'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('active', i === phaseIdx);
    el.classList.toggle('done',   i < phaseIdx);
  });

  // Next button label
  const nextBtn = document.getElementById('csv-next-btn');
  if (phase === 'upload') {
    nextBtn.textContent = 'Next →';
    nextBtn.disabled    = !csvState.fileLoaded;
  } else if (phase === 'map') {
    nextBtn.textContent = 'Preview →';
    nextBtn.disabled    = false;
  }
}

function csvNextStep() {
  if (csvState.phase === 'upload') {
    if (!csvState.fileLoaded) { toast('Upload or paste CSV data first', 'error'); return; }
    csvSetPhase('map');
  } else if (csvState.phase === 'map') {
    const missing = csvValidateMapping();
    if (missing.length) {
      toast(`Map required fields: ${missing.join(', ')}`, 'error');
      return;
    }
    csvBuildPreview();
    csvSetPhase('preview');
  } else if (csvState.phase === 'preview') {
    csvDoImport();
  }
}

// ── The actual import ─────────────────────────────────────────────────────────

function csvDoImport() {
  const validRows = csvState.parsed.filter(r => r.errors.length === 0);
  if (!validRows.length) { toast('No valid rows to import', 'error'); return; }

  const snapshot = createDataSnapshot();

  let imported = 0;
  validRows.forEach(({ data }) => {
    // Generate or use SKU
    const sku = data.sku || `SKU-${String(skuCounter).padStart(3, '0')}`;

    products.push({
      id:          nextProdId++,
      sku,
      name:        data.name,
      brand:       data.brand       || '—',
      variant:     data.variant     || '—',
      category:    data.category    || 'Uncategorized',
      cost:        data.cost,
      price:       data.price,
      stock:       data.stock,
      minStock:    data.minStock    || 5,
      batchNumber: data.batchNumber || '',
      expiryDate:  data.expiryDate  || '',
    });

    skuCounter++;
    imported++;
  });

  saveCurrentUserData();
  addMovementEntry('Bulk Import', 'Inventory', `Imported ${imported} product${imported !== 1 ? 's' : ''} via CSV.`);

  render();
  queueUndo(`${imported} product${imported !== 1 ? 's' : ''} imported.`, snapshot);

  // Show success screen
  showCsvSuccess(imported);
}

function showCsvSuccess(count) {
  const body = document.getElementById('csv-modal-body');
  body.innerHTML = `
    <div class="csv-success-screen">
      <div class="csv-success-icon">✓</div>
      <div class="csv-success-title">${count} Product${count !== 1 ? 's' : ''} Imported!</div>
      <div class="csv-success-sub">
        Your inventory has been updated. You can review the new products in the Products table.
      </div>
    </div>
  `;

  document.getElementById('csv-modal-footer').innerHTML = `
    <div class="csv-footer-info">
      <strong>${count} product${count !== 1 ? 's' : ''}</strong> added to your inventory.
    </div>
    <div class="csv-footer-actions">
      <button class="csv-btn-secondary" onclick="csvReset()">Import More</button>
      <button class="csv-btn-primary" onclick="closeCsvImport()">Done ✓</button>
    </div>
  `;

  // Update step indicator
  ['csv-step-1','csv-step-2','csv-step-3','csv-step-4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.classList.add('done'); }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function csvSetNextEnabled(enabled) {
  const btn = document.getElementById('csv-next-btn');
  if (btn) btn.disabled = !enabled;
}

function csvReset() {
  csvState = {
    phase:      'upload',
    rawRows:    [],
    headers:    [],
    mapping:    {},
    parsed:     [],
    fileLoaded: false,
  };

  // Rebuild body if it was replaced by success screen
  const body = document.getElementById('csv-modal-body');
  if (body && !document.getElementById('csv-phase-upload')) {
    // The success screen replaced the body HTML — reload the modal body
    // by re-rendering from scratch via a small template
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
          <div><strong>New to this?</strong> Download our template — fill it in Excel or Google Sheets, then import.</div>
          <button class="csv-dl-btn" onclick="downloadCsvTemplate()">⬇ Template</button>
        </div>
        <div class="csv-drop-zone" id="csv-drop-zone"
          onclick="document.getElementById('csv-file-input').click()"
          ondragover="csvDragOver(event)" ondragleave="csvDragLeave(event)" ondrop="csvDrop(event)"
          role="button" tabindex="0" aria-label="Drop CSV file here or click to browse"
          onkeydown="if(event.key==='Enter'||event.key===' ')document.getElementById('csv-file-input').click()">
          <span class="csv-drop-icon">📂</span>
          <div class="csv-drop-title">Drop your CSV file here</div>
          <div class="csv-drop-sub">Drag &amp; drop a <strong>.csv</strong> file, or click to browse.</div>
          <button class="csv-file-btn" type="button" onclick="event.stopPropagation();document.getElementById('csv-file-input').click()">📁 Browse File</button>
          <input type="file" id="csv-file-input" accept=".csv,text/csv" style="display:none;" onchange="csvFileSelected(event)" />
        </div>
        <div class="csv-paste-area">
          <div class="csv-paste-label"><span></span>Or paste CSV / spreadsheet data directly</div>
          <textarea class="csv-paste-input" id="csv-paste-input"
            placeholder="Name,Category,Brand,CostPrice,SellingPrice,Stock,MinStock&#10;Rice 5kg,Grains,Tata,80,120,50,10"
            spellcheck="false" oninput="csvPasteChanged()" aria-label="Paste CSV data here"></textarea>
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
          <table class="csv-preview-table" id="csv-preview-table">
            <thead id="csv-preview-thead"></thead>
            <tbody id="csv-preview-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Reset footer
  const footer = document.getElementById('csv-modal-footer');
  if (footer) {
    footer.innerHTML = `
      <div class="csv-footer-info" id="csv-footer-info">Upload a CSV file or paste data above to get started.</div>
      <div class="csv-footer-actions">
        <button class="csv-btn-secondary" onclick="csvReset()">Reset</button>
        <button class="csv-btn-primary" id="csv-next-btn" onclick="csvNextStep()" disabled>Next →</button>
      </div>
    `;
  }

  csvSetPhase('upload');
}
// ============================================================================
// INITIALIZATION & EVENT LISTENERS
// ============================================================================

window.addEventListener('load', () => {
  loadFeaturePanels();   // keep legacy data compatible
  loadViewMode();
  initAuth();
  loadTheme();
  updateThemeButton();
  syncProfileMenuTheme();
  loadCurrency();
  applyViewMode();       // show correct sections from the start
  fetchExchangeRates();
  render();
  if (activeViewMode === 'insights') renderDashboard();
  notifyImportantEvents();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { switchViewMode('home'); closeProfileMenu(); }
  if (event.key !== 'Enter') return;
  if (document.getElementById('auth-overlay')?.style.display === 'none') return;
  handleAuthAction();
});

document.addEventListener('click', event => {
  const { profileMenu } = getAuthElements();
  if (!profileMenu) return;
  if (!profileMenu.contains(event.target)) closeProfileMenu();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service worker registered'))
    .catch(err => console.log('SW error:', err));
}