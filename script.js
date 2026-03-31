let currency = localStorage.getItem('currency') || '₹';
let products = JSON.parse(localStorage.getItem('products')) || [];
let transactions = JSON.parse(localStorage.getItem('transactions')) || [];
let searchQuery = '';
let filterCategory = 'all';
let sortBy = 'none';
let nextProdId = Date.now() + 1;
let deadStockDays = 7;
let reviewedProducts = JSON.parse(localStorage.getItem('reviewed')) || [];
let restockHistory = JSON.parse(localStorage.getItem('restockHistory')) || [];
let barChart = null;
let doughnutChart = null;

function fmt(amount) {
  return currency + amount.toLocaleString('en-IN');
}

function setCurrency(val) {
  currency = val;
  localStorage.setItem('currency', val);
  render();
}

function loadCurrency() {
  const saved = localStorage.getItem('currency') || '₹';
  currency = saved;
  document.getElementById('currency-select').value = saved;
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
  const cost     = parseFloat(document.getElementById('prod-cost').value);
  const price    = parseFloat(document.getElementById('prod-price').value);
  const stock    = parseInt(document.getElementById('prod-stock').value);
  const minStock = parseInt(document.getElementById('prod-min').value) || 5;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    alert('Fill all product fields correctly.');
    return;
  }
  if (cost >= price) {
    alert('Selling price must be greater than cost price.');
    return;
  }
  products.push({ id: nextProdId++, name, category, cost, price, stock, minStock });
  saveProducts();
  clearProductForm();
  render();
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
  document.getElementById('prod-cost').value     = p.cost;
  document.getElementById('prod-price').value    = p.price;
  document.getElementById('prod-stock').value    = p.stock;
  document.getElementById('prod-min').value      = p.minStock;

  // Change button to Save Edit
  const btn = document.querySelector('.form-section button');
  btn.textContent  = '💾 Save Edit';
  btn.onclick      = () => saveEdit(id);
}

function saveEdit(id) {
  const p = products.find(p => p.id === id);
  if (!p) return;

  const name     = document.getElementById('prod-name').value.trim();
  const category = document.getElementById('prod-category').value.trim() || 'Uncategorized';
  const cost     = parseFloat(document.getElementById('prod-cost').value);
  const price    = parseFloat(document.getElementById('prod-price').value);
  const stock    = parseInt(document.getElementById('prod-stock').value);
  const minStock = parseInt(document.getElementById('prod-min').value) || 5;

  if (!name || isNaN(cost) || cost <= 0 || isNaN(price) || price <= 0 || isNaN(stock) || stock < 0) {
    alert('Fill all fields correctly.'); return;
  }
  if (cost >= price) {
    alert('Selling price must be greater than cost price.'); return;
  }

  p.name     = name;
  p.category = category;
  p.cost     = cost;
  p.price    = price;
  p.stock    = stock;
  p.minStock = minStock;

  saveProducts();
  clearProductForm();

  // Reset button back to Add Product
  const btn = document.querySelector('.form-section button');
  btn.textContent = '+ Add Product';
  btn.onclick     = addProduct;

  render();
}

function sellProduct(id) {
  const qtyInput  = document.getElementById('qty-' + id);
  const noteInput = document.getElementById('note-' + id);
  const qty       = parseInt(qtyInput.value);
  const note      = noteInput ? noteInput.value.trim() : '';
  const product   = products.find(p => p.id === id);

  if (!product) return;
  if (isNaN(qty) || qty <= 0) { alert('Enter a valid quantity.'); return; }
  if (qty > product.stock)    { alert('Not enough stock.'); return; }

  const total     = qty * product.price;
  const totalCost = qty * product.cost;
  const profit    = total - totalCost;
  const date      = new Date().toISOString().split('T')[0];

  product.stock -= qty;

  transactions.unshift({
    id: Date.now(),
    date,
    product: product.name,
    qty,
    cost: product.cost,
    price: product.price,
    total,
    totalCost,
    profit,
    note
  });

  qtyInput.value  = '';
  if (noteInput) noteInput.value = '';
  saveProducts();
  render();
}

function saveProducts() {
  localStorage.setItem('products', JSON.stringify(products));
  localStorage.setItem('transactions', JSON.stringify(transactions));
}

function clearProductForm() {
  document.getElementById('prod-name').value     = '';
  document.getElementById('prod-category').value = '';
  document.getElementById('prod-cost').value     = '';
  document.getElementById('prod-price').value    = '';
  document.getElementById('prod-stock').value    = '';
  document.getElementById('prod-min').value      = '';
}

function clearAllData() {
  if (!confirm('Are you sure? This will delete all products, sales and transactions.')) return;
  localStorage.clear();
  products      = [];
  transactions  = [];
  restockHistory = [];
  reviewedProducts = [];
  render();
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
    products,
    transactions,
    restockHistory,
    reviewedProducts,
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
      currency         = data.currency         || '₹';
      saveProducts();
      localStorage.setItem('restockHistory',   JSON.stringify(restockHistory));
      localStorage.setItem('reviewed',         JSON.stringify(reviewedProducts));
      localStorage.setItem('currency',         currency);
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
        <td>${p.name}</td>
        <td><span class="badge" style="background:rgba(124,106,247,0.12);color:#7c6af7;">${p.category || 'Uncategorized'}</span></td>
        <td>${fmt(p.cost)}</td>
        <td>${fmt(p.price)}</td>
        <td><span class="badge income">${margin}% margin</span></td>
        <td>${stockBadge}</td>
        <td style="color:var(--muted);font-size:13px;">${p.minStock} units</td>
        <td>
          <input type="number" id="qty-${p.id}" placeholder="Qty" min="1" max="${p.stock}"
            style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;" />
          <input type="text" id="note-${p.id}" placeholder="Note (optional)"
           style="width:120px;height:32px;padding:0 8px;border-radius:8px;border:1px solid var(--card-border);background:var(--input-bg);color:var(--text);font-size:13px;margin-left:4px;" />
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
    localStorage.setItem('reviewed', JSON.stringify(reviewedProducts));
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
  if (isNaN(qty) || qty <= 0)  { alert('Enter a valid quantity.'); return; }
  if (isNaN(cost) || cost < 0) { alert('Enter a valid cost.'); return; }

  product.stock += qty;
  restockHistory.unshift({ id: Date.now(), date: new Date().toISOString().split('T')[0], product: product.name, qty, cost, total: qty * cost });

  qtyInput.value  = '';
  costInput.value = '';
  localStorage.setItem('restockHistory', JSON.stringify(restockHistory));
  saveProducts();
  render();
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
}

function loadTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.body.classList.add('light');
    document.getElementById('theme-btn').textContent = '☀️';
  }
}

window.addEventListener('load', () => {
  loadTheme();
  loadCurrency();
  render();
  renderDashboard();
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service worker registered'))
    .catch(err => console.log('SW error:', err));
}