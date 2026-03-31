/* ==========================================================================
   BudgetBuddy v3 — Premium INR Tracker with Monthly Navigation
   ========================================================================== */
'use strict';

// ==========================================================================
// 1. CONFIG
// ==========================================================================

const STORAGE_KEY = 'budgetbuddy_v3';
const THEME_KEY = 'budgetbuddy_theme';

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const CATEGORIES = Object.freeze({
  expense: [
    { name: 'Food & Dining',     emoji: '🍕', color: '#fb7185' },
    { name: 'Transport',         emoji: '🚗', color: '#fbbf24' },
    { name: 'Shopping',          emoji: '🛍️', color: '#34d399' },
    { name: 'Bills & Utilities', emoji: '💡', color: '#60a5fa' },
    { name: 'Entertainment',     emoji: '🎬', color: '#fb923c' },
    { name: 'Healthcare',        emoji: '🏥', color: '#a78bfa' },
    { name: 'Education',         emoji: '📚', color: '#38bdf8' },
    { name: 'Rent',              emoji: '🏠', color: '#2dd4bf' },
    { name: 'Groceries',         emoji: '🛒', color: '#4ade80' },
    { name: 'Other',             emoji: '📦', color: '#94a3b8' },
  ],
  income: [
    { name: 'Salary',      emoji: '💰', color: '#34d399' },
    { name: 'Freelance',   emoji: '💼', color: '#2dd4bf' },
    { name: 'Investment',  emoji: '📈', color: '#38bdf8' },
    { name: 'Business',    emoji: '🏢', color: '#a3e635' },
    { name: 'Gift',        emoji: '🎁', color: '#e879f9' },
    { name: 'Other',       emoji: '💵', color: '#6ee7b7' },
  ],
});

// Indian Rupee formatter — lakh/crore grouping
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatINR = (n) => INR.format(n);

/** Compact format for chart tooltips: ₹1.2L, ₹45K, ₹800 */
function compactINR(n) {
  const abs = Math.abs(n);
  if (abs >= 100000) return '₹' + (abs / 100000).toFixed(1) + 'L';
  if (abs >= 1000) return '₹' + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'K';
  return '₹' + abs;
}

// ==========================================================================
// 2. STATE
// ==========================================================================

const state = {
  transactions: [],
  budget: 0,
  currentType: 'expense',

  // Month navigation
  viewMode: 'month',   // 'month' | 'all'
  viewMonth: new Date().getMonth(),    // 0-11
  viewYear: new Date().getFullYear(),
};

let lastBudgetAlertLevel = null;

// ==========================================================================
// 3. THEME MANAGEMENT
// ==========================================================================

function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function setTheme(theme) {
  document.documentElement.classList.add('theme-transitioning');
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    const next = theme === 'dark' ? 'light' : 'dark';
    btn.setAttribute('aria-label', 'Switch to ' + next + ' mode');
    btn.setAttribute('title', 'Switch to ' + next + ' mode');
  }

  setTimeout(function () {
    document.documentElement.classList.remove('theme-transitioning');
  }, 550);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  showToast('Switched to ' + (next === 'dark' ? 'Dark' : 'Light') + ' mode', 'info');
}

// ==========================================================================
// 4. LOCAL STORAGE PERSISTENCE
// ==========================================================================

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.transactions)) {
      state.transactions = data.transactions;
    }
    if (typeof data.budget === 'number' && data.budget >= 0) {
      state.budget = data.budget;
    }
  } catch (e) {
    console.warn('[BudgetBuddy] Parse error:', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      transactions: state.transactions,
      budget: state.budget,
    }));
  } catch (e) {
    console.warn('[BudgetBuddy] Save error:', e);
    showToast('Could not save — storage may be full.', 'error');
  }
}

// ==========================================================================
// 5. UTILITIES
// ==========================================================================

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(str) {
  var el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function getCat(type, name) {
  return CATEGORIES[type].find(function (c) { return c.name === name; }) || { emoji: '📦', color: '#94a3b8' };
}

function todayISO() {
  var d = new Date();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

// ==========================================================================
// 6. CALCULATIONS
// ==========================================================================

/** Filter transactions for a specific month/year */
function txForMonth(m, y) {
  return state.transactions.filter(function (tx) {
    var d = new Date(tx.date);
    return d.getMonth() === m && d.getFullYear() === y;
  });
}

/** Get transactions based on current view mode */
function getViewTransactions() {
  if (state.viewMode === 'all') return state.transactions.slice();
  return txForMonth(state.viewMonth, state.viewYear);
}

function calcTotals(txList) {
  var income = 0;
  var expense = 0;
  for (var i = 0; i < txList.length; i++) {
    if (txList[i].type === 'income') income += txList[i].amount;
    else expense += txList[i].amount;
  }
  return { income: income, expense: expense, balance: income - expense };
}

function calcExpensesByCategory(txList) {
  var map = {};
  for (var i = 0; i < txList.length; i++) {
    var tx = txList[i];
    if (tx.type === 'expense') {
      map[tx.category] = (map[tx.category] || 0) + tx.amount;
    }
  }
  return Object.entries(map).sort(function (a, b) { return b[1] - a[1]; });
}

function getCurrentMonthExpenses() {
  var now = new Date();
  var txs = txForMonth(now.getMonth(), now.getFullYear());
  var total = 0;
  for (var i = 0; i < txs.length; i++) {
    if (txs[i].type === 'expense') total += txs[i].amount;
  }
  return total;
}

/** Get totals for the previous month relative to the viewed month */
function getPrevMonthTotals() {
  var pm = state.viewMonth - 1;
  var py = state.viewYear;
  if (pm < 0) { pm = 11; py--; }
  return calcTotals(txForMonth(pm, py));
}

/** Get last 6 months data for overview chart */
function getLast6Months() {
  var result = [];
  var m = new Date().getMonth();
  var y = new Date().getFullYear();
  for (var i = 0; i < 6; i++) {
    var txs = txForMonth(m, y);
    var t = calcTotals(txs);
    result.unshift({
      month: m,
      year: y,
      income: t.income,
      expense: t.expense,
      net: t.balance,
    });
    m--;
    if (m < 0) { m = 11; y--; }
  }
  return result;
}

// ==========================================================================
// 7. DOM CACHE
// ==========================================================================

var D = {};

function cacheDom() {
  function $(id) { return document.getElementById(id); }

  D.totalBalance   = $('total-balance');
  D.totalIncome    = $('total-income');
  D.totalExpenses  = $('total-expenses');
  D.lblBalance     = $('lbl-balance');
  D.lblIncome      = $('lbl-income');
  D.lblExpense     = $('lbl-expense');
  D.cmpBalance     = $('cmp-balance');
  D.cmpIncome      = $('cmp-income');
  D.cmpExpense     = $('cmp-expense');
  D.budgetInput    = $('budget-input');
  D.budgetFill     = $('budget-fill');
  D.budgetGlow     = $('budget-glow');
  D.budgetSpent    = $('budget-spent');
  D.budgetPercent  = $('budget-percent');
  D.budgetProgress = $('budget-progressbar');
  D.form           = $('transaction-form');
  D.txTitle        = $('tx-title');
  D.txAmount       = $('tx-amount');
  D.txDate         = $('tx-date');
  D.txCategory     = $('tx-category');
  D.btnSubmit      = $('btn-submit');
  D.btnSubmitText  = $('btn-submit-text');
  D.toggleSlider   = $('toggle-slider');
  D.donutSvg       = $('donut-svg');
  D.donutTotal     = $('donut-total');
  D.donutTitle     = $('donut-title');
  D.legend         = $('category-legend');
  D.historyList    = $('history-list');
  D.txCount        = $('tx-count');
  D.searchInput    = $('search-input');
  D.historyTitle   = $('history-title');
  D.toastContainer = $('toast-container');
  D.confirmModal   = $('confirm-modal');
  D.confirmMessage = $('confirm-message');
  D.confirmOk      = $('confirm-ok');
  D.confirmCancel  = $('confirm-cancel');
  D.alertBanner    = $('budget-alert-banner');
  D.alertPrimary   = $('alert-primary-text');
  D.alertSecondary = $('alert-secondary-text');
  D.alertClose     = $('alert-close');
  D.alertProgress  = $('alert-progress');
  D.monthLabel     = $('month-label');
  D.monthSub       = $('month-sub');
  D.viewSlider     = $('view-slider');
  D.overviewChart  = $('overview-chart');
  D.overviewEmpty  = $('overview-empty');
}

// ==========================================================================
// 8. RENDER FUNCTIONS
// ==========================================================================

function pulse(el) {
  el.classList.remove('amount-updated');
  void el.offsetWidth;
  el.classList.add('amount-updated');
}

// ----- Month Navigation -----

function renderMonthNav() {
  var mName = MONTHS_FULL[state.viewMonth];
  D.monthLabel.textContent = mName + ' ' + state.viewYear;

  if (state.viewMode === 'all') {
    D.monthSub.textContent = 'Viewing all transactions';
  } else {
    var now = new Date();
    if (state.viewMonth === now.getMonth() && state.viewYear === now.getFullYear()) {
      D.monthSub.textContent = 'Current month';
    } else {
      D.monthSub.textContent = 'Viewing selected month';
    }
  }

  // Update view toggle buttons
  var viewBtns = document.querySelectorAll('.view-btn');
  for (var i = 0; i < viewBtns.length; i++) {
    var btn = viewBtns[i];
    var isActive = btn.dataset.view === state.viewMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', String(isActive));
  }

  if (state.viewMode === 'all') {
    D.viewSlider.classList.add('slide-right');
  } else {
    D.viewSlider.classList.remove('slide-right');
  }
}

// ----- Dashboard -----

function renderDashboard() {
  var txList = getViewTransactions();
  var totals = calcTotals(txList);
  var income = totals.income;
  var expense = totals.expense;
  var balance = totals.balance;

  D.totalBalance.textContent = formatINR(balance);
  D.totalIncome.textContent = formatINR(income);
  D.totalExpenses.textContent = formatINR(expense);

  D.totalBalance.classList.toggle('negative-balance', balance < 0);

  // Labels
  if (state.viewMode === 'all') {
    D.lblBalance.textContent = 'Total Balance';
    D.lblIncome.textContent = 'Total Income';
    D.lblExpense.textContent = 'Total Expenses';
  } else {
    var mShort = MONTHS_SHORT[state.viewMonth];
    D.lblBalance.textContent = mShort + ' Balance';
    D.lblIncome.textContent = mShort + ' Income';
    D.lblExpense.textContent = mShort + ' Expenses';
  }

  // Month-over-month comparison (only in month mode)
  if (state.viewMode === 'month') {
    var prev = getPrevMonthTotals();
    renderComparison(D.cmpBalance, balance, prev.balance, 'balance');
    renderComparison(D.cmpIncome, income, prev.income, 'income');
    renderComparison(D.cmpExpense, expense, prev.expense, 'expense');
  } else {
    D.cmpBalance.textContent = '';
    D.cmpIncome.textContent = '';
    D.cmpExpense.textContent = '';
  }

  pulse(D.totalBalance);
}

function renderComparison(el, current, previous, type) {
  if (previous === 0 && current === 0) {
    el.textContent = '';
    el.className = 'summary-comparison';
    return;
  }

  if (previous === 0) {
    el.textContent = '● New this month';
    el.className = 'summary-comparison cmp-neutral';
    return;
  }

  var diff = current - previous;
  var pct = Math.round((Math.abs(diff) / previous) * 100);

  if (diff === 0) {
    el.textContent = '— Same as last month';
    el.className = 'summary-comparison cmp-neutral';
    return;
  }

  var arrow = diff > 0 ? '↑' : '↓';
  var cls;

  // For expenses, "up" is bad; for income/balance, "up" is good
  if (type === 'expense') {
    cls = diff > 0 ? 'cmp-down' : 'cmp-up';
  } else {
    cls = diff > 0 ? 'cmp-up' : 'cmp-down';
  }

  el.textContent = arrow + ' ' + pct + '% vs last month';
  el.className = 'summary-comparison ' + cls;
}

// ----- Budget Progress -----

function renderBudgetProgress() {
  var spent = getCurrentMonthExpenses();
  var budget = state.budget;

  D.budgetSpent.textContent = formatINR(spent) + ' spent this month';

  if (budget <= 0) {
    D.budgetFill.style.width = '0%';
    D.budgetGlow.style.width = '0%';
    D.budgetFill.className = 'progress-fill';
    D.budgetGlow.className = 'progress-glow';
    D.budgetPercent.textContent = 'No budget set';
    D.budgetProgress.setAttribute('aria-valuenow', '0');
    return;
  }

  var pct = Math.min((spent / budget) * 100, 100);

  D.budgetFill.style.width = pct + '%';
  D.budgetGlow.style.width = pct + '%';

  D.budgetFill.className = 'progress-fill';
  D.budgetGlow.className = 'progress-glow';

  if (pct <= 50) {
    D.budgetFill.classList.add('safe');
    D.budgetGlow.classList.add('safe');
  } else if (pct <= 80) {
    D.budgetFill.classList.add('warning');
    D.budgetGlow.classList.add('warning');
  } else {
    D.budgetFill.classList.add('danger');
    D.budgetGlow.classList.add('danger');
  }

  D.budgetSpent.textContent = formatINR(spent) + ' of ' + formatINR(budget);

  if (spent > budget) {
    D.budgetPercent.textContent = Math.round((spent / budget) * 100) + '% — Over budget!';
  } else {
    D.budgetPercent.textContent = Math.round(pct) + '%';
  }

  D.budgetProgress.setAttribute('aria-valuenow', Math.round(pct));
}

// ----- SVG Donut Chart -----

function renderDonutChart() {
  var txList = getViewTransactions();
  var entries = calcExpensesByCategory(txList);
  var total = 0;
  for (var i = 0; i < entries.length; i++) {
    total += entries[i][1];
  }

  var R = 80;
  var C = 2 * Math.PI * R;

  D.donutTotal.textContent = formatINR(total);

  // Update title
  if (state.viewMode === 'month') {
    D.donutTitle.textContent = '🍩 ' + MONTHS_SHORT[state.viewMonth] + ' Expenses';
  } else {
    D.donutTitle.textContent = '🍩 All-Time Expenses';
  }

  // Remove old segments
  var oldSegs = D.donutSvg.querySelectorAll('.donut-segment');
  for (var i = 0; i < oldSegs.length; i++) {
    oldSegs[i].remove();
  }

  if (entries.length === 0) {
    D.legend.innerHTML = '<p class="legend-empty">No expense data yet.</p>';
    return;
  }

  var offset = 0;
  for (var i = 0; i < entries.length; i++) {
    var cat = entries[i][0];
    var amount = entries[i][1];
    var config = getCat('expense', cat);
    var slice = (amount / total) * C;

    var circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('class', 'donut-segment');
    circ.setAttribute('cx', '100');
    circ.setAttribute('cy', '100');
    circ.setAttribute('r', String(R));
    circ.setAttribute('stroke', config.color);
    circ.setAttribute('stroke-dasharray', slice + ' ' + (C - slice));
    circ.setAttribute('stroke-dashoffset', String(-offset));
    D.donutSvg.appendChild(circ);
    offset += slice;
  }

  // Legend
  var html = '';
  for (var i = 0; i < entries.length; i++) {
    var cat = entries[i][0];
    var amount = entries[i][1];
    var config = getCat('expense', cat);
    var pct = ((amount / total) * 100).toFixed(1);

    html += '<div class="legend-item">' +
      '<span class="legend-color" style="background:' + config.color + '"></span>' +
      '<span class="legend-emoji">' + config.emoji + '</span>' +
      '<span class="legend-name">' + esc(cat) + '</span>' +
      '<span class="legend-value">' + formatINR(amount) + '</span>' +
      '<span class="legend-pct">' + pct + '%</span>' +
      '</div>';
  }
  D.legend.innerHTML = html;
}

// ----- Transaction History -----

function renderHistory(query) {
  if (query === undefined) query = '';

  var txList = getViewTransactions();

  // Sort: most recent first
  var list = txList.slice().sort(function (a, b) {
    var dateDiff = new Date(b.date) - new Date(a.date);
    if (dateDiff !== 0) return dateDiff;
    return b.createdAt - a.createdAt;
  });

  // Filter by search query
  if (query) {
    var q = query.toLowerCase();
    list = list.filter(function (t) {
      return t.title.toLowerCase().indexOf(q) !== -1 ||
             t.category.toLowerCase().indexOf(q) !== -1;
    });
  }

  D.txCount.textContent = list.length;

  // Update title
  if (state.viewMode === 'month') {
    D.historyTitle.textContent = '📜 ' + MONTHS_SHORT[state.viewMonth] + ' ' + state.viewYear + ' History';
  } else {
    D.historyTitle.textContent = '📜 All History';
  }

  if (list.length === 0) {
    var isSearch = !!query;
    var mName = MONTHS_FULL[state.viewMonth];
    var emptyMsg;

    if (isSearch) {
      emptyMsg = 'No matching transactions';
    } else if (state.viewMode === 'month') {
      emptyMsg = 'No transactions in ' + mName;
    } else {
      emptyMsg = 'No transactions yet';
    }

    var subMsg = isSearch ? 'Try a different search term.' : 'Add your first transaction to begin tracking.';

    D.historyList.innerHTML =
      '<div class="empty-state">' +
      '<div class="empty-icon" aria-hidden="true">' + (isSearch ? '🔍' : '📋') + '</div>' +
      '<p class="empty-title">' + emptyMsg + '</p>' +
      '<p class="empty-subtitle">' + subMsg + '</p>' +
      '</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var config = getCat(t.type, t.category);
    var sign = t.type === 'income' ? '+' : '−';
    var cls = t.type === 'income' ? 'tx-inc' : 'tx-exp';
    var delay = i * 25;

    html += '<div class="tx-item" data-id="' + t.id + '" style="animation-delay:' + delay + 'ms">' +
      '<div class="tx-icon" style="background:' + config.color + '18;color:' + config.color + '">' + config.emoji + '</div>' +
      '<div class="tx-details">' +
      '<span class="tx-title">' + esc(t.title) + '</span>' +
      '<span class="tx-meta">' + esc(t.category) + ' · ' + formatDate(t.date) + '</span>' +
      '</div>' +
      '<div class="tx-right">' +
      '<span class="tx-amount ' + cls + '">' + sign + formatINR(t.amount) + '</span>' +
      '<button class="btn-delete" data-delete-id="' + t.id + '" title="Delete" aria-label="Delete ' + esc(t.title) + '">✕</button>' +
      '</div>' +
      '</div>';
  }
  D.historyList.innerHTML = html;
}

// ----- 6-Month Overview Chart -----

function renderOverviewChart() {
  var months = getLast6Months();

  var hasData = false;
  for (var i = 0; i < months.length; i++) {
    if (months[i].income > 0 || months[i].expense > 0) {
      hasData = true;
      break;
    }
  }

  if (!hasData) {
    D.overviewChart.style.display = 'none';
    D.overviewEmpty.classList.remove('hidden');
    return;
  }

  D.overviewChart.style.display = '';
  D.overviewEmpty.classList.add('hidden');

  // Find max value for scaling
  var maxVal = 1;
  for (var i = 0; i < months.length; i++) {
    var incVal = months[i].income;
    var expVal = months[i].expense;
    if (incVal > maxVal) maxVal = incVal;
    if (expVal > maxVal) maxVal = expVal;
  }

  var now = new Date();
  var html = '';

  for (var i = 0; i < months.length; i++) {
    var m = months[i];
    var incH = m.income > 0 ? Math.max((m.income / maxVal) * 100, 4) : 0;
    var expH = m.expense > 0 ? Math.max((m.expense / maxVal) * 100, 4) : 0;
    var isActive = state.viewMode === 'month' &&
                   m.month === state.viewMonth &&
                   m.year === state.viewYear;
    var isCurrent = m.month === now.getMonth() && m.year === now.getFullYear();
    var net = m.income - m.expense;
    var netCls = net > 0 ? 'positive' : (net < 0 ? 'negative' : 'zero');
    var netText;

    if (net === 0 && m.income === 0) {
      netText = '';
    } else {
      netText = (net >= 0 ? '+' : '-') + compactINR(Math.abs(net));
    }

    html += '<div class="month-col' + (isActive ? ' active-col' : '') + '" data-nav-month="' + m.month + '" data-nav-year="' + m.year + '">' +
      '<div class="mc-bars">' +
      '<div class="mc-bar mc-bar-income" style="height:' + incH + '%">' +
      '<span class="mc-tip">' + formatINR(m.income) + '</span>' +
      '</div>' +
      '<div class="mc-bar mc-bar-expense" style="height:' + expH + '%">' +
      '<span class="mc-tip">' + formatINR(m.expense) + '</span>' +
      '</div>' +
      '</div>' +
      '<span class="mc-label">' + MONTHS_SHORT[m.month] + (isCurrent ? ' ●' : '') + '</span>' +
      (netText ? '<span class="mc-net ' + netCls + '">' + netText + '</span>' : '<span class="mc-net zero">—</span>') +
      '</div>';
  }

  D.overviewChart.innerHTML = html;
}

// ----- Populate Categories -----

function populateCategories(type) {
  var cats = CATEGORIES[type];
  var html = '<option value="" disabled selected>Select category</option>';
  for (var i = 0; i < cats.length; i++) {
    html += '<option value="' + cats[i].name + '">' + cats[i].emoji + ' ' + cats[i].name + '</option>';
  }
  D.txCategory.innerHTML = html;
}

// ----- Master Render -----

function renderAll() {
  renderMonthNav();
  renderDashboard();
  renderBudgetProgress();
  renderDonutChart();
  renderHistory(D.searchInput.value);
  renderOverviewChart();
}

// ==========================================================================
// 9. BUDGET ALERT SYSTEM (Bengali + English)
// ==========================================================================

function checkBudgetAlert() {
  var budget = state.budget;
  if (budget <= 0) {
    lastBudgetAlertLevel = null;
    return;
  }

  var spent = getCurrentMonthExpenses();
  var pct = (spent / budget) * 100;

  if (pct >= 100 && lastBudgetAlertLevel !== 'exceeded') {
    lastBudgetAlertLevel = 'exceeded';
    showBudgetBanner(
      '🚨 বাজেট অতিক্রম! তোমার এই মাসের খরচ বাজেটের সীমা ছাড়িয়ে গেছে!',
      'Budget Exceeded! You\'ve spent ' + formatINR(spent) + ' against a budget of ' + formatINR(budget) + '.',
      true
    );
  } else if (pct >= 90 && pct < 100 && lastBudgetAlertLevel !== 'warning90' && lastBudgetAlertLevel !== 'exceeded') {
    lastBudgetAlertLevel = 'warning90';
    showBudgetBanner(
      '⚠️ সাবধান! তুমি তোমার বাজেট অতিক্রম করার পথে!',
      'Warning: You\'ve used ' + Math.round(pct) + '% of your monthly budget (' + formatINR(spent) + ' of ' + formatINR(budget) + ').',
      false
    );
  } else if (pct < 90) {
    lastBudgetAlertLevel = null;
  }
}

var _budgetBannerTimer = null;

function showBudgetBanner(primary, secondary, isDanger) {
  D.alertPrimary.textContent = primary;
  D.alertSecondary.textContent = secondary;

  if (isDanger) {
    D.alertBanner.classList.add('alert-danger');
  } else {
    D.alertBanner.classList.remove('alert-danger');
  }

  D.alertBanner.classList.remove('hidden');

  // Reset countdown animation
  D.alertProgress.style.animation = 'none';
  void D.alertProgress.offsetWidth;
  D.alertProgress.style.animation = '';

  // Auto-hide after 8s
  if (_budgetBannerTimer) clearTimeout(_budgetBannerTimer);
  _budgetBannerTimer = setTimeout(function () {
    D.alertBanner.classList.add('hidden');
  }, 8000);
}

// ==========================================================================
// 10. EVENT HANDLERS
// ==========================================================================

// --- Month Navigation ---

function goToPrevMonth() {
  state.viewMonth--;
  if (state.viewMonth < 0) {
    state.viewMonth = 11;
    state.viewYear--;
  }
  state.viewMode = 'month';
  renderAll();
}

function goToNextMonth() {
  state.viewMonth++;
  if (state.viewMonth > 11) {
    state.viewMonth = 0;
    state.viewYear++;
  }
  state.viewMode = 'month';
  renderAll();
}

function setViewMode(mode) {
  state.viewMode = mode;
  renderAll();
}

function navigateToMonth(m, y) {
  state.viewMonth = m;
  state.viewYear = y;
  state.viewMode = 'month';
  renderAll();
}

// --- Type Toggle ---

function handleTypeToggle(type) {
  state.currentType = type;

  var btns = document.querySelectorAll('.toggle-btn');
  for (var i = 0; i < btns.length; i++) {
    var isActive = btns[i].dataset.type === type;
    btns[i].classList.toggle('active', isActive);
    btns[i].setAttribute('aria-checked', String(isActive));
  }

  if (type === 'income') {
    D.toggleSlider.classList.add('slide-right');
  } else {
    D.toggleSlider.classList.remove('slide-right');
  }

  D.btnSubmit.classList.remove('expense-mode', 'income-mode');
  D.btnSubmit.classList.add(type === 'income' ? 'income-mode' : 'expense-mode');
  D.btnSubmitText.textContent = type === 'income' ? 'Add Income' : 'Add Expense';

  populateCategories(type);
}

// --- Form Submit ---

function handleFormSubmit(e) {
  e.preventDefault();

  var title = D.txTitle.value.trim();
  var amount = parseFloat(D.txAmount.value);
  var date = D.txDate.value;
  var category = D.txCategory.value;

  if (!title) {
    showToast('Please enter a title.', 'error');
    D.txTitle.focus();
    return;
  }
  if (!amount || amount < 1) {
    showToast('Please enter a valid amount.', 'error');
    D.txAmount.focus();
    return;
  }
  if (!date) {
    showToast('Please select a date.', 'error');
    D.txDate.focus();
    return;
  }
  if (!category) {
    showToast('Please select a category.', 'error');
    D.txCategory.focus();
    return;
  }

  var tx = {
    id: uid(),
    title: title,
    amount: amount,
    date: date,
    category: category,
    type: state.currentType,
    createdAt: Date.now(),
  };

  state.transactions.push(tx);
  saveState();

  // Auto-navigate to the month of the new transaction
  var td = new Date(date);
  state.viewMonth = td.getMonth();
  state.viewYear = td.getFullYear();
  state.viewMode = 'month';

  renderAll();

  if (state.currentType === 'expense') {
    checkBudgetAlert();
  }

  // Reset form
  D.form.reset();
  D.txDate.value = todayISO();
  populateCategories(state.currentType);

  var typeLabel = state.currentType === 'income' ? 'Income' : 'Expense';
  var toastType = state.currentType === 'income' ? 'success' : 'info';
  showToast(typeLabel + ' of ' + formatINR(amount) + ' added!', toastType);
}

// --- Delete Transaction ---

function handleDeleteTx(id) {
  var tx = null;
  for (var i = 0; i < state.transactions.length; i++) {
    if (state.transactions[i].id === id) {
      tx = state.transactions[i];
      break;
    }
  }
  if (!tx) return;

  showConfirmModal(
    'Delete "' + tx.title + '" (' + formatINR(tx.amount) + ')?',
    function () {
      state.transactions = state.transactions.filter(function (t) {
        return t.id !== id;
      });
      saveState();
      renderAll();
      checkBudgetAlert();
      showToast('Transaction deleted.', 'info');
    }
  );
}

// --- Set Budget ---

function handleSetBudget() {
  var val = parseFloat(D.budgetInput.value);
  if (!val || val < 1) {
    showToast('Enter a valid budget amount.', 'error');
    D.budgetInput.focus();
    return;
  }

  state.budget = val;
  saveState();

  lastBudgetAlertLevel = null;
  renderBudgetProgress();
  checkBudgetAlert();

  D.budgetInput.value = '';
  D.budgetInput.placeholder = formatINR(val);
  showToast('Monthly budget set to ' + formatINR(val) + '.', 'success');
}

// --- Export CSV ---

function handleExportCSV() {
  var txList = getViewTransactions();

  if (txList.length === 0) {
    showToast('No transactions to export.', 'error');
    return;
  }

  var header = ['Title', 'Type', 'Category', 'Amount (INR)', 'Date'];
  var sorted = txList.slice().sort(function (a, b) {
    return new Date(b.date) - new Date(a.date);
  });

  var rows = [];
  for (var i = 0; i < sorted.length; i++) {
    var t = sorted[i];
    rows.push([
      '"' + t.title.replace(/"/g, '""') + '"',
      t.type.charAt(0).toUpperCase() + t.type.slice(1),
      '"' + t.category + '"',
      t.amount,
      t.date,
    ].join(','));
  }

  var csv = header.join(',') + '\r\n' + rows.join('\r\n');
  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);

  var a = document.createElement('a');
  a.href = url;
  var suffix = state.viewMode === 'month'
    ? MONTHS_SHORT[state.viewMonth] + '_' + state.viewYear
    : 'All';
  a.download = 'BudgetBuddy_' + suffix + '_' + todayISO() + '.csv';
  a.click();
  URL.revokeObjectURL(url);

  showToast('Exported ' + txList.length + ' transactions.', 'success');
}

// --- Clear All ---

function handleClearAll() {
  if (state.transactions.length === 0 && state.budget === 0) {
    showToast('Nothing to clear.', 'info');
    return;
  }

  showConfirmModal(
    'This will permanently delete ALL transactions and reset your budget. This cannot be undone.',
    function () {
      state.transactions = [];
      state.budget = 0;
      lastBudgetAlertLevel = null;
      localStorage.removeItem(STORAGE_KEY);
      D.budgetInput.placeholder = 'Set budget';
      D.alertBanner.classList.add('hidden');
      renderAll();
      showToast('All data cleared.', 'info');
    }
  );
}

// ==========================================================================
// 11. TOAST NOTIFICATION SYSTEM
// ==========================================================================

function showToast(message, type) {
  if (!type) type = 'info';

  var icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
  };

  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span><span>' + esc(message) + '</span>';

  D.toastContainer.appendChild(toast);

  requestAnimationFrame(function () {
    toast.classList.add('toast-show');
  });

  setTimeout(function () {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');

    toast.addEventListener('transitionend', function () {
      if (toast.parentNode) toast.remove();
    }, { once: true });

    // Fallback removal
    setTimeout(function () {
      if (toast.parentNode) toast.remove();
    }, 500);
  }, 3500);
}

// ==========================================================================
// 12. CONFIRM MODAL
// ==========================================================================

function showConfirmModal(message, onConfirm) {
  D.confirmMessage.textContent = message;
  D.confirmModal.classList.remove('hidden');
  D.confirmCancel.focus();

  var cleanedUp = false;

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    D.confirmOk.removeEventListener('click', onOk);
    D.confirmCancel.removeEventListener('click', onCancel);
    D.confirmModal.removeEventListener('click', onOverlay);
    document.removeEventListener('keydown', onEsc);
  }

  function close() {
    D.confirmModal.classList.add('hidden');
    cleanup();
  }

  function onOk() {
    onConfirm();
    close();
  }

  function onCancel() {
    close();
  }

  function onOverlay(e) {
    if (e.target === D.confirmModal) close();
  }

  function onEsc(e) {
    if (e.key === 'Escape') close();
  }

  D.confirmOk.addEventListener('click', onOk);
  D.confirmCancel.addEventListener('click', onCancel);
  D.confirmModal.addEventListener('click', onOverlay);
  document.addEventListener('keydown', onEsc);
}

// ==========================================================================
// 13. EVENT BINDING
// ==========================================================================

function bindEvents() {
  // Form submission
  D.form.addEventListener('submit', handleFormSubmit);

  // Type toggle buttons
  var toggleBtns = document.querySelectorAll('.toggle-btn');
  for (var i = 0; i < toggleBtns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        handleTypeToggle(btn.dataset.type);
      });
    })(toggleBtns[i]);
  }

  // Budget
  document.getElementById('btn-set-budget').addEventListener('click', handleSetBudget);
  D.budgetInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSetBudget();
    }
  });

  // Header actions
  document.getElementById('btn-export').addEventListener('click', handleExportCSV);
  document.getElementById('btn-clear').addEventListener('click', handleClearAll);

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Month navigation
  document.getElementById('month-prev').addEventListener('click', goToPrevMonth);
  document.getElementById('month-next').addEventListener('click', goToNextMonth);

  // View mode toggle
  var viewBtns = document.querySelectorAll('.view-btn');
  for (var i = 0; i < viewBtns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(btn.dataset.view);
      });
    })(viewBtns[i]);
  }

  // Click on overview chart month column to navigate
  D.overviewChart.addEventListener('click', function (e) {
    var col = e.target.closest('.month-col');
    if (col) {
      var m = parseInt(col.dataset.navMonth);
      var y = parseInt(col.dataset.navYear);
      if (!isNaN(m) && !isNaN(y)) {
        navigateToMonth(m, y);
      }
    }
  });

  // Search (debounced)
  var searchTimer = null;
  D.searchInput.addEventListener('input', function (e) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      renderHistory(e.target.value);
    }, 150);
  });

  // Delete via event delegation
  D.historyList.addEventListener('click', function (e) {
    var btn = e.target.closest('.btn-delete');
    if (btn && btn.dataset.deleteId) {
      handleDeleteTx(btn.dataset.deleteId);
    }
  });

  // Alert banner close
  D.alertClose.addEventListener('click', function () {
    D.alertBanner.classList.add('hidden');
    if (_budgetBannerTimer) clearTimeout(_budgetBannerTimer);
  });

  // Keyboard shortcut: Alt + Arrow for month navigation
  document.addEventListener('keydown', function (e) {
    // Don't trigger when typing in inputs
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    // Don't trigger when modal is open
    if (!D.confirmModal.classList.contains('hidden')) return;

    if (e.key === 'ArrowLeft' && e.altKey) {
      e.preventDefault();
      goToPrevMonth();
    }
    if (e.key === 'ArrowRight' && e.altKey) {
      e.preventDefault();
      goToNextMonth();
    }
  });
}

// ==========================================================================
// 14. INITIALISATION
// ==========================================================================

function init() {
  // Set theme before any paint
  setTheme(getTheme());

  // Cache DOM references
  cacheDom();

  // Load saved data
  loadState();

  // Set form defaults
  D.txDate.value = todayISO();
  D.txDate.max = todayISO();

  // Restore budget placeholder
  if (state.budget > 0) {
    D.budgetInput.placeholder = formatINR(state.budget);
  }

  // Set view to current month
  state.viewMonth = new Date().getMonth();
  state.viewYear = new Date().getFullYear();
  state.viewMode = 'month';

  // Initial type & categories
  handleTypeToggle('expense');

  // Wire up all event listeners
  bindEvents();

  // First paint
  renderAll();

  // Check budget alert on load
  checkBudgetAlert();
}

// Boot the app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
