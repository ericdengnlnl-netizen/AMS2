const state = {
  dashboard: null,
  navChart: null,
  performanceAnalysis: null
};

const numFmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function money(v) {
  return `¥${numFmt.format(Number(v || 0))}`;
}

function pct(v) {
  return `${(Number(v || 0) * 100).toFixed(2)}%`;
}

function navFmt(v) {
  return Number(v || 0).toFixed(4);
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(dateIso, { months = 0, years = 0 } = {}) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + years);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#b0352f' : '#1f2022';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2600);
}

async function requestJson(url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (error) {
    throw new Error(`请求失败(${url}): ${error.message || String(error)}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (error) {
    throw new Error(`接口返回非JSON(${url})`);
  }

  if (!resp.ok || !data.ok) {
    throw new Error(`${data.error || `请求失败: ${resp.status}`} (${url})`);
  }

  return data.result;
}

async function requestFormData(url, formData) {
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      body: formData
    });
  } catch (error) {
    throw new Error(`请求失败(${url}): ${error.message || String(error)}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (error) {
    throw new Error(`接口返回非JSON(${url})`);
  }

  if (!resp.ok || !data.ok) {
    throw new Error(`${data.error || `请求失败: ${resp.status}`} (${url})`);
  }

  return data.result;
}

function renderMetrics(containerId, metrics) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  metrics.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'metric';

    const valClass = item.valueClass ? `value ${item.valueClass}` : 'value';

    div.innerHTML = `
      <div class="label">${item.label}</div>
      <div class="${valClass}">${item.value}</div>
    `;
    container.appendChild(div);
  });
}

function renderHeader() {
  const data = state.dashboard;
  const hasData = Boolean(data?.has_data);

  const statusLine = document.getElementById('statusLine');
  const valuationDate = data?.latest_valuation_date || '--';

  if (!hasData) {
    const prefix = data?.read_only_mode ? '[只读模式] ' : '';
    statusLine.textContent = `${prefix}${data?.message || '等待导入初始估值表'}`;
    document.getElementById('latestValuationDate').textContent = '最近估值日期: --';
    return;
  }

  const prefix = data?.read_only_mode ? '[只读模式] ' : '';
  statusLine.textContent = `${prefix}估值区间: ${data.meta.inception_date} ~ ${valuationDate}`;
  document.getElementById('latestValuationDate').textContent = `最近估值日期: ${valuationDate}`;
}

function applyReadOnlyMode(readOnlyMode) {
  const hideIds = [
    'syncBtn',
    'rebuildBtn',
    'initialImportForm',
    'transactionsImportForm',
    'cashAdjustmentForm',
    'rebalanceForm'
  ];

  hideIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = readOnlyMode ? 'none' : '';
  });
}

function renderSummaryAndStats() {
  const hasData = Boolean(state.dashboard?.has_data);

  if (!hasData) {
    renderMetrics('summaryGrid', [
      { label: '初始净值', value: '--' },
      { label: '当前总市值', value: '--' },
      { label: '累计收益率', value: '--' }
    ]);
    document.getElementById('statsTableBody').innerHTML = '';
    return;
  }

  const stats = state.dashboard.stats || {};
  const pnlClass = Number(stats.pnl || 0) >= 0 ? 'good' : 'bad';

  renderMetrics('summaryGrid', [
    { label: '初始市值', value: money(stats.inception_value) },
    { label: '当前总市值', value: money(stats.latest_total_value) },
    { label: '累计收益', value: money(stats.pnl), valueClass: pnlClass },
    { label: '累计收益率', value: pct(stats.pnl_pct), valueClass: pnlClass },
    { label: '最新单位净值', value: navFmt(stats.latest_nav), valueClass: pnlClass },
    { label: '夏普比率', value: Number(stats.sharpe_ratio || 0).toFixed(3) }
  ]);

  const statRows = [
    ['累计收益率', pct(stats.cumulative_return)],
    ['年化收益率', pct(stats.annualized_return)],
    ['年化波动率', pct(stats.volatility)],
    ['夏普比率', Number(stats.sharpe_ratio || 0).toFixed(3)],
    ['最大回撤', pct(stats.max_drawdown)]
  ];

  const tbody = document.getElementById('statsTableBody');
  tbody.innerHTML = '';
  statRows.forEach(([k, v]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    tbody.appendChild(tr);
  });
}

function renderNavChart() {
  const hasData = Boolean(state.dashboard?.has_data);
  const ctx = document.getElementById('navChart');

  if (state.navChart) {
    state.navChart.destroy();
    state.navChart = null;
  }

  if (!hasData) {
    return;
  }

  const navChart = state.dashboard.nav_chart || { dates: [], values: [], markers: [] };
  const labels = navChart.dates || [];
  const navValues = navChart.values || [];
  const markerPoints = labels.map(() => null);
  const markerLabels = {};

  (navChart.markers || []).forEach((m) => {
    if (m.index === undefined || m.index === null) return;
    markerPoints[m.index] = Number(navValues[m.index] || 0);
    markerLabels[m.index] = m.label || '调仓';
  });

  const datasets = [
    {
      label: '单位净值',
      data: navValues,
      borderColor: '#0f6076',
      backgroundColor: 'rgba(15,96,118,0.14)',
      fill: true,
      tension: 0.24,
      pointRadius: 0
    }
  ];

  if (markerPoints.some((v) => v !== null)) {
    datasets.push({
      label: '调仓时点',
      data: markerPoints,
      showLine: false,
      pointRadius: 4,
      pointHoverRadius: 5,
      pointBackgroundColor: '#d26037',
      borderColor: '#d26037'
    });
  }

  state.navChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.dataset.label || '';
              if (label === '调仓时点') {
                return markerLabels[context.dataIndex] || '调仓';
              }
              return `${label}: ${navFmt(context.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => Number(value).toFixed(3)
          }
        },
        x: {
          ticks: { maxTicksLimit: 8 }
        }
      }
    }
  });
}

function renderAllocationTable() {
  const tbody = document.getElementById('allocationTableBody');
  tbody.innerHTML = '';

  if (!state.dashboard?.has_data) {
    return;
  }

  const rows = state.dashboard.latest_allocation || [];
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.ts_code || '-'}</td>
      <td>${row.instrument_name || '-'}</td>
      <td>${row.major_asset || '-'}</td>
      <td>${Number(row.quantity || 0).toLocaleString('zh-CN')}</td>
      <td>${Number(row.close_price || 0).toFixed(4)}</td>
      <td>${money(row.market_value)}</td>
      <td>${pct(row.weight)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTransactionTable() {
  const tbody = document.getElementById('transactionTableBody');
  tbody.innerHTML = '';

  if (!state.dashboard?.has_data) {
    return;
  }

  const rows = state.dashboard.transactions || [];
  rows.forEach((row) => {
    const isCashAdjustment = row.note_kind === 'cash_adjustment';
    const cashDirection = String(row.cash_direction || '').toUpperCase();
    const sideClass = isCashAdjustment
      ? (cashDirection === 'INCREASE' ? 'good' : 'bad')
      : (row.action === 'BUY' ? 'good' : 'bad');
    const actionLabel = isCashAdjustment
      ? (cashDirection === 'INCREASE' ? '现金增加' : '现金减少')
      : (row.action || '-');
    const quantityDisplay = isCashAdjustment
      ? money(row.quantity || row.cash_amount || 0)
      : Number(row.quantity || 0).toLocaleString('zh-CN');
    const tradePriceDisplay = isCashAdjustment
      ? '-'
      : Number(row.trade_price || 0).toFixed(4);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.effective_date || '-'}</td>
      <td>${row.ts_code || '-'}</td>
      <td>${row.instrument_name || '-'}</td>
      <td class="${sideClass}">${actionLabel}</td>
      <td>${quantityDisplay}</td>
      <td>${tradePriceDisplay}</td>
      <td>${row.source || '-'}</td>
      <td>${row.note || '-'}</td>
      <td>${row.created_at ? String(row.created_at).slice(0, 19).replace('T', ' ') : '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDiagnostics() {
  const tbody = document.getElementById('diagnosticTableBody');
  tbody.innerHTML = '';

  if (!state.dashboard?.has_data) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>暂无诊断信息</td>';
    tbody.appendChild(tr);
    return;
  }

  const diagnostics = state.dashboard.diagnostics || {};
  const missing = diagnostics.missing_prices || [];
  const negativeCash = diagnostics.negative_cash_dates || [];
  const unknown = diagnostics.unknown_transaction_assets || [];
  const noHistory = diagnostics.assets_without_price_history || [];
  const cashRecon = diagnostics.cash_reconciliation || null;

  const rows = [
    ['缺失价格填充次数', `${missing.length}（展示前5条）`],
    ['负现金风险日期', `${negativeCash.length}（展示前5条）`],
    ['交易中出现新资产', unknown.length ? unknown.join(', ') : '无'],
    ['完全无历史价格资产', noHistory.length ? noHistory.map((x) => `${x.instrument_name}(${x.ts_code})`).join('，') : '无']
  ];

  if (missing.length) {
    const sample = missing.slice(0, 5)
      .map((x) => `${x.trade_date} ${x.ts_code}@${Number(x.filled_price || 0).toFixed(4)}`)
      .join('；');
    rows.push(['缺失价格示例', sample]);
  }

  if (negativeCash.length) {
    const sample = negativeCash.slice(0, 5)
      .map((x) => `${x.date} ${money(x.cash_value)}`)
      .join('；');
    rows.push(['负现金示例', sample]);
  }

  if (cashRecon) {
    const cashDiff = Number(cashRecon.modeled_cash || 0) - Number(cashRecon.equation_cash || 0);
    rows.push([
      '现金核对',
      `初始${money(cashRecon.initial_cash)} + 卖出${money(cashRecon.sell_inflow)} - 买入${money(cashRecon.buy_outflow)} + 调剂增加${money(cashRecon.adjustment_inflow)} - 调剂减少${money(cashRecon.adjustment_outflow)} = 模型现金${money(cashRecon.modeled_cash)}（方程差额 ${money(cashDiff)}）`
    ]);
  }

  rows.forEach(([k, v]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    tbody.appendChild(tr);
  });
}

function renderContributionTable(tbodyId, rows) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';

  if (!rows || !rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="3">暂无数据</td>';
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const pnlClass = Number(row.contribution_amount || 0) >= 0 ? 'good' : 'bad';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.instrument_name || '-'} (${row.ts_code || '-'})</td>
      <td class="${pnlClass}">${money(row.contribution_amount)}</td>
      <td class="${pnlClass}">${pct(row.contribution_rate)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderPerformanceAnalysis() {
  const analysis = state.performanceAnalysis;
  document.getElementById('analysisRangeHint').textContent = analysis
    ? `区间: ${analysis.interval_start_date} ~ ${analysis.interval_end_date}`
    : '区间: --';

  if (!analysis) {
    renderMetrics('performanceSummaryGrid', [
      { label: '区间收益金额', value: '--' },
      { label: '区间收益率', value: '--' },
      { label: '年化收益率', value: '--' },
      { label: '区间最大回撤', value: '--' },
      { label: '夏普比率', value: '--' },
      { label: '卡玛比率', value: '--' }
    ]);
    renderContributionTable('topPositiveBody', []);
    renderContributionTable('topNegativeBody', []);
    document.getElementById('holdingsReturnBody').innerHTML = '';
    document.getElementById('benchmarkReturnBody').innerHTML = '';
    return;
  }

  const stats = analysis.interval_stats || {};
  const pnlClass = Number(stats.pnl_amount || 0) >= 0 ? 'good' : 'bad';
  renderMetrics('performanceSummaryGrid', [
    { label: '区间收益金额', value: money(stats.pnl_amount), valueClass: pnlClass },
    { label: '区间收益率', value: pct(stats.pnl_pct), valueClass: pnlClass },
    { label: '年化收益率', value: pct(stats.annualized_return), valueClass: pnlClass },
    { label: '区间最大回撤', value: pct(stats.max_drawdown) },
    { label: '夏普比率', value: Number(stats.sharpe_ratio || 0).toFixed(3) },
    { label: '卡玛比率', value: Number(stats.calmar_ratio || 0).toFixed(3) }
  ]);

  renderContributionTable('topPositiveBody', analysis.contribution?.top_positive || []);
  renderContributionTable('topNegativeBody', analysis.contribution?.top_negative || []);

  const holdingsBody = document.getElementById('holdingsReturnBody');
  holdingsBody.innerHTML = '';
  (analysis.holdings_returns || []).forEach((row) => {
    const pnlClassRow = Number(row.contribution_amount || 0) >= 0 ? 'good' : 'bad';
    const retClass = Number(row.period_return || 0) >= 0 ? 'good' : 'bad';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.ts_code || '-'}</td>
      <td>${row.instrument_name || '-'}${row.is_cleared ? '（清仓）' : ''}</td>
      <td>${Number(row.start_quantity || 0).toLocaleString('zh-CN')}</td>
      <td>${Number(row.end_quantity || 0).toLocaleString('zh-CN')}</td>
      <td>${Number(row.start_price || 0).toFixed(4)}</td>
      <td>${Number(row.end_price || 0).toFixed(4)}</td>
      <td class="${retClass}">${row.period_return === null ? '-' : pct(row.period_return)}</td>
      <td class="${pnlClassRow}">${money(row.contribution_amount)}</td>
      <td class="${pnlClassRow}">${pct(row.contribution_rate)}</td>
    `;
    holdingsBody.appendChild(tr);
  });

  const benchmarkBody = document.getElementById('benchmarkReturnBody');
  benchmarkBody.innerHTML = '';
  (analysis.benchmark_returns || []).forEach((row) => {
    const ret = row.return_pct;
    const cls = ret === null || ret === undefined ? '' : (Number(ret) >= 0 ? 'good' : 'bad');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.name || '-'}</td>
      <td>${row.ts_code || '-'}</td>
      <td>${row.start_date || '-'}</td>
      <td>${row.end_date || '-'}</td>
      <td>${row.start_close === null || row.start_close === undefined ? '-' : Number(row.start_close).toFixed(2)}</td>
      <td>${row.end_close === null || row.end_close === undefined ? '-' : Number(row.end_close).toFixed(2)}</td>
      <td class="${cls}">${ret === null || ret === undefined ? '-' : pct(ret)}</td>
    `;
    benchmarkBody.appendChild(tr);
  });
}

function renderImportResults(initialResult, txResult) {
  const initialNode = document.getElementById('initialImportResult');
  const txNode = document.getElementById('transactionsImportResult');

  if (initialResult) {
    initialNode.textContent = `初始导入完成：估值日 ${initialResult.valuationDate}，初始市值 ${money(initialResult.inceptionValue)}，持仓 ${initialResult.positionsImported} 条`;
  }

  if (txResult) {
    txNode.textContent = `交易导入完成：总行数 ${txResult.total_rows}，新增 ${txResult.imported}，重复跳过 ${txResult.skipped_duplicate}`;
  }
}

function renderCashAdjustmentResult(result) {
  const node = document.getElementById('cashAdjustmentResult');
  if (!node || !result) return;
  const direction = String(result.cash_direction || '').toUpperCase();
  const directionLabel = direction === 'INCREASE' ? '增加' : '减少';
  node.textContent = `现金调剂已录入：${result.effective_date} ${directionLabel} ${money(result.quantity || result.cash_amount || 0)}`;
}

function resolvePerformanceStartDate(endDate, rangePreset, inceptionDate, customStartDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return null;

  switch (rangePreset) {
    case 'SINCE_INCEPTION':
      return inceptionDate || null;
    case 'YTD':
      return `${end.getFullYear()}-01-01`;
    case '1M':
      return shiftDate(endDate, { months: -1 });
    case '3M':
      return shiftDate(endDate, { months: -3 });
    case '6M':
      return shiftDate(endDate, { months: -6 });
    case '1Y':
      return shiftDate(endDate, { years: -1 });
    case 'CUSTOM':
      return customStartDate || null;
    default:
      return inceptionDate || null;
  }
}

function getPerformanceQueryFromForm() {
  const form = document.getElementById('performanceForm');
  if (!form) return null;
  const fd = new FormData(form);
  const endDate = String(fd.get('endDate') || '').trim();
  const rangePreset = String(fd.get('rangePreset') || 'SINCE_INCEPTION').trim();
  const customStartDate = String(fd.get('customStartDate') || '').trim();
  const inceptionDate = state.dashboard?.meta?.inception_date || '';

  const startDate = resolvePerformanceStartDate(endDate, rangePreset, inceptionDate, customStartDate);
  if (!startDate || !endDate) {
    throw new Error('请选择有效的分析区间');
  }
  if (startDate > endDate) {
    throw new Error('起始日期不能晚于结束日期');
  }

  return { startDate, endDate };
}

async function runPerformanceAnalysis({ silent = false } = {}) {
  if (!state.dashboard?.has_data) {
    state.performanceAnalysis = null;
    renderPerformanceAnalysis();
    return;
  }

  const { startDate, endDate } = getPerformanceQueryFromForm();
  const query = new URLSearchParams({ startDate, endDate });
  const result = await requestJson(`/api/performance-analysis?${query.toString()}`);
  state.performanceAnalysis = result;
  renderPerformanceAnalysis();
  if (!silent) {
    showToast('业绩分析已更新');
  }
}

async function loadDashboard() {
  const dashboard = await requestJson('/api/dashboard');
  state.dashboard = dashboard;
  applyReadOnlyMode(Boolean(dashboard?.read_only_mode));

  renderHeader();
  renderSummaryAndStats();
  renderNavChart();
  renderAllocationTable();
  renderTransactionTable();
  renderDiagnostics();

  if (dashboard?.has_data) {
    const form = document.getElementById('performanceForm');
    if (form) {
      const endInput = form.querySelector('input[name="endDate"]');
      if (endInput && !endInput.value) {
        endInput.value = dashboard.latest_valuation_date || isoToday();
      }
    }
    try {
      await runPerformanceAnalysis({ silent: true });
    } catch (error) {
      state.performanceAnalysis = null;
      renderPerformanceAnalysis();
      showToast(`业绩分析失败: ${error.message}`, true);
    }
  } else {
    state.performanceAnalysis = null;
    renderPerformanceAnalysis();
  }
}

async function onImportInitial(event) {
  event.preventDefault();

  const fileInput = document.getElementById('initialFile');
  if (!fileInput.files || !fileInput.files.length) {
    throw new Error('请选择初始估值 Excel 文件');
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  const result = await requestFormData('/api/import-initial', formData);
  renderImportResults(result, null);
  showToast('初始估值导入成功');
  await loadDashboard();
}

async function onImportTransactions(event) {
  event.preventDefault();

  const fileInput = document.getElementById('transactionsFile');
  if (!fileInput.files || !fileInput.files.length) {
    throw new Error('请选择交易记录 Excel 文件');
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  const result = await requestFormData('/api/import-transactions', formData);
  renderImportResults(null, result);
  showToast('交易记录导入成功');
  await loadDashboard();
}

async function onSyncPrices() {
  const result = await requestJson('/api/sync-prices', {
    method: 'POST',
    body: JSON.stringify({})
  });

  showToast(`行情同步完成：${result.inserted} 行`);
  await loadDashboard();
}

async function onRebuildValuations() {
  const result = await requestJson('/api/rebuild-valuations', {
    method: 'POST',
    body: JSON.stringify({})
  });

  showToast(`估值重算完成：${result.snapshotCount} 个交易日`);
  await loadDashboard();
}

async function onAddRebalance(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  payload.quantity = Number(payload.quantity);
  payload.tradeCost = Number(payload.tradeCost);

  await requestJson('/api/rebalances', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  event.target.reset();
  const dateInput = document.querySelector('#rebalanceForm input[name="effectiveDate"]');
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  showToast('手工调仓记录已新增');
  await loadDashboard();
}

async function onAddCashAdjustment(event) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const payload = Object.fromEntries(formData.entries());
  payload.amount = Number(payload.amount);

  const result = await requestJson('/api/cash-adjustments', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  renderCashAdjustmentResult(result);
  event.target.reset();
  const dateInput = document.querySelector('#cashAdjustmentForm input[name="effectiveDate"]');
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  showToast('现金调剂已新增');
  await loadDashboard();
}

function bindEvents() {
  document.getElementById('initialImportForm').addEventListener('submit', async (event) => {
    try {
      await onImportInitial(event);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('transactionsImportForm').addEventListener('submit', async (event) => {
    try {
      await onImportTransactions(event);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('syncBtn').addEventListener('click', async () => {
    try {
      await onSyncPrices();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('rebuildBtn').addEventListener('click', async () => {
    try {
      await onRebuildValuations();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    try {
      await loadDashboard();
      showToast('已刷新');
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('rebalanceForm').addEventListener('submit', async (event) => {
    try {
      await onAddRebalance(event);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('cashAdjustmentForm').addEventListener('submit', async (event) => {
    try {
      await onAddCashAdjustment(event);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('performanceForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await runPerformanceAnalysis({ silent: false });
    } catch (error) {
      showToast(error.message, true);
    }
  });

  const performanceForm = document.getElementById('performanceForm');
  const presetSelect = performanceForm?.querySelector('select[name="rangePreset"]');
  const customStartInput = performanceForm?.querySelector('input[name="customStartDate"]');
  if (presetSelect && customStartInput) {
    const syncCustomInputState = () => {
      const isCustom = presetSelect.value === 'CUSTOM';
      customStartInput.required = isCustom;
      customStartInput.disabled = !isCustom;
      if (!isCustom) {
        customStartInput.value = '';
      }
    };
    presetSelect.addEventListener('change', syncCustomInputState);
    syncCustomInputState();
  }
}

(async function bootstrap() {
  bindEvents();

  const today = new Date().toISOString().slice(0, 10);
  const rebalanceDateInput = document.querySelector('#rebalanceForm input[name="effectiveDate"]');
  if (rebalanceDateInput) {
    rebalanceDateInput.value = today;
  }
  const cashAdjDateInput = document.querySelector('#cashAdjustmentForm input[name="effectiveDate"]');
  if (cashAdjDateInput) {
    cashAdjDateInput.value = today;
  }
  const performanceEndInput = document.querySelector('#performanceForm input[name="endDate"]');
  if (performanceEndInput) {
    performanceEndInput.value = today;
  }

  try {
    await loadDashboard();
  } catch (error) {
    showToast(error.message, true);
  }
})();
