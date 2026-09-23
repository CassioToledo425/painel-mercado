// Atualização remota do painel.
// Consulta version.json periodicamente e recarrega a página quando uma nova versão é publicada.
(() => {
  const CHECK_INTERVAL_MS = 60_000;
  let loadedVersion = null;
  let checking = false;

  async function fetchVersion() {
    const response = await fetch(`./version.json?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`version.json HTTP ${response.status}`);

    const payload = await response.json();
    const version = String(payload?.version || '').trim();
    if (!version) throw new Error('version.json sem versão válida');
    return version;
  }

  async function checkForUpdate() {
    if (checking) return;
    checking = true;

    try {
      const currentVersion = await fetchVersion();

      if (loadedVersion === null) {
        loadedVersion = currentVersion;
        return;
      }

      if (currentVersion !== loadedVersion) {
        const url = new URL(window.location.href);
        url.searchParams.set('panelVersion', currentVersion);
        url.searchParams.set('reload', Date.now().toString());
        window.location.replace(url.toString());
      }
    } catch (error) {
      console.warn('Verificação de versão do painel:', error);
    } finally {
      checking = false;
    }
  }

  checkForUpdate();
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
})();
