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
let barChart = null;
let doughnutChart = null;
let authMode = 'login';
let currentUser = null;
let dailyGoal = 0;

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
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
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
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

  setUserValue(userId, 'products', JSON.parse(localStorage.getItem('products')) || []);
  setUserValue(userId, 'transactions', JSON.parse(localStorage.getItem('transactions')) || []);
  setUserValue(userId, 'restockHistory', JSON.parse(localStorage.getItem('restockHistory')) || []);
  setUserValue(userId, 'reviewed', JSON.parse(localStorage.getItem('reviewed')) || []);
  setUserValue(userId, 'currency', localStorage.getItem('currency') || 'INR');
  setUserValue(userId, 'skuCounter', parseInt(localStorage.getItem('skuCounter')) || 1);
  setUserValue(userId, 'dailyGoal', parseFloat(localStorage.getItem('dailyGoal')) || 0);
}

function loadCurrentUserData() {
  if (!currentUser) return;

  migrateLegacyDataToUser(currentUser.id);

  products = getUserValue(currentUser.id, 'products', []);
  transactions = getUserValue(currentUser.id, 'transactions', []);
  restockHistory = getUserValue(currentUser.id, 'restockHistory', []);
  reviewedProducts = getUserValue(currentUser.id, 'reviewed', []);
  currency = getUserValue(currentUser.id, 'currency', 'INR');
  skuCounter = parseInt(getUserValue(currentUser.id, 'skuCounter', 1)) || 1;
  dailyGoal = parseFloat(getUserValue(currentUser.id, 'dailyGoal', 0)) || 0;
  nextProdId = Math.max(Date.now(), ...products.map(p => Number(p.id) || 0)) + 1;

  const currencySelect = document.getElementById('currency-select');
  if (currencySelect) currencySelect.value = currency;
}

function saveCurrentUserData() {
  if (!currentUser) return;
  setUserValue(currentUser.id, 'products', products);
  setUserValue(currentUser.id, 'transactions', transactions);
  setUserValue(currentUser.id, 'restockHistory', restockHistory);
  setUserValue(currentUser.id, 'reviewed', reviewedProducts);
  setUserValue(currentUser.id, 'currency', currency);
  setUserValue(currentUser.id, 'skuCounter', skuCounter);
  setUserValue(currentUser.id, 'dailyGoal', dailyGoal);
}

function getAuthElements() {
  return {
    overlay: document.getElementById('auth-overlay'),
    shell: document.getElementById('app-shell'),
    title: document.getElementById('auth-title'),
    subtitle: document.getElementById('auth-subtitle'),
    name: document.getElementById('auth-name'),
    nameGroup: document.getElementById('auth-name-group'),
    email: document.getElementById('auth-email'),
    password: document.getElementById('auth-password'),
    confirm: document.getElementById('auth-confirm-password'),
    confirmGroup: document.getElementById('auth-confirm-group'),
    submit: document.getElementById('auth-submit-btn'),
    switchBtn: document.getElementById('auth-switch-btn'),
    message: document.getElementById('auth-message'),
    profileMenu: document.getElementById('header-profile-menu'),
    profileChip: document.getElementById('header-profile-chip'),
    profileDropdown: document.getElementById('header-profile-dropdown'),
    userBadge: document.getElementById('header-current-user-badge'),
    themeMenuIcon: document.getElementById('header-theme-menu-icon'),
    themeMenuLabel: document.getElementById('header-theme-menu-label')
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

  title.textContent = signupMode ? 'Create your account' : 'Log in to Shop Tracker';
  subtitle.textContent = signupMode
    ? 'Create an account to keep products, sales, and goals separate for each user.'
    : 'Sign in to open your own inventory and sales dashboard.';
  nameGroup.style.display = signupMode ? 'block' : 'none';
  confirmGroup.style.display = signupMode ? 'block' : 'none';
  submit.textContent = signupMode ? 'Sign Up' : 'Log In';
  switchBtn.style.display = 'inline-flex';
  switchBtn.textContent = signupMode ? 'Already have an account?' : 'Need to create an account?';

  name.value = '';
  email.value = '';
  password.value = '';
  confirm.value = '';
  message.textContent = '';
  (signupMode ? name : email).focus();
}

function updateAuthUI() {
  const { overlay, shell, profileMenu, profileChip, profileDropdown, userBadge } = getAuthElements();
  const authed = isAuthenticated();

  if (overlay) overlay.style.display = authed ? 'none' : 'flex';
  if (shell) shell.classList.toggle('app-shell-hidden', !authed);
  if (profileMenu) profileMenu.style.display = authed && currentUser ? 'inline-flex' : 'none';
  if (userBadge) {
    userBadge.textContent = currentUser ? currentUser.name || currentUser.email : '';
  }
  if (!authed && profileMenu) profileMenu.style.display = 'none';
  if (profileChip) profileChip.setAttribute('aria-expanded', 'false');
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
  const userEmail = normalizeEmail(email.value);
  const pwd = password.value.trim();

  if (!userEmail) {
    setAuthMessage('Enter a valid email address.', 'error');
    return;
  }

  if (pwd.length < 4) {
    setAuthMessage('Use at least 4 characters for the password.', 'error');
    return;
  }

  if (authMode === 'signup') {
    if (!displayName) {
      setAuthMessage('Enter your name to create the account.', 'error');
      return;
    }
    if (pwd !== confirm.value.trim()) {
      setAuthMessage('Passwords do not match.', 'error');
      return;
    }

    const users = getUsers();
    if (users.some(user => user.email === userEmail)) {
      setAuthMessage('That email is already registered. Log in instead.', 'error');
      return;
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(pwd, salt);
    const user = {
      id: `user-${Date.now()}`,
      name: displayName,
      email: userEmail,
      salt,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    saveUsers(users);
    completeLogin(user);
    toast(`Welcome, ${user.name}`);
    return;
  }

  const users = getUsers();
  const user = users.find(item => item.email === userEmail);
  if (!user) {
    setAuthMessage('No account found for that email.', 'error');
    return;
  }

  const passwordHash = await hashPassword(pwd, user.salt);
  if (passwordHash !== user.passwordHash) {
    setAuthMessage('Incorrect password. Try again.', 'error');
    return;
  }

  completeLogin(user);
  setAuthMessage('');
  toast(`Welcome back, ${user.name}`);
}

function logout() {
  closeProfileMenu();
  sessionStorage.removeItem('isAuthenticated');
  setCurrentUserId(null);
  currentUser = null;
  products = [];
  transactions = [];
  restockHistory = [];
  reviewedProducts = [];
  dailyGoal = 0;
  currency = 'INR';
  skuCounter = 1;
  updateAuthMode(getUsers().length ? 'login' : 'signup');
  updateAuthUI();
}

function initAuth() {
  const userId = getCurrentUserId();
  currentUser = getUsers().find(user => user.id === userId) || null;
  if (isAuthenticated() && currentUser) {
    loadCurrentUserData();
  }
  updateAuthMode(getUsers().length ? 'login' : 'signup');
  updateAuthUI();
}

function fmt(amount) {
  const symbols = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
  const converted = convertAmount(amount);
  const symbol    = symbols[currency] || currency;
  return symbol + Math.round(converted).toLocaleString('en-IN');
}

function convertAmount(amount) {
  if (!exchangeRates || currency === baseCurrency) return amount;
  const inUSD    = amount / (exchangeRates['INR'] || 1);
  const inTarget = inUSD * (exchangeRates[currency] || 1);
  return inTarget;
}

function setCurrency(val) {
  currency = val;
  saveCurrentUserData();
  render();
  toast(`Currency switched to ${val}`);
}

function loadCurrency() {
  const el    = document.getElementById('currency-select');
  if (el) el.value = currency;
}

async function fetchExchangeRates() {
  // Use cached rates if less than 1 hour old
  const now     = Date.now();
  const oneHour = 60 * 60 * 1000;

  if (exchangeRates && ratesUpdatedAt && (now - parseInt(ratesUpdatedAt)) < oneHour) {
    updateRatesBadge('Rates cached');
    return;
  }

  updateRatesBadge('Fetching rates...');

  try {
    const res  = await fetch('https://v6.exchangerate-api.com/v6/c4700f47c7f6f17c24b3d4f6/latest/USD');
    const data = await res.json();

    if (data.result === 'success') {
      exchangeRates  = data.conversion_rates;
      ratesUpdatedAt = Date.now().toString();
      localStorage.setItem('exchangeRates',  JSON.stringify(exchangeRates));
      localStorage.setItem('ratesUpdatedAt', ratesUpdatedAt);
      updateRatesBadge(`Rates updated`);
      render();
      toast('✓ Live exchange rates loaded');
    } else {
      updateRatesBadge('Rates unavailable');
      toast('Could not fetch rates', 'error');
    }
  } catch (err) {
    updateRatesBadge('Offline — cached rates');
    toast('Using cached rates', 'info');
  }
}

function updateRatesBadge(text) {
  const el = document.getElementById('rates-badge');
  if (el) el.textContent = text;
}

function render() {
  renderStats();
  renderDashboard();
  renderProducts();
  renderTransactions();
  renderDeadStock();
  renderSmartInsights();
  renderRestockHistory();
  renderCategoryReport();
  renderBreakEven();
  renderGoal();
}

function renderStats() {
  const totalRevenue = transactions.reduce((s, t) => s + t.total, 0);
  const totalProfit  = transactions.reduce((s, t) => s + t.profit, 0);
  const totalCost    = transactions.reduce((s, t) => s + t.totalCost, 0);

  // This week vs last week
  const now       = new Date();
  const weekAgo   = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const twoWkAgo  = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today     = now.toISOString().split('T')[0];

  const thisWeek  = transactions.filter(t => t.date >= weekAgo  && t.date <= today);
  const lastWeek  = transactions.filter(t => t.date >= twoWkAgo && t.date < weekAgo);

  const thisRev   = thisWeek.reduce((s, t) => s + t.total, 0);
  const lastRev   = lastWeek.reduce((s, t) => s + t.total, 0);
  const trend     = getTrend(thisRev, lastRev);

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

function addProduct() {
  const name     = document.getElementById('prod-name').value.trim();
  const category = document.getElementById('prod-category').value.trim() || 'Uncategorized';
  const brand    = document.getElementById('prod-brand').value.trim() || '—';
  const variant  = document.getElementById('prod-variant').value.trim() || '—';
  const cost     = parseFloat(document.getElementById('prod-cost').value);
  const price    = parseFloat(document.getElementById('prod-price').value);
  const stock    = parseInt(document.getElementById('prod-stock').value);
  const minStock = parseInt(document.getElementById('prod-min').value) || 5;
  const skuInput = document.getElementById('prod-sku').value.trim();
  const sku      = skuInput || `SKU-${String(skuCounter).padStart(3, '0')}`;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all fields correctly', 'error'); return;
  }
  if (cost >= price) {
    toast('Selling price must be greater than cost price', 'error'); return;
  }

  products.push({ id: nextProdId++, sku, name, brand, variant, category, cost, price, stock, minStock });
  skuCounter++;
  saveCurrentUserData();
  saveProducts();
  clearProductForm();
  render();
  toast(`✓ ${name} added (${sku})`);
}
function deleteProduct(id) {
  products = products.filter(p => p.id !== id);
  saveProducts();
  render();
}
function editProduct(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  document.getElementById('prod-name').value     = p.name;
  document.getElementById('prod-category').value = p.category || '';
  document.getElementById('prod-brand').value    = p.brand || '';
  document.getElementById('prod-variant').value  = p.variant || '';
  document.getElementById('prod-sku').value      = p.sku || '';
  document.getElementById('prod-cost').value     = p.cost;
  document.getElementById('prod-price').value    = p.price;
  document.getElementById('prod-stock').value    = p.stock;
  document.getElementById('prod-min').value      = p.minStock;

  const btn = document.querySelector('.form-section button');
  btn.textContent = '💾 Save Edit';
  btn.onclick     = () => saveEdit(id);
}

function saveEdit(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  const name     = document.getElementById('prod-name').value.trim();
  const category = document.getElementById('prod-category').value.trim() || 'Uncategorized';
  const brand    = document.getElementById('prod-brand').value.trim() || '—';
  const variant  = document.getElementById('prod-variant').value.trim() || '—';
  const sku      = document.getElementById('prod-sku').value.trim() || p.sku;
  const cost     = parseFloat(document.getElementById('prod-cost').value);
  const price    = parseFloat(document.getElementById('prod-price').value);
  const stock    = parseInt(document.getElementById('prod-stock').value);
  const minStock = parseInt(document.getElementById('prod-min').value) || 5;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all fields correctly', 'error'); return;
  }
  if (cost >= price) {
    toast('Selling price must be greater than cost price', 'error'); return;
  }

  p.name = name; p.category = category; p.brand = brand;
  p.variant = variant; p.sku = sku; p.cost = cost;
  p.price = price; p.stock = stock; p.minStock = minStock;

  saveProducts();
  clearProductForm();

  const btn = document.querySelector('.form-section button');
  btn.textContent = '+ Add Product';
  btn.onclick     = addProduct;

  render();
  toast(`✓ ${name} updated`);
}

function sellProduct(id) {
  const qtyInput  = document.getElementById('qty-' + id);
  const noteInput = document.getElementById('note-' + id);
  const qty       = parseInt(qtyInput.value);
  const note      = noteInput ? noteInput.value.trim() : '';
  const product   = products.find(p => p.id === id);

  if (!product) return;
  if (isNaN(qty) || qty <= 0) { toast('Enter a valid quantity', 'error'); return; }
  if (qty > product.stock)    { toast('Not enough stock', 'error'); return; }

  const total     = qty * product.price;
  const totalCost = qty * product.cost;
  const profit    = total - totalCost;
  const date      = new Date().toISOString().split('T')[0];

  product.stock -= qty;

  transactions.unshift({
    id: Date.now(),
    date, product: product.name,
    qty, cost: product.cost, price: product.price,
    total, totalCost, profit, note
  });

  qtyInput.value  = '';
  if (noteInput) noteInput.value = '';
  saveProducts();
  render();
  toast(`✓ Sold ${qty}x ${product.name} for ${fmt(total)}`);
}

function saveProducts() {
  saveCurrentUserData();
}

function clearProductForm() {
  document.getElementById('prod-name').value     = '';
  document.getElementById('prod-category').value = '';
  document.getElementById('prod-brand').value    = '';
  document.getElementById('prod-variant').value  = '';
  document.getElementById('prod-sku').value      = '';
  document.getElementById('prod-cost').value     = '';
  document.getElementById('prod-price').value    = '';
  document.getElementById('prod-stock').value    = '';
  document.getElementById('prod-min').value      = '';
}

function clearAllData() {
  showConfirm('Delete all data for this account? This cannot be undone.', () => {
    if (!currentUser) return;
    ['products', 'transactions', 'restockHistory', 'reviewed', 'currency', 'skuCounter', 'dailyGoal'].forEach(key => {
      removeUserValue(currentUser.id, key);
    });
    products = []; transactions = []; restockHistory = []; reviewedProducts = [];
    dailyGoal = 0;
    currency = 'INR';
    skuCounter = 1;
    loadCurrency();
    render();
    toast('All data cleared', 'error');
  });
}

function setSearch(val) {
  searchQuery = val.toLowerCase();
  renderProducts();
}

function setCategory(val) {
  filterCategory = val;
  renderProducts();
}

function setSort(val) {
  sortBy = val;
  renderProducts();
}

function backupData() {
  const data = {
    user: currentUser ? { id: currentUser.id, name: currentUser.name, email: currentUser.email } : null,
    products,
    transactions,
    restockHistory,
    reviewedProducts,
    dailyGoal,
    currency,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `shop-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function restoreData(event) {
  const file   = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('This will replace all current data. Are you sure?')) return;
      products         = data.products         || [];
      transactions     = data.transactions     || [];
      restockHistory   = data.restockHistory   || [];
      reviewedProducts = data.reviewedProducts || [];
      dailyGoal        = parseFloat(data.dailyGoal) || 0;
      skuCounter       = products.length + 1;
      currency         = data.currency         || 'INR';
      saveProducts();
      saveCurrentUserData();
      document.getElementById('currency-select').value = currency;
      render();
      alert('Data restored successfully!');
    } catch(err) {
      alert('Invalid backup file.');
    }
  };
  reader.readAsText(file);
}

function getTrend(current, previous) {
  if (previous === 0) return { arrow: '', pct: '', color: 'var(--muted)' };
  const pct = (((current - previous) / previous) * 100).toFixed(1);
  if (pct > 0)  return { arrow: '↑', pct: pct + '%', color: '#1D9E75' };
  if (pct < 0)  return { arrow: '↓', pct: Math.abs(pct) + '%', color: '#D85A30' };
  return { arrow: '→', pct: '0%', color: '#6b7280' };
}

function renderProducts() {
  renderRestockAlert();
  updateCategoryFilter();

  let list = [...products];
  if (searchQuery) list = list.filter(p => p.name.toLowerCase().includes(searchQuery));
  if (filterCategory !== 'all') list = list.filter(p => (p.category || 'Uncategorized') === filterCategory);
  if (sortBy === 'stock-asc')  list.sort((a, b) => a.stock - b.stock);
  if (sortBy === 'stock-desc') list.sort((a, b) => b.stock - a.stock);
  if (sortBy === 'price-asc')  list.sort((a, b) => a.price - b.price);
  if (sortBy === 'price-desc') list.sort((a, b) => b.price - a.price);

  const tbody = document.getElementById('prod-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No products match your search.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(p => {
    const margin  = (((p.price - p.cost) / p.price) * 100).toFixed(1);
    const isLow   = p.stock <= p.minStock;
    const isEmpty = p.stock === 0;
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

function renderTransactions() {
  const tbody    = document.getElementById('txn-body');
  const filtered = getFilteredTransactions();
  const totalProfit = filtered.reduce((s, t) => s + t.profit, 0);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No transactions found.</td></tr>';
    document.getElementById('total-profit').textContent = fmt(0);
    return;
  }

  tbody.innerHTML = filtered.map(t => `
    <tr>
      <td>${t.date}</td>
      <td>
        <div style="font-weight:600;">${t.product}</div>
        ${t.note ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">📝 ${t.note}</div>` : ''}
      </td>
      <td>${t.qty}</td>
      <td>${fmt(t.price)}</td>
      <td style="color:#1D9E75;font-weight:700;">+${fmt(t.total)}</td>
      <td style="color:#7c6af7;font-weight:700;">+${fmt(t.profit)}</td>
      <td><button onclick="deleteTransaction(${t.id})">✕</button></td>
    </tr>
  `).join('');

  document.getElementById('total-profit').textContent = fmt(totalProfit);
}

function renderDashboard() {
  const today     = new Date().toISOString().split('T')[0];
  const todayTxns = transactions.filter(t => t.date === today);
  const soldToday = todayTxns.reduce((s, t) => s + t.qty, 0);
  const revToday  = todayTxns.reduce((s, t) => s + t.total, 0);
  const profToday = todayTxns.reduce((s, t) => s + t.profit, 0);

  document.getElementById('kpi-sold').textContent    = soldToday;
  document.getElementById('kpi-revenue').textContent = fmt(revToday);
  document.getElementById('kpi-profit').textContent  = fmt(profToday);

  const productTotals = {};
  transactions.forEach(t => {
    productTotals[t.product] = (productTotals[t.product] || 0) + t.qty;
  });
  const top = Object.entries(productTotals).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('kpi-top').textContent = top ? `${top[0]} (${top[1]} sold)` : '—';

  const days = [];
  const dayLabels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
    dayLabels.push(d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
  }

  const revenueByDay = days.map(day => transactions.filter(t => t.date === day).reduce((s, t) => s + t.total, 0));
  const profitByDay  = days.map(day => transactions.filter(t => t.date === day).reduce((s, t) => s + t.profit, 0));

  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: dayLabels,
      datasets: [
        { label: 'Revenue', data: revenueByDay, backgroundColor: 'rgba(29,158,117,0.7)', borderRadius: 6, borderSkipped: false },
        { label: 'Profit',  data: profitByDay,  backgroundColor: 'rgba(124,106,247,0.7)', borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#6b7280', font: { size: 11 }, callback: v => fmt(v) }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });

  const prodRevenue = {};
  transactions.forEach(t => { prodRevenue[t.product] = (prodRevenue[t.product] || 0) + t.total; });
  const prodNames  = Object.keys(prodRevenue);
  const prodValues = Object.values(prodRevenue);
  const colors = ['#1D9E75','#7c6af7','#D85A30','#eab308','#378ADD','#e879a0','#14b8a6','#f97316'];

  if (doughnutChart) doughnutChart.destroy();
  if (!prodNames.length) {
    document.getElementById('donut-legend').innerHTML = '<span style="color:#6b7280;font-size:13px;">No sales yet</span>';
  } else {
    doughnutChart = new Chart(document.getElementById('doughnutChart'), {
      type: 'doughnut',
      data: {
        labels: prodNames,
        datasets: [{ data: prodValues, backgroundColor: colors.slice(0, prodNames.length), borderWidth: 0, hoverOffset: 6 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
    });
    document.getElementById('donut-legend').innerHTML = prodNames.map((n, i) => `
      <span style="display:flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;">
        <span style="width:10px;height:10px;border-radius:2px;background:${colors[i]};flex-shrink:0;"></span>
        ${n}
      </span>
    `).join('');
  }
}

function renderRestockAlert() {
  const lowItems = products.filter(p => p.stock <= p.minStock);
  const banner   = document.getElementById('restock-banner');
  if (!lowItems.length) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex';
  document.getElementById('restock-list').innerHTML = lowItems.map(p =>
    `<span class="restock-tag">${p.name} — ${p.stock} left</span>`
  ).join('');
}

function setDeadStockDays(val) {
  deadStockDays = parseInt(val);
  document.getElementById('days-label').textContent = val + ' days';
  renderDeadStock();
}

function markReviewed(id) {
  if (!reviewedProducts.includes(id)) {
    reviewedProducts.push(id);
    saveCurrentUserData();
  }
  renderDeadStock();
}

function renderDeadStock() {
  const today   = new Date();
  const tbody   = document.getElementById('dead-body');
  const countEl = document.getElementById('dead-count');

  const deadList = products.filter(p => {
    if (reviewedProducts.includes(p.id)) return false;
    const lastSale = transactions.filter(t => t.product === p.name).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (!lastSale) return p.stock > 0;
    const daysSince = Math.floor((today - new Date(lastSale.date)) / (1000 * 60 * 60 * 24));
    return daysSince >= deadStockDays && p.stock > 0;
  }).map(p => {
    const lastSale  = transactions.filter(t => t.product === p.name).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const daysSince = lastSale ? Math.floor((today - new Date(lastSale.date)) / (1000 * 60 * 60 * 24)) : null;
    return { ...p, daysSince, idleValue: p.stock * p.cost };
  });

  countEl.textContent = deadList.length;

  if (!deadList.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No dead stock found — all products sold within ${deadStockDays} days.</td></tr>`;
    return;
  }

  tbody.innerHTML = deadList.map(p => `
    <tr class="row-dead">
      <td>
        <div style="font-weight:600;">${p.name}</div>
        <div style="font-size:12px;color:var(--muted);">${p.category || 'Uncategorized'}</div>
      </td>
      <td><span class="badge danger">${p.daysSince === null ? 'Never sold' : p.daysSince + ' days ago'}</span></td>
      <td>${p.stock} units</td>
      <td style="color:#eab308;font-weight:700;">${fmt(p.idleValue)}</td>
      <td><button class="reviewed-btn" onclick="markReviewed(${p.id})">✓ Mark reviewed</button></td>
    </tr>
  `).join('');
}

function renderSmartInsights() {
  const today     = new Date().toISOString().split('T')[0];
  const todayTxns = transactions.filter(t => t.date === today);
  const todayRev    = todayTxns.reduce((s, t) => s + t.total, 0);
  const todayProfit = todayTxns.reduce((s, t) => s + t.profit, 0);
  const todayItems  = todayTxns.reduce((s, t) => s + t.qty, 0);

  document.getElementById('summary-rev').textContent    = fmt(todayRev);
  document.getElementById('summary-profit').textContent = fmt(todayProfit);
  document.getElementById('summary-items').textContent  = todayItems;

  const dayMap = {};
  transactions.forEach(t => {
    const day = new Date(t.date).toLocaleDateString('en-IN', { weekday: 'long' });
    dayMap[day] = (dayMap[day] || 0) + t.total;
  });
  const bestDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0];
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

function restockProduct(id) {
  const qtyInput  = document.getElementById('restock-qty-' + id);
  const costInput = document.getElementById('restock-cost-' + id);
  const qty       = parseInt(qtyInput.value);
  const cost      = parseFloat(costInput.value);
  const product   = products.find(p => p.id === id);

  if (!product) return;
  if (isNaN(qty) || qty <= 0)  { toast('Enter a valid quantity', 'error'); return; }
  if (isNaN(cost) || cost < 0) { toast('Enter a valid cost', 'error'); return; }

  product.stock += qty;
  restockHistory.unshift({
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    product: product.name, qty, cost, total: qty * cost
  });

  qtyInput.value  = '';
  costInput.value = '';
  saveCurrentUserData();
  saveProducts();
  render();
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
      <td>${r.product}</td>
      <td>${r.qty} units</td>
      <td>${fmt(r.cost)} per unit</td>
      <td style="color:#eab308;font-weight:700;">${fmt(r.total)}</td>
    </tr>
  `).join('');
}

function exportCSV() {
  const rows = [
    ['--- SALES TRANSACTIONS ---'],
    ['Date', 'Product', 'Qty', 'Unit Price', 'Total', 'Cost', 'Profit'],
    ...transactions.map(t => [t.date, t.product, t.qty, t.price, t.total, t.totalCost, t.profit]),
    [],
    ['--- RESTOCK HISTORY ---'],
    ['Date', 'Product', 'Qty Added', 'Cost Per Unit', 'Total Paid'],
    ...restockHistory.map(r => [r.date, r.product, r.qty, r.cost, r.total])
  ];
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `shop-tracker-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc    = new jsPDF();
  const today  = new Date().toISOString().split('T')[0];
  const green  = [29, 158, 117];
  const dark   = [30, 30, 40];

  doc.setFillColor(...dark);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Shop Tracker — Daily Report', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text(`Generated: ${today}`, 14, 26);

  const totalRev    = transactions.reduce((s, t) => s + t.total, 0);
  const totalProfit = transactions.reduce((s, t) => s + t.profit, 0);
  const totalCost   = transactions.reduce((s, t) => s + t.totalCost, 0);

  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...dark);
  doc.text('Summary', 14, 42);
  doc.autoTable({
    startY: 46,
    head: [['Total Revenue', 'Total Cost', 'Gross Profit', 'Items Sold']],
    body: [[fmt(totalRev), fmt(totalCost), fmt(totalProfit), transactions.reduce((s, t) => s + t.qty, 0)]],
    headStyles: { fillColor: green, textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: dark },
    margin: { left: 14, right: 14 }
  });

  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...dark);
  doc.text('Sales Transactions', 14, doc.lastAutoTable.finalY + 14);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 18,
    head: [['Date', 'Product', 'Qty', 'Unit Price', 'Total', 'Profit']],
    body: transactions.map(t => [t.date, t.product, t.qty, fmt(t.price), fmt(t.total), fmt(t.profit)]),
    headStyles: { fillColor: green, textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: dark },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 14, right: 14 }
  });

  const todayDate = new Date();
  const deadList  = products.filter(p => {
    const lastSale = transactions.filter(t => t.product === p.name).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (!lastSale) return p.stock > 0;
    return Math.floor((todayDate - new Date(lastSale.date)) / (1000 * 60 * 60 * 24)) >= deadStockDays && p.stock > 0;
  });

  if (deadList.length) {
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...dark);
    doc.text('Dead Stock', 14, doc.lastAutoTable.finalY + 14);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Product', 'Stock', 'Idle Value']],
      body: deadList.map(p => [p.name, p.stock + ' units', fmt(p.stock * p.cost)]),
      headStyles: { fillColor: [216, 90, 48], textColor: 255, fontStyle: 'bold' },
      bodyStyles: { textColor: dark },
      margin: { left: 14, right: 14 }
    });
  }

  doc.setFontSize(9); doc.setTextColor(150, 150, 150);
  doc.text('Generated by Shop Tracker', 14, 290);
  doc.save(`shop-report-${today}.pdf`);
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  document.getElementById('theme-btn').textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeButton();
  syncProfileMenuTheme();
}

function loadTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.body.classList.add('light');
    document.getElementById('theme-btn').textContent = '☀️';
  }
  syncProfileMenuTheme();
}

function updateThemeButton() {
  const themeBtn = document.getElementById('theme-btn');
  if (!themeBtn) return;
  const isLight = document.body.classList.contains('light');
  themeBtn.textContent = isLight ? '☾' : '✺';
  themeBtn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  themeBtn.setAttribute('aria-label', themeBtn.title);
}

function syncProfileMenuTheme() {
  const { themeMenuIcon, themeMenuLabel } = getAuthElements();
  const isLight = document.body.classList.contains('light');
  if (themeMenuIcon) themeMenuIcon.textContent = isLight ? '☾' : '✺';
  if (themeMenuLabel) themeMenuLabel.textContent = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  closeProfileMenu();
}

window.addEventListener('load', () => {
  initAuth();
  loadTheme();
  updateThemeButton();
  syncProfileMenuTheme();
  loadCurrency();
  fetchExchangeRates();
  render();
  renderDashboard();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeProfileMenu();
  if (event.key !== 'Enter') return;
  if (document.getElementById('auth-overlay')?.style.display === 'none') return;
  handleAuthAction();
});

document.addEventListener('click', event => {
  const { profileMenu } = getAuthElements();
  if (!profileMenu) return;
  if (!profileMenu.contains(event.target)) closeProfileMenu();
});

// Feature 4 — Date Range Filter
let dateFrom = '';
let dateTo   = '';

function setDateFrom(val) {
  dateFrom = val;
  renderTransactions();
  renderDateStats();
}

function setDateTo(val) {
  dateTo = val;
  renderTransactions();
  renderDateStats();
}

function clearDateFilter() {
  dateFrom = '';
  dateTo   = '';
  document.getElementById('date-from').value = '';
  document.getElementById('date-to').value   = '';
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
  const filtered = getFilteredTransactions();
  const rev    = filtered.reduce((s, t) => s + t.total, 0);
  const profit = filtered.reduce((s, t) => s + t.profit, 0);
  const cost   = filtered.reduce((s, t) => s + t.totalCost, 0);
  const items  = filtered.reduce((s, t) => s + t.qty, 0);

  const el = document.getElementById('date-stats');
  if (!el) return;

  if (!dateFrom && !dateTo) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'flex';
  el.innerHTML = `
    <div class="date-stat-card">
      <div class="date-stat-label">Revenue</div>
      <div class="date-stat-value" style="color:#1D9E75;">${fmt(rev)}</div>
    </div>
    <div class="date-stat-card">
      <div class="date-stat-label">Cost</div>
      <div class="date-stat-value" style="color:#D85A30;">${fmt(cost)}</div>
    </div>
    <div class="date-stat-card">
      <div class="date-stat-label">Profit</div>
      <div class="date-stat-value" style="color:#7c6af7;">${fmt(profit)}</div>
    </div>
    <div class="date-stat-card">
      <div class="date-stat-label">Items Sold</div>
      <div class="date-stat-value">${items}</div>
    </div>
  `;
}

// Feature 5 — Monthly/Weekly Report
function renderReport(period) {
  const now    = new Date();
  const report = document.getElementById('report-body');
  const title  = document.getElementById('report-title');
  let groups   = {};

  transactions.forEach(t => {
    const d   = new Date(t.date);
    let key;
    if (period === 'weekly') {
      const weekNum = getWeekNumber(d);
      key = `Week ${weekNum}, ${d.getFullYear()}`;
    } else {
      key = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    }
    if (!groups[key]) groups[key] = { revenue: 0, cost: 0, profit: 0, items: 0 };
    groups[key].revenue += t.total;
    groups[key].cost    += t.totalCost;
    groups[key].profit  += t.profit;
    groups[key].items   += t.qty;
  });

  title.textContent = period === 'weekly' ? 'Weekly Report' : 'Monthly Report';

  const entries = Object.entries(groups).reverse();
  if (!entries.length) {
    report.innerHTML = '<tr><td colspan="5" class="empty">No data yet.</td></tr>';
    return;
  }

  report.innerHTML = entries.map(([period, d]) => `
    <tr>
      <td style="font-weight:600;">${period}</td>
      <td style="color:#1D9E75;font-weight:700;">${fmt(d.revenue)}</td>
      <td style="color:#D85A30;font-weight:700;">${fmt(d.cost)}</td>
      <td style="color:#7c6af7;font-weight:700;">${fmt(d.profit)}</td>
      <td>${d.items}</td>
    </tr>
  `).join('');
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

// Feature 6 — Category-wise Profit Report
function renderCategoryReport() {
  const catMap = {};

  transactions.forEach(t => {
    const product = products.find(p => p.name === t.product);
    const cat     = product ? (product.category || 'Uncategorized') : 'Uncategorized';
    if (!catMap[cat]) catMap[cat] = { revenue: 0, cost: 0, profit: 0, items: 0, products: new Set() };
    catMap[cat].revenue  += t.total;
    catMap[cat].cost     += t.totalCost;
    catMap[cat].profit   += t.profit;
    catMap[cat].items    += t.qty;
    catMap[cat].products.add(t.product);
  });

  const tbody = document.getElementById('cat-report-body');
  const entries = Object.entries(catMap).sort((a, b) => b[1].profit - a[1].profit);

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No sales data yet.</td></tr>';
    return;
  }

  const totalRevenue = entries.reduce((s, [, d]) => s + d.revenue, 0);

  tbody.innerHTML = entries.map(([cat, d]) => {
    const share  = totalRevenue > 0 ? ((d.revenue / totalRevenue) * 100).toFixed(1) : 0;
    const margin = d.revenue > 0 ? ((d.profit / d.revenue) * 100).toFixed(1) : 0;
    return `
      <tr>
        <td>
          <span class="badge" style="background:rgba(124,106,247,0.12);color:#7c6af7;">${cat}</span>
        </td>
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

// Feature 8 — Break-even Calculator
function renderBreakEven() {
  const tbody = document.getElementById('breakeven-body');
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No products yet.</td></tr>';
    return;
  }

  // Get today's restock costs
  const today        = new Date().toISOString().split('T')[0];
  const todayRestock = restockHistory.filter(r => r.date === today);

  // Total fixed cost today (restock spending)
  const totalRestockToday = todayRestock.reduce((s, r) => s + r.total, 0);

  tbody.innerHTML = products.map(p => {
    // Units needed to break even on restock cost
    const profitPerUnit  = p.price - p.cost;
    const restockForThis = todayRestock.filter(r => r.product === p.name).reduce((s, r) => s + r.total, 0);
    const unitsNeeded    = profitPerUnit > 0 ? Math.ceil(restockForThis / profitPerUnit) : '—';

    // Units sold today for this product
    const soldToday = transactions
      .filter(t => t.date === today && t.product === p.name)
      .reduce((s, t) => s + t.qty, 0);

    const status = unitsNeeded === '—'
      ? '<span class="badge expense">No margin</span>'
      : soldToday >= unitsNeeded
      ? '<span class="badge income">✓ Break-even reached</span>'
      : `<span class="badge warning">${unitsNeeded - soldToday} more to go</span>`;

    return `
      <tr>
        <td style="font-weight:600;">${p.name}</td>
        <td>${fmt(p.price - p.cost)} per unit</td>
        <td>${fmt(restockForThis)}</td>
        <td style="font-weight:700;">${unitsNeeded === '—' ? '—' : unitsNeeded + ' units'}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join('');

  // Overall break-even
  const totalProfitToday = transactions
    .filter(t => t.date === today)
    .reduce((s, t) => s + t.profit, 0);

  const overallEl = document.getElementById('breakeven-overall');
  if (overallEl) {
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
}

// Feature 9 — Toast Notifications
function toast(message, type = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const icons = {
    success: '✓',
    error: '!',
    info: 'i'
  };

  const t = document.createElement('div');
  t.id    = 'toast';
  t.className = `toast toast-${type}`;
  t.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.success}</div>
    <div class="toast-copy">
      <div class="toast-label">${type === 'error' ? 'Action needed' : type === 'info' ? 'Heads up' : 'Success'}</div>
      <div class="toast-message">${message}</div>
    </div>
    <div class="toast-progress"></div>
  `;
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-exit');
    setTimeout(() => t.remove(), 320);
  }, 2600);
}

// Feature 10 — Delete Transaction
function deleteTransaction(id) {
  transactions = transactions.filter(t => t.id !== id);
  saveProducts();
  render();
  toast('Transaction deleted');
}

// Feature 11 — Profit Goal Tracker

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
  const todayProfit = transactions.filter(t => t.date === today).reduce((s, t) => s + t.profit, 0);
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

function showConfirm(message, onYes) {
  const existing = document.getElementById('confirm-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id    = 'confirm-modal';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 9998;
  `;

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
  document.getElementById('confirm-yes').onclick = () => {
    overlay.remove();
    onYes();
  };
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service worker registered'))
    .catch(err => console.log('SW error:', err));
}
