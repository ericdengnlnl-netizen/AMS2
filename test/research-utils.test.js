const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { _internals } = require('../research');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('normalizeUrl removes tracking params and hash', () => {
  const out = _internals.normalizeUrl('https://example.com/path/?utm_source=a&z=1#frag');
  assert.equal(out, 'https://example.com/path?z=1');
});

test('parseDateToIso parses different formats', () => {
  assert.equal(_internals.parseDateToIso('2026-2-9'), '2026-02-09');
  assert.equal(_internals.parseDateToIso('2026/02/10'), '2026-02-10');
  assert.equal(_internals.parseDateToIso('invalid-date'), null);
});

test('extractPublishedDateFromHtml prefers explicit meta date', () => {
  const html = fixture('sample_article.html');
  const date = _internals.extractPublishedDateFromHtml(html, 'https://example.com/x');
  assert.equal(date, '2026-02-15');
});

test('classifyTopics returns fixed taxonomy codes', () => {
  const text = 'The Federal Reserve and Treasury yield curve point to slower growth and inflation risks.';
  const topics = _internals.classifyTopics(text, 3);
  assert.ok(Array.isArray(topics));
  assert.ok(topics.length >= 1);
  for (const code of topics) {
    assert.ok(typeof code === 'string');
  }
});

test('extractArticlePayload extracts title/date/paragraphs/images', () => {
  const html = fixture('sample_article.html');
  const payload = _internals.extractArticlePayload(
    { code: 'test', name: 'Test Source' },
    'https://example.com/insights/articles/a-1',
    html
  );

  assert.equal(payload.title_en, 'Macro Outlook Weekly');
  assert.equal(payload.published_at, '2026-02-15');
  assert.ok(payload.raw_excerpt_en.includes('Federal Reserve'));
  assert.ok(payload.key_paragraphs_en.length >= 1);
  assert.ok(payload.images.length >= 1);
  assert.equal(payload.images[0].url, 'https://example.com/images/chart-1.png');
});

test('extractUrlsFromSitemapXml and limitUnique dedupe urls', () => {
  const xml = fixture('sample_sitemap.xml');
  const urls = _internals.extractUrlsFromSitemapXml(xml);
  assert.equal(urls.length, 4);

  const unique = _internals.limitUnique(urls, 10);
  assert.equal(unique.length, 3);
  assert.equal(unique[0], 'https://example.com/insights/articles/a-1');
});
