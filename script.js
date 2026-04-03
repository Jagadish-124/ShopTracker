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
const FEATURE_PANEL_KEY = 'featurePanels';
const VIEW_MODE_KEY = 'activeViewMode';
const featurePanelDefaults = {
  analytics: false,
  stock: false,
  timeline: false,
  reports: false
};
let featurePanels = { ...featurePanelDefaults };
let activeViewMode = 'home';
const featurePanelViews = {
  analytics: 'insights',
  stock: 'inventory',
  timeline: 'insights',
  reports: 'reports'
};

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
  setUserValue(userId, 'movementHistory', []);
  setUserValue(userId, 'notificationSettings', { enabled: false, lowStock: true, goal: true });
}

function loadCurrentUserData() {
  if (!currentUser) return;

  migrateLegacyDataToUser(currentUser.id);

  products = getUserValue(currentUser.id, 'products', []);
  transactions = getUserValue(currentUser.id, 'transactions', []);
  restockHistory = getUserValue(currentUser.id, 'restockHistory', []);
  movementHistory = getUserValue(currentUser.id, 'movementHistory', []);
  reviewedProducts = getUserValue(currentUser.id, 'reviewed', []);
  currency = getUserValue(currentUser.id, 'currency', 'INR');
  skuCounter = parseInt(getUserValue(currentUser.id, 'skuCounter', 1)) || 1;
  dailyGoal = parseFloat(getUserValue(currentUser.id, 'dailyGoal', 0)) || 0;
  notificationSettings = getUserValue(currentUser.id, 'notificationSettings', { enabled: false, lowStock: true, goal: true });
  hydrateProductLinks();
  nextProdId = Math.max(Date.now(), ...products.map(p => Number(p.id) || 0)) + 1;

  const currencySelect = document.getElementById('currency-select');
  if (currencySelect) currencySelect.value = currency;
}

function saveCurrentUserData() {
  if (!currentUser) return;
  setUserValue(currentUser.id, 'products', products);
  setUserValue(currentUser.id, 'transactions', transactions);
  setUserValue(currentUser.id, 'restockHistory', restockHistory);
  setUserValue(currentUser.id, 'movementHistory', movementHistory);
  setUserValue(currentUser.id, 'reviewed', reviewedProducts);
  setUserValue(currentUser.id, 'currency', currency);
  setUserValue(currentUser.id, 'skuCounter', skuCounter);
  setUserValue(currentUser.id, 'dailyGoal', dailyGoal);
  setUserValue(currentUser.id, 'notificationSettings', notificationSettings);
}

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

function loadViewMode() {
  const saved = localStorage.getItem(VIEW_MODE_KEY);
  activeViewMode = saved || 'home';
}

function saveViewMode() {
  localStorage.setItem(VIEW_MODE_KEY, activeViewMode);
}

function applyViewMode() {
  document.querySelectorAll('[data-view]').forEach(section => {
    section.classList.toggle('view-hidden', section.dataset.view !== activeViewMode);
  });

  document.querySelectorAll('.workspace-nav-btn').forEach(button => {
    const active = button.dataset.viewTarget === activeViewMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function switchViewMode(mode) {
  activeViewMode = mode;
  saveViewMode();
  applyViewMode();

  if (mode === 'insights' && !featurePanels.analytics) {
    featurePanels.analytics = true;
    saveFeaturePanels();
    applyFeaturePanels();
  }

  if (mode === 'reports' && !featurePanels.reports) {
    featurePanels.reports = true;
    saveFeaturePanels();
    applyFeaturePanels();
  }

  render();
}

function applyFeaturePanels() {
  const activePanels = Object.entries(featurePanels).filter(([, open]) => open);
  const backdrop = document.getElementById('feature-panel-backdrop');

  Object.entries(featurePanels).forEach(([panel, open]) => {
    const section = document.getElementById(`feature-${panel}`);
    const button = document.getElementById(`toggle-${panel}`);
    if (section) section.classList.toggle('feature-panel-hidden', !open);
    if (button) {
      button.classList.toggle('active', open);
      button.setAttribute('aria-pressed', String(open));
    }
  });

  document.body.classList.toggle('feature-panel-open', activePanels.length > 0);
  if (backdrop) backdrop.classList.toggle('open', activePanels.length > 0);
}

function closeActiveFeaturePanel() {
  let changed = false;
  Object.keys(featurePanels).forEach(panel => {
    if (featurePanels[panel]) {
      featurePanels[panel] = false;
      changed = true;
    }
  });

  if (!changed) return;

  if (barChart) {
    barChart.destroy();
    barChart = null;
  }
  if (doughnutChart) {
    doughnutChart.destroy();
    doughnutChart = null;
  }

  saveFeaturePanels();
  applyFeaturePanels();
}

function toggleFeaturePanel(panel) {
  if (!(panel in featurePanels)) return;

  const nextOpen = !featurePanels[panel];
  Object.keys(featurePanels).forEach(key => {
    featurePanels[key] = false;
  });
  featurePanels[panel] = nextOpen;

  if (nextOpen) {
    activeViewMode = featurePanelViews[panel] || activeViewMode;
    saveViewMode();
    applyViewMode();
  }

  saveFeaturePanels();
  applyFeaturePanels();

  if (panel === 'analytics' && !featurePanels[panel]) {
    if (barChart) {
      barChart.destroy();
      barChart = null;
    }
    if (doughnutChart) {
      doughnutChart.destroy();
      doughnutChart = null;
    }
  }

  if (featurePanels[panel]) {
    if (panel === 'analytics') renderDashboard();
    if (panel === 'stock') {
      renderDeadStock();
      renderRestockHistory();
    }
    if (panel === 'timeline') renderMovementHistory();
    if (panel === 'reports') {
      renderBreakEven();
      renderCategoryReport();
      renderDateStats();
    }
  }
}

function hydrateProductLinks() {
  const nameMap = new Map(products.map(product => [product.name, product]));

  transactions = transactions.map(tx => {
    if (tx.productId && tx.category && tx.sku) return tx;
    const product = nameMap.get(tx.product);
    return product ? {
      ...tx,
      productId: tx.productId || product.id,
      sku: tx.sku || product.sku || '',
      category: tx.category || product.category || 'Uncategorized'
    } : tx;
  });

  restockHistory = restockHistory.map(entry => {
    if (entry.productId && entry.category && entry.sku) return entry;
    const product = nameMap.get(entry.product);
    return product ? {
      ...entry,
      productId: entry.productId || product.id,
      sku: entry.sku || product.sku || '',
      category: entry.category || product.category || 'Uncategorized'
    } : entry;
  });
}

function getRecordProductId(record) {
  return record?.productId ?? null;
}

function findProductByRecord(record) {
  const productId = getRecordProductId(record);
  if (productId !== null) {
    const byId = products.find(product => product.id === productId);
    if (byId) return byId;
  }

  return products.find(product => product.name === record?.product) || null;
}

function getRecordProductName(record) {
  return findProductByRecord(record)?.name || record?.product || 'Unknown product';
}

function getRecordCategory(record) {
  return findProductByRecord(record)?.category || record?.category || 'Uncategorized';
}

function matchesProductRecord(record, product) {
  if (!record || !product) return false;
  const productId = getRecordProductId(record);
  return productId !== null ? productId === product.id : record.product === product.name;
}

function hasChartSupport() {
  return typeof window.Chart === 'function';
}

function hasPdfSupport() {
  return !!window.jspdf?.jsPDF;
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

function openRestorePicker() {
  closeProfileMenu();
  document.getElementById('restore-file-input')?.click();
}

function openImportCsvPicker() {
  closeProfileMenu();
  document.getElementById('import-csv-input')?.click();
}

async function requestNotificationAccess() {
  closeProfileMenu();
  if (!('Notification' in window)) {
    toast('Browser notifications are not supported here.', 'error');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast('Notification permission was not granted.', 'error');
    return;
  }

  notificationSettings.enabled = true;
  saveCurrentUserData();
  toast('Notifications enabled.');
  notifyImportantEvents(true);
}

function parseCSVRow(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeCSVHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getCSVValue(row, headerMap, keys) {
  for (const key of keys) {
    const index = headerMap[key];
    if (index === undefined) continue;
    return row[index] ?? '';
  }
  return '';
}

function importProductsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  closeProfileMenu();

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = String(e.target.result || '').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) {
        toast('CSV needs a header row and at least one product row.', 'error');
        return;
      }

      const headers = parseCSVRow(lines[0]).map(normalizeCSVHeader);
      const headerMap = Object.fromEntries(headers.map((header, index) => [header, index]));
      const hasNameColumn = headers.includes('name') || headers.includes('product') || headers.includes('productname');
      if (!hasNameColumn) {
        toast('CSV must include a Name or Product column.', 'error');
        return;
      }

      const snapshot = createDataSnapshot();
      const productsBySku = new Map(products.map(product => [String(product.sku || '').toLowerCase(), product]));
      const productsByName = new Map(products.map(product => [String(product.name || '').toLowerCase(), product]));
      let imported = 0;
      let updated = 0;
      let skipped = 0;

      for (const line of lines.slice(1)) {
        const row = parseCSVRow(line);
        const name = getCSVValue(row, headerMap, ['name', 'product', 'productname']).trim();
        const skuValue = getCSVValue(row, headerMap, ['sku', 'productsku', 'itemid']).trim();
        const category = getCSVValue(row, headerMap, ['category']).trim() || 'Uncategorized';
        const brand = getCSVValue(row, headerMap, ['brand']).trim() || '—';
        const variant = getCSVValue(row, headerMap, ['variant', 'size']).trim() || '—';
        const batchNumber = getCSVValue(row, headerMap, ['batch', 'batchnumber', 'lot', 'lotnumber']).trim();
        const expiryDate = getCSVValue(row, headerMap, ['expiry', 'expirydate', 'useby', 'bestbefore']).trim();
        const cost = parseFloat(getCSVValue(row, headerMap, ['cost', 'costprice', 'buyprice']).trim());
        const price = parseFloat(getCSVValue(row, headerMap, ['price', 'sellprice', 'sellingprice']).trim());
        const stock = parseInt(getCSVValue(row, headerMap, ['stock', 'qty', 'quantity']).trim(), 10);
        const minStockRaw = getCSVValue(row, headerMap, ['minstock', 'minimumstock', 'reorderlevel']).trim();
        const minStock = parseInt(minStockRaw, 10);

        if (!name || Number.isNaN(cost) || Number.isNaN(price) || Number.isNaN(stock) || cost <= 0 || price <= 0 || stock < 0 || cost >= price) {
          skipped++;
          continue;
        }

        const normalizedSku = skuValue.toLowerCase();
        const normalizedName = name.toLowerCase();
        const existing = (normalizedSku && productsBySku.get(normalizedSku)) || productsByName.get(normalizedName);
        const sku = skuValue || existing?.sku || `SKU-${String(skuCounter).padStart(3, '0')}`;
        const nextProduct = {
          id: existing?.id || nextProdId++,
          sku,
          name,
          brand,
          variant,
          category,
          batchNumber,
          expiryDate,
          cost,
          price,
          stock,
          minStock: Number.isNaN(minStock) ? 5 : minStock
        };

        if (existing) {
          Object.assign(existing, nextProduct);
          updated++;
        } else {
          products.push(nextProduct);
          imported++;
        }

        productsBySku.set(String(sku).toLowerCase(), existing || nextProduct);
        productsByName.set(normalizedName, existing || nextProduct);
        skuCounter++;
      }

      if (!imported && !updated) {
        toast('No valid product rows were found in that CSV.', 'error');
        return;
      }

      saveProducts();
      addMovementEntry('Imported', 'Inventory', `CSV import finished: ${imported} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}.`);
      render();
      queueUndo(`CSV import complete: ${imported} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}.`, snapshot);
    } catch (err) {
      toast('Could not import that CSV file.', 'error');
    } finally {
      event.target.value = '';
    }
  };

  reader.readAsText(file);
}

function enhanceProfileMenu() {
  const { profileDropdown } = getAuthElements();
  if (!profileDropdown || profileDropdown.dataset.enhanced === 'true') return;

  const actionRow = document.querySelector('.page-actions-row');
  const backupBtn = actionRow?.querySelector('button[onclick="backupData()"]');
  const restoreLabel = actionRow?.querySelector('label.export-btn');
  const csvBtn = actionRow?.querySelector('button[onclick="exportCSV()"]');
  const pdfBtn = actionRow?.querySelector('button[onclick="exportPDF()"]');
  const clearBtn = actionRow?.querySelector('button[onclick="clearAllData()"]');
  const themeItem = profileDropdown.querySelector('button[onclick="toggleTheme()"]');

  [backupBtn, restoreLabel, csvBtn, pdfBtn, clearBtn].forEach(el => {
    if (el) el.style.display = 'none';
  });

  let restoreInput = document.getElementById('restore-file-input');
  if (!restoreInput && restoreLabel) {
    restoreInput = restoreLabel.querySelector('input[type="file"]');
    if (restoreInput) {
      restoreInput.id = 'restore-file-input';
      restoreInput.hidden = true;
      profileDropdown.appendChild(restoreInput);
    }
  }

  let importInput = document.getElementById('import-csv-input');
  if (!importInput) {
    importInput = document.createElement('input');
    importInput.id = 'import-csv-input';
    importInput.type = 'file';
    importInput.accept = '.csv,text/csv';
    importInput.hidden = true;
    importInput.setAttribute('onchange', 'importProductsCSV(event)');
    profileDropdown.appendChild(importInput);
  }

  const items = [
    { label: 'Backup data', icon: 'BK', action: 'backupData()' },
    { label: 'Restore backup', icon: 'RS', action: 'openRestorePicker()' },
    { label: 'Import CSV', icon: 'IMP', action: 'openImportCsvPicker()' },
    { label: 'Enable Alerts', icon: 'NTF', action: 'requestNotificationAccess()' },
    { label: 'Export CSV', icon: 'CSV', action: 'exportCSV()' },
    { label: 'Export PDF', icon: 'PDF', action: 'exportPDF()' },
    { label: 'Clear data', icon: 'DEL', action: 'clearAllData()', danger: true }
  ];

  items.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-dropdown-item${item.danger ? ' danger' : ''}`;
    button.setAttribute('onclick', item.action);
    button.innerHTML = `<span class="profile-dropdown-icon">${item.icon}</span><span>${item.label}</span>`;
    profileDropdown.insertBefore(button, themeItem || profileDropdown.firstChild);
  });

  const divider = document.createElement('div');
  divider.className = 'profile-dropdown-divider';
  divider.setAttribute('aria-hidden', 'true');
  profileDropdown.insertBefore(divider, themeItem || profileDropdown.firstChild);

  profileDropdown.dataset.enhanced = 'true';
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
  if (featurePanels.analytics) renderDashboard();
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
}

function getDaysToExpiry(expiryDate) {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

function renderExpiryAlert() {
  const banner = document.getElementById('expiry-banner');
  const list = document.getElementById('expiry-list');
  if (!banner || !list) return;

  const expiringItems = products
    .map(product => ({ ...product, daysToExpiry: getDaysToExpiry(product.expiryDate) }))
    .filter(product => product.daysToExpiry !== null && product.daysToExpiry >= 0 && product.daysToExpiry <= 30)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

  if (!expiringItems.length) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'block';
  list.innerHTML = expiringItems.map(product => `
    <span class="restock-tag expiry-tag">
      ${product.name} â€” ${product.daysToExpiry === 0 ? 'Expires today' : `${product.daysToExpiry} day${product.daysToExpiry === 1 ? '' : 's'} left`}
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

async function sendBrowserNotification(title, body, tag) {
  if (!notificationSettings.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      registration.showNotification(title, {
        body,
        tag,
        icon: './icon-192.png',
        badge: './icon-192.png'
      });
      return;
    }
  }

  new Notification(title, { body, tag, icon: './icon-192.png' });
}

function notifyImportantEvents(force = false) {
  if (!notificationSettings.enabled || !currentUser) return;

  const today = new Date().toISOString().split('T')[0];
  const lowStockItems = products.filter(p => p.stock <= p.minStock);
  const expiringItems = products.filter(p => {
    const daysToExpiry = getDaysToExpiry(p.expiryDate);
    return daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 30;
  });
  const todayProfit = transactions
    .filter(t => t.date === today)
    .reduce((sum, t) => sum + t.profit, 0);

  const lowStockKey = `notify:${currentUser.id}:lowStock:${today}`;
  const expiryKey = `notify:${currentUser.id}:expiry:${today}`;
  const goalKey = `notify:${currentUser.id}:goal:${today}`;

  if ((force || !localStorage.getItem(lowStockKey)) && lowStockItems.length && notificationSettings.lowStock) {
    const names = lowStockItems.slice(0, 3).map(item => item.name).join(', ');
    sendBrowserNotification('Low stock alert', `${lowStockItems.length} product(s) need restocking: ${names}${lowStockItems.length > 3 ? '...' : ''}`, 'low-stock');
    localStorage.setItem(lowStockKey, 'sent');
  }

  if ((force || !localStorage.getItem(expiryKey)) && expiringItems.length) {
    const names = expiringItems.slice(0, 3).map(item => item.name).join(', ');
    sendBrowserNotification('Near expiry alert', `${expiringItems.length} product(s) are nearing expiry: ${names}${expiringItems.length > 3 ? '...' : ''}`, 'near-expiry');
    localStorage.setItem(expiryKey, 'sent');
  }

  if (dailyGoal > 0 && notificationSettings.goal && todayProfit >= dailyGoal && (force || !localStorage.getItem(goalKey))) {
    sendBrowserNotification('Daily goal reached', `You hit your profit goal with ${fmt(todayProfit)} today.`, 'goal-reached');
    localStorage.setItem(goalKey, 'sent');
  }
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDataSnapshot() {
  return {
    products: cloneData(products),
    transactions: cloneData(transactions),
    restockHistory: cloneData(restockHistory),
    movementHistory: cloneData(movementHistory),
    reviewedProducts: cloneData(reviewedProducts),
    dailyGoal,
    currency,
    skuCounter,
    notificationSettings: cloneData(notificationSettings)
  };
}

function applyDataSnapshot(snapshot) {
  products = cloneData(snapshot.products || []);
  transactions = cloneData(snapshot.transactions || []);
  restockHistory = cloneData(snapshot.restockHistory || []);
  movementHistory = cloneData(snapshot.movementHistory || []);
  reviewedProducts = cloneData(snapshot.reviewedProducts || []);
  dailyGoal = parseFloat(snapshot.dailyGoal) || 0;
  currency = snapshot.currency || 'INR';
  skuCounter = snapshot.skuCounter || (products.length + 1);
  notificationSettings = cloneData(snapshot.notificationSettings || { enabled: false, lowStock: true, goal: true });

  saveCurrentUserData();
  const currencySelect = document.getElementById('currency-select');
  if (currencySelect) currencySelect.value = currency;
  render();
}

function queueUndo(message, snapshot, type = 'info') {
  if (pendingUndoTimer) {
    clearTimeout(pendingUndoTimer);
    pendingUndoTimer = null;
  }

  toast(message, type, {
    label: 'Undo',
    onClick: () => {
      if (pendingUndoTimer) {
        clearTimeout(pendingUndoTimer);
        pendingUndoTimer = null;
      }
      applyDataSnapshot(snapshot);
      toast('Last action undone.');
    }
  }, 7000);

  pendingUndoTimer = setTimeout(() => {
    pendingUndoTimer = null;
  }, 7000);
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
  const batchNumber = document.getElementById('prod-batch').value.trim();
  const expiryDate = document.getElementById('prod-expiry').value;
  const skuInput = document.getElementById('prod-sku').value.trim();
  const sku      = skuInput || `SKU-${String(skuCounter).padStart(3, '0')}`;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all fields correctly', 'error'); return;
  }
  if (cost >= price) {
    toast('Selling price must be greater than cost price', 'error'); return;
  }

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
  const product = products.find(p => p.id === id);
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

  document.getElementById('prod-name').value     = p.name;
  document.getElementById('prod-category').value = p.category || '';
  document.getElementById('prod-brand').value    = p.brand || '';
  document.getElementById('prod-variant').value  = p.variant || '';
  document.getElementById('prod-sku').value      = p.sku || '';
  document.getElementById('prod-cost').value     = p.cost;
  document.getElementById('prod-price').value    = p.price;
  document.getElementById('prod-stock').value    = p.stock;
  document.getElementById('prod-min').value      = p.minStock;
  document.getElementById('prod-batch').value    = p.batchNumber || '';
  document.getElementById('prod-expiry').value   = p.expiryDate || '';

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
  const batchNumber = document.getElementById('prod-batch').value.trim();
  const expiryDate = document.getElementById('prod-expiry').value;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    toast('Fill all fields correctly', 'error'); return;
  }
  if (cost >= price) {
    toast('Selling price must be greater than cost price', 'error'); return;
  }

  p.name = name; p.category = category; p.brand = brand;
  p.variant = variant; p.sku = sku; p.cost = cost;
  p.price = price; p.stock = stock; p.minStock = minStock;
  p.batchNumber = batchNumber; p.expiryDate = expiryDate;

  saveProducts();
  addMovementEntry('Updated', name, `Edited product details. Stock now ${stock}, price ${fmt(price)}.`);
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
    date,
    productId: product.id,
    product: product.name,
    sku: product.sku || '',
    category: product.category || 'Uncategorized',
    qty, cost: product.cost, price: product.price,
    total, totalCost, profit, note
  });

  qtyInput.value  = '';
  if (noteInput) noteInput.value = '';
  saveProducts();
  addMovementEntry('Sold', product.name, `Sold ${qty} units for ${fmt(total)}${note ? ` with note: ${note}` : ''}.`);
  render();
  toast(`✓ Sold ${qty}x ${product.name} for ${fmt(total)}`);
  notifyImportantEvents();
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
  document.getElementById('prod-batch').value    = '';
  document.getElementById('prod-expiry').value   = '';
}

function clearAllData() {
  closeProfileMenu();
  showConfirm('Delete all data for this account? This cannot be undone.', () => {
    if (!currentUser) return;
    const snapshot = createDataSnapshot();
    ['products', 'transactions', 'restockHistory', 'movementHistory', 'reviewed', 'currency', 'skuCounter', 'dailyGoal', 'notificationSettings'].forEach(key => {
      removeUserValue(currentUser.id, key);
    });
    products = []; transactions = []; restockHistory = []; movementHistory = []; reviewedProducts = [];
    dailyGoal = 0;
    currency = 'INR';
    skuCounter = 1;
    notificationSettings = { enabled: false, lowStock: true, goal: true };
    loadCurrency();
    render();
    queueUndo('All account data cleared.', snapshot, 'error');
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
  closeProfileMenu();
  const data = {
    user: currentUser ? { id: currentUser.id, name: currentUser.name, email: currentUser.email } : null,
    products,
    transactions,
    restockHistory,
    movementHistory,
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
  closeProfileMenu();
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!confirm('This will replace all current data. Are you sure?')) return;
      const snapshot = createDataSnapshot();
      applyDataSnapshot({
        products: data.products || [],
        transactions: data.transactions || [],
        restockHistory: data.restockHistory || [],
        movementHistory: data.movementHistory || [],
        reviewedProducts: data.reviewedProducts || [],
        dailyGoal: parseFloat(data.dailyGoal) || 0,
        currency: data.currency || 'INR',
        skuCounter: (data.products || []).length + 1
      });
      addMovementEntry('Restored', 'Inventory', 'Restored inventory data from backup file.');
      queueUndo('Backup restored.', snapshot);
    } catch(err) {
      toast('Invalid backup file.', 'error');
    } finally {
      event.target.value = '';
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
    const daysToExpiry = getDaysToExpiry(p.expiryDate);
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
    productId: product.id,
    product: product.name,
    sku: product.sku || '',
    category: product.category || 'Uncategorized',
    qty, cost, total: qty * cost
  });

  qtyInput.value  = '';
  costInput.value = '';
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
      <td>${r.product}</td>
      <td>${r.qty} units</td>
      <td>${fmt(r.cost)} per unit</td>
      <td style="color:#eab308;font-weight:700;">${fmt(r.total)}</td>
    </tr>
  `).join('');
}

function exportCSV() {
  closeProfileMenu();
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
  closeProfileMenu();
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
  loadFeaturePanels();
  loadViewMode();
  initAuth();
  enhanceProfileMenu();
  loadTheme();
  updateThemeButton();
  syncProfileMenuTheme();
  loadCurrency();
  applyFeaturePanels();
  applyViewMode();
  fetchExchangeRates();
  render();
  if (featurePanels.analytics) renderDashboard();
  notifyImportantEvents();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeActiveFeaturePanel();
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
  const insightsEl = document.getElementById('date-range-insights');
  if (!el) return;

  if (!dateFrom && !dateTo) {
    el.style.display = 'none';
    if (insightsEl) insightsEl.style.display = 'none';
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

  if (!insightsEl) return;

  if (!filtered.length) {
    insightsEl.style.display = 'grid';
    insightsEl.innerHTML = `
      <div class="range-insight-card empty-state">
        <div class="range-insight-title">Date Range Insights</div>
        <div class="range-insight-value">No transactions</div>
        <div class="range-insight-subtext">Try widening the selected dates to compare category profit and weak products.</div>
      </div>
    `;
    return;
  }

  const byProduct = {};
  const byCategory = {};

  filtered.forEach(t => {
    const product = products.find(p => p.name === t.product);
    const category = product?.category || 'Uncategorized';

    if (!byProduct[t.product]) byProduct[t.product] = { revenue: 0, cost: 0, profit: 0, items: 0 };
    if (!byCategory[category]) byCategory[category] = { revenue: 0, profit: 0, items: 0 };

    byProduct[t.product].revenue += t.total;
    byProduct[t.product].cost += t.totalCost;
    byProduct[t.product].profit += t.profit;
    byProduct[t.product].items += t.qty;

    byCategory[category].revenue += t.total;
    byCategory[category].profit += t.profit;
    byCategory[category].items += t.qty;
  });

  const productEntries = Object.entries(byProduct);
  const categoryEntries = Object.entries(byCategory);
  const bestProduct = [...productEntries].sort((a, b) => b[1].profit - a[1].profit)[0];
  const weakestProduct = [...productEntries].sort((a, b) => a[1].profit - b[1].profit)[0];
  const topCategory = [...categoryEntries].sort((a, b) => b[1].profit - a[1].profit)[0];
  const avgOrderProfit = filtered.length ? profit / filtered.length : 0;
  const marginPct = rev > 0 ? ((profit / rev) * 100).toFixed(1) : '0.0';

  insightsEl.style.display = 'grid';
  insightsEl.innerHTML = `
    <div class="range-insight-card accent-green">
      <div class="range-insight-title">Top Category</div>
      <div class="range-insight-value">${topCategory ? topCategory[0] : '—'}</div>
      <div class="range-insight-subtext">${topCategory ? `${fmt(topCategory[1].profit)} profit across ${topCategory[1].items} items sold` : 'No category data yet'}</div>
    </div>
    <div class="range-insight-card accent-violet">
      <div class="range-insight-title">Best Product</div>
      <div class="range-insight-value">${bestProduct ? bestProduct[0] : '—'}</div>
      <div class="range-insight-subtext">${bestProduct ? `${fmt(bestProduct[1].profit)} profit from ${bestProduct[1].items} units` : 'No product data yet'}</div>
    </div>
    <div class="range-insight-card accent-amber">
      <div class="range-insight-title">Lowest Performer</div>
      <div class="range-insight-value">${weakestProduct ? weakestProduct[0] : '—'}</div>
      <div class="range-insight-subtext">${weakestProduct ? `${fmt(weakestProduct[1].profit)} profit on ${fmt(weakestProduct[1].revenue)} revenue` : 'No product data yet'}</div>
    </div>
    <div class="range-insight-card accent-slate">
      <div class="range-insight-title">Range Quality</div>
      <div class="range-insight-value">${marginPct}% margin</div>
      <div class="range-insight-subtext">${fmt(avgOrderProfit)} average profit per transaction in this range</div>
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
function toast(message, type = 'success', action = null, duration = 2600) {
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
    ${action ? `<button type="button" class="toast-action">${action.label}</button>` : ''}
    <div class="toast-progress"></div>
  `;
  document.body.appendChild(t);
  const progress = t.querySelector('.toast-progress');
  if (progress) progress.style.animationDuration = `${duration}ms`;

  const dismiss = setTimeout(() => {
    t.classList.add('toast-exit');
    setTimeout(() => t.remove(), 320);
  }, duration);

  if (action) {
    t.querySelector('.toast-action')?.addEventListener('click', () => {
      clearTimeout(dismiss);
      t.remove();
      action.onClick();
    });
  }
}

// Feature 10 — Delete Transaction
function deleteTransaction(id) {
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;
  const snapshot = createDataSnapshot();
  const product = findProductByRecord(tx);
  if (product) product.stock += tx.qty;
  transactions = transactions.filter(t => t.id !== id);
  saveProducts();
  addMovementEntry('Sale Deleted', getRecordProductName(tx), `Removed sale of ${tx.qty} units and restored stock.`);
  render();
  queueUndo(`Sale deleted for ${getRecordProductName(tx)}.`, snapshot);
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

function renderDashboard() {
  const today     = new Date().toISOString().split('T')[0];
  const todayTxns = transactions.filter(t => t.date === today);
  const soldToday = todayTxns.reduce((s, t) => s + t.qty, 0);
  const revToday  = todayTxns.reduce((s, t) => s + t.total, 0);
  const profToday = todayTxns.reduce((s, t) => s + t.profit, 0);

  document.getElementById('kpi-sold').textContent = soldToday;
  document.getElementById('kpi-revenue').textContent = fmt(revToday);
  document.getElementById('kpi-profit').textContent = fmt(profToday);

  const groupedTotals = {};
  transactions.forEach(t => {
    const key = String(getRecordProductId(t) ?? t.product);
    if (!groupedTotals[key]) {
      groupedTotals[key] = { name: getRecordProductName(t), qty: 0, revenue: 0 };
    }
    groupedTotals[key].qty += t.qty;
    groupedTotals[key].revenue += t.total;
  });

  const top = Object.values(groupedTotals).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)[0];
  document.getElementById('kpi-top').textContent = top ? `${top.name} (${top.qty} sold)` : '—';

  const days = [];
  const dayLabels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
    dayLabels.push(d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
  }

  const revenueByDay = days.map(day => transactions.filter(t => t.date === day).reduce((s, t) => s + t.total, 0));
  const profitByDay = days.map(day => transactions.filter(t => t.date === day).reduce((s, t) => s + t.profit, 0));

  if (!hasChartSupport()) {
    if (barChart) {
      barChart.destroy();
      barChart = null;
    }
    if (doughnutChart) {
      doughnutChart.destroy();
      doughnutChart = null;
    }
    document.getElementById('donut-legend').innerHTML = '<span style="color:#6b7280;font-size:13px;">Charts unavailable offline</span>';
    return;
  }

  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: dayLabels,
      datasets: [
        { label: 'Revenue', data: revenueByDay, backgroundColor: 'rgba(29,158,117,0.7)', borderRadius: 6, borderSkipped: false },
        { label: 'Profit', data: profitByDay, backgroundColor: 'rgba(124,106,247,0.7)', borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#6b7280', font: { size: 11 }, callback: value => fmt(value) }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });

  const revenueByProduct = {};
  transactions.forEach(t => {
    const key = String(getRecordProductId(t) ?? t.product);
    if (!revenueByProduct[key]) {
      revenueByProduct[key] = { name: getRecordProductName(t), total: 0 };
    }
    revenueByProduct[key].total += t.total;
  });

  const productEntries = Object.values(revenueByProduct);
  const prodNames = productEntries.map(entry => entry.name);
  const prodValues = productEntries.map(entry => entry.total);
  const colors = ['#1D9E75', '#7c6af7', '#D85A30', '#eab308', '#378ADD', '#e879a0', '#14b8a6', '#f97316'];

  if (doughnutChart) doughnutChart.destroy();
  if (!prodNames.length) {
    document.getElementById('donut-legend').innerHTML = '<span style="color:#6b7280;font-size:13px;">No sales yet</span>';
    return;
  }

  doughnutChart = new Chart(document.getElementById('doughnutChart'), {
    type: 'doughnut',
    data: {
      labels: prodNames,
      datasets: [{ data: prodValues, backgroundColor: colors.slice(0, prodNames.length), borderWidth: 0, hoverOffset: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
  });

  document.getElementById('donut-legend').innerHTML = prodNames.map((name, index) => `
    <span style="display:flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;">
      <span style="width:10px;height:10px;border-radius:2px;background:${colors[index]};flex-shrink:0;"></span>
      ${name}
    </span>
  `).join('');
}

function renderRestockHistory() {
  const tbody = document.getElementById('restock-body');
  if (!restockHistory.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No restock history yet.</td></tr>';
    return;
  }

  tbody.innerHTML = restockHistory.map(entry => `
    <tr>
      <td>${entry.date}</td>
      <td>
        <div style="font-weight:600;">${getRecordProductName(entry)}</div>
        ${entry.sku ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${entry.sku}</div>` : ''}
      </td>
      <td>${entry.qty} units</td>
      <td>${fmt(entry.cost)} per unit</td>
      <td style="color:#eab308;font-weight:700;">${fmt(entry.total)}</td>
    </tr>
  `).join('');
}

function renderDeadStock() {
  const today = new Date();
  const tbody = document.getElementById('dead-body');
  const countEl = document.getElementById('dead-count');

  const deadList = products.filter(product => {
    if (reviewedProducts.includes(product.id)) return false;
    const lastSale = transactions
      .filter(tx => matchesProductRecord(tx, product))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    if (!lastSale) return product.stock > 0;

    const daysSince = Math.floor((today - new Date(lastSale.date)) / 86400000);
    return daysSince >= deadStockDays && product.stock > 0;
  }).map(product => {
    const lastSale = transactions
      .filter(tx => matchesProductRecord(tx, product))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    return {
      ...product,
      lastSale: lastSale?.date || null,
      daysSince: lastSale ? Math.floor((today - new Date(lastSale.date)) / 86400000) : null,
      idleValue: product.stock * product.cost
    };
  });

  countEl.textContent = deadList.length;
  if (!deadList.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No dead stock right now.</td></tr>';
    return;
  }

  tbody.innerHTML = deadList.map(product => `
    <tr>
      <td>
        <div style="font-weight:600;">${product.name}</div>
        <div style="font-size:12px;color:var(--muted);">${product.category || 'Uncategorized'}</div>
      </td>
      <td><span class="badge danger">${product.daysSince === null ? 'Never sold' : `${product.daysSince} days ago`}</span></td>
      <td>${product.stock} units</td>
      <td style="color:#eab308;font-weight:700;">${fmt(product.idleValue)}</td>
      <td><button class="reviewed-btn" onclick="markReviewed(${product.id})">âœ“ Mark reviewed</button></td>
    </tr>
  `).join('');
}

function renderDateStats() {
  const filtered = getFilteredTransactions();
  const rev = filtered.reduce((s, t) => s + t.total, 0);
  const profit = filtered.reduce((s, t) => s + t.profit, 0);
  const cost = filtered.reduce((s, t) => s + t.totalCost, 0);
  const items = filtered.reduce((s, t) => s + t.qty, 0);

  const el = document.getElementById('date-stats');
  const insightsEl = document.getElementById('date-range-insights');
  if (!el) return;

  if (!dateFrom && !dateTo) {
    el.style.display = 'none';
    if (insightsEl) insightsEl.style.display = 'none';
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

  if (!insightsEl) return;

  if (!filtered.length) {
    insightsEl.style.display = 'grid';
    insightsEl.innerHTML = `
      <div class="range-insight-card empty-state">
        <div class="range-insight-title">Date Range Insights</div>
        <div class="range-insight-value">No transactions</div>
        <div class="range-insight-subtext">Try widening the selected dates to compare category profit and weak products.</div>
      </div>
    `;
    return;
  }

  const byProduct = {};
  const byCategory = {};

  filtered.forEach(t => {
    const productName = getRecordProductName(t);
    const category = getRecordCategory(t);

    if (!byProduct[productName]) byProduct[productName] = { revenue: 0, cost: 0, profit: 0, items: 0 };
    if (!byCategory[category]) byCategory[category] = { revenue: 0, profit: 0, items: 0 };

    byProduct[productName].revenue += t.total;
    byProduct[productName].cost += t.totalCost;
    byProduct[productName].profit += t.profit;
    byProduct[productName].items += t.qty;

    byCategory[category].revenue += t.total;
    byCategory[category].profit += t.profit;
    byCategory[category].items += t.qty;
  });

  const bestProduct = Object.entries(byProduct).sort((a, b) => b[1].profit - a[1].profit)[0];
  const weakestProduct = Object.entries(byProduct).sort((a, b) => a[1].profit - b[1].profit)[0];
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1].profit - a[1].profit)[0];
  const avgOrderProfit = filtered.length ? profit / filtered.length : 0;
  const marginPct = rev > 0 ? ((profit / rev) * 100).toFixed(1) : '0.0';

  insightsEl.style.display = 'grid';
  insightsEl.innerHTML = `
    <div class="range-insight-card accent-green">
      <div class="range-insight-title">Top Category</div>
      <div class="range-insight-value">${topCategory ? topCategory[0] : '—'}</div>
      <div class="range-insight-subtext">${topCategory ? `${fmt(topCategory[1].profit)} profit across ${topCategory[1].items} items sold` : 'No category data yet'}</div>
    </div>
    <div class="range-insight-card accent-violet">
      <div class="range-insight-title">Best Product</div>
      <div class="range-insight-value">${bestProduct ? bestProduct[0] : '—'}</div>
      <div class="range-insight-subtext">${bestProduct ? `${fmt(bestProduct[1].profit)} profit from ${bestProduct[1].items} units` : 'No product data yet'}</div>
    </div>
    <div class="range-insight-card accent-amber">
      <div class="range-insight-title">Lowest Performer</div>
      <div class="range-insight-value">${weakestProduct ? weakestProduct[0] : '—'}</div>
      <div class="range-insight-subtext">${weakestProduct ? `${fmt(weakestProduct[1].profit)} profit on ${fmt(weakestProduct[1].revenue)} revenue` : 'No product data yet'}</div>
    </div>
    <div class="range-insight-card accent-slate">
      <div class="range-insight-title">Range Quality</div>
      <div class="range-insight-value">${marginPct}% margin</div>
      <div class="range-insight-subtext">${fmt(avgOrderProfit)} average profit per transaction in this range</div>
    </div>
  `;
}

function renderCategoryReport() {
  const catMap = {};

  transactions.forEach(t => {
    const category = getRecordCategory(t);
    if (!catMap[category]) catMap[category] = { revenue: 0, cost: 0, profit: 0, items: 0, products: new Set() };

    catMap[category].revenue += t.total;
    catMap[category].cost += t.totalCost;
    catMap[category].profit += t.profit;
    catMap[category].items += t.qty;
    catMap[category].products.add(getRecordProductName(t));
  });

  const tbody = document.getElementById('cat-report-body');
  const entries = Object.entries(catMap).sort((a, b) => b[1].profit - a[1].profit);

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">No sales data yet.</td></tr>';
    return;
  }

  const totalRevenue = entries.reduce((sum, [, data]) => sum + data.revenue, 0);
  tbody.innerHTML = entries.map(([category, data]) => {
    const share = totalRevenue > 0 ? ((data.revenue / totalRevenue) * 100).toFixed(1) : 0;
    return `
      <tr>
        <td><span class="badge" style="background:rgba(124,106,247,0.12);color:#7c6af7;">${category}</span></td>
        <td>${data.products.size} products</td>
        <td style="color:#1D9E75;font-weight:700;">${fmt(data.revenue)}</td>
        <td style="color:#D85A30;font-weight:700;">${fmt(data.cost)}</td>
        <td style="color:#7c6af7;font-weight:700;">${fmt(data.profit)}</td>
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
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No products yet.</td></tr>';
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const todayRestock = restockHistory.filter(entry => entry.date === today);
  const totalRestockToday = todayRestock.reduce((sum, entry) => sum + entry.total, 0);

  tbody.innerHTML = products.map(product => {
    const profitPerUnit = product.price - product.cost;
    const restockForThis = todayRestock
      .filter(entry => matchesProductRecord(entry, product))
      .reduce((sum, entry) => sum + entry.total, 0);
    const unitsNeeded = profitPerUnit > 0 ? Math.ceil(restockForThis / profitPerUnit) : '—';
    const soldToday = transactions
      .filter(tx => tx.date === today && matchesProductRecord(tx, product))
      .reduce((sum, tx) => sum + tx.qty, 0);

    const status = unitsNeeded === '—'
      ? '<span class="badge expense">No margin</span>'
      : soldToday >= unitsNeeded
      ? '<span class="badge income">âœ“ Break-even reached</span>'
      : `<span class="badge warning">${unitsNeeded - soldToday} more to go</span>`;

    return `
      <tr>
        <td style="font-weight:600;">${product.name}</td>
        <td>${fmt(product.price - product.cost)} per unit</td>
        <td>${fmt(restockForThis)}</td>
        <td style="font-weight:700;">${unitsNeeded === '—' ? '—' : `${unitsNeeded} units`}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join('');

  const totalProfitToday = transactions
    .filter(tx => tx.date === today)
    .reduce((sum, tx) => sum + tx.profit, 0);

  const overallEl = document.getElementById('breakeven-overall');
  if (!overallEl) return;

  if (totalRestockToday === 0) {
    overallEl.textContent = 'No restock costs today.';
    overallEl.style.color = 'var(--muted)';
  } else if (totalProfitToday >= totalRestockToday) {
    overallEl.textContent = `âœ“ Break-even reached â€” ${fmt(totalProfitToday - totalRestockToday)} surplus today`;
    overallEl.style.color = '#1D9E75';
  } else {
    overallEl.textContent = `Need ${fmt(totalRestockToday - totalProfitToday)} more profit to break even today`;
    overallEl.style.color = '#D85A30';
  }
}

function exportPDF() {
  closeProfileMenu();
  if (!hasPdfSupport()) {
    toast('PDF export is unavailable right now. Try again when the PDF library has loaded.', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const today = new Date().toISOString().split('T')[0];
  const green = [29, 158, 117];
  const dark = [30, 30, 40];

  doc.setFillColor(...dark);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Shop Tracker â€” Daily Report', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text(`Generated: ${today}`, 14, 26);

  const totalRev = transactions.reduce((sum, tx) => sum + tx.total, 0);
  const totalProfit = transactions.reduce((sum, tx) => sum + tx.profit, 0);
  const totalCost = transactions.reduce((sum, tx) => sum + tx.totalCost, 0);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...dark);
  doc.text('Summary', 14, 42);
  doc.autoTable({
    startY: 46,
    head: [['Total Revenue', 'Total Cost', 'Gross Profit', 'Items Sold']],
    body: [[fmt(totalRev), fmt(totalCost), fmt(totalProfit), transactions.reduce((sum, tx) => sum + tx.qty, 0)]],
    headStyles: { fillColor: green, textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: dark },
    margin: { left: 14, right: 14 }
  });

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...dark);
  doc.text('Sales Transactions', 14, doc.lastAutoTable.finalY + 14);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 18,
    head: [['Date', 'Product', 'Qty', 'Unit Price', 'Total', 'Profit']],
    body: transactions.map(tx => [tx.date, getRecordProductName(tx), tx.qty, fmt(tx.price), fmt(tx.total), fmt(tx.profit)]),
    headStyles: { fillColor: green, textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: dark },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 14, right: 14 }
  });

  const todayDate = new Date();
  const deadList = products.filter(product => {
    const lastSale = transactions
      .filter(tx => matchesProductRecord(tx, product))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    if (!lastSale) return product.stock > 0;
    return Math.floor((todayDate - new Date(lastSale.date)) / 86400000) >= deadStockDays && product.stock > 0;
  });

  if (deadList.length) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...dark);
    doc.text('Dead Stock', 14, doc.lastAutoTable.finalY + 14);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Product', 'Stock', 'Idle Value']],
      body: deadList.map(product => [product.name, `${product.stock} units`, fmt(product.stock * product.cost)]),
      headStyles: { fillColor: [216, 90, 48], textColor: 255, fontStyle: 'bold' },
      bodyStyles: { textColor: dark },
      margin: { left: 14, right: 14 }
    });
  }

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text('Generated by Shop Tracker', 14, 290);
  doc.save(`shop-report-${today}.pdf`);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service worker registered'))
    .catch(err => console.log('SW error:', err));
}


