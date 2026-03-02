const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const XLSX = require('xlsx');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { registerResearchRoutes, startResearchScheduler } = require('./research');

dotenv.config();

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);
const RISK_FREE_RATE = Number(process.env.RISK_FREE_RATE || 0.02);
const DEFAULT_PORTFOLIO_ID = process.env.DEFAULT_PORTFOLIO_ID || 'default';
const LEGACY_EXCEL_PATH = process.env.EXCEL_PATH || path.join(ROOT_DIR, '2026年2月资产配置.xlsx');
const CASH_CODE = 'CASH.CNY';
const CASH_NAME = '现金';
const READ_ONLY_MODE = String(process.env.READ_ONLY_MODE || '').toLowerCase() === 'true';
const WRITE_API_KEY = String(process.env.WRITE_API_KEY || '');
const ENABLE_VIEWER_AUTH = String(process.env.ENABLE_VIEWER_AUTH || '').toLowerCase() === 'true';
const VIEWER_USERS = String(process.env.VIEWER_USERS || '');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

function parseViewerUsers(raw) {
  const map = new Map();
  if (!raw) return map;
  const parts = String(raw).split(',');
  for (const part of parts) {
    const pair = String(part || '').trim();
    if (!pair) continue;
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const user = pair.slice(0, idx).trim();
    const pass = pair.slice(idx + 1).trim();
    if (!user || !pass) continue;
    map.set(user, pass);
  }
  return map;
}

const viewerUsersMap = parseViewerUsers(VIEWER_USERS);

function requireViewerAuth(req, res, next) {
  if (req.path === '/api/health') return next();
  if (!ENABLE_VIEWER_AUTH) return next();
  if (!viewerUsersMap.size) {
    return res.status(500).json({
      ok: false,
      error: 'ENABLE_VIEWER_AUTH=true 但未配置 VIEWER_USERS'
    });
  }

  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm=\"Portfolio Viewer\"');
    return res.status(401).send('Authentication required');
  }

  let decoded = '';
  try {
    decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  } catch (error) {
    res.setHeader('WWW-Authenticate', 'Basic realm=\"Portfolio Viewer\"');
    return res.status(401).send('Invalid authorization');
  }

  const sepIdx = decoded.indexOf(':');
  if (sepIdx <= 0) {
    res.setHeader('WWW-Authenticate', 'Basic realm=\"Portfolio Viewer\"');
    return res.status(401).send('Invalid authorization');
  }

  const username = decoded.slice(0, sepIdx);
  const password = decoded.slice(sepIdx + 1);
  const expected = viewerUsersMap.get(username);
  if (!expected || expected !== password) {
    res.setHeader('WWW-Authenticate', 'Basic realm=\"Portfolio Viewer\"');
    return res.status(401).send('Invalid credentials');
  }

  return next();
}

function requireWriteAccess(req, res, next) {
  if (!READ_ONLY_MODE) return next();
  const key = String(req.headers['x-write-key'] || '');
  if (WRITE_API_KEY && key && key === WRITE_API_KEY) {
    return next();
  }
  return res.status(403).json({
    ok: false,
    error: '当前为只读模式，写操作已禁用'
  });
}

app.use(requireViewerAuth);
app.use(express.static(path.join(ROOT_DIR, 'public')));

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('缺少 Supabase 环境变量，请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });
}

function toNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '') return defaultValue;
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function toFiniteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toTushareDate(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toIsoDate(yyyymmdd) {
  const s = String(yyyymmdd || '');
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function isoDate(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getYesterdayDateIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

function getTodayDateIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return isoDate(d);
}

function excelSerialToIsoDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const base = new Date(Date.UTC(1899, 11, 30));
  base.setUTCDate(base.getUTCDate() + Math.floor(n));
  return base.toISOString().slice(0, 10);
}

function parseDateLike(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value);

  const maybeNumber = Number(value);
  if (Number.isFinite(maybeNumber) && maybeNumber > 10000) {
    return excelSerialToIsoDate(maybeNumber);
  }

  const s = String(value).trim();
  if (!s) return null;

  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return isoDate(d);

  return null;
}

function monthOf(isoDateValue) {
  return String(isoDateValue || '').slice(0, 7);
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function uniqueSortedDates(rows) {
  return [...new Set((rows || []).map((r) => r.trade_date).filter(Boolean))].sort();
}

function sha1(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex');
}

function normalizeDirection(value) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (upper === 'BUY' || raw === '买入') return 'BUY';
  if (upper === 'SELL' || raw === '卖出') return 'SELL';
  return null;
}

function alignToTradingDate(targetDate, tradingDates) {
  if (!targetDate || !tradingDates.length) return null;
  const lastTradingDate = tradingDates[tradingDates.length - 1];
  if (targetDate > lastTradingDate) return null;
  for (const date of tradingDates) {
    if (date >= targetDate) return date;
  }
  return null;
}

function findHeaderRow(rows, mustHaveLabels) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const labels = new Set(row.map((v) => String(v || '').trim()));
    if (mustHaveLabels.every((label) => labels.has(label))) {
      return i;
    }
  }
  return -1;
}

function parseInitialWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    throw new Error('初始估值表为空');
  }

  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: null,
    raw: true
  });

  let valuationDate = null;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const row = rows[i] || [];
    for (let j = 0; j < row.length - 1; j += 1) {
      const key = String(row[j] || '').trim();
      if (key === '估值表日期') {
        valuationDate = parseDateLike(row[j + 1]);
      }
    }
  }

  if (!valuationDate) {
    throw new Error('无法识别初始估值表日期（需包含“估值表日期”）');
  }

  const headerIndex = findHeaderRow(rows, ['大类资产', '代码', '名称', '成本', '数量']);
  if (headerIndex < 0) {
    throw new Error('初始估值表缺少表头（需包含 大类资产/代码/名称/成本/数量）');
  }

  const dataRows = rows.slice(headerIndex + 1);
  const positionsRaw = [];
  let currentMajor = null;
  let totalAmountRow = null;

  for (const row of dataRows) {
    if (!Array.isArray(row)) continue;

    const major = row[0] !== null && row[0] !== '' ? String(row[0]).trim() : currentMajor;
    const codeRaw = row[3] !== null && row[3] !== '' ? String(row[3]).trim() : '';
    const nameRaw = row[4] !== null && row[4] !== '' ? String(row[4]).trim() : '';

    if (major) currentMajor = major;

    if ((major === '总额' || major === '总计') && toNumber(row[1], 0) > 0) {
      totalAmountRow = toNumber(row[1], 0);
      continue;
    }

    if (!nameRaw && !codeRaw) continue;

    const normalizedName = nameRaw.replace(/\s+/g, '');
    const isCodePlaceholder = !codeRaw || codeRaw === '——' || codeRaw === '--' || codeRaw === '-';
    const isCashName = /^现金$/.test(normalizedName) || /^人民币现金$/.test(normalizedName) || /账户可用/.test(normalizedName);
    const isCash = isCodePlaceholder && isCashName;
    const tsCode = isCash ? CASH_CODE : codeRaw;
    const instrumentName = isCash ? CASH_NAME : nameRaw;

    if (!tsCode || !instrumentName) continue;

    const amount = toNumber(row[7], 0);
    const qty = toNumber(row[6], 0);
    const baseCost = toNumber(row[5], 0);

    let quantity = qty;
    let costPrice = baseCost;
    let costAmount = amount;

    if (isCash) {
      quantity = qty > 0 ? qty : amount;
      costPrice = 1;
      costAmount = quantity;
    } else {
      if (!(costAmount > 0) && quantity > 0 && costPrice > 0) {
        costAmount = quantity * costPrice;
      }
      if (!(costPrice > 0) && quantity > 0 && costAmount > 0) {
        costPrice = costAmount / quantity;
      }
    }

    positionsRaw.push({
      major_asset: currentMajor || '未分类',
      sub_asset: '',
      instrument_name: instrumentName,
      ts_code: tsCode,
      target_ratio: toNumber(row[8], toNumber(row[2], 0)),
      cost_price: costPrice,
      quantity,
      cost_amount: costAmount
    });
  }

  if (!positionsRaw.length) {
    throw new Error('初始估值表未解析到有效持仓行');
  }

  const merged = new Map();
  for (const row of positionsRaw) {
    const key = row.ts_code;
    if (!merged.has(key)) {
      merged.set(key, { ...row });
      continue;
    }

    const existing = merged.get(key);
    existing.quantity = toNumber(existing.quantity, 0) + toNumber(row.quantity, 0);
    existing.cost_amount = toNumber(existing.cost_amount, 0) + toNumber(row.cost_amount, 0);
    if (existing.quantity > 0) {
      existing.cost_price = existing.ts_code === CASH_CODE ? 1 : existing.cost_amount / existing.quantity;
    }
    existing.target_ratio = toNumber(existing.target_ratio, 0) + toNumber(row.target_ratio, 0);
  }

  const positions = [...merged.values()];
  const sumAmount = positions.reduce((sum, p) => sum + toNumber(p.cost_amount, 0), 0);
  const inceptionValue = totalAmountRow && totalAmountRow > 0 ? totalAmountRow : sumAmount;

  if (!(inceptionValue > 0)) {
    throw new Error('初始估值总额无效（需大于 0）');
  }

  const month = monthOf(valuationDate);
  const cashPosition = positions.find((p) => p.ts_code === CASH_CODE);

  return {
    month,
    valuationDate,
    inceptionValue,
    cashValue: toNumber(cashPosition?.cost_amount, 0),
    positions
  };
}

function parseTransactionWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) {
    throw new Error('交易记录表为空');
  }

  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: null,
    raw: true
  });

  const headerIndex = findHeaderRow(rows, ['交易时间', '代码', '方向', '价格', '数量']);
  if (headerIndex < 0) {
    throw new Error('交易记录表缺少表头（需包含 交易时间/代码/方向/价格/数量）');
  }

  const header = rows[headerIndex] || [];
  const idx = {
    tradeTime: header.findIndex((v) => String(v || '').trim() === '交易时间'),
    tsCode: header.findIndex((v) => String(v || '').trim() === '代码'),
    name: header.findIndex((v) => ['简称', '名称'].includes(String(v || '').trim())),
    direction: header.findIndex((v) => String(v || '').trim() === '方向'),
    price: header.findIndex((v) => String(v || '').trim() === '价格'),
    quantity: header.findIndex((v) => String(v || '').trim() === '数量')
  };

  const transactions = [];
  let totalRows = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    if (!Array.isArray(row)) continue;
    const hasAny = row.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (!hasAny) continue;

    totalRows += 1;
    const effectiveDate = parseDateLike(row[idx.tradeTime]);
    const tsCode = String(row[idx.tsCode] || '').trim();
    const instrumentName = String(row[idx.name] || tsCode).trim();
    const action = normalizeDirection(row[idx.direction]);
    const tradePrice = toNumber(row[idx.price], NaN);
    const quantity = toNumber(row[idx.quantity], NaN);

    if (!effectiveDate || !tsCode || !action || !(tradePrice > 0) || !(quantity > 0)) {
      continue;
    }

    transactions.push({
      month: monthOf(effectiveDate),
      effective_date: effectiveDate,
      ts_code: tsCode,
      instrument_name: instrumentName || tsCode,
      action,
      quantity,
      trade_price: tradePrice
    });
  }

  return { transactions, totalRows };
}

async function upsertMany(supabase, table, rows, conflictTarget) {
  if (!rows.length) return;

  for (const batch of chunkArray(rows, 500)) {
    const { error } = await supabase
      .from(table)
      .upsert(batch, conflictTarget ? { onConflict: conflictTarget } : undefined);

    if (error) throw error;
  }
}

async function insertMany(supabase, table, rows) {
  if (!rows.length) return;

  for (const batch of chunkArray(rows, 500)) {
    const { error } = await supabase.from(table).insert(batch);
    if (error) throw error;
  }
}

async function getPortfolioMeta(supabase) {
  const { data, error } = await supabase
    .from('portfolio_meta')
    .select('*')
    .eq('portfolio_id', DEFAULT_PORTFOLIO_ID)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function importInitialFromBuffer(buffer) {
  const supabase = getSupabaseClient();
  const parsed = parseInitialWorkbook(buffer);

  const metaRow = {
    portfolio_id: DEFAULT_PORTFOLIO_ID,
    month: parsed.month,
    inception_date: parsed.valuationDate,
    inception_value: parsed.inceptionValue,
    total_amount: parsed.inceptionValue,
    timing_coefficient: 1,
    beta_amount: parsed.inceptionValue,
    actual_invest_amount: parsed.inceptionValue,
    cash_available: parsed.cashValue,
    friction_cost: 0
  };

  const { error: metaError } = await supabase
    .from('portfolio_meta')
    .upsert(metaRow, { onConflict: 'portfolio_id' });
  if (metaError) throw metaError;

  const { error: posDeleteError } = await supabase
    .from('positions')
    .delete()
    .eq('portfolio_id', DEFAULT_PORTFOLIO_ID);
  if (posDeleteError) throw posDeleteError;

  const positionRows = parsed.positions.map((p) => ({
    portfolio_id: DEFAULT_PORTFOLIO_ID,
    month: parsed.month,
    valuation_date: parsed.valuationDate,
    major_asset: p.major_asset,
    sub_asset: p.sub_asset,
    instrument_name: p.instrument_name,
    ts_code: p.ts_code,
    target_ratio: toFiniteOrNull(p.target_ratio),
    cost_price: toFiniteOrNull(p.cost_price),
    quantity: toFiniteOrNull(p.quantity),
    cost_amount: toFiniteOrNull(p.cost_amount)
  }));

  await insertMany(supabase, 'positions', positionRows);

  const { error: signalDeleteError } = await supabase
    .from('allocation_signals')
    .delete()
    .eq('month', parsed.month)
    .eq('step', 2);
  if (signalDeleteError) throw signalDeleteError;

  const signalRows = positionRows.map((row) => ({
    month: parsed.month,
    step: 2,
    major_asset: row.major_asset,
    sub_asset: row.sub_asset,
    instrument_name: row.instrument_name,
    ts_code: row.ts_code,
    target_ratio: row.target_ratio
  }));
  await insertMany(supabase, 'allocation_signals', signalRows);

  const { error: snapshotDeleteError } = await supabase
    .from('portfolio_daily_snapshots')
    .delete()
    .eq('portfolio_id', DEFAULT_PORTFOLIO_ID);
  if (snapshotDeleteError) throw snapshotDeleteError;

  return {
    valuationDate: parsed.valuationDate,
    inceptionValue: parsed.inceptionValue,
    positionsImported: positionRows.length
  };
}

async function importTransactionsFromBuffer(buffer) {
  const supabase = getSupabaseClient();
  const parsed = parseTransactionWorkbook(buffer);

  const dedupedMap = new Map();
  for (const tx of parsed.transactions) {
    const id = sha1(`${tx.effective_date}|${tx.ts_code}|${tx.action}|${tx.trade_price}|${tx.quantity}`);
    if (!dedupedMap.has(id)) {
      dedupedMap.set(id, {
        portfolio_id: DEFAULT_PORTFOLIO_ID,
        month: tx.month,
        ts_code: tx.ts_code,
        instrument_name: tx.instrument_name,
        action: tx.action,
        from_ratio: null,
        to_ratio: null,
        ratio_change: null,
        record_type: 'transaction',
        effective_date: tx.effective_date,
        quantity: tx.quantity,
        trade_price: tx.trade_price,
        coefficient: null,
        source: 'excel_import',
        external_id: id,
        note: JSON.stringify({
          kind: 'transaction',
          effective_date: tx.effective_date,
          quantity: tx.quantity,
          trade_cost: tx.trade_price,
          user_note: 'Excel导入'
        })
      });
    }
  }

  const candidateRows = [...dedupedMap.values()];
  const allIds = candidateRows.map((r) => r.external_id);

  const existing = new Set();
  for (const idBatch of chunkArray(allIds, 300)) {
    if (!idBatch.length) continue;
    const { data, error } = await supabase
      .from('rebalance_records')
      .select('external_id')
      .eq('portfolio_id', DEFAULT_PORTFOLIO_ID)
      .in('external_id', idBatch);

    if (error) throw error;
    (data || []).forEach((row) => existing.add(row.external_id));
  }

  const rowsToInsert = candidateRows.filter((row) => !existing.has(row.external_id));
  await insertMany(supabase, 'rebalance_records', rowsToInsert);

  return {
    imported: rowsToInsert.length,
    skipped_duplicate: candidateRows.length - rowsToInsert.length,
    total_rows: parsed.totalRows
  };
}

async function callTushare(apiName, params, fields) {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error('缺少 TUSHARE_TOKEN 环境变量');

  const payload = {
    api_name: apiName,
    token,
    params,
    fields
  };

  const response = await axios.post('https://api.tushare.pro', payload, {
    timeout: 20000
  });

  const body = response.data;
  if (!body) throw new Error('Tushare 返回为空');
  if (body.code !== 0) throw new Error(`Tushare 错误: ${body.msg || body.code}`);

  const data = body.data || {};
  const keys = data.fields || [];
  const items = data.items || [];

  return items.map((item) => {
    const row = {};
    keys.forEach((key, idx) => {
      row[key] = item[idx];
    });
    return row;
  });
}

async function fetchFundDailyWithAlias(tsCode, startDate, endDate) {
  const primaryRows = await callTushare(
    'fund_daily',
    {
      ts_code: tsCode,
      start_date: startDate,
      end_date: endDate
    },
    'ts_code,trade_date,pre_close,close,pct_chg'
  );

  if (primaryRows.length > 0) {
    return {
      rows: primaryRows,
      usedAlias: false,
      sourceCode: tsCode
    };
  }

  const match = String(tsCode).match(/^(.+)\.(SZ|SH)$/i);
  if (!match) {
    return {
      rows: primaryRows,
      usedAlias: false,
      sourceCode: tsCode
    };
  }

  const altCode = `${match[1]}.${match[2].toUpperCase() === 'SZ' ? 'SH' : 'SZ'}`;
  const aliasRows = await callTushare(
    'fund_daily',
    {
      ts_code: altCode,
      start_date: startDate,
      end_date: endDate
    },
    'ts_code,trade_date,pre_close,close,pct_chg'
  );

  if (!aliasRows.length) {
    return {
      rows: primaryRows,
      usedAlias: false,
      sourceCode: tsCode
    };
  }

  return {
    rows: aliasRows.map((row) => ({ ...row, ts_code: tsCode })),
    usedAlias: true,
    sourceCode: altCode
  };
}

async function syncPrices(options = {}) {
  const supabase = getSupabaseClient();
  const meta = await getPortfolioMeta(supabase);
  if (!meta) throw new Error('请先导入初始估值表');

  const startDate = options.startDate || meta.inception_date;
  const endDate = options.endDate || getTodayDateIso();

  const [{ data: positionRows, error: positionError }, { data: rebalanceRows, error: rebalanceError }] =
    await Promise.all([
      supabase
        .from('positions')
        .select('ts_code')
        .eq('portfolio_id', DEFAULT_PORTFOLIO_ID),
      supabase
        .from('rebalance_records')
        .select('ts_code,record_type')
        .eq('portfolio_id', DEFAULT_PORTFOLIO_ID)
    ]);

  if (positionError) throw positionError;
  if (rebalanceError) throw rebalanceError;

  const tsCodes = [...new Set([
    ...(positionRows || []).map((r) => r.ts_code),
    ...(rebalanceRows || []).map((r) => r.ts_code)
  ])]
    .filter((code) => code && code !== CASH_CODE && code !== '__TIMING__');

  if (!tsCodes.length) {
    return {
      inserted: 0,
      tsCodeCount: 0,
      requestedStartDate: startDate,
      requestedEndDate: endDate,
      actualLatestTradeDate: null
    };
  }

  const tushareStart = toTushareDate(startDate);
  const tushareEnd = toTushareDate(endDate);
  let totalRows = 0;
  let latestTradeDate = null;
  const aliasResolved = [];

  for (const tsCode of tsCodes) {
    const fetched = await fetchFundDailyWithAlias(tsCode, tushareStart, tushareEnd);
    const rows = fetched.rows;

    const priceRows = rows
      .map((row) => ({
        ts_code: row.ts_code,
        trade_date: toIsoDate(row.trade_date),
        close_price: toNumber(row.close),
        pre_close: toNumber(row.pre_close),
        pct_chg: toNumber(row.pct_chg),
        source: fetched.usedAlias ? 'tushare_alias' : 'tushare'
      }))
      .filter((row) => row.trade_date && row.close_price > 0)
      .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));

    if (!priceRows.length) continue;
    if (fetched.usedAlias) {
      aliasResolved.push({
        requested_ts_code: tsCode,
        source_ts_code: fetched.sourceCode
      });
    }

    await upsertMany(supabase, 'asset_prices', priceRows, 'ts_code,trade_date');
    totalRows += priceRows.length;

    const localLatest = priceRows[priceRows.length - 1].trade_date;
    if (!latestTradeDate || localLatest > latestTradeDate) {
      latestTradeDate = localLatest;
    }
  }

  return {
    inserted: totalRows,
    tsCodeCount: tsCodes.length,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    actualLatestTradeDate: latestTradeDate,
    aliasResolved
  };
}

function parseLegacyNote(note) {
  if (!note || typeof note !== 'string') return null;
  try {
    const parsed = JSON.parse(note);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (error) {
    return null;
  }
  return null;
}

function normalizeTransactionRow(row) {
  const note = parseLegacyNote(row.note);

  const recordType = row.record_type
    || (row.ts_code === '__TIMING__' ? 'timing' : (note?.kind || 'transaction'));

  const normalized = {
    id: row.id,
    portfolio_id: row.portfolio_id || DEFAULT_PORTFOLIO_ID,
    month: row.month || monthOf(row.effective_date || row.created_at),
    ts_code: row.ts_code,
    instrument_name: row.instrument_name || row.ts_code,
    action: String(row.action || '').toUpperCase(),
    record_type: recordType,
    effective_date: row.effective_date
      || note?.effective_date
      || (row.created_at ? String(row.created_at).slice(0, 10) : null),
    quantity: toFiniteOrNull(row.quantity) ?? toFiniteOrNull(note?.quantity),
    trade_price: toFiniteOrNull(row.trade_price) ?? toFiniteOrNull(note?.trade_cost),
    coefficient: toFiniteOrNull(row.coefficient) ?? toFiniteOrNull(note?.coefficient),
    note_kind: note?.kind || null,
    cash_direction: note?.cash_direction ? String(note.cash_direction).toUpperCase() : null,
    cash_amount: toFiniteOrNull(note?.amount),
    source: row.source || (note ? 'legacy' : 'manual'),
    external_id: row.external_id || null,
    note: note?.user_note || row.note || '',
    created_at: row.created_at || null
  };

  return normalized;
}

function computeVolatilityAndSharpe(dailyReturns, annualizedReturn, riskFreeRate) {
  if (dailyReturns.length < 2) {
    return {
      volatility: 0,
      sharpe: 0
    };
  }

  const n = dailyReturns.length;
  const mean = dailyReturns.reduce((sum, r) => sum + r, 0) / n;
  const variance = dailyReturns.reduce((sum, r) => sum + ((r - mean) ** 2), 0) / (n - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252);
  const sharpe = volatility > 0 ? (annualizedReturn - riskFreeRate) / volatility : 0;

  return { volatility, sharpe };
}

function buildValuationSeries({
  meta,
  positions,
  transactions,
  prices,
  endDate,
  riskFreeRate = RISK_FREE_RATE
}) {
  const inceptionDate = String(meta.inception_date);
  const cutoffDate = endDate || getTodayDateIso();
  const inceptionValue = toNumber(meta.inception_value || meta.total_amount, 0);

  if (!(inceptionValue > 0)) {
    throw new Error('组合初始净值基数无效，请重新导入初始估值表');
  }

  const priceRows = (prices || [])
    .filter((row) => row.trade_date >= inceptionDate && row.trade_date <= cutoffDate)
    .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  const quotedCodeSet = new Set(priceRows.map((row) => row.ts_code).filter(Boolean));

  const priceByCodeDate = new Map();
  const tradingDateSet = new Set();
  for (const row of priceRows) {
    if (!row.ts_code || !row.trade_date) continue;
    priceByCodeDate.set(`${row.ts_code}|${row.trade_date}`, toNumber(row.close_price, 0));
    tradingDateSet.add(row.trade_date);
  }

  let tradingDates = [...tradingDateSet].sort();
  if (!tradingDates.length) {
    tradingDates = [inceptionDate];
  }

  const normalizedTransactions = (transactions || [])
    .map(normalizeTransactionRow)
    .filter((row) => row.record_type === 'transaction')
    .filter((row) => row.effective_date && row.effective_date >= inceptionDate && row.effective_date <= cutoffDate)
    .filter((row) => row.ts_code && row.ts_code !== '__TIMING__')
    .filter((row) => {
      if (row.note_kind === 'cash_adjustment') {
        return ['INCREASE', 'DECREASE'].includes(String(row.cash_direction || '').toUpperCase())
          && toNumber(row.quantity, 0) > 0;
      }
      return ['BUY', 'SELL'].includes(row.action)
        && toNumber(row.quantity, 0) > 0
        && toNumber(row.trade_price, 0) > 0;
    })
    .sort((a, b) => {
      if (String(a.effective_date) === String(b.effective_date)) {
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      }
      return String(a.effective_date).localeCompare(String(b.effective_date));
    });

  const positionInfo = new Map();
  const holdings = new Map();
  const fallbackPrice = new Map();
  const lastClosePrice = new Map();

  for (const pos of positions || []) {
    const code = pos.ts_code;
    if (!code) continue;

    positionInfo.set(code, {
      ts_code: code,
      instrument_name: pos.instrument_name || code,
      major_asset: pos.major_asset || '未分类',
      sub_asset: pos.sub_asset || '未分类'
    });

    holdings.set(code, toNumber(pos.quantity, 0));

    if (code === CASH_CODE) {
      fallbackPrice.set(code, 1);
      lastClosePrice.set(code, 1);
    } else if (toNumber(pos.cost_price, 0) > 0) {
      fallbackPrice.set(code, toNumber(pos.cost_price, 0));
    }
  }

  if (!holdings.has(CASH_CODE)) {
    holdings.set(CASH_CODE, 0);
    positionInfo.set(CASH_CODE, {
      ts_code: CASH_CODE,
      instrument_name: CASH_NAME,
      major_asset: '货币类',
      sub_asset: '现金'
    });
    fallbackPrice.set(CASH_CODE, 1);
    lastClosePrice.set(CASH_CODE, 1);
  }

  const unknownAssetSet = new Set();
  const valuationDates = tradingDates.filter((date) => date > inceptionDate);
  const alignmentDates = valuationDates.length ? valuationDates : [inceptionDate];

  const alignedTransactions = [];
  const txByTradingDate = new Map();

  for (const tx of normalizedTransactions) {
    const alignedDate = alignToTradingDate(tx.effective_date, alignmentDates);
    if (!alignedDate) continue;

    const finalTx = {
      ...tx,
      aligned_date: alignedDate
    };

    alignedTransactions.push(finalTx);

    if (!txByTradingDate.has(alignedDate)) {
      txByTradingDate.set(alignedDate, []);
    }
    txByTradingDate.get(alignedDate).push(finalTx);
  }

  const missingPriceWarnings = [];
  const missingKeySet = new Set();
  const negativeCashDates = [];
  const navSeries = [];
  const snapshotRows = [];
  const rowsByDate = [];

  const dailyReturns = [];
  let peakNav = 1;
  let maxDrawdown = 0;
  let prevNav = 1;
  let latestAllocationRows = [];
  let latestTotalValue = inceptionValue;
  let latestCashValue = toNumber(holdings.get(CASH_CODE), 0);
  const initialCashValue = toNumber(holdings.get(CASH_CODE), 0);
  let cashBuyOutflow = 0;
  let cashSellInflow = 0;
  let cashAdjustmentInflow = 0;
  let cashAdjustmentOutflow = 0;

  const initialRows = [];
  for (const [code, quantityRaw] of holdings.entries()) {
    const quantity = toNumber(quantityRaw, 0);
    const info = positionInfo.get(code) || {
      ts_code: code,
      instrument_name: code,
      major_asset: '未分类',
      sub_asset: '未分类'
    };

    const price = code === CASH_CODE ? 1 : toNumber(fallbackPrice.get(code), 0);
    initialRows.push({
      ...info,
      quantity,
      close_price: price,
      market_value: quantity * price
    });
  }

  navSeries.push({
    date: inceptionDate,
    nav: 1,
    total_value: inceptionValue,
    cash_value: latestCashValue,
    daily_return: 0
  });

  snapshotRows.push({
    portfolio_id: DEFAULT_PORTFOLIO_ID,
    trade_date: inceptionDate,
    total_value: Number(inceptionValue.toFixed(6)),
    nav: 1,
    daily_return: 0,
    cumulative_return: 0,
    annualized_return: 0,
    volatility: 0,
    sharpe_ratio: 0,
    max_drawdown: 0,
    cash_value: Number(latestCashValue.toFixed(6))
  });

  latestAllocationRows = initialRows;
  rowsByDate.push({
    date: inceptionDate,
    rows: initialRows
  });

  for (const date of valuationDates) {
    const dayTxs = txByTradingDate.get(date) || [];

    for (const tx of dayTxs) {
      if (tx.note_kind === 'cash_adjustment') {
        const direction = String(tx.cash_direction || '').toUpperCase();
        const amount = toNumber(tx.quantity, 0);
        if (!(amount > 0)) continue;

        const currentCash = toNumber(holdings.get(CASH_CODE), 0);
        const nextCash = direction === 'INCREASE'
          ? currentCash + amount
          : currentCash - amount;

        holdings.set(CASH_CODE, nextCash);
        latestCashValue = nextCash;
        if (direction === 'INCREASE') {
          cashAdjustmentInflow += amount;
        } else if (direction === 'DECREASE') {
          cashAdjustmentOutflow += amount;
        }
        continue;
      }

      const code = tx.ts_code;
      if (!positionInfo.has(code)) {
        positionInfo.set(code, {
          ts_code: code,
          instrument_name: tx.instrument_name || code,
          major_asset: '未分类',
          sub_asset: '未分类'
        });
      }
      if (!holdings.has(code)) {
        holdings.set(code, 0);
        unknownAssetSet.add(code);
      }

      const qty = toNumber(tx.quantity, 0);
      const tradePrice = toNumber(tx.trade_price, 0);

      if (!(qty > 0) || !(tradePrice > 0)) continue;

      const currentQty = toNumber(holdings.get(code), 0);
      const currentCash = toNumber(holdings.get(CASH_CODE), 0);

      if (tx.action === 'BUY') {
        holdings.set(code, currentQty + qty);
        holdings.set(CASH_CODE, currentCash - qty * tradePrice);
        cashBuyOutflow += qty * tradePrice;
      } else if (tx.action === 'SELL') {
        const newQty = Math.max(0, currentQty - qty);
        holdings.set(code, newQty);
        holdings.set(CASH_CODE, currentCash + qty * tradePrice);
        cashSellInflow += qty * tradePrice;
      }

      fallbackPrice.set(code, tradePrice);
    }

    const rowsForDay = [];
    let totalValue = 0;

    for (const [code, quantityRaw] of holdings.entries()) {
      const quantity = toNumber(quantityRaw, 0);
      const info = positionInfo.get(code) || {
        ts_code: code,
        instrument_name: code,
        major_asset: '未分类',
        sub_asset: '未分类'
      };

      let price = 0;
      if (code === CASH_CODE) {
        price = 1;
      } else {
        const direct = toNumber(priceByCodeDate.get(`${code}|${date}`), 0);
        if (direct > 0) {
          price = direct;
          lastClosePrice.set(code, direct);
        } else {
          price = toNumber(lastClosePrice.get(code), 0) || toNumber(fallbackPrice.get(code), 0);
          if (price > 0) {
            const mk = `${code}|${date}`;
            if (!missingKeySet.has(mk)) {
              missingKeySet.add(mk);
              missingPriceWarnings.push({
                trade_date: date,
                ts_code: code,
                filled_price: price
              });
            }
          }
        }
      }

      const marketValue = quantity * price;
      totalValue += marketValue;
      rowsForDay.push({
        ...info,
        quantity,
        close_price: price,
        market_value: marketValue
      });
    }

    const cashValue = toNumber(holdings.get(CASH_CODE), 0);
    if (cashValue < 0) {
      negativeCashDates.push({ date, cash_value: cashValue });
    }

    const nav = inceptionValue > 0 ? totalValue / inceptionValue : 0;
    const dailyReturn = prevNav > 0 ? nav / prevNav - 1 : 0;
    if (prevNav > 0) {
      dailyReturns.push(dailyReturn);
    }

    const days = Math.max(
      1,
      Math.round((new Date(date).getTime() - new Date(inceptionDate).getTime()) / (24 * 60 * 60 * 1000))
    );
    const cumulativeReturn = nav - 1;
    const annualizedReturn = nav > 0 ? Math.pow(nav, 365 / days) - 1 : 0;

    peakNav = Math.max(peakNav, nav);
    const drawdown = peakNav > 0 ? nav / peakNav - 1 : 0;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;

    const { volatility, sharpe } = computeVolatilityAndSharpe(dailyReturns, annualizedReturn, riskFreeRate);

    navSeries.push({
      date,
      nav,
      total_value: totalValue,
      cash_value: cashValue,
      daily_return: dailyReturn
    });

    snapshotRows.push({
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      trade_date: date,
      total_value: Number(totalValue.toFixed(6)),
      nav: Number(nav.toFixed(10)),
      daily_return: Number(dailyReturn.toFixed(10)),
      cumulative_return: Number(cumulativeReturn.toFixed(10)),
      annualized_return: Number(annualizedReturn.toFixed(10)),
      volatility: Number(volatility.toFixed(10)),
      sharpe_ratio: Number(sharpe.toFixed(10)),
      max_drawdown: Number(maxDrawdown.toFixed(10)),
      cash_value: Number(cashValue.toFixed(6))
    });

    latestTotalValue = totalValue;
    latestCashValue = cashValue;
    latestAllocationRows = rowsForDay;
    rowsByDate.push({
      date,
      rows: rowsForDay
    });
    prevNav = nav;
  }

  const latestDate = navSeries.length ? navSeries[navSeries.length - 1].date : inceptionDate;
  const latestNav = navSeries.length ? navSeries[navSeries.length - 1].nav : 1;

  const allocationTotal = latestAllocationRows.reduce((sum, row) => sum + toNumber(row.market_value, 0), 0);
  const allocationRows = latestAllocationRows
    .map((row) => ({
      ...row,
      weight: allocationTotal > 0 ? toNumber(row.market_value, 0) / allocationTotal : 0
    }))
    .sort((a, b) => toNumber(b.market_value, 0) - toNumber(a.market_value, 0));

  const stats = {
    cumulative_return: latestNav - 1,
    annualized_return: snapshotRows.length ? snapshotRows[snapshotRows.length - 1].annualized_return : 0,
    volatility: snapshotRows.length ? snapshotRows[snapshotRows.length - 1].volatility : 0,
    sharpe_ratio: snapshotRows.length ? snapshotRows[snapshotRows.length - 1].sharpe_ratio : 0,
    max_drawdown: snapshotRows.length ? snapshotRows[snapshotRows.length - 1].max_drawdown : 0,
    latest_nav: latestNav,
    latest_total_value: latestTotalValue,
    inception_value: inceptionValue,
    pnl: latestTotalValue - inceptionValue,
    pnl_pct: latestNav - 1
  };
  const assetsWithoutPriceHistory = [...holdings.keys()]
    .filter((code) => code && code !== CASH_CODE && !quotedCodeSet.has(code))
    .map((code) => {
      const info = positionInfo.get(code) || {};
      return {
        ts_code: code,
        instrument_name: info.instrument_name || code
      };
    });

  return {
    startDate: inceptionDate,
    endDate: latestDate,
    tradingDates,
    alignedTransactions,
    navSeries,
    snapshotRows,
    rows_by_date: rowsByDate,
    latestAllocationRows: allocationRows,
    stats,
    diagnostics: {
      missing_prices: missingPriceWarnings.slice(0, 200),
      negative_cash_dates: negativeCashDates.slice(0, 50),
      unknown_transaction_assets: [...unknownAssetSet],
      assets_without_price_history: assetsWithoutPriceHistory,
      cash_reconciliation: {
        initial_cash: initialCashValue,
        sell_inflow: cashSellInflow,
        buy_outflow: cashBuyOutflow,
        adjustment_inflow: cashAdjustmentInflow,
        adjustment_outflow: cashAdjustmentOutflow,
        modeled_cash: latestCashValue,
        equation_cash: initialCashValue + cashSellInflow - cashBuyOutflow + cashAdjustmentInflow - cashAdjustmentOutflow
      }
    },
    latestCashValue
  };
}

async function computePortfolioValuation({ endDate, persistSnapshots = false } = {}) {
  const supabase = getSupabaseClient();
  const meta = await getPortfolioMeta(supabase);
  if (!meta) {
    return {
      hasData: false,
      message: '请先上传初始估值表'
    };
  }

  const [
    { data: positions, error: positionsError },
    { data: rebalanceRows, error: rebalanceError }
  ] = await Promise.all([
    supabase
      .from('positions')
      .select('*')
      .eq('portfolio_id', DEFAULT_PORTFOLIO_ID)
      .order('id', { ascending: true }),
    supabase
      .from('rebalance_records')
      .select('*')
      .eq('portfolio_id', DEFAULT_PORTFOLIO_ID)
      .order('created_at', { ascending: true })
  ]);

  if (positionsError) throw positionsError;
  if (rebalanceError) throw rebalanceError;

  if (!(positions || []).length) {
    return {
      hasData: false,
      message: '暂无初始持仓数据，请先导入初始估值表'
    };
  }

  const txRows = (rebalanceRows || []).map(normalizeTransactionRow);
  const tsCodes = [...new Set([
    ...(positions || []).map((p) => p.ts_code),
    ...txRows.map((r) => r.ts_code)
  ])]
    .filter((code) => code && code !== CASH_CODE && code !== '__TIMING__');

  let prices = [];
  if (tsCodes.length) {
    const { data: priceRows, error: priceError } = await supabase
      .from('asset_prices')
      .select('ts_code,trade_date,close_price,pre_close,pct_chg')
      .in('ts_code', tsCodes)
      .gte('trade_date', meta.inception_date)
      .lte('trade_date', endDate || getTodayDateIso())
      .order('trade_date', { ascending: true });

    if (priceError) throw priceError;
    prices = priceRows || [];
  }

  const valuation = buildValuationSeries({
    meta,
    positions,
    transactions: txRows,
    prices,
    endDate: endDate || getTodayDateIso(),
    riskFreeRate: RISK_FREE_RATE
  });

  if (persistSnapshots) {
    await upsertMany(
      supabase,
      'portfolio_daily_snapshots',
      valuation.snapshotRows,
      'portfolio_id,trade_date'
    );
  }

  return {
    hasData: true,
    meta,
    positions,
    transactions: txRows,
    valuation
  };
}

function buildNavMarkers(navSeries, transactions) {
  const dateToIndex = new Map((navSeries || []).map((p, idx) => [p.date, idx]));
  const markers = [];

  for (const tx of transactions || []) {
    const idx = dateToIndex.get(tx.aligned_date);
    if (idx === undefined) continue;

    if (tx.note_kind === 'cash_adjustment') {
      const direction = String(tx.cash_direction || '').toUpperCase();
      const directionLabel = direction === 'INCREASE' ? '现金增加' : '现金减少';
      markers.push({
        date: tx.aligned_date,
        index: idx,
        label: `${directionLabel} ${Number(toNumber(tx.quantity, 0)).toLocaleString('zh-CN')}`
      });
      continue;
    }

    markers.push({
      date: tx.aligned_date,
      index: idx,
      label: `${tx.action} ${tx.instrument_name} ${Number(toNumber(tx.quantity, 0)).toLocaleString('zh-CN')}`
    });
  }

  return markers;
}

function addMonths(dateLike, months) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) {
    d.setDate(0);
  }
  return d;
}

function clampIntervalToSeries(requestedStartDate, requestedEndDate, availableDates) {
  const sortedDates = [...(availableDates || [])].sort();
  if (!sortedDates.length) return null;

  const reqStart = requestedStartDate || sortedDates[0];
  const reqEnd = requestedEndDate || sortedDates[sortedDates.length - 1];

  let start = null;
  for (const date of sortedDates) {
    if (date >= reqStart) {
      start = date;
      break;
    }
  }
  if (!start) start = sortedDates[0];

  let end = null;
  for (let i = sortedDates.length - 1; i >= 0; i -= 1) {
    const date = sortedDates[i];
    if (date <= reqEnd) {
      end = date;
      break;
    }
  }
  if (!end) end = sortedDates[sortedDates.length - 1];

  if (start > end) {
    return {
      start: end,
      end
    };
  }

  return { start, end };
}

function computeMaxDrawdownFromSeries(series, key) {
  const values = (series || []).map((row) => toNumber(row[key], 0)).filter((v) => v > 0);
  if (!values.length) return 0;

  let peak = values[0];
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    const drawdown = peak > 0 ? value / peak - 1 : 0;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }
  return maxDrawdown;
}

function buildPerformanceAnalysis({
  meta,
  valuation,
  requestedStartDate,
  requestedEndDate
}) {
  const series = valuation.navSeries || [];
  if (!series.length) {
    throw new Error('暂无可分析的净值序列');
  }

  const availableDates = series.map((p) => p.date);
  const clamped = clampIntervalToSeries(requestedStartDate, requestedEndDate, availableDates);
  if (!clamped) {
    throw new Error('暂无可分析日期');
  }

  const startDate = clamped.start;
  const endDate = clamped.end;
  const sliced = series.filter((p) => p.date >= startDate && p.date <= endDate);
  if (!sliced.length) {
    throw new Error('区间内没有净值数据');
  }

  const startPoint = sliced[0];
  const endPoint = sliced[sliced.length - 1];
  const startValue = toNumber(startPoint.total_value, 0);
  const endValue = toNumber(endPoint.total_value, 0);
  const pnlAmount = endValue - startValue;
  const pnlPct = startValue > 0 ? pnlAmount / startValue : 0;

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(
    1,
    Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / dayMs)
  );
  const annualizedReturn = pnlPct > -1 ? Math.pow(1 + pnlPct, 365 / days) - 1 : 0;

  const dailyReturns = [];
  for (let i = 1; i < sliced.length; i += 1) {
    const prev = toNumber(sliced[i - 1].total_value, 0);
    const curr = toNumber(sliced[i].total_value, 0);
    if (prev > 0) {
      dailyReturns.push(curr / prev - 1);
    }
  }

  const { volatility, sharpe } = computeVolatilityAndSharpe(dailyReturns, annualizedReturn, RISK_FREE_RATE);
  const maxDrawdown = computeMaxDrawdownFromSeries(sliced, 'total_value');
  const calmar = maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : 0;

  const rowMapByDate = new Map(
    (valuation.rows_by_date || []).map((entry) => [entry.date, entry.rows || []])
  );
  const startRows = rowMapByDate.get(startDate) || [];
  const endRows = rowMapByDate.get(endDate) || [];

  const startByCode = new Map(startRows.map((r) => [r.ts_code, r]));
  const endByCode = new Map(endRows.map((r) => [r.ts_code, r]));

  const txInRange = (valuation.alignedTransactions || [])
    .filter((tx) => tx.aligned_date >= startDate && tx.aligned_date <= endDate)
    .filter((tx) => tx.note_kind !== 'cash_adjustment');

  const tradeFlowByCode = new Map();
  const tradedCodeSet = new Set();

  for (const tx of txInRange) {
    const code = tx.ts_code;
    if (!code || code === CASH_CODE) continue;
    tradedCodeSet.add(code);
    const flow = tradeFlowByCode.get(code) || { buy: 0, sell: 0 };
    const qty = toNumber(tx.quantity, 0);
    const tradePrice = toNumber(tx.trade_price, 0);
    if (tx.action === 'BUY') {
      flow.buy += qty * tradePrice;
    } else if (tx.action === 'SELL') {
      flow.sell += qty * tradePrice;
    }
    tradeFlowByCode.set(code, flow);
  }

  const codeSet = new Set();
  for (const code of startByCode.keys()) {
    if (code && code !== CASH_CODE) codeSet.add(code);
  }
  for (const code of endByCode.keys()) {
    if (code && code !== CASH_CODE) codeSet.add(code);
  }
  for (const code of tradedCodeSet) codeSet.add(code);

  const holdingsReturns = [];
  for (const code of codeSet) {
    const start = startByCode.get(code) || {};
    const end = endByCode.get(code) || {};
    const flow = tradeFlowByCode.get(code) || { buy: 0, sell: 0 };

    const startQty = toNumber(start.quantity, 0);
    const endQty = toNumber(end.quantity, 0);
    const tradedInRange = tradedCodeSet.has(code);
    if (startQty <= 0 && endQty <= 0 && !tradedInRange) {
      continue;
    }
    const startPrice = toNumber(start.close_price, 0);
    const endPrice = toNumber(end.close_price, 0);
    const startValueAsset = startQty * startPrice;
    const endValueAsset = endQty * endPrice;
    const pnl = endValueAsset - startValueAsset - flow.buy + flow.sell;
    const contributionRate = startValue > 0 ? pnl / startValue : 0;
    const periodReturn = startPrice > 0 && endPrice > 0 ? endPrice / startPrice - 1 : null;

    const instrumentName = end.instrument_name || start.instrument_name || code;
    const majorAsset = end.major_asset || start.major_asset || '未分类';
    const isCleared = startQty > 0 && endQty <= 0;

    holdingsReturns.push({
      ts_code: code,
      instrument_name: instrumentName,
      major_asset: majorAsset,
      start_quantity: startQty,
      end_quantity: endQty,
      start_price: startPrice,
      end_price: endPrice,
      period_return: periodReturn,
      contribution_amount: pnl,
      contribution_rate: contributionRate,
      is_cleared: isCleared
    });
  }

  holdingsReturns.sort((a, b) => toNumber(b.contribution_amount, 0) - toNumber(a.contribution_amount, 0));

  const topPositive = holdingsReturns
    .filter((row) => toNumber(row.contribution_amount, 0) > 0)
    .slice(0, 3);
  const topNegative = holdingsReturns
    .filter((row) => toNumber(row.contribution_amount, 0) < 0)
    .sort((a, b) => toNumber(a.contribution_amount, 0) - toNumber(b.contribution_amount, 0))
    .slice(0, 3);

  return {
    requested_start_date: requestedStartDate || null,
    requested_end_date: requestedEndDate || null,
    interval_start_date: startDate,
    interval_end_date: endDate,
    interval_stats: {
      start_value: startValue,
      end_value: endValue,
      pnl_amount: pnlAmount,
      pnl_pct: pnlPct,
      annualized_return: annualizedReturn,
      max_drawdown: maxDrawdown,
      sharpe_ratio: sharpe,
      calmar_ratio: calmar
    },
    contribution: {
      top_positive: topPositive,
      top_negative: topNegative
    },
    holdings_returns: holdingsReturns
  };
}

async function fetchBenchmarkReturns(startDate, endDate) {
  const benchmarks = [
    { name: '上证指数', ts_code: '000001.SH' },
    { name: '沪深300', ts_code: '000300.SH' },
    { name: '中证500', ts_code: '000905.SH' },
    { name: '中证1000', ts_code: '000852.SH' },
    { name: '创业板指', ts_code: '399006.SZ' },
    { name: '科创综指', ts_code: '000680.SH' }
  ];

  const rows = [];
  const tushareStart = toTushareDate(startDate);
  const tushareEnd = toTushareDate(endDate);

  for (const benchmark of benchmarks) {
    try {
      const data = await callTushare(
        'index_daily',
        {
          ts_code: benchmark.ts_code,
          start_date: tushareStart,
          end_date: tushareEnd
        },
        'ts_code,trade_date,close'
      );

      const points = data
        .map((row) => ({
          trade_date: toIsoDate(row.trade_date),
          close: toNumber(row.close, 0)
        }))
        .filter((row) => row.trade_date && row.close > 0)
        .sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date)));

      if (!points.length) {
        rows.push({
          name: benchmark.name,
          ts_code: benchmark.ts_code,
          start_date: null,
          end_date: null,
          start_close: null,
          end_close: null,
          return_pct: null
        });
        continue;
      }

      const first = points[0];
      const last = points[points.length - 1];
      rows.push({
        name: benchmark.name,
        ts_code: benchmark.ts_code,
        start_date: first.trade_date,
        end_date: last.trade_date,
        start_close: first.close,
        end_close: last.close,
        return_pct: first.close > 0 ? last.close / first.close - 1 : null
      });
    } catch (error) {
      rows.push({
        name: benchmark.name,
        ts_code: benchmark.ts_code,
        start_date: null,
        end_date: null,
        start_close: null,
        end_close: null,
        return_pct: null,
        error: error.message || String(error)
      });
    }
  }

  return rows;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    read_only_mode: READ_ONLY_MODE,
    viewer_auth_enabled: ENABLE_VIEWER_AUTH
  });
});

app.post('/api/import-initial', requireWriteAccess, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: '请上传初始估值 Excel 文件（字段名 file）' });
    }

    const result = await importInitialFromBuffer(req.file.buffer);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post('/api/import-transactions', requireWriteAccess, upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: '请上传交易记录 Excel 文件（字段名 file）' });
    }

    const result = await importTransactionsFromBuffer(req.file.buffer);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post('/api/sync-prices', requireWriteAccess, async (req, res) => {
  try {
    const result = await syncPrices({
      startDate: req.body?.startDate,
      endDate: req.body?.endDate
    });

    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post('/api/rebuild-valuations', requireWriteAccess, async (req, res) => {
  try {
    const computed = await computePortfolioValuation({
      endDate: req.body?.endDate,
      persistSnapshots: true
    });

    if (!computed.hasData) {
      return res.status(400).json({ ok: false, error: computed.message || '缺少估值基础数据' });
    }

    const valuation = computed.valuation;
    const result = {
      startDate: valuation.startDate,
      endDate: valuation.endDate,
      snapshotCount: valuation.snapshotRows.length,
      latestNav: valuation.stats.latest_nav,
      latestValue: valuation.stats.latest_total_value
    };

    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const computed = await computePortfolioValuation({
      endDate: req.query?.endDate,
      persistSnapshots: false
    });

    if (!computed.hasData) {
      return res.json({
        ok: true,
        result: {
          has_data: false,
          message: computed.message || '暂无数据',
          read_only_mode: READ_ONLY_MODE
        }
      });
    }

    const valuation = computed.valuation;
    const navMarkers = buildNavMarkers(valuation.navSeries, valuation.alignedTransactions);

    const result = {
      has_data: true,
      read_only_mode: READ_ONLY_MODE,
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      meta: {
        inception_date: computed.meta.inception_date,
        inception_value: toNumber(computed.meta.inception_value, 0)
      },
      nav_chart: {
        dates: valuation.navSeries.map((p) => p.date),
        values: valuation.navSeries.map((p) => Number(toNumber(p.nav, 0).toFixed(6))),
        total_values: valuation.navSeries.map((p) => Number(toNumber(p.total_value, 0).toFixed(2))),
        markers: navMarkers
      },
      latest_allocation: valuation.latestAllocationRows,
      transactions: valuation.alignedTransactions
        .slice()
        .sort((a, b) => {
          if (String(a.effective_date) === String(b.effective_date)) {
            return String(b.created_at || '').localeCompare(String(a.created_at || ''));
          }
          return String(b.effective_date).localeCompare(String(a.effective_date));
        }),
      stats: valuation.stats,
      latest_valuation_date: valuation.endDate,
      diagnostics: valuation.diagnostics
    };

    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.get('/api/performance-analysis', async (req, res) => {
  try {
    const requestedStartDate = req.query?.startDate ? String(req.query.startDate) : null;
    const requestedEndDate = req.query?.endDate ? String(req.query.endDate) : null;

    const computed = await computePortfolioValuation({
      endDate: requestedEndDate || undefined,
      persistSnapshots: false
    });

    if (!computed.hasData) {
      return res.status(400).json({ ok: false, error: computed.message || '暂无可分析数据' });
    }

    const analysis = buildPerformanceAnalysis({
      meta: computed.meta,
      valuation: computed.valuation,
      requestedStartDate,
      requestedEndDate
    });

    const benchmarkReturns = await fetchBenchmarkReturns(
      analysis.interval_start_date,
      analysis.interval_end_date
    );

    res.json({
      ok: true,
      result: {
        ...analysis,
        benchmark_returns: benchmarkReturns
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.get('/api/rebalances', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('rebalance_records')
      .select('*')
      .eq('portfolio_id', DEFAULT_PORTFOLIO_ID)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    const result = (data || [])
      .map(normalizeTransactionRow)
      .filter((r) => r.record_type === 'transaction');

    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post('/api/rebalances', requireWriteAccess, async (req, res) => {
  try {
    const payload = req.body || {};
    const effectiveDate = String(payload.effectiveDate || '');
    const tsCode = String(payload.tsCode || '').trim();
    const instrumentName = String(payload.instrumentName || tsCode).trim();
    const action = normalizeDirection(payload.action);
    const quantity = toNumber(payload.quantity, NaN);
    const tradePrice = toNumber(payload.tradeCost, NaN);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return res.status(400).json({ ok: false, error: 'effectiveDate 格式应为 YYYY-MM-DD' });
    }
    if (!tsCode) {
      return res.status(400).json({ ok: false, error: '缺少 tsCode' });
    }
    if (!action) {
      return res.status(400).json({ ok: false, error: 'action 仅支持 BUY/SELL（或 买入/卖出）' });
    }
    if (!(quantity > 0)) {
      return res.status(400).json({ ok: false, error: 'quantity 必须大于 0' });
    }
    if (!(tradePrice > 0)) {
      return res.status(400).json({ ok: false, error: 'tradeCost 必须大于 0' });
    }

    const supabase = getSupabaseClient();
    const row = {
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      month: monthOf(effectiveDate),
      ts_code: tsCode,
      instrument_name: instrumentName,
      action,
      from_ratio: null,
      to_ratio: null,
      ratio_change: null,
      record_type: 'transaction',
      effective_date: effectiveDate,
      quantity,
      trade_price: tradePrice,
      coefficient: null,
      source: 'manual',
      external_id: null,
      note: JSON.stringify({
        kind: 'transaction',
        effective_date: effectiveDate,
        quantity,
        trade_cost: tradePrice,
        user_note: payload.note ? String(payload.note) : ''
      })
    };

    const { data, error } = await supabase
      .from('rebalance_records')
      .insert(row)
      .select('*')
      .single();

    if (error) throw error;

    res.json({ ok: true, result: normalizeTransactionRow(data) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post('/api/cash-adjustments', requireWriteAccess, async (req, res) => {
  try {
    const payload = req.body || {};
    const effectiveDate = String(payload.effectiveDate || '');
    const directionRaw = String(payload.direction || '').trim();
    const amount = toNumber(payload.amount, NaN);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return res.status(400).json({ ok: false, error: 'effectiveDate 格式应为 YYYY-MM-DD' });
    }
    if (!(amount > 0)) {
      return res.status(400).json({ ok: false, error: 'amount 必须大于 0' });
    }

    const directionMap = {
      INCREASE: 'INCREASE',
      DECREASE: 'DECREASE',
      增加: 'INCREASE',
      减少: 'DECREASE'
    };
    const direction = directionMap[directionRaw.toUpperCase()] || directionMap[directionRaw];
    if (!direction) {
      return res.status(400).json({ ok: false, error: 'direction 仅支持 INCREASE/DECREASE（或 增加/减少）' });
    }

    const supabase = getSupabaseClient();
    const row = {
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      month: monthOf(effectiveDate),
      ts_code: CASH_CODE,
      instrument_name: '现金调剂',
      action: 'ADJUST',
      from_ratio: null,
      to_ratio: null,
      ratio_change: null,
      record_type: 'transaction',
      effective_date: effectiveDate,
      quantity: amount,
      trade_price: 1,
      coefficient: null,
      source: 'manual_cash_adjustment',
      external_id: null,
      note: JSON.stringify({
        kind: 'cash_adjustment',
        effective_date: effectiveDate,
        cash_direction: direction,
        amount,
        user_note: payload.note ? String(payload.note) : ''
      })
    };

    const { data, error } = await supabase
      .from('rebalance_records')
      .insert(row)
      .select('*')
      .single();

    if (error) throw error;

    res.json({ ok: true, result: normalizeTransactionRow(data) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post('/api/init', requireWriteAccess, async (req, res) => {
  try {
    const filePath = req.body?.excelPath || LEGACY_EXCEL_PATH;
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ ok: false, error: `Excel 文件不存在: ${filePath}` });
    }

    const buffer = fs.readFileSync(filePath);
    const result = await importInitialFromBuffer(buffer);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.use('/api/research/update', requireWriteAccess);

registerResearchRoutes({ app, getSupabaseClient });

app.get('/research', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'research.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Asset valuation system running at http://localhost:${PORT}`);
  startResearchScheduler({ getSupabaseClient });
});
