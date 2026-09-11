import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const FILE = path.join(DATA_DIR, 'news.json');
await mkdir(DATA_DIR, { recursive: true });

const nowIso = () => new Date().toISOString();

function decodeEntities(text) {
  const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    '#8211': '–', '#8212': '—', '#8216': '‘', '#8217': '’',
    '#8220': '“', '#8221': '”', '#8230': '…', '#038': '&',
  };
  return String(text ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z0-9#]+);/g, (m, key) => entities[key] ?? m)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; PainelMercado/1.0; +https://cassiotoledo425.github.io/painel-mercado/)',
        accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function readPrevious() {
  try { return JSON.parse(await readFile(FILE, 'utf8')); }
  catch { return null; }
}

async function write(payload) {
  await writeFile(FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    const dateMatch = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i);
    const title = decodeEntities(titleMatch?.[1]);
    if (!title) continue;
    items.push({
      title,
      link: decodeEntities(linkMatch?.[1]),
      pubDate: decodeEntities(dateMatch?.[1]) || null,
    });
    if (items.length >= 15) break;
  }
  return items;
}

function parseMarketsHtml(html) {
  const found = [];
  const seen = new Set();
  const linkRegex = /<a\b[^>]*href=["']([^"']*\/mercados\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html))) {
    const title = decodeEntities(match[2]);
    if (title.length < 18 || seen.has(title)) continue;
    seen.add(title);
    const href = match[1].startsWith('http') ? match[1] : `https://www.infomoney.com.br${match[1]}`;
    found.push({ title, link: href, pubDate: null });
    if (found.length >= 15) break;
  }
  return found;
}

async function updateNews() {
  const previous = await readPrevious();
  const errors = [];

  try {
    const xml = await fetchText('https://www.infomoney.com.br/mercados/feed/');
    const items = parseRss(xml);
    if (!items.length) throw new Error('feed RSS sem itens reconhecíveis');
    await write({
      status: 'ok',
      updatedAt: nowIso(),
      source: 'InfoMoney RSS / Mercados',
      items,
    });
    console.log(`[INFOMONEY] ${items.length} notícias obtidas via RSS.`);
    return;
  } catch (error) {
    errors.push(`RSS: ${error.message}`);
  }

  try {
    const html = await fetchText('https://www.infomoney.com.br/mercados/');
    const items = parseMarketsHtml(html);
    if (!items.length) throw new Error('página sem manchetes reconhecíveis');
    await write({
      status: 'ok',
      updatedAt: nowIso(),
      source: 'InfoMoney página Mercados',
      items,
    });
    console.log(`[INFOMONEY] ${items.length} notícias obtidas pela página Mercados.`);
    return;
  } catch (error) {
    errors.push(`HTML: ${error.message}`);
  }

  if (previous?.items?.length) {
    await write({
      ...previous,
      status: 'stale',
      lastAttemptAt: nowIso(),
      warning: 'Falha ao consultar o InfoMoney; mantidas as últimas manchetes válidas.',
      errors,
    });
    console.warn('[INFOMONEY] Mantido último feed válido:', errors.join(' | '));
    return;
  }

  await write({
    status: 'error',
    updatedAt: nowIso(),
    source: 'InfoMoney',
    items: [],
    errors,
  });
  console.error('[INFOMONEY] Não foi possível obter notícias:', errors.join(' | '));
}

await updateNews();
