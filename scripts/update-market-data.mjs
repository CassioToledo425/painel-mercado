import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
await mkdir(DATA_DIR, { recursive: true });

const UPDATE_BRAPI = String(process.env.UPDATE_BRAPI ?? 'false') === 'true';
const UPDATE_FX = String(process.env.UPDATE_FX ?? 'false') === 'true';
const BRAPI_TOKEN = process.env.BRAPI_TOKEN ?? '';
const B3 = [
  ['VALE3', 'VALE3.SA', 'Vale ON'],
  ['PETR4', 'PETR4.SA', 'Petrobras PN'],
  ['ITUB4', 'ITUB4.SA', 'Itaú Unibanco'],
  ['BBDC4', 'BBDC4.SA', 'Bradesco PN'],
  ['WEGE3', 'WEGE3.SA', 'WEG ON'],
  ['MGLU3', 'MGLU3.SA', 'Magazine Luiza'],
];
const GLOBAL = [
  ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'],
  ['GOOGL', 'Alphabet'], ['AMZN', 'Amazon'], ['META', 'Meta'],
];

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;

async function getJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readPrevious(filename) {
  try { return JSON.parse(await readFile(path.join(DATA_DIR, filename), 'utf8')); }
  catch { return null; }
}

async function writeJson(filename, payload) {
  await writeFile(path.join(DATA_DIR, filename), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function fetchYahoo(symbol, name) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const data = await getJson(url, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
  });
  const meta = data?.chart?.result?.[0]?.meta ?? {};
  const price = num(meta.regularMarketPrice);
  const previousClose = num(meta.chartPreviousClose ?? meta.previousClose);
  if (price === null || previousClose === null || previousClose === 0) throw new Error('cotação inválida');
  return {
    symbol,
    name,
    price,
    changePercent: ((price - previousClose) / previousClose) * 100,
    marketTime: meta.regularMarketTime ?? null,
    stale: false,
  };
}

async function fetchBrapi(symbol, name) {
  if (!BRAPI_TOKEN) throw new Error('BRAPI_TOKEN ausente');
  const data = await getJson(`https://brapi.dev/api/quote/${encodeURIComponent(symbol)}`, {
    headers: { Authorization: `Bearer ${BRAPI_TOKEN}`, accept: 'application/json' },
  });
  const q = data?.results?.[0];
  const price = num(q?.regularMarketPrice);
  const changePercent = num(q?.regularMarketChangePercent);
  if (price === null || changePercent === null) throw new Error('cotação inválida');
  return { symbol, name: q?.shortName ?? name, price, changePercent, marketTime: q?.regularMarketTime ?? null };
}

async function updateFX() {
  if (!UPDATE_FX) {
    const existing = await readPrevious('fx.json');
    if (existing) return;
    console.log('[FX] Sem arquivo inicial: criando bootstrap pela AwesomeAPI.');
  }

  const previous = await readPrevious('fx.json');

  try {
    const data = await getJson('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL', {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; PainelMercado/1.0)',
        accept: 'application/json',
      },
    });

    const usd = data?.USDBRL;
    const eur = data?.EURBRL;
    if (!usd || !eur || num(usd.bid) === null || num(eur.bid) === null) {
      throw new Error('câmbio incompleto');
    }

    await writeJson('fx.json', {
      status: 'ok',
      updatedAt: nowIso(),
      source: 'AwesomeAPI via GitHub Actions',
      schedule: '08:00 + 10:10–18:10 a cada 15 min · America/Sao_Paulo',
      USDBRL: {
        bid: num(usd.bid),
        pctChange: num(usd.pctChange),
        timestamp: usd.timestamp ?? null,
      },
      EURBRL: {
        bid: num(eur.bid),
        pctChange: num(eur.pctChange),
        timestamp: eur.timestamp ?? null,
      },
    });
    console.log('[FX] Dólar e Euro atualizados pela AwesomeAPI.');
  } catch (error) {
    console.error(`[FX] ${error.message}`);
    if (previous?.USDBRL && previous?.EURBRL) {
      await writeJson('fx.json', {
        ...previous,
        status: 'stale',
        lastAttemptAt: nowIso(),
        warning: 'Falha temporária na AwesomeAPI; mantido o último câmbio válido.',
      });
      return;
    }

    await writeJson('fx.json', {
      status: 'error',
      updatedAt: nowIso(),
      source: 'AwesomeAPI via GitHub Actions',
      USDBRL: null,
      EURBRL: null,
      error: error.message,
    });
  }
}

async function updateB3() {
  if (!UPDATE_BRAPI) {
    const existing = await readPrevious('brapi.json');
    if (existing) return;
    console.log('[B3] Sem arquivo inicial: criando bootstrap via Yahoo sem consumir BRAPI.');
  }

  const previous = await readPrevious('brapi.json');
  const stocks = [];
  let ibovespa = null;
  let source = 'BRAPI';
  const errors = [];

  if (UPDATE_BRAPI && BRAPI_TOKEN) {
    for (const [symbol,, name] of B3) {
      try { stocks.push(await fetchBrapi(symbol, name)); }
      catch (e) { errors.push(`${symbol}: ${e.message}`); }
      await sleep(150);
    }
    try { ibovespa = await fetchBrapi('^BVSP', 'Ibovespa'); }
    catch (e) { errors.push(`^BVSP: ${e.message}`); }
  } else if (UPDATE_BRAPI && !BRAPI_TOKEN) {
    errors.push('BRAPI_TOKEN não configurado');
  }

  if (!UPDATE_BRAPI || errors.length) {
    source = UPDATE_BRAPI ? 'Yahoo Finance fallback (BRAPI indisponível)' : 'Yahoo Finance bootstrap';
    stocks.length = 0;
    errors.length = 0;
    for (const [symbol, yahoo, name] of B3) {
      try { stocks.push(await fetchYahoo(yahoo, name).then((q) => ({ ...q, symbol }))); }
      catch (e) { errors.push(`${symbol}: ${e.message}`); }
      await sleep(150);
    }
    try { ibovespa = await fetchYahoo('^BVSP', 'Ibovespa'); }
    catch (e) { errors.push(`^BVSP: ${e.message}`); }
  }

  if (stocks.length === B3.length && ibovespa && !errors.length) {
    await writeJson('brapi.json', {
      status: source === 'BRAPI' ? 'ok' : 'fallback',
      updatedAt: nowIso(),
      source,
      schedule: '08:00 / 12:00 / 16:00 America/Sao_Paulo',
      stocks,
      ibovespa,
    });
    return;
  }

  if (previous) {
    await writeJson('brapi.json', {
      ...previous,
      status: 'stale',
      lastAttemptAt: nowIso(),
      warning: 'Falha na atualização; mantido o último dado válido.',
    });
  }
  console.error('[B3] Falhas:', errors.join(' | '));
}

async function updateGlobal() {
  const previous = await readPrevious('global.json');
  const old = new Map((previous?.stocks ?? []).map((s) => [s.symbol, s]));
  const stocks = [];
  let failures = 0;

  for (const [symbol, name] of GLOBAL) {
    try { stocks.push(await fetchYahoo(symbol, name)); }
    catch (e) {
      failures += 1;
      const prev = old.get(symbol);
      if (prev) stocks.push({ ...prev, stale: true });
      console.error(`[GLOBAL] ${symbol}: ${e.message}`);
    }
    await sleep(150);
  }

  if (!stocks.length && previous) {
    await writeJson('global.json', { ...previous, status: 'stale', lastAttemptAt: nowIso() });
    return;
  }

  await writeJson('global.json', {
    status: failures === 0 ? 'ok' : 'stale',
    updatedAt: failures === 0 ? nowIso() : previous?.updatedAt ?? nowIso(),
    lastAttemptAt: nowIso(),
    source: 'Yahoo Finance chart',
    stocks,
  });
}

await updateFX();
await updateB3();
await updateGlobal();
