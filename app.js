'use strict';

const REFRESH_SECONDS = 300;
const CACHE_PREFIX = 'painel_mercado_v3_';
let secondsLeft = REFRESH_SECONDS;
let syncing = false;

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${fmt(n)}%`;
}

function pctClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'neutral';
  return n > 0 ? 'up' : 'down';
}

function arrow(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '• ';
  return n > 0 ? '▲ ' : '▼ ';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setKpi(id, value, pct = null, note = '') {
  const valueEl = document.getElementById(`${id}-val`);
  if (valueEl) {
    valueEl.textContent = value;
    valueEl.classList.remove('placeholder');
  }

  const pctEl = document.getElementById(`${id}-pct`);
  if (!pctEl) return;

  const n = Number(pct);
  if (pct !== null && pct !== undefined && Number.isFinite(n)) {
    pctEl.textContent = `${arrow(n)}${fmtPct(n)}`;
    pctEl.className = `kpi-box-delta ${pctClass(n)}`;
  } else {
    pctEl.textContent = note || '';
    pctEl.className = 'kpi-box-delta neutral';
  }
}

function setKpiUnavailable(id, note = 'Fonte indisponível') {
  setKpi(id, '—', null, note);
}

function setPanelMessage(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = `<div style="padding:16px;opacity:.72">${escapeHtml(message)}</div>`;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      savedAt: new Date().toISOString(),
      data,
    }));
  } catch (_) {}
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw)?.data ?? null : null;
  } catch (_) {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  return response.json();
}

async function fetchStaticJson(url, cacheKey) {
  try {
    const separator = url.includes('?') ? '&' : '?';
    const data = await fetchJson(`${url}${separator}v=${Date.now()}`, {}, 10000);
    writeCache(cacheKey, data);
    return { data, fromNetwork: true };
  } catch (error) {
    const cached = readCache(cacheKey);
    if (cached) return { data: cached, fromNetwork: false };
    throw error;
  }
}

function compoundPercent(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return (nums.reduce((factor, v) => factor * (1 + v / 100), 1) - 1) * 100;
}

function latestBcbValue(payload) {
  if (!Array.isArray(payload) || !payload.length) throw new Error('Série BCB vazia');
  const row = payload[payload.length - 1];
  const value = Number(String(row.valor).replace(',', '.'));
  if (!Number.isFinite(value)) throw new Error('Valor BCB inválido');
  return { value, date: row.data };
}

function latestIbgeSeries(variable) {
  const resultados = variable?.resultados ?? [];
  for (const resultado of resultados) {
    for (const serie of (resultado?.series ?? [])) {
      const values = serie?.serie;
      if (!values || typeof values !== 'object') continue;
      const entries = Object.entries(values)
        .filter(([, v]) => v !== null && v !== '' && v !== '-' && v !== '...')
        .sort(([a], [b]) => String(a).localeCompare(String(b)));
      if (!entries.length) continue;
      const [period, raw] = entries[entries.length - 1];
      const value = Number(String(raw).replace(',', '.'));
      if (Number.isFinite(value)) return { period, value };
    }
  }
  return null;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function formatPeriod(period) {
  const s = String(period ?? '');
  if (!/^\d{6}$/.test(s)) return s;
  const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${months[Number(s.slice(4,6)) - 1]}/${s.slice(0,4)}`;
}

function setInfiniteTicker(elementId, items) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const safe = items.length ? items : ['Fonte temporariamente indisponível'];
  const html = safe.map((text) =>
    `<span class="ticker-item"><span class="ticker-bullet">◆</span>${escapeHtml(text)}</span>`
  ).join('');
  el.innerHTML = html + html;
}

async function fetchCambio() {
  try {
    const d = await fetchJson('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL');
    if (!d?.USDBRL || !d?.EURBRL) throw new Error('Câmbio incompleto');
    setKpi('usd', `R$ ${fmt(d.USDBRL.bid)}`, Number(d.USDBRL.pctChange));
    setKpi('eur', `R$ ${fmt(d.EURBRL.bid)}`, Number(d.EURBRL.pctChange));
    return true;
  } catch (error) {
    console.error('Câmbio:', error);
    setKpiUnavailable('usd');
    setKpiUnavailable('eur');
    return false;
  }
}

async function fetchSelicAndCDI() {
  const [selic, cdi] = await Promise.allSettled([
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json'),
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json'),
  ]);
  let ok = true;

  try {
    if (selic.status !== 'fulfilled') throw selic.reason;
    setKpi('selic', `${fmt(latestBcbValue(selic.value).value)}%`);
  } catch (error) {
    console.error('Selic:', error); ok = false; setKpiUnavailable('selic');
  }

  try {
    if (cdi.status !== 'fulfilled') throw cdi.reason;
    setKpi('cdi', `${fmt(latestBcbValue(cdi.value).value)}%`);
  } catch (error) {
    console.error('CDI:', error); ok = false; setKpiUnavailable('cdi');
  }

  return ok;
}

async function fetchInflacao() {
  const [ipca, igpm] = await Promise.allSettled([
    fetchJson('https://servicodados.ibge.gov.br/api/v3/agregados/1737/periodos/-1/variaveis/2265?localidades=N1[all]'),
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.28655/dados/ultimos/12?formato=json'),
  ]);
  let ok = true;

  try {
    if (ipca.status !== 'fulfilled') throw ipca.reason;
    const variable = Array.isArray(ipca.value) ? ipca.value[0] : null;
    const latest = latestIbgeSeries(variable);
    if (!latest) throw new Error('IPCA sem valor');
    setKpi('ipca', `${fmt(latest.value)}%`);
  } catch (error) {
    console.error('IPCA:', error); ok = false; setKpiUnavailable('ipca');
  }

  try {
    if (igpm.status !== 'fulfilled') throw igpm.reason;
    const acc12 = compoundPercent(igpm.value.map((row) => Number(String(row.valor).replace(',', '.'))));
    if (!Number.isFinite(acc12)) throw new Error('IGP-M inválido');
    setKpi('igpm', `${fmt(acc12)}%`);
  } catch (error) {
    console.error('IGP-M:', error); ok = false; setKpiUnavailable('igpm');
  }

  return ok;
}

function renderBRStocks(payload) {
  const stocks = Array.isArray(payload?.stocks) ? payload.stocks : [];
  if (!stocks.length) {
    setPanelMessage('br-stocks', 'Cotações B3 temporariamente indisponíveis');
    setKpiUnavailable('ibov');
    return;
  }

  const names = {
    VALE3: 'Vale ON', PETR4: 'Petrobras PN', ITUB4: 'Itaú Unibanco',
    BBDC4: 'Bradesco PN', WEGE3: 'WEG ON', MGLU3: 'Magazine Luiza',
  };

  document.getElementById('br-stocks').innerHTML = stocks.map((s) => {
    const pct = Number(s.changePercent);
    return `<div class="stock-row">
      <span class="s-ticker">${escapeHtml(s.symbol)}</span>
      <span class="s-name">${escapeHtml(names[s.symbol] || s.name || s.symbol)}</span>
      <span class="s-price">R$ ${fmt(s.price)}</span>
      <span class="s-pct ${pctClass(pct)}">${arrow(pct)}${fmtPct(pct)}</span>
    </div>`;
  }).join('');

  const ibov = payload?.ibovespa;
  if (ibov && Number.isFinite(Number(ibov.price))) {
    setKpi('ibov', `${fmt(ibov.price, 0)} pts`, Number(ibov.changePercent));
  } else {
    setKpiUnavailable('ibov');
  }
}

async function fetchStocksAndIndex() {
  try {
    const { data, fromNetwork } = await fetchStaticJson('./data/brapi.json', 'brapi');
    renderBRStocks(data);
    return fromNetwork && data?.status === 'ok';
  } catch (error) {
    console.error('B3:', error);
    setPanelMessage('br-stocks', 'Cotações B3 temporariamente indisponíveis');
    setKpiUnavailable('ibov');
    return false;
  }
}

function renderGlobalStocks(payload) {
  const stocks = Array.isArray(payload?.stocks) ? payload.stocks : [];
  if (!stocks.length) {
    setPanelMessage('global-stocks', 'Mercado global temporariamente indisponível');
    return;
  }

  document.getElementById('global-stocks').innerHTML = stocks.map((s) => {
    const pct = Number(s.changePercent);
    const stale = s.stale ? ' · último dado válido' : '';
    return `<div class="stock-row">
      <span class="s-ticker">${escapeHtml(s.symbol)}</span>
      <span class="s-name">${escapeHtml((s.name || s.symbol) + stale)}</span>
      <span class="s-price">US$ ${fmt(s.price)}</span>
      <span class="s-pct ${pctClass(pct)}">${arrow(pct)}${fmtPct(pct)}</span>
    </div>`;
  }).join('');
}

async function fetchGlobalStocks() {
  try {
    const { data, fromNetwork } = await fetchStaticJson('./data/global.json', 'global');
    renderGlobalStocks(data);
    return fromNetwork && data?.status === 'ok';
  } catch (error) {
    console.error('Global:', error);
    setPanelMessage('global-stocks', 'Mercado global temporariamente indisponível');
    return false;
  }
}

async function fetchInfoMoneyNews() {
  try {
    const rss = encodeURIComponent('https://www.infomoney.com.br/mercados/feed/');
    const data = await fetchJson(`https://api.rss2json.com/v1/api.json?rss_url=${rss}`);
    const titles = Array.isArray(data?.items)
      ? data.items.slice(0, 15).map((item) => String(item.title || '').trim()).filter(Boolean)
      : [];
    if (!titles.length) throw new Error('RSS vazio');
    writeCache('news', titles);
    setInfiniteTicker('news-ticker', titles);
    return true;
  } catch (error) {
    console.error('InfoMoney:', error);
    const cached = readCache('news');
    if (Array.isArray(cached) && cached.length) {
      setInfiniteTicker('news-ticker', cached.map((t) => `${t} · último feed válido`));
    } else {
      setInfiniteTicker('news-ticker', ['InfoMoney temporariamente indisponível']);
    }
    return false;
  }
}

async function fetchConstructionIndicators() {
  const items = [];
  const [incc, sinapi] = await Promise.allSettled([
    fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.7456/dados/ultimos/12?formato=json'),
    fetchJson('https://servicodados.ibge.gov.br/api/v3/agregados/2296/periodos/-1/variaveis/all?localidades=N1[all]'),
  ]);
  let ok = true;

  try {
    if (incc.status !== 'fulfilled') throw incc.reason;
    const latest = latestBcbValue(incc.value);
    const acc12 = compoundPercent(incc.value.map((row) => Number(String(row.valor).replace(',', '.'))));
    items.push(`INCC-M/FGV: ${fmt(latest.value)}% no mês · ${fmt(acc12)}% em 12 meses · ref. ${latest.date}`);
  } catch (error) {
    console.error('INCC:', error); ok = false;
    items.push('INCC-M/FGV: fonte temporariamente indisponível');
  }

  try {
    if (sinapi.status !== 'fulfilled') throw sinapi.reason;
    const vars = Array.isArray(sinapi.value) ? sinapi.value : [];
    const findVar = (predicate) => vars.find((v) => predicate(normalizeText(v?.variavel)));
    const costVar = findVar((n) => n.includes('custo medio'));
    const monthVar = findVar((n) => n.includes('variacao') && n.includes('mes') && !n.includes('doze'));
    const twelveVar = findVar((n) => n.includes('variacao') && n.includes('doze'));
    const cost = latestIbgeSeries(costVar);
    const month = latestIbgeSeries(monthVar);
    const twelve = latestIbgeSeries(twelveVar);
    if (!cost && !month && !twelve) throw new Error('SINAPI sem valor');

    const parts = ['SINAPI/IBGE'];
    if (cost) parts.push(`R$ ${fmt(cost.value)}/m²`);
    if (month) parts.push(`${fmt(month.value)}% no mês`);
    if (twelve) parts.push(`${fmt(twelve.value)}% em 12 meses`);
    const period = cost?.period || month?.period || twelve?.period;
    if (period) parts.push(`ref. ${formatPeriod(period)}`);
    items.push(parts.join(' · '));
  } catch (error) {
    console.error('SINAPI:', error); ok = false;
    items.push('SINAPI/IBGE: fonte temporariamente indisponível');
  }

  setInfiniteTicker('construction-ticker', items);
  return ok;
}

function tick() {
  setText('clock', new Date().toLocaleTimeString('pt-BR'));
}

function updateCountdown() {
  secondsLeft -= 1;
  if (secondsLeft <= 0) {
    secondsLeft = REFRESH_SECONDS;
    fetchAll();
  }
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  setText('next-update', `Próxima atualização: ${m}:${String(s).padStart(2, '0')}`);
}

async function fetchAll() {
  if (syncing) return;
  syncing = true;
  secondsLeft = REFRESH_SECONDS;
  setText('last-update', 'Sincronizando...');

  try {
    const results = await Promise.allSettled([
      fetchCambio(),
      fetchSelicAndCDI(),
      fetchInflacao(),
      fetchStocksAndIndex(),
      fetchGlobalStocks(),
      fetchInfoMoneyNews(),
      fetchConstructionIndicators(),
    ]);

    const failures = results.filter((r) => r.status !== 'fulfilled' || r.value !== true).length;
    const now = new Date().toLocaleTimeString('pt-BR');
    setText(
      'last-update',
      failures === 0 ? `Atualizado às ${now}` : `Atualização parcial às ${now} · ${failures} fonte(s) com alerta`
    );
  } finally {
    syncing = false;
  }
}

tick();
setInterval(tick, 1000);
setInterval(updateCountdown, 1000);
fetchAll();
