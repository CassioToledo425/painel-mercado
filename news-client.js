// Substitui a coleta direta via rss2json por um JSON gerado pelo GitHub Actions.
fetchInfoMoneyNews = async function fetchInfoMoneyNewsFromLocalData() {
  try {
    const { data, fromNetwork } = await fetchStaticJson('./data/news.json', 'news-json');
    const titles = Array.isArray(data?.items)
      ? data.items
          .slice(0, 15)
          .map((item) => String(item?.title || '').trim())
          .filter(Boolean)
      : [];

    if (!titles.length) throw new Error('news.json sem manchetes');

    setInfiniteTicker('news-ticker', titles);
    return fromNetwork && data?.status === 'ok';
  } catch (error) {
    console.error('InfoMoney local:', error);
    const cachedPayload = readCache('news-json');
    const cachedTitles = Array.isArray(cachedPayload?.items)
      ? cachedPayload.items
          .slice(0, 15)
          .map((item) => String(item?.title || '').trim())
          .filter(Boolean)
      : [];

    if (cachedTitles.length) {
      setInfiniteTicker('news-ticker', cachedTitles.map((title) => `${title} · último feed válido`));
    } else {
      setInfiniteTicker('news-ticker', ['InfoMoney temporariamente indisponível']);
    }
    return false;
  }
};

// Corrige imediatamente a faixa de notícias após o app principal carregar.
fetchInfoMoneyNews();
