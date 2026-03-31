'use strict';

// ==========================================================================
// 1. CONFIG
// ==========================================================================

const STORAGE_KEY = 'budgetbuddy_v3';
const THEME_KEY = 'budgetbuddy_theme';

const MONTHS_FULL = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'];

const CATEGORIES = Object.freeze({
  expense: [
    { name:'Food & Dining',     emoji:'🍕', color:'#fb7185' },
    { name:'Transport',         emoji:'🚗', color:'#fbbf24' },
    { name:'Shopping',          emoji:'🛍️', color:'#34d399' },
    { name:'Bills & Utilities', emoji:'💡', color:'#60a5fa' },
    { name:'Entertainment',     emoji:'🎬', color:'#fb923c' },
    { name:'Healthcare',        emoji:'🏥', color:'#a78bfa' },
    { name:'Education',         emoji:'📚', color:'#38bdf8' },
    { name:'Rent',              emoji:'🏠', color:'#2dd4bf' },
    { name:'Groceries',         emoji:'🛒', color:'#4ade80' },
    { name:'Other',             emoji:'📦', color:'#94a3b8' },
  ],
  income: [
    { name:'Salary',    emoji:'💰', color:'#34d399' },
    { name:'Freelance', emoji:'💼', color:'#2dd4bf' },
    { name:'Investment',emoji:'📈', color:'#38bdf8' },
    { name:'Business',  emoji:'🏢', color:'#a3e635' },
    { name:'Gift',      emoji:'🎁', color:'#e879f9' },
    { name:'Other',     emoji:'💵', color:'#6ee7b7' },
  ],
});

const INR = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:0});
const formatINR = n => INR.format(n);

/** Compact format for chart tooltips: ₹1.2L, ₹45K, ₹800 */
function compactINR(n) {
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return '₹' + n;
}

// ==========================================================================
// 2. STATE
// ==========================================================================

const state = {
  transactions: [],
  budget: 0,
  currentType: 'expense',

  // Month navigation
  viewMode: 'month',  // 'month' | 'all'
  viewMonth: new Date().getMonth(),   // 0-11
  viewYear:  new Date().getFullYear(),
};

let lastBudgetAlertLevel = null;

// ==========================================================================
// 3. THEME
// ==========================================================================

function getTheme() {
  const s = localStorage.getItem(THEME_KEY);
  if (s === 'light' || s === 'dark') return s;
  return window.matchMedia?.('(prefers-color-scheme:light)').matches ? 'light' : 'dark';
}
function setTheme(t) {
  document.documentElement.classList.add('theme-transitioning');
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
  const btn = document.getElementById('theme-toggle');
  if (btn) { const n = t==='dark'?'light':'dark'; btn.setAttribute('aria-label',`Switch to ${n} mode`); }
  setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 550);
}
function toggleTheme() {
  const c = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(c==='dark'?'light':'dark');
  showToast(`Switched to ${c==='dark'?'Light':'Dark'} mode`,'info');
}

// ==========================================================================
// 4. PERSISTENCE
// ==========================================================================

function loadState() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!d) return;
    if (Array.isArray(d.transactions)) state.transactions = d.transactions;
    if (typeof d.budget==='number' && d.budget>=0) state.budget = d.budget;
  } catch(e) { console.warn('[BB] parse error', e); }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ transactions: state.transactions, budget: state.budget }));
  } catch(e) { showToast('Save failed — storage full?','error'); }
}

// ==========================================================================
// 5. UTILITIES
// ==========================================================================

function formatDate(iso) { return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function esc(s) { const e=document.createElement('span'); e.textContent=s; return e.innerHTML; }
function getCat(type,name) { return CATEGORIES[type].find(c=>c.name===name)||{emoji:'📦',color:'#94a3b8'}; }
function todayISO() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ==========================================================================
// 6. CALCULATIONS
// ==========================================================================

/** Filter transactions for a specific month/year */
function txForMonth(m, y) {
  return state.transactions.filter(tx => {
    const d = new Date(tx.date);
    return d.getMonth() === m && d.getFullYear() === y;
  });
}

/** Get transactions based on current view mode */
function getViewTransactions() {
  if (state.viewMode === 'all') return [...state.transactions];
  return txForMonth(state.viewMonth, state.viewYear);
}

function calcTotals(txList) {
  let income=0, expense=0;
  for (const tx of txList) { if (tx.type==='income') income+=tx.amount; else expense+=tx.amount; }
  return { income, expense, balance: income - expense };
}

function calcExpensesByCategory(txList) {
  const map = {};
  for (const tx of txList) { if (tx.type==='expense') map[tx.category]=(map[tx.category]||0)+tx.amount; }
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}

function getCurrentMonthExpenses() {
  const now = new Date();
  return txForMonth(now.getMonth(), now.getFullYear())
    .filter(tx => tx.type==='expense')
    .reduce((s,tx) => s+tx.amount, 0);
}

/** Get totals for the previous month relative to the viewed month */
function getPrevMonthTotals() {
  let pm = state.viewMonth - 1, py = state.viewYear;
  if (pm < 0) { pm = 11; py--; }
  return calcTotals(txForMonth(pm, py));
}

/** Get last 6 months data for overview chart */
function getLast6Months() {
  const result = [];
  let m = new Date().getMonth(), y = new Date().getFullYear();
  for (let i = 0; i < 6; i++) {
    const txs = txForMonth(m, y);
    const t = calcTotals(txs);
    result.unshift({ month: m, year: y, income: t.income, expense: t.expense, net: t.balance });
    m--;
    if (m < 0) { m = 11; y--; }
  }
  return result;
}

// ==========================================================================
// 7. DOM CACHE
// ==========================================================================

const D = {};

function cacheDom() {
  const $ = id => document.getElementById(id);
  D.totalBalance=$('total-balance'); D.totalIncome=$('total-income'); D.totalExpenses=$('total-expenses');
  D.lblBalance=$('lbl-balance'); D.lblIncome=$('lbl-income'); D.lblExpense=$('lbl-expense');
  D.cmpBalance=$('cmp-balance'); D.cmpIncome=$('cmp-income'); D.cmpExpense=$('cmp-expense');
  D.budgetInput=$('budget-input'); D.budgetFill=$('budget-fill'); D.budgetGlow=$('budget-glow');
  D.budgetSpent=$('budget-spent'); D.budgetPercent=$('budget-percent'); D.budgetProgress=$('budget-progressbar');
  D.form=$('transaction-form'); D.txTitle=$('tx-title'); D.txAmount=$('tx-amount');
  D.txDate=$('tx-date'); D.txCategory=$('tx-category');
  D.btnSubmit=$('btn-submit'); D.btnSubmitText=$('btn-submit-text'); D.toggleSlider=$('toggle-slider');
  D.donutSvg=$('donut-svg'); D.donutTotal=$('donut-total'); D.donutTitle=$('donut-title');
  D.legend=$('category-legend');
  D.historyList=$('history-list'); D.txCount=$('tx-count'); D.searchInput=$('search-input');
  D.historyTitle=$('history-title');
  D.toastContainer=$('toast-container');
  D.confirmModal=$('confirm-modal'); D.confirmMessage=$('confirm-message');
  D.confirmOk=$('confirm-ok'); D.confirmCancel=$('confirm-cancel');
  D.alertBanner=$('budget-alert-banner'); D.alertPrimary=$('alert-primary-text');
  D.alertSecondary=$('alert-secondary-text'); D.alertClose=$('alert-close');
  D.alertProgress=$('alert-progress');
  D.monthLabel=$('month-label'); D.monthSub=$('month-sub');
  D.viewSlider=$('view-slider');
  D.overviewChart=$('overview-chart'); D.overviewEmpty=$('overview-empty');
}

// ==========================================================================
// 8. RENDER
// ==========================================================================

function pulse(el) { el.classList.remove('amount-updated'); void el.offsetWidth; el.classList.add('amount-updated'); }

function renderMonthNav() {
  const mName = MONTHS_FULL[state.viewMonth];
  D.monthLabel.textContent = `${mName} ${state.viewYear}`;

  if (state.viewMode === 'all') {
    D.monthSub.textContent = 'Viewing all transactions';
  } else {
    const now = new Date();
    if (state.viewMonth === now.getMonth() && state.viewYear === now.getFullYear()) {
      D.monthSub.textContent = 'Current month';
    } else {
      D.monthSub.textContent = 'Viewing selected month';
    }
  }

  // Update view toggle buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    const active = btn.dataset.view === state.viewMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  });

  if (state.viewMode === 'all') D.viewSlider.classList.add('slide-right');
  else D.viewSlider.classList.remove('slide-right');
}

function renderDashboard() {
  const txList = getViewTransactions();
  const { income, expense, balance } = calcTotals(txList);

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
    const mShort = MONTHS_SHORT[state.viewMonth];
    D.lblBalance.textContent = `${mShort} Balance`;
    D.lblIncome.textContent = `${mShort} Income`;
    D.lblExpense.textContent = `${mShort} Expenses`;
  }

  // Month-over-month comparison (only in month mode)
  if (state.viewMode === 'month') {
    const prev = getPrevMonthTotals();
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

  const diff = current - previous;
  const pct = Math.round((Math.abs(diff) / previous) * 100);

  if (diff === 0) {
    el.textContent = '— Same as last month';
    el.className = 'summary-comparison cmp-neutral';
    return;
  }

  const arrow = diff > 0 ? '↑' : '↓';

  // For expenses, "up" is bad; for income/balance, "up" is good
  let cls;
  if (type === 'expense') {
    cls = diff > 0 ? 'cmp-down' : 'cmp-up'; // more expense = bad
  } else {
    cls = diff > 0 ? 'cmp-up' : 'cmp-down';
  }

  el.textContent = `${arrow} ${pct}% vs last month`;
  el.className = `summary-comparison ${cls}`;
}

function renderBudgetProgress() {
  const spent = getCurrentMonthExpenses();
  const budget = state.budget;
  D.budgetSpent.textContent = `${formatINR(spent)} spent this month`;
  if (budget <= 0) {
    D.budgetFill.style.width='0%'; D.budgetGlow.style.width='0%';
    D.budgetFill.className='progress-fill'; D.budgetGlow.className='progress-glow';
    D.budgetPercent.textContent='No budget set';
    D.budgetProgress.setAttribute('aria-valuenow','0');
    return;
  }
  const pct = Math.min((spent/budget)*100, 100);
  D.budgetFill.style.width=`${pct}%`; D.budgetGlow.style.width=`${pct}%`;
  D.budgetFill.className='progress-fill'; D.budgetGlow.className='progress-glow';
  if (pct<=50){D.budgetFill.classList.add('safe');D.budgetGlow.classList.add('safe')}
  else if(pct<=80){D.budgetFill.classList.add('warning');D.budgetGlow.classList.add('warning')}
  else{D.budgetFill.classList.add('danger');D.budgetGlow.classList.add('danger')}
  D.budgetSpent.textContent=`${formatINR(spent)} of ${formatINR(budget)}`;
  D.budgetPercent.textContent=spent>budget?`${Math.round((spent/budget)*100)}% — Over budget!`:`${Math.round(pct)}%`;
  D.budgetProgress.setAttribute('aria-valuenow',Math.round(pct));
}

function renderDonutChart() {
  const txList = getViewTransactions();
  const entries = calcExpensesByCategory(txList);
  const total = entries.reduce((s,[,v])=>s+v, 0);
  const R=80, C=2*Math.PI*R;

  D.donutTotal.textContent = formatINR(total);

  // Update title
  if (state.viewMode === 'month') {
    D.donutTitle.textContent = `🍩 ${MONTHS_SHORT[state.viewMonth]} Expenses`;
  } else {
    D.donutTitle.textContent = '🍩 All-Time Expenses';
  }

  D.donutSvg.querySelectorAll('.donut-segment').forEach(el=>el.remove());

  if (!entries.length) {
    D.legend.innerHTML = '<p class="legend-empty">No expense data yet.</p>';
    return;
  }

  let offset = 0;
  for (const [cat, amount] of entries) {
    const { color } = getCat('expense', cat);
    const slice = (amount/total)*C;
    const circ = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circ.setAttribute('class','donut-segment');
    circ.setAttribute('cx','100'); circ.setAttribute('cy','100'); circ.setAttribute('r',String(R));
    circ.setAttribute('stroke',color);
    circ.setAttribute('stroke-dasharray',`${slice} ${C-slice}`);
    circ.setAttribute('stroke-dashoffset',String(-offset));
    D.donutSvg.appendChild(circ);
    offset += slice;
  }

  D.legend.innerHTML = entries.map(([cat,amount]) => {
    const {emoji,color} = getCat('expense',cat);
    const pct = ((amount/total)*100).toFixed(1);
    return `<div class="legend-item">
      <span class="legend-color" style="background:${color}"></span>
      <span class="legend-emoji">${emoji}</span>
      <span class="legend-name">${esc(cat)}</span>
      <span class="legend-value">${formatINR(amount)}</span>
      <span class="legend-pct">${pct}%</span>
    </div>`;
  }).join('');
}

function renderHistory(query='') {
  const txList = getViewTransactions();
  let list = [...txList].sort((a,b)=>new Date(b.date)-new Date(a.date)||b.createdAt-a.createdAt);

  if (query) {
    const q = query.toLowerCase();
    list = list.filter(t=>t.title.toLowerCase().includes(q)||t.category.toLowerCase().includes(q));
  }

  D.txCount.textContent = list.length;

  // Update title
  if (state.viewMode === 'month') {
    D.historyTitle.textContent = `📜 ${MONTHS_SHORT[state.viewMonth]} ${state.viewYear} History`;
  } else {
    D.historyTitle.textContent = '📜 All History';
  }

  if (!list.length) {
    const isSearch = !!query;
    const mName = MONTHS_FULL[state.viewMonth];
    D.historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">${isSearch?'🔍':'📋'}</div>
        <p class="empty-title">${isSearch?'No matching transactions':state.viewMode==='month'?`No transactions in ${mName}`:'No transactions yet'}</p>
        <p class="empty-subtitle">${isSearch?'Try a different search term.':'Add your first transaction to begin tracking.'}</p>
      </div>`;
    return;
  }

  D.historyList.innerHTML = list.map((t,i) => {
    const {emoji,color}=getCat(t.type,t.category);
    const sign=t.type==='income'?'+':'−';
    const cls=t.type==='income'?'tx-inc':'tx-exp';
    return `<div class="tx-item" data-id="${t.id}" style="animation-delay:${i*25}ms">
      <div class="tx-icon" style="background:${color}18;color:${color}">${emoji}</div>
      <div class="tx-details">
        <span class="tx-title">${esc(t.title)}</span>
        <span class="tx-meta">${esc(t.category)} · ${formatDate(t.date)}</span>
      </div>
      <div class="tx-right">
        <span class="tx-amount ${cls}">${sign}${formatINR(t.amount)}</span>
        <button class="btn-delete" data-delete-id="${t.id}" title="Delete" aria-label="Delete ${esc(t.title)}">✕</button>
      </div>
    </div>`;
  }).join('');
}

/** Render the 6-month overview bar chart */
function renderOverviewChart() {
  const months = getLast6Months();
  const hasData = months.some(m => m.income > 0 || m.expense > 0);

  if (!hasData) {
    D.overviewChart.style.display = 'none';
    D.overviewEmpty.classList.remove('hidden');
    return;
  }

  D.overviewChart.style.display = '';
  D.overviewEmpty.classList.add('hidden');

  // Find max value for scaling
  const maxVal = Math.max(...months.map(m => Math.max(m.income, m.expense)), 1);

  const now = new Date();

  D.overviewChart.innerHTML = months.map(m => {
    const incH = Math.max((m.income / maxVal) * 100, m.income > 0 ? 4 : 0);
    const expH = Math.max((m.expense / maxVal) * 100, m.expense > 0 ? 4 : 0);
    const isActive = state.viewMode === 'month' && m.month === state.viewMonth && m.year === state.viewYear;
    const isCurrent = m.month === now.getMonth() && m.year === now.getFullYear();
    const net = m.income - m.expense;
    const netCls = net > 0 ? 'positive' : net < 0 ? 'negative' : 'zero';
    const netText = net === 0 && m.income === 0 ? '' : (net >= 0 ? '+' : '') + compactINR(Math.abs(net));

    return `<div class="month-col ${isActive ? 'active-col' : ''}" data-nav-month="${m.month}" data-nav-year="${m.year}">
      <div class="mc-bars">
        <div class="mc-bar mc-bar-income" style="height:${incH}%">
          <span class="mc-tip">${formatINR(m.income)}</span>
        </div>
        <div class="mc-bar mc-bar-expense" style="height:${expH}%">
          <span class="mc-tip">${formatINR(m.expense)}</span>
        </div>
      </div>
      <span class="mc-label">${MONTHS_SHORT[m.month]}${isCurrent?' ●':''}</span>
      ${netText ? `<span class="mc-net ${netCls}">${netText}</span>` : '<span class="mc-net zero">—</span>'}
    </div>`;
  }).join('');
}

function populateCategories(type) {
  D.txCategory.innerHTML = '<option value="" disabled selected>Select category</option>' +
    CATEGORIES[type].map(c=>`<option value="${c.name}">${c.emoji} ${c.name}</option>`).join('');
}

function renderAll() {
  renderMonthNav();
  renderDashboard();
  renderBudgetProgress();
  renderDonutChart();
  renderHistory(D.searchInput.value);
  renderOverviewChart();
}

// ==========================================================================
// 9. BUDGET ALERT (Bengali)
// ==========================================================================

function checkBudgetAlert() {
  const budget = state.budget;
  if (budget <= 0) { lastBudgetAlertLevel = null; return; }
  const spent = getCurrentMonthExpenses();
  const pct = (spent / budget) * 100;

  if (pct >= 100 && lastBudgetAlertLevel !== 'exceeded') {
    lastBudgetAlertLevel = 'exceeded';
    showBudgetBanner(
      '🚨 বাজেট অতিক্রম! তোমার এই মাসের খরচ বাজেটের সীমা ছাড়িয়ে গেছে!',
      `Budget Exceeded! You've spent ${formatINR(spent)} against a budget of ${formatINR(budget)}.`,
      true
    );
  } else if (pct >= 90 && pct < 100 && lastBudgetAlertLevel !== 'warning90' && lastBudgetAlertLevel !== 'exceeded') {
    lastBudgetAlertLevel = 'warning90';
    showBudgetBanner(
      '⚠️ সাবধান! তুমি তোমার বাজেট অতিক্রম করার পথে!',
      `Warning: You've used ${Math.round(pct)}% of your monthly budget (${formatINR(spent)} of ${formatINR(budget)}).`,
      false
    );
  } else if (pct < 90) {
    lastBudgetAlertLevel = null;
  }
}

function showBudgetBanner(primary, secondary, isDanger) {
  D.alertPrimary.textContent = primary;
  D.alertSecondary.textContent = secondary;
  D.alertBanner.classList.toggle('alert-danger', isDanger);
  D.alertBanner.classList.remove('hidden');
  D.alertProgress.style.animation = 'none';
  void D.alertProgress.offsetWidth;
  D.alertProgress.style.animation = '';
  clearTimeout(showBudgetBanner._t);
  showBudgetBanner._t = setTimeout(() => D.alertBanner.classList.add('hidden'), 8000);
}

// ==========================================================================
// 10. EVENT HANDLERS
// ==========================================================================

// --- Month Navigation ---
function goToPrevMonth() {
  state.viewMonth--;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
  state.viewMode = 'month';
  renderAll();
}
function goToNextMonth() {
  state.viewMonth++;
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
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
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    const a = btn.dataset.type===type;
    btn.classList.toggle('active',a);
    btn.setAttribute('aria-checked',String(a));
  });
  if (type==='income') D.toggleSlider.classList.add('slide-right');
  else D.toggleSlider.classList.remove('slide-right');
  D.btnSubmit.classList.remove('expense-mode','income-mode');
  D.btnSubmit.classList.add(type==='income'?'income-mode':'expense-mode');
  D.btnSubmitText.textContent = type==='income'?'Add Income':'Add Expense';
  populateCategories(type);
}

// --- Form Submit ---
function handleFormSubmit(e) {
  e.preventDefault();
  const title=D.txTitle.value.trim(), amount=parseFloat(D.txAmount.value),
        date=D.txDate.value, category=D.txCategory.value;
  if (!title)             { showToast('Please enter a title.','error'); D.txTitle.focus(); return; }
  if (!amount||amount<1)  { showToast('Please enter a valid amount.','error'); D.txAmount.focus(); return; }
  if (!date)              { showToast('Please select a date.','error'); D.txDate.focus(); return; }
  if (!category)          { showToast('Please select a category.','error'); D.txCategory.focus(); return; }

  const tx = { id:uid(), title, amount, date, category, type:state.currentType, createdAt:Date.now() };
  state.transactions.push(tx);
  saveState();

  // Auto-navigate to the month of the new transaction
  const td = new Date(date);
  state.viewMonth = td.getMonth();
  state.viewYear = td.getFullYear();
  state.viewMode = 'month';

  renderAll();

  if (state.currentType==='expense') checkBudgetAlert();

  D.form.reset();
  D.txDate.value = todayISO();
  populateCategories(state.currentType);

  showToast(`${state.currentType==='income'?'Income':'Expense'} of ${formatINR(amount)} added!`,
    state.currentType==='income'?'success':'info');
}

// --- Delete ---
function handleDeleteTx(id) {
  const tx = state.transactions.find(t=>t.id===id);
  if (!tx) return;
  showConfirmModal(`Delete "${tx.title}" (${formatINR(tx.amount)})?`, () => {
    state.transactions = state.transactions.filter(t=>t.id!==id);
    saveState(); renderAll(); checkBudgetAlert();
    showToast('Transaction deleted.','info');
  });
}

// --- Budget ---
function handleSetBudget() {
  const val = parseFloat(D.budgetInput.value);
  if (!val||val<1) { showToast('Enter a valid budget amount.','error'); D.budgetInput.focus(); return; }
  state.budget = val; saveState();
  lastBudgetAlertLevel = null;
  renderBudgetProgress(); checkBudgetAlert();
  D.budgetInput.value = '';
  D.budgetInput.placeholder = formatINR(val);
  showToast(`Monthly budget set to ${formatINR(val)}.`,'success');
}

// --- Export ---
function handleExportCSV() {
  const txList = getViewTransactions();
  if (!txList.length) { showToast('No transactions to export.','error'); return; }
  const header = ['Title','Type','Category','Amount (INR)','Date'];
  const rows = [...txList].sort((a,b)=>new Date(b.date)-new Date(a.date))
    .map(t=>[`"${t.title.replace(/"/g,'""')}"`,t.type.charAt(0).toUpperCase()+t.type.slice(1),`"${t.category}"`,t.amount,t.date]);
  const csv = [header.join(','),...rows.map(r=>r.join(','))].join('\r\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url;
  const suffix = state.viewMode==='month' ? `${MONTHS_SHORT[state.viewMonth]}_${state.viewYear}` : 'All';
  a.download = `BudgetBuddy_${suffix}_${todayISO()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`Exported ${txList.length} transactions.`,'success');
}

// --- Clear All ---
function handleClearAll() {
  if (!state.transactions.length && !state.budget) { showToast('Nothing to clear.','info'); return; }
  showConfirmModal('This will permanently delete ALL transactions and reset your budget.', () => {
    state.transactions=[]; state.budget=0; lastBudgetAlertLevel=null;
    localStorage.removeItem(STORAGE_KEY);
    D.budgetInput.placeholder='Set budget';
    D.alertBanner.classList.add('hidden');
    renderAll(); showToast('All data cleared.','info');
  });
}

// ==========================================================================
// 11. TOAST
// ==========================================================================

function showToast(msg, type='info') {
  const icons={success:'✅',error:'❌',info:'ℹ️',warning:'⚠️'};
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${esc(msg)}</span>`;
  D.toastContainer.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('toast-show'));
  setTimeout(()=>{
    t.classList.remove('toast-show');t.classList.add('toast-hide');
    t.addEventListener('transitionend',()=>t.remove(),{once:true});
    setTimeout(()=>{if(t.parentNode)t.remove()},500);
  },3500);
}

// ==========================================================================
// 12. CONFIRM MODAL
// ==========================================================================

function showConfirmModal(msg, onConfirm) {
  D.confirmMessage.textContent = msg;
  D.confirmModal.classList.remove('hidden');
  D.confirmCancel.focus();
  const cleanup=()=>{D.confirmOk.removeEventListener('click',ok);D.confirmCancel.removeEventListener('click',cancel);D.confirmModal.removeEventListener('click',ov);document.removeEventListener('keydown',es)};
  const close=()=>{D.confirmModal.classList.add('hidden');cleanup()};
  const ok=()=>{onConfirm();close()};
  const cancel=()=>close();
  const ov=e=>{if(e.target===D.confirmModal)close()};
  const es=e=>{if(e.key==='Escape')close()};
  D.confirmOk.addEventListener('click',ok);
  D.confirmCancel.addEventListener('click',cancel);
  D.confirmModal.addEventListener('click',ov);
  document.addEventListener('keydown',es);
}

// ==========================================================================
// 13. EVENT BINDING
// ==========================================================================

function bindEvents() {
  D.form.addEventListener('submit', handleFormSubmit);

  document.querySelectorAll('.toggle-btn').forEach(btn =>
    btn.addEventListener('click', () => handleTypeToggle(btn.dataset.type)));

  document.getElementById('btn-set-budget').addEventListener('click', handleSetBudget);
  D.budgetInput.addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();handleSetBudget()} });

  document.getElementById('btn-export').addEventListener('click', handleExportCSV);
  document.getElementById('btn-clear').addEventListener('click', handleClearAll);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Month navigation
  document.getElementById('month-prev').addEventListener('click', goToPrevMonth);
  document.getElementById('month-next').addEventListener('click', goToNextMonth);

  // View mode toggle
  document.querySelectorAll('.view-btn').forEach(btn =>
    btn.addEventListener('click', () => setViewMode(btn.dataset.view)));

  // Click on overview chart month column to navigate
  D.overviewChart.addEventListener('click', e => {
    const col = e.target.closest('.month-col');
    if (col) {
      const m = parseInt(col.dataset.navMonth);
      const y = parseInt(col.dataset.navYear);
      if (!isNaN(m) && !isNaN(y)) navigateToMonth(m, y);
    }
  });

  // Search (debounced)
  let timer;
  D.searchInput.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => renderHistory(e.target.value), 150);
  });

  // Delete delegation
  D.historyList.addEventListener('click', e => {
    const btn = e.target.closest('.btn-delete');
    if (btn && btn.dataset.deleteId) handleDeleteTx(btn.dataset.deleteId);
  });

  // Alert close
  D.alertClose.addEventListener('click', () => {
    D.alertBanner.classList.add('hidden');
    clearTimeout(showBudgetBanner._t);
  });

  // Keyboard navigation for month arrows
  document.addEventListener('keydown', e => {
    // Only when no modal/input is focused
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (!D.confirmModal.classList.contains('hidden')) return;

    if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); goToPrevMonth(); }
    if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); goToNextMonth(); }
  });
}

// ==========================================================================
// 14. INIT
// ==========================================================================

function init() {
  setTheme(getTheme());
  cacheDom();
  loadState();

  D.txDate.value = todayISO();
  D.txDate.max = todayISO();

  if (state.budget > 0) D.budgetInput.placeholder = formatINR(state.budget);

  // Set view to current month
  state.viewMonth = new Date().getMonth();
  state.viewYear = new Date().getFullYear();
  state.viewMode = 'month';

  handleTypeToggle('expense');
  bindEvents();
  renderAll();
  checkBudgetAlert();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();