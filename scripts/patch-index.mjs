import { readFile, writeFile } from 'node:fs/promises';

const file = 'index.html';
let html = await readFile(file, 'utf8');

if (!html.includes('<script src="app.js"></script>')) {
  const inline = /<script>\s*const\s+BRAPI_TOKEN\s*=[\s\S]*?<\/script>/;
  if (!inline.test(html)) throw new Error('Script antigo com BRAPI_TOKEN não encontrado.');
  html = html.replace(inline, '<script src="app.js"></script>');
}

html = html.replace('NYSE / NASDAQ</span>', 'NYSE / NASDAQ · AUTO</span>');
html = html.replace(
  'Fontes: InfoMoney · AwesomeAPI · BCB · BRAPI (08h, 12h, 16h) · IBGE · FGV',
  'Fontes: InfoMoney · AwesomeAPI · BCB · BRAPI (08h, 12h, 16h) · IBGE · FGV · Yahoo Finance'
);

await writeFile(file, html, 'utf8');
console.log('index.html atualizado: token removido e app.js ativado.');
