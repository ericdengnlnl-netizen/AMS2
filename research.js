const axios = require('axios');
const crypto = require('crypto');
const cron = require('node-cron');

const RESEARCH_DEFAULT_LIMIT = Number(process.env.RESEARCH_LIMIT_PER_SOURCE || 20);
const RESEARCH_CRON_EXPR = process.env.RESEARCH_CRON_EXPR || '30 7 * * *';
const RESEARCH_CRON_TZ = process.env.RESEARCH_CRON_TZ || 'America/New_York';

const SOURCE_CATALOG = [
  {
    code: 'goldman_sachs',
    name: 'Goldman Sachs',
    base_url: 'https://www.goldmansachs.com',
    access_mode: 'public',
    sitemap_urls: ['https://www.goldmansachs.com/sitemap-1.xml'],
    allow_patterns: ['/insights/articles/', '/insights/top-of-mind/']
  },
  {
    code: 'merrill',
    name: 'Merrill',
    base_url: 'https://www.ml.com',
    access_mode: 'public',
    sitemap_urls: ['https://www.ml.com/sitemap.xml'],
    allow_patterns: ['/capital-market-outlook/', '/articles/']
  },
  {
    code: 'bofa_institute',
    name: 'BofA Institute',
    base_url: 'https://institute.bankofamerica.com',
    access_mode: 'public',
    sitemap_urls: ['https://institute.bankofamerica.com/content/institute/bank-of-america-institute.sitemap.xml'],
    allow_patterns: ['/daily-insights', '/economic-insights/']
  },
  {
    code: 'jpm_am',
    name: 'J.P. Morgan AM',
    base_url: 'https://am.jpmorgan.com',
    access_mode: 'public',
    discovery_page: 'https://am.jpmorgan.com/us/en/asset-management/adv/insights/',
    insights_json: 'https://am.jpmorgan.com/content/dam/jpm-am-aem/americas/us/en/insights/market-insights/wmr/wmr.json',
    allow_patterns: ['/insights/', '/market-insights/']
  },
  {
    code: 'db_research',
    name: 'DB Research',
    base_url: 'https://research.db.com',
    access_mode: 'restricted',
    restricted_url: 'https://research.db.com/research/Register',
    allow_patterns: []
  },
  {
    code: 'morgan_stanley',
    name: 'Morgan Stanley',
    base_url: 'https://www.morganstanley.com',
    access_mode: 'public',
    sitemap_urls: ['https://www.morganstanley.com/sitemap.xml'],
    allow_patterns: ['/ideas/', '/insights/articles/']
  },
  {
    code: 'citadel_securities',
    name: 'Citadel Securities',
    base_url: 'https://www.citadelsecurities.com',
    access_mode: 'public',
    sitemap_urls: ['https://www.citadelsecurities.com/post-sitemap.xml'],
    allow_patterns: ['/news-and-insights/', '/insights/']
  },
  {
    code: 'apollo_academy',
    name: 'Apollo Academy',
    base_url: 'https://www.apolloacademy.com',
    access_mode: 'public',
    sitemap_urls: ['https://www.apolloacademy.com/post-sitemap.xml', 'https://www.apolloacademy.com/post-sitemap2.xml'],
    allow_patterns: ['/daily-spark/', '/macro/', '/markets/', '/insights/']
  }
];

const TOPIC_TAXONOMY = {
  fed_policy: {
    label_zh: '美联储政策',
    keywords: ['federal reserve', 'fed', 'fomc', 'dot plot', 'policy rate', 'powell']
  },
  us_rates: {
    label_zh: '美国利率',
    keywords: ['treasury', 'yield', 'curve', '2s10s', 'term premium', 'duration']
  },
  inflation: {
    label_zh: '通胀',
    keywords: ['inflation', 'cpi', 'pce', 'core inflation', 'disinflation']
  },
  labor_market: {
    label_zh: '劳动力市场',
    keywords: ['labor market', 'employment', 'nonfarm payroll', 'nfp', 'unemployment', 'wage']
  },
  growth_recession: {
    label_zh: '增长与衰退',
    keywords: ['gdp', 'growth', 'recession', 'soft landing', 'hard landing']
  },
  fx: {
    label_zh: '外汇',
    keywords: ['dollar', 'usd', 'fx', 'eurusd', 'usdjpy', 'exchange rate']
  },
  commodities: {
    label_zh: '大宗商品',
    keywords: ['oil', 'crude', 'gas', 'gold', 'copper', 'commodity']
  },
  equity_strategy: {
    label_zh: '股票策略',
    keywords: ['equity', 's&p 500', 'valuation', 'earnings', 'risk premium']
  },
  china_macro: {
    label_zh: '中国宏观',
    keywords: ['china', 'pboC', 'renminbi', 'rmb', 'beijing']
  },
  europe_macro: {
    label_zh: '欧洲宏观',
    keywords: ['ecb', 'euro area', 'europe', 'bund', 'boe']
  },
  geopolitics: {
    label_zh: '地缘政治',
    keywords: ['tariff', 'sanction', 'geopolitical', 'middle east', 'russia', 'ukraine']
  },
  thematic: {
    label_zh: '主题研究',
    keywords: ['ai', 'energy transition', 'technology', 'demographics', 'productivity']
  },
  macro_general: {
    label_zh: '宏观综合',
    keywords: ['macro', 'market', 'outlook', 'forecast', 'economy']
  }
};

const TOPIC_CODES = Object.keys(TOPIC_TAXONOMY);
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const RESEARCH_DISCLAIMER = '内容仅用于研究信息整理，不构成投资建议；中文为机器翻译摘要，请以原文为准。';

const runtime = {
  schedulerStarted: false,
  activeRunId: null
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      if (!Number.isFinite(code)) return '';
      try {
        return String.fromCharCode(code);
      } catch {
        return '';
      }
    });
}

function stripTags(html) {
  return sanitizeWhitespace(decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ' ')));
}

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    u.hash = '';
    const removable = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'mc_cid',
      'mc_eid'
    ];
    for (const key of removable) {
      u.searchParams.delete(key);
    }
    const entries = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of entries) {
      u.searchParams.append(k, v);
    }
    if (u.pathname.length > 1) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return String(rawUrl || '').trim();
  }
}

function parseDateToIso(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const plain = raw.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (plain) {
    const year = Number(plain[1]);
    const month = Number(plain[2]);
    const day = Number(plain[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  }

  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  const m = raw.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function guessDateFromUrl(url) {
  const s = String(url || '');
  const m = s.match(/\b(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})\b/);
  if (!m) return null;
  return parseDateToIso(`${m[1]}-${m[2]}-${m[3]}`);
}

function extractMetaContent(html, pattern) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${pattern}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const m = html.match(re);
  return m ? sanitizeWhitespace(decodeHtmlEntities(m[1])) : '';
}

function extractTitleFromHtml(html) {
  const og = extractMetaContent(html, 'og:title');
  if (og) return og;

  const twitter = extractMetaContent(html, 'twitter:title');
  if (twitter) return twitter;

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const clean = stripTags(title[1]);
    if (clean) return clean;
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const clean = stripTags(h1[1]);
    if (clean) return clean;
  }

  return '';
}

function parseJsonFromText(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function extractPublishedDateFromHtml(html, url) {
  const directCandidates = [
    extractMetaContent(html, 'article:published_time'),
    extractMetaContent(html, 'og:published_time'),
    extractMetaContent(html, 'publish_date'),
    extractMetaContent(html, 'date')
  ].filter(Boolean);

  for (const item of directCandidates) {
    const iso = parseDateToIso(item);
    if (iso) return iso;
  }

  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    const parsed = parseJsonFromText(script[1]);
    if (!parsed) continue;
    const stack = Array.isArray(parsed) ? parsed : [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      const maybeDate = node.datePublished || node.dateCreated || node.uploadDate;
      const iso = parseDateToIso(maybeDate);
      if (iso) return iso;
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') stack.push(value);
      }
    }
  }

  return guessDateFromUrl(url);
}

function extractParagraphs(html) {
  const noScript = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const chunks = [];
  for (const m of noScript.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const cleaned = stripTags(m[1]);
    if (cleaned.length >= 45) {
      chunks.push(cleaned);
    }
  }

  if (chunks.length) {
    return chunks.slice(0, 80);
  }

  const article = noScript.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (!article) return [];
  const text = stripTags(article[1]);
  return text
    .split(/(?<=[.!?。；;])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 45)
    .slice(0, 80);
}

function absolutizeUrl(src, baseUrl) {
  if (!src) return '';
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return '';
  }
}

function extractImages(html, pageUrl) {
  const images = [];
  for (const m of String(html || '').matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const full = absolutizeUrl(m[1], pageUrl);
    if (!full || full.startsWith('data:')) continue;
    const lower = full.toLowerCase();
    const isChartLike = /chart|figure|graph|infographic/.test(lower);
    images.push({ url: full, chart_candidate: isChartLike });
  }

  const seen = new Set();
  const deduped = [];
  for (const img of images) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    deduped.push(img);
  }
  return deduped.slice(0, 24);
}

function scoreParagraph(paragraph) {
  const text = String(paragraph || '');
  if (!text) return 0;
  const lengthScore = Math.min(240, text.length);
  const numericScore = (text.match(/\d+/g) || []).length * 8;
  const pctScore = (text.match(/%/g) || []).length * 14;
  return lengthScore + numericScore + pctScore;
}

function pickKeyParagraphs(paragraphs, maxCount = 5) {
  const indexed = (paragraphs || []).map((text, idx) => ({ idx, text, score: scoreParagraph(text) }));
  indexed.sort((a, b) => b.score - a.score);
  const picked = indexed.slice(0, Math.max(1, maxCount)).sort((a, b) => a.idx - b.idx).map((x) => x.text);
  return picked;
}

function classifyTopics(text, maxCount = 3) {
  const raw = String(text || '').toLowerCase();
  const scored = [];
  for (const [code, meta] of Object.entries(TOPIC_TAXONOMY)) {
    const score = meta.keywords.reduce((acc, keyword) => acc + (raw.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length, 0);
    if (score > 0) {
      scored.push({ code, score });
    }
  }
  if (!scored.length) {
    return ['macro_general'];
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map((x) => x.code);
}

function hashContent(parts) {
  const h = crypto.createHash('sha256');
  h.update(parts.map((x) => String(x || '')).join('\n---\n'));
  return h.digest('hex');
}

async function fetchText(url, timeoutMs = 25000) {
  const resp = await axios.get(url, {
    timeout: timeoutMs,
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0; +https://localhost)'
    }
  });
  return String(resp.data || '');
}

function extractUrlsFromSitemapXml(xml) {
  const urls = [];
  for (const m of String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    const u = decodeHtmlEntities(m[1]);
    if (u && /^https?:\/\//i.test(u)) urls.push(u.trim());
  }
  return urls;
}

function limitUnique(items, limit) {
  const seen = new Set();
  const out = [];
  for (const raw of items || []) {
    const u = normalizeUrl(raw);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

async function discoverFromSitemaps(config, limitPerSource) {
  const urls = [];
  for (const sitemapUrl of config.sitemap_urls || []) {
    try {
      const xml = await fetchText(sitemapUrl);
      const found = extractUrlsFromSitemapXml(xml);
      for (const url of found) {
        const allowed = (config.allow_patterns || []).some((p) => url.includes(p));
        if (allowed) urls.push(url);
      }
    } catch {
      // continue other sitemap urls
    }
  }
  return limitUnique(urls, limitPerSource);
}

async function discoverJpmInsights(config, limitPerSource) {
  const links = [];

  try {
    const html = await fetchText(config.discovery_page);
    for (const m of html.matchAll(/https:\/\/am\.jpmorgan\.com[^"'\s<]+/g)) {
      const url = decodeHtmlEntities(m[0]).replace(/['">]+$/, '');
      const allowed = (config.allow_patterns || []).some((p) => url.includes(p));
      if (allowed) links.push(url);
    }
  } catch {
    // ignore
  }

  try {
    const jsonRaw = await fetchText(config.insights_json);
    const parsed = parseJsonFromText(jsonRaw);
    if (parsed && parsed.ctaDestination) {
      links.push(absolutizeUrl(parsed.ctaDestination, config.base_url));
    }

    for (const m of String(jsonRaw).matchAll(/"ctaDestination"\s*:\s*"([^"]+)"/g)) {
      links.push(absolutizeUrl(decodeHtmlEntities(m[1]), config.base_url));
    }
  } catch {
    // ignore
  }

  return limitUnique(links, limitPerSource);
}

async function discoverUrlsForSource(config, limitPerSource) {
  if (config.access_mode === 'restricted') {
    return [config.restricted_url || config.base_url].filter(Boolean);
  }

  if (config.code === 'jpm_am') {
    return discoverJpmInsights(config, limitPerSource);
  }

  return discoverFromSitemaps(config, limitPerSource);
}

function buildTranslationPrompt(input) {
  const topicList = TOPIC_CODES.join(', ');
  return `你是资深宏观与金融市场研究助理。请基于以下英文材料输出中文结构化结果。\n\n要求：\n1) 输出简体中文。\n2) 仅返回严格 JSON。\n3) JSON 格式：\n{\n  "summary_zh": "2-4句摘要",\n  "highlights_zh": ["要点1", "要点2", "要点3"],\n  "key_paragraphs_zh": ["关键段翻译1", "关键段翻译2", "关键段翻译3"],\n  "topics": ["topic_code_1", "topic_code_2"]\n}\n4) topics 必须从以下枚举中选择：${topicList}\n5) 不要翻译图表图片；只处理文本。\n\n元信息：\n- 机构: ${input.sourceName}\n- 标题: ${input.titleEn}\n- 日期: ${input.publishedAt || 'unknown'}\n- 规则主题候选: ${(input.ruleTopics || []).join(', ')}\n\n英文摘要素材：\n${input.rawExcerpt}\n\n关键段原文：\n${(input.keyParagraphs || []).map((p, i) => `[${i + 1}] ${p}`).join('\n\n')}`;
}

function fallbackChineseSummary(article, topics) {
  const summary = `自动翻译暂不可用，建议先阅读原文。已按规则分类为：${(topics || []).join('、')}。`;
  const highlights = [
    `标题：${article.title_en || '未知标题'}`,
    `发布日期：${article.published_at || '未知日期'}`,
    '请点击原文链接查看完整内容。'
  ];
  const keyParagraphsZh = (article.key_paragraphs_en || []).slice(0, 3).map((x, idx) => `关键段${idx + 1}（英文原文）：${x}`);
  return {
    summary_zh: summary,
    highlights_zh: highlights,
    key_paragraphs_zh: keyParagraphsZh,
    topics
  };
}

async function translateWithOpenAI(article, ruleTopics) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackChineseSummary(article, ruleTopics);
  }

  const prompt = buildTranslationPrompt({
    sourceName: article.source_name,
    titleEn: article.title_en,
    publishedAt: article.published_at,
    ruleTopics,
    rawExcerpt: article.raw_excerpt_en || '',
    keyParagraphs: article.key_paragraphs_en || []
  });

  try {
    const resp = await axios.post(
      `${OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      {
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are a macro research analyst assistant.' },
          { role: 'user', content: prompt }
        ]
      },
      {
        timeout: 60000,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = resp?.data?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonFromText(content);
    if (!parsed || typeof parsed !== 'object') {
      return fallbackChineseSummary(article, ruleTopics);
    }

    const summary_zh = sanitizeWhitespace(parsed.summary_zh || '');
    const highlights_zh = Array.isArray(parsed.highlights_zh)
      ? parsed.highlights_zh.map((x) => sanitizeWhitespace(x)).filter(Boolean).slice(0, 6)
      : [];
    const key_paragraphs_zh = Array.isArray(parsed.key_paragraphs_zh)
      ? parsed.key_paragraphs_zh.map((x) => sanitizeWhitespace(x)).filter(Boolean).slice(0, 6)
      : [];

    let topics = Array.isArray(parsed.topics)
      ? parsed.topics.map((x) => String(x)).filter((x) => TOPIC_CODES.includes(x)).slice(0, 3)
      : [];

    if (!topics.length) topics = ruleTopics;

    return {
      summary_zh: summary_zh || fallbackChineseSummary(article, ruleTopics).summary_zh,
      highlights_zh: highlights_zh.length ? highlights_zh : fallbackChineseSummary(article, ruleTopics).highlights_zh,
      key_paragraphs_zh: key_paragraphs_zh.length ? key_paragraphs_zh : fallbackChineseSummary(article, ruleTopics).key_paragraphs_zh,
      topics
    };
  } catch {
    return fallbackChineseSummary(article, ruleTopics);
  }
}

function buildPartialRecord({ source, url, title, publishedAt, topics, reason }) {
  const normalized = normalizeUrl(url);
  return {
    source_code: source.code,
    source_name: source.name,
    url,
    original_url: url,
    canonical_url: normalized,
    title_en: title || 'Untitled',
    published_at: publishedAt || new Date().toISOString().slice(0, 10),
    topics: topics && topics.length ? topics : ['macro_general'],
    summary_zh: `正文抽取不完整（${reason || 'unknown'}），请点击原文查看。`,
    highlights_zh: ['正文抽取失败或内容受限。', '已保留元信息与原文链接。'],
    key_paragraphs_zh: [],
    raw_excerpt_en: '',
    images: [],
    content_hash: hashContent([url, title || '', publishedAt || '']),
    status: 'partial',
    disclaimer: RESEARCH_DISCLAIMER
  };
}

function extractArticlePayload(config, url, html) {
  const title = extractTitleFromHtml(html) || 'Untitled';
  const publishedAt = extractPublishedDateFromHtml(html, url) || new Date().toISOString().slice(0, 10);
  const paragraphs = extractParagraphs(html);
  const rawExcerpt = paragraphs.slice(0, 10).join('\n\n').slice(0, 12000);
  const keyParagraphsEn = pickKeyParagraphs(paragraphs, 5);
  const ruleTopics = classifyTopics(`${title}\n${rawExcerpt}`, 3);
  const images = extractImages(html, url);

  return {
    source_code: config.code,
    source_name: config.name,
    url,
    original_url: url,
    canonical_url: normalizeUrl(url),
    title_en: title,
    published_at: publishedAt,
    topics: ruleTopics,
    raw_excerpt_en: rawExcerpt,
    key_paragraphs_en: keyParagraphsEn,
    images,
    disclaimer: RESEARCH_DISCLAIMER
  };
}

async function insertRunLog(supabase, log) {
  try {
    await supabase.from('research_run_logs').insert(log);
  } catch {
    // ignore log failures to keep pipeline moving
  }
}

async function ensureSourcesSeeded(supabase) {
  const seed = SOURCE_CATALOG.map((s) => ({
    code: s.code,
    name: s.name,
    base_url: s.base_url,
    access_mode: s.access_mode,
    enabled: true,
    status_note: s.access_mode === 'restricted' ? '该来源需要登录，首版仅展示外链状态' : 'ready'
  }));

  const { error } = await supabase.from('research_sources').upsert(seed, { onConflict: 'code' });
  if (error) throw error;
}

function buildEmptyStats(sourceCodes) {
  const bySource = {};
  for (const code of sourceCodes) {
    bySource[code] = {
      discovered: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      restricted: 0,
      partial: 0
    };
  }
  return {
    total: {
      discovered: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      restricted: 0,
      partial: 0
    },
    by_source: bySource
  };
}

function bumpStats(stats, sourceCode, field, value = 1) {
  if (!stats.by_source[sourceCode]) {
    stats.by_source[sourceCode] = {
      discovered: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      restricted: 0,
      partial: 0
    };
  }
  stats.by_source[sourceCode][field] += value;
  stats.total[field] += value;
}

async function processSource({
  supabase,
  runId,
  source,
  force,
  limitPerSource,
  stats
}) {
  if (source.access_mode === 'restricted') {
    bumpStats(stats, source.code, 'restricted', 1);
    await insertRunLog(supabase, {
      run_id: runId,
      source_code: source.code,
      url: source.restricted_url || source.base_url,
      stage: 'discover',
      status: 'restricted',
      message: 'source requires login; only external link is retained'
    });

    await supabase
      .from('research_sources')
      .update({
        last_checked_at: new Date().toISOString(),
        status: 'restricted',
        status_note: '需要注册/登录，仅展示外链状态'
      })
      .eq('code', source.code);

    return;
  }

  let urls = [];
  try {
    urls = await discoverUrlsForSource(source, limitPerSource);
  } catch (error) {
    await insertRunLog(supabase, {
      run_id: runId,
      source_code: source.code,
      url: source.base_url,
      stage: 'discover',
      status: 'error',
      message: error.message || String(error)
    });
    bumpStats(stats, source.code, 'failed', 1);
    await supabase
      .from('research_sources')
      .update({
        last_checked_at: new Date().toISOString(),
        status: 'error',
        status_note: `discover failed: ${String(error.message || error).slice(0, 240)}`
      })
      .eq('code', source.code);
    return;
  }

  bumpStats(stats, source.code, 'discovered', urls.length);

  for (const url of urls) {
    await insertRunLog(supabase, {
      run_id: runId,
      source_code: source.code,
      url,
      stage: 'fetch',
      status: 'running',
      message: 'fetching article'
    });

    try {
      let html = '';
      try {
        html = await fetchText(url);
      } catch (error) {
        const partial = buildPartialRecord({
          source,
          url,
          title: '',
          publishedAt: guessDateFromUrl(url),
          topics: ['macro_general'],
          reason: `fetch error: ${String(error.message || error).slice(0, 120)}`
        });

        const { error: upsertErr } = await supabase.from('research_items').upsert(partial, { onConflict: 'canonical_url' });
        if (upsertErr) throw upsertErr;

        bumpStats(stats, source.code, 'partial', 1);
        await insertRunLog(supabase, {
          run_id: runId,
          source_code: source.code,
          url,
          stage: 'extract',
          status: 'partial',
          message: 'failed to fetch; inserted partial metadata'
        });
        continue;
      }

      const article = extractArticlePayload(source, url, html);
      const contentHash = hashContent([
        article.title_en,
        article.published_at,
        article.raw_excerpt_en,
        JSON.stringify(article.images)
      ]);

      const { data: existing, error: existingErr } = await supabase
        .from('research_items')
        .select('id,content_hash')
        .eq('canonical_url', article.canonical_url)
        .maybeSingle();
      if (existingErr) throw existingErr;

      if (existing && !force && existing.content_hash === contentHash) {
        bumpStats(stats, source.code, 'skipped', 1);
        await insertRunLog(supabase, {
          run_id: runId,
          source_code: source.code,
          url,
          stage: 'dedupe',
          status: 'skipped',
          message: 'content hash unchanged'
        });
        continue;
      }

      if (!article.raw_excerpt_en || article.raw_excerpt_en.length < 80) {
        const partial = buildPartialRecord({
          source,
          url,
          title: article.title_en,
          publishedAt: article.published_at,
          topics: article.topics,
          reason: 'insufficient text'
        });

        partial.images = article.images;

        const { error: upsertErr } = await supabase.from('research_items').upsert(partial, { onConflict: 'canonical_url' });
        if (upsertErr) throw upsertErr;

        bumpStats(stats, source.code, 'partial', 1);
        continue;
      }

      const translated = await translateWithOpenAI(article, article.topics);

      const payload = {
        source_code: source.code,
        source_name: source.name,
        url,
        original_url: url,
        canonical_url: article.canonical_url,
        title_en: article.title_en,
        published_at: article.published_at,
        topics: translated.topics && translated.topics.length ? translated.topics : article.topics,
        summary_zh: translated.summary_zh,
        highlights_zh: translated.highlights_zh,
        key_paragraphs_zh: translated.key_paragraphs_zh,
        raw_excerpt_en: article.raw_excerpt_en,
        images: article.images,
        content_hash: contentHash,
        status: 'ok',
        disclaimer: RESEARCH_DISCLAIMER,
        updated_at: new Date().toISOString()
      };

      const { error: upsertErr } = await supabase.from('research_items').upsert(payload, { onConflict: 'canonical_url' });
      if (upsertErr) throw upsertErr;

      if (existing) {
        bumpStats(stats, source.code, 'updated', 1);
      } else {
        bumpStats(stats, source.code, 'inserted', 1);
      }

      await insertRunLog(supabase, {
        run_id: runId,
        source_code: source.code,
        url,
        stage: 'store',
        status: 'ok',
        message: existing ? 'updated existing record' : 'inserted new record'
      });

      // mild pacing to reduce source burst and API burst.
      await sleep(250);
    } catch (error) {
      bumpStats(stats, source.code, 'failed', 1);
      await insertRunLog(supabase, {
        run_id: runId,
        source_code: source.code,
        url,
        stage: 'pipeline',
        status: 'error',
        message: String(error.message || error).slice(0, 400)
      });
    }
  }

  await supabase
    .from('research_sources')
    .update({
      last_checked_at: new Date().toISOString(),
      status: 'ok',
      status_note: `processed ${urls.length} urls`
    })
    .eq('code', source.code);
}

async function runResearchPipeline({
  getSupabaseClient,
  runId,
  requestedSourceCodes,
  force,
  limitPerSource
}) {
  const supabase = getSupabaseClient();

  const selected = SOURCE_CATALOG.filter((s) => {
    if (!requestedSourceCodes || !requestedSourceCodes.length) return true;
    return requestedSourceCodes.includes(s.code);
  });

  const stats = buildEmptyStats(selected.map((s) => s.code));

  for (const source of selected) {
    await processSource({
      supabase,
      runId,
      source,
      force,
      limitPerSource,
      stats
    });
  }

  return stats;
}

async function startResearchRun({ getSupabaseClient, triggerType, requestedSourceCodes, force, limitPerSource }) {
  const supabase = getSupabaseClient();

  if (runtime.activeRunId) {
    return { runId: runtime.activeRunId, status: 'running' };
  }

  const { data: runningRow } = await supabase
    .from('research_runs')
    .select('id,status,started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runningRow?.id) {
    runtime.activeRunId = runningRow.id;
    return { runId: runningRow.id, status: 'running' };
  }

  await ensureSourcesSeeded(supabase);

  const runPayload = {
    trigger_type: triggerType || 'manual',
    status: 'running',
    started_at: new Date().toISOString(),
    stats: {
      requested_sources: requestedSourceCodes || [],
      force: !!force,
      limit_per_source: limitPerSource
    },
    error_message: null
  };

  const { data: createdRun, error: createErr } = await supabase
    .from('research_runs')
    .insert(runPayload)
    .select('*')
    .single();
  if (createErr) throw createErr;

  const runId = createdRun.id;
  runtime.activeRunId = runId;

  setImmediate(async () => {
    const supabaseBg = getSupabaseClient();
    try {
      const stats = await runResearchPipeline({
        getSupabaseClient,
        runId,
        requestedSourceCodes,
        force,
        limitPerSource
      });

      await supabaseBg
        .from('research_runs')
        .update({
          status: 'finished',
          ended_at: new Date().toISOString(),
          stats,
          error_message: null
        })
        .eq('id', runId);
    } catch (error) {
      await supabaseBg
        .from('research_runs')
        .update({
          status: 'failed',
          ended_at: new Date().toISOString(),
          error_message: String(error.message || error).slice(0, 400)
        })
        .eq('id', runId);
    } finally {
      runtime.activeRunId = null;
    }
  });

  return { runId, status: 'running' };
}

function parseArrayField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return [];
  }
  return [];
}

function requireAdminKey(req, res) {
  const expected = process.env.ADMIN_UPDATE_KEY;
  if (!expected) {
    res.status(500).json({ ok: false, error: 'ADMIN_UPDATE_KEY 未配置' });
    return false;
  }

  const got = String(req.headers['x-admin-key'] || '');
  if (!got || got !== expected) {
    res.status(401).json({ ok: false, error: '管理员密钥无效' });
    return false;
  }

  return true;
}

async function getSourceMap(supabase) {
  const { data } = await supabase.from('research_sources').select('code,name,access_mode,status,last_checked_at,status_note').order('name', { ascending: true });
  const map = new Map();
  for (const row of data || []) {
    map.set(row.code, row);
  }
  return map;
}

function toPositiveInt(value, fallback, min = 1, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function mapItemForList(row, sourceMap) {
  const source = sourceMap.get(row.source_code) || { code: row.source_code, name: row.source_name || row.source_code };
  return {
    id: row.id,
    source: {
      code: source.code,
      name: source.name
    },
    title_en: row.title_en,
    published_at: row.published_at,
    topics: row.topics || [],
    summary_zh: row.summary_zh,
    original_url: row.original_url || row.url,
    has_translation: row.status === 'ok',
    status: row.status,
    updated_at: row.updated_at
  };
}

function registerResearchRoutes({ app, getSupabaseClient }) {
  app.get('/api/research/items', async (req, res) => {
    try {
      const supabase = getSupabaseClient();
      const source = req.query.source ? String(req.query.source) : '';
      const topic = req.query.topic ? String(req.query.topic) : '';
      const from = req.query.from ? String(req.query.from) : '';
      const to = req.query.to ? String(req.query.to) : '';
      const q = req.query.q ? String(req.query.q).trim() : '';
      const sort = req.query.sort ? String(req.query.sort) : 'published_desc';
      const page = toPositiveInt(req.query.page, 1, 1, 5000);
      const pageSize = toPositiveInt(req.query.pageSize, 20, 1, 100);

      let query = supabase
        .from('research_items')
        .select('id,source_code,source_name,title_en,published_at,topics,summary_zh,original_url,url,status,updated_at', { count: 'exact' });

      if (source) query = query.eq('source_code', source);
      if (topic) query = query.contains('topics', [topic]);
      if (from) query = query.gte('published_at', from);
      if (to) query = query.lte('published_at', to);
      if (q) {
        const escaped = q.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
        if (escaped) {
          query = query.or(`title_en.ilike.%${escaped}%,summary_zh.ilike.%${escaped}%`);
        }
      }

      if (sort === 'published_asc') {
        query = query.order('published_at', { ascending: true }).order('id', { ascending: true });
      } else {
        query = query.order('published_at', { ascending: false }).order('id', { ascending: false });
      }

      const fromRow = (page - 1) * pageSize;
      const toRow = fromRow + pageSize - 1;
      query = query.range(fromRow, toRow);

      const [{ data, error, count }, sourceMap] = await Promise.all([
        query,
        getSourceMap(supabase)
      ]);

      if (error) throw error;

      const items = (data || []).map((row) => mapItemForList(row, sourceMap));

      res.json({
        ok: true,
        result: {
          items,
          pagination: {
            page,
            pageSize,
            total: count || 0,
            totalPages: Math.max(1, Math.ceil((count || 0) / pageSize))
          }
        }
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.get('/api/research/items/:id', async (req, res) => {
    try {
      const supabase = getSupabaseClient();
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ ok: false, error: '无效 id' });
      }

      const { data: row, error } = await supabase
        .from('research_items')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!row) return res.status(404).json({ ok: false, error: '记录不存在' });

      const { data: sourceRow } = await supabase
        .from('research_sources')
        .select('code,name,access_mode,status,status_note,last_checked_at')
        .eq('code', row.source_code)
        .maybeSingle();

      const result = {
        id: row.id,
        source: {
          code: row.source_code,
          name: row.source_name || sourceRow?.name || row.source_code
        },
        title_en: row.title_en,
        published_at: row.published_at,
        topics: row.topics || [],
        summary_zh: row.summary_zh,
        highlights_zh: parseArrayField(row.highlights_zh),
        key_paragraphs_zh: parseArrayField(row.key_paragraphs_zh),
        images: parseArrayField(row.images),
        raw_excerpt_en: row.raw_excerpt_en || '',
        original_url: row.original_url || row.url,
        disclaimer: row.disclaimer || RESEARCH_DISCLAIMER,
        source_status: sourceRow?.status || 'unknown',
        status: row.status,
        updated_at: row.updated_at
      };

      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.get('/api/research/facets', async (req, res) => {
    try {
      const supabase = getSupabaseClient();

      const [{ data: sources }, { data: rows, count }] = await Promise.all([
        supabase
          .from('research_sources')
          .select('code,name,access_mode,enabled,status,last_checked_at,status_note')
          .order('name', { ascending: true }),
        supabase
          .from('research_items')
          .select('topics,published_at', { count: 'exact' })
          .order('published_at', { ascending: false })
          .limit(5000)
      ]);

      const topicSet = new Set();
      let minDate = null;
      let maxDate = null;

      for (const row of rows || []) {
        for (const t of row.topics || []) topicSet.add(t);
        const d = row.published_at;
        if (!d) continue;
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }

      const topics = Array.from(topicSet)
        .sort((a, b) => a.localeCompare(b))
        .map((code) => ({
          code,
          label_zh: TOPIC_TAXONOMY[code]?.label_zh || code
        }));

      res.json({
        ok: true,
        result: {
          sources: sources || [],
          topics,
          date_range: {
            from: minDate,
            to: maxDate
          },
          total_items: count || 0
        }
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.post('/api/research/update', async (req, res) => {
    try {
      if (!requireAdminKey(req, res)) return;

      const payload = req.body || {};
      const requestedSourceCodes = Array.isArray(payload.sources)
        ? payload.sources.map((x) => String(x)).filter((x) => SOURCE_CATALOG.some((s) => s.code === x))
        : [];
      const force = !!payload.force;
      const limitPerSource = toPositiveInt(payload.limitPerSource, RESEARCH_DEFAULT_LIMIT, 1, 100);

      const result = await startResearchRun({
        getSupabaseClient,
        triggerType: 'manual',
        requestedSourceCodes,
        force,
        limitPerSource
      });

      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.get('/api/research/runs/latest', async (req, res) => {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('research_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      res.json({ ok: true, result: data || null });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.get('/api/research/runs/:runId', async (req, res) => {
    try {
      const runId = req.params.runId;
      const supabase = getSupabaseClient();

      const [{ data: run, error: runErr }, { data: logs, error: logsErr }] = await Promise.all([
        supabase.from('research_runs').select('*').eq('id', runId).maybeSingle(),
        supabase
          .from('research_run_logs')
          .select('source_code,url,stage,status,message,created_at')
          .eq('run_id', runId)
          .order('created_at', { ascending: false })
          .limit(400)
      ]);

      if (runErr) throw runErr;
      if (logsErr) throw logsErr;
      if (!run) return res.status(404).json({ ok: false, error: 'run 不存在' });

      res.json({
        ok: true,
        result: {
          run,
          logs: logs || []
        }
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });

  app.get('/api/research/sources', async (req, res) => {
    try {
      const supabase = getSupabaseClient();
      await ensureSourcesSeeded(supabase);
      const { data, error } = await supabase
        .from('research_sources')
        .select('code,name,base_url,access_mode,enabled,status,last_checked_at,status_note')
        .order('name', { ascending: true });
      if (error) throw error;
      res.json({ ok: true, result: data || [] });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || String(error) });
    }
  });
}

function startResearchScheduler({ getSupabaseClient }) {
  if (runtime.schedulerStarted) return;
  runtime.schedulerStarted = true;

  cron.schedule(
    RESEARCH_CRON_EXPR,
    async () => {
      try {
        await startResearchRun({
          getSupabaseClient,
          triggerType: 'scheduled',
          requestedSourceCodes: [],
          force: false,
          limitPerSource: RESEARCH_DEFAULT_LIMIT
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[research] scheduled run failed to start:', error.message || String(error));
      }
    },
    { timezone: RESEARCH_CRON_TZ }
  );

  // eslint-disable-next-line no-console
  console.log(`[research] scheduler enabled: ${RESEARCH_CRON_EXPR} (${RESEARCH_CRON_TZ})`);
}

module.exports = {
  registerResearchRoutes,
  startResearchScheduler,
  _internals: {
    normalizeUrl,
    parseDateToIso,
    extractPublishedDateFromHtml,
    classifyTopics,
    parseJsonFromText,
    extractArticlePayload,
    pickKeyParagraphs,
    decodeHtmlEntities,
    extractUrlsFromSitemapXml,
    limitUnique
  }
};
