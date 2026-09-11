// Carrega as notícias locais ANTES do app principal sem depender de rss2json.
// O app antigo ainda chama a URL do rss2json; interceptamos somente essa chamada
// e devolvemos o data/news.json gerado pelo GitHub Actions.
(() => {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function painelFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const isInfoMoneyRss2Json =
      url.startsWith('https://api.rss2json.com/v1/api.json') &&
      url.toLowerCase().includes('infomoney');

    if (!isInfoMoneyRss2Json) {
      return nativeFetch(input, init);
    }

    const localUrl = `./data/news.json?v=${Date.now()}`;
    const response = await nativeFetch(localUrl, {
      cache: 'no-store',
      signal: init?.signal,
    });

    if (!response.ok) {
      throw new Error(`news.json HTTP ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items)
      ? payload.items.slice(0, 15).map((item) => ({
          title: String(item?.title || '').trim(),
          link: item?.link || '',
          pubDate: item?.pubDate || null,
        })).filter((item) => item.title)
      : [];

    return new Response(
      JSON.stringify({
        status: items.length ? 'ok' : 'error',
        items,
        source: payload?.source || 'InfoMoney local',
        updatedAt: payload?.updatedAt || null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }
    );
  };
})();
