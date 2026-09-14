// Redireciona apenas a consulta de câmbio do painel para o JSON local
// gerado pelo GitHub Actions, evitando rate limit no navegador da TV.
(() => {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function painelFxFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const isAwesomeFx = url.startsWith('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL');

    if (!isAwesomeFx) {
      return nativeFetch(input, init);
    }

    const response = await nativeFetch(`./data/fx.json?v=${Date.now()}`, {
      cache: 'no-store',
      signal: init?.signal,
    });

    if (!response.ok) {
      throw new Error(`fx.json HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!payload?.USDBRL || !payload?.EURBRL) {
      throw new Error('fx.json sem câmbio válido');
    }

    return new Response(
      JSON.stringify({
        USDBRL: payload.USDBRL,
        EURBRL: payload.EURBRL,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }
    );
  };
})();
