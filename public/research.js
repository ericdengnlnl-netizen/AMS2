const state = {
  filters: {
    source: '',
    topic: '',
    from: '',
    to: '',
    q: ''
  },
  items: [],
  pagination: {
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1
  },
  selectedId: null,
  facets: null,
  sourceStatus: [],
  currentRunId: null,
  pollingTimer: null
};

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#b0352f' : '#1f2022';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2600);
}

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function request(url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
  } catch (error) {
    throw new Error(`请求失败(${url}): ${error.message || String(error)}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`接口返回非JSON(${url})`);
  }

  if (!resp.ok || !data.ok) {
    throw new Error(`${data.error || `请求失败: ${resp.status}`} (${url})`);
  }

  return data.result;
}

function setSelectOptions(selectEl, options, selectedValue, allLabel = '全部') {
  const before = [`<option value="">${allLabel}</option>`];
  const html = options
    .map((opt) => {
      const value = escapeHtml(opt.value);
      const label = escapeHtml(opt.label);
      const selected = opt.value === selectedValue ? 'selected' : '';
      return `<option value="${value}" ${selected}>${label}</option>`;
    })
    .join('');
  selectEl.innerHTML = before.join('') + html;
  selectEl.value = selectedValue || '';
}

function statusClass(status) {
  if (status === 'ok' || status === 'finished') return 'ok';
  if (status === 'restricted') return 'restricted';
  if (status === 'partial') return 'partial';
  return 'error';
}

function topicLabel(code) {
  const found = (state.facets?.topics || []).find((x) => x.code === code);
  return found?.label_zh || code;
}

function updateFilterValuesFromUI() {
  state.filters.source = document.getElementById('sourceFilter').value || '';
  state.filters.topic = document.getElementById('topicFilter').value || '';
  state.filters.from = document.getElementById('fromFilter').value || '';
  state.filters.to = document.getElementById('toFilter').value || '';
  state.filters.q = document.getElementById('searchInput').value.trim();
}

function renderSourceHint() {
  const hint = document.getElementById('sourceHint');
  const rows = state.sourceStatus || [];
  if (!rows.length) {
    hint.textContent = '数据源状态: --';
    return;
  }

  const text = rows
    .map((row) => `${row.name}:${row.status || 'idle'}`)
    .join(' | ');
  hint.textContent = `数据源状态: ${text}`;
}

function renderList() {
  const list = document.getElementById('listContainer');
  list.innerHTML = '';

  if (!state.items.length) {
    list.innerHTML = '<div class="detail-empty">暂无数据，请点击“立即更新”。</div>';
    document.getElementById('countHint').textContent = '0 条';
    document.getElementById('pageInfo').textContent = '--';
    return;
  }

  for (const item of state.items) {
    const card = document.createElement('article');
    card.className = `item-card ${item.id === state.selectedId ? 'active' : ''}`;
    card.dataset.id = String(item.id);

    const badges = (item.topics || [])
      .map((t) => `<span class="badge">${escapeHtml(topicLabel(t))}</span>`)
      .join('');

    card.innerHTML = `
      <div class="item-meta">
        <span>${escapeHtml(item.source.name)} | ${escapeHtml(item.published_at || '--')}</span>
        <span class="status-chip ${statusClass(item.status)}">${escapeHtml(item.status)}</span>
      </div>
      <div class="item-title">${escapeHtml(item.title_en || 'Untitled')}</div>
      <p class="item-summary">${escapeHtml(item.summary_zh || '无摘要')}</p>
      <div class="badge-wrap">${badges}</div>
    `;

    card.addEventListener('click', async () => {
      state.selectedId = item.id;
      renderList();
      await loadDetail(item.id);
    });

    list.appendChild(card);
  }

  document.getElementById('countHint').textContent = `${state.pagination.total} 条`;
  document.getElementById('pageInfo').textContent = `第 ${state.pagination.page} / ${state.pagination.totalPages} 页`;
}

function renderDetailEmpty() {
  document.getElementById('detailContainer').className = 'detail-empty';
  document.getElementById('detailContainer').textContent = '请选择左侧内容查看详情。';
}

function renderDetail(detail) {
  const container = document.getElementById('detailContainer');
  container.className = 'detail';

  const topics = (detail.topics || []).map((t) => `<span class="badge">${escapeHtml(topicLabel(t))}</span>`).join('');
  const highlights = (detail.highlights_zh || []).map((h) => `<li>${escapeHtml(h)}</li>`).join('');
  const keyParas = (detail.key_paragraphs_zh || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  const images = (detail.images || [])
    .slice(0, 8)
    .map((img, idx) => {
      const url = escapeHtml(img.url || '');
      const caption = img.chart_candidate ? '图表候选（不翻译）' : '图片';
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="image-${idx + 1}" /><div class="caption">${caption}</div></a>`;
    })
    .join('');

  container.innerHTML = `
    <h3>${escapeHtml(detail.title_en || 'Untitled')}</h3>
    <div class="meta">
      <span>${escapeHtml(detail.source.name)}</span>
      <span>${escapeHtml(detail.published_at || '--')}</span>
      <span class="status-chip ${statusClass(detail.source_status)}">来源状态: ${escapeHtml(detail.source_status || '--')}</span>
      <span class="status-chip ${statusClass(detail.status)}">内容状态: ${escapeHtml(detail.status || '--')}</span>
    </div>
    <div class="badge-wrap">${topics}</div>

    <h3>中文摘要</h3>
    <p>${escapeHtml(detail.summary_zh || '无摘要')}</p>

    <h3>要点</h3>
    <ul>${highlights || '<li>暂无</li>'}</ul>

    <h3>关键段翻译</h3>
    <ul>${keyParas || '<li>暂无</li>'}</ul>

    <h3>英文摘录</h3>
    <p>${escapeHtml(detail.raw_excerpt_en || '暂无')}</p>

    <h3>图片/图表</h3>
    <div class="image-grid">${images || '<div class="hint">暂无图片</div>'}</div>

    <p class="hint" style="margin-top: 12px;">${escapeHtml(detail.disclaimer || '')}</p>

    <div class="actions">
      <a class="btn" href="${escapeHtml(detail.original_url)}" target="_blank" rel="noopener noreferrer">阅读原文</a>
    </div>
  `;
}

async function loadFacetsAndSources() {
  const [facets, sourceStatus] = await Promise.all([
    request('/api/research/facets'),
    request('/api/research/sources')
  ]);

  state.facets = facets;
  state.sourceStatus = sourceStatus;

  setSelectOptions(
    document.getElementById('sourceFilter'),
    (facets.sources || []).map((s) => ({ value: s.code, label: s.name })),
    state.filters.source,
    '全部机构'
  );

  setSelectOptions(
    document.getElementById('topicFilter'),
    (facets.topics || []).map((t) => ({ value: t.code, label: t.label_zh })),
    state.filters.topic,
    '全部主题'
  );

  renderSourceHint();
}

function buildItemsQuery() {
  const p = new URLSearchParams();
  p.set('page', String(state.pagination.page));
  p.set('pageSize', String(state.pagination.pageSize));
  p.set('sort', 'published_desc');

  if (state.filters.source) p.set('source', state.filters.source);
  if (state.filters.topic) p.set('topic', state.filters.topic);
  if (state.filters.from) p.set('from', state.filters.from);
  if (state.filters.to) p.set('to', state.filters.to);
  if (state.filters.q) p.set('q', state.filters.q);

  return p.toString();
}

async function loadItems() {
  const result = await request(`/api/research/items?${buildItemsQuery()}`);
  state.items = result.items || [];
  state.pagination = result.pagination || state.pagination;

  if (!state.items.length) {
    state.selectedId = null;
    renderDetailEmpty();
  } else if (!state.selectedId || !state.items.some((x) => x.id === state.selectedId)) {
    state.selectedId = state.items[0].id;
    await loadDetail(state.selectedId);
  }

  renderList();
}

async function loadDetail(id) {
  if (!id) {
    renderDetailEmpty();
    return;
  }
  const detail = await request(`/api/research/items/${id}`);
  renderDetail(detail);
}

function getAdminKey() {
  return sessionStorage.getItem('research_admin_key') || '';
}

async function triggerUpdate() {
  let adminKey = getAdminKey();
  if (!adminKey) {
    adminKey = window.prompt('请输入管理员更新密钥（ADMIN_UPDATE_KEY）:') || '';
    if (!adminKey) return;
    sessionStorage.setItem('research_admin_key', adminKey);
  }

  const payload = {
    limitPerSource: 20,
    force: false
  };

  const result = await request('/api/research/update', {
    method: 'POST',
    headers: {
      'x-admin-key': adminKey
    },
    body: JSON.stringify(payload)
  });

  state.currentRunId = result.runId;
  showToast('更新任务已启动');
  startRunPolling();
}

function setLastSyncText(run) {
  const node = document.getElementById('lastSyncText');
  if (!run) {
    node.textContent = '最近更新: --';
    return;
  }

  const ended = run.ended_at || run.started_at;
  if (!ended) {
    node.textContent = `最近更新: ${run.status}`;
    return;
  }

  node.textContent = `最近更新: ${ended.slice(0, 19).replace('T', ' ')} (${run.status})`;
}

function stopRunPolling() {
  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }
}

function startRunPolling() {
  stopRunPolling();
  if (!state.currentRunId) return;

  const check = async () => {
    try {
      const result = await request(`/api/research/runs/${state.currentRunId}`);
      const run = result.run;
      setLastSyncText(run);
      if (run.status === 'finished') {
        stopRunPolling();
        showToast('更新完成');
        await loadFacetsAndSources();
        await loadItems();
      } else if (run.status === 'failed') {
        stopRunPolling();
        showToast(`更新失败: ${run.error_message || 'unknown'}`, true);
      }
    } catch (error) {
      stopRunPolling();
      showToast(error.message, true);
    }
  };

  check();
  state.pollingTimer = setInterval(check, 3500);
}

async function preloadLatestRunTime() {
  try {
    const result = await request('/api/research/runs/latest');
    if (result) {
      setLastSyncText(result);
      return;
    }
  } catch {
    // ignore
  }

  document.getElementById('lastSyncText').textContent = '最近更新: 尚无历史任务';
}

function bindEvents() {
  document.getElementById('searchBtn').addEventListener('click', async () => {
    try {
      updateFilterValuesFromUI();
      state.pagination.page = 1;
      await loadItems();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('searchInput').addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    try {
      updateFilterValuesFromUI();
      state.pagination.page = 1;
      await loadItems();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('prevBtn').addEventListener('click', async () => {
    if (state.pagination.page <= 1) return;
    try {
      state.pagination.page -= 1;
      await loadItems();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('nextBtn').addEventListener('click', async () => {
    if (state.pagination.page >= state.pagination.totalPages) return;
    try {
      state.pagination.page += 1;
      await loadItems();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById('updateBtn').addEventListener('click', async () => {
    try {
      await triggerUpdate();
    } catch (error) {
      if (String(error.message).includes('401')) {
        sessionStorage.removeItem('research_admin_key');
      }
      showToast(error.message, true);
    }
  });
}

(async function bootstrap() {
  bindEvents();
  try {
    await loadFacetsAndSources();
    await loadItems();
    await preloadLatestRunTime();
  } catch (error) {
    showToast(error.message, true);
  }
})();
