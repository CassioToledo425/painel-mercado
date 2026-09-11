import { readFile, writeFile } from 'node:fs/promises';

const file = 'index.html';
let html = await readFile(file, 'utf8');

const appScript = /<script\s+src=["']app\.js(?:\?[^"']*)?["']\s*><\/script>/i;
const newsScript = /<script\s+src=["']news-client\.js(?:\?[^"']*)?["']\s*><\/script>/i;

// Migração legada: só atua se o app.js ainda não existir, com ou sem versão de cache.
if (!appScript.test(html)) {
  const inlineLegacy = /<script>\s*const\s+BRAPI_TOKEN\s*=[\s\S]*?<\/script>/i;
  if (!inlineLegacy.test(html)) {
    throw new Error('Não foi encontrado app.js nem o script legado com BRAPI_TOKEN.');
  }
  html = html.replace(inlineLegacy, '<script src="app.js"></script>');
}

// O news-client precisa carregar antes do app.js para interceptar a chamada antiga do feed.
if (!newsScript.test(html)) {
  html = html.replace(appScript, (appTag) => `<script src="news-client.js"></script>\n${appTag}`);
}

html = html.replace(/NYSE \/ NASDAQ(?: · AUTO)*<\/span>/g, 'NYSE / NASDAQ · AUTO</span>');

html = html.replace(
  /Fontes: InfoMoney · AwesomeAPI · BCB · BRAPI \(08h, 12h, 16h\) · IBGE · FGV(?: · Yahoo Finance)*/g,
  'Fontes: InfoMoney · AwesomeAPI · BCB · BRAPI (08h, 12h, 16h) · IBGE · FGV · Yahoo Finance'
);

await writeFile(file, html, 'utf8');
console.log('index.html validado/migrado com sucesso.');
