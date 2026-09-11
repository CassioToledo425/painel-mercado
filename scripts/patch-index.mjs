import { readFile, writeFile } from 'node:fs/promises';

const file = 'index.html';
let html = await readFile(file, 'utf8');

if (!html.includes('<script src="app.js"></script>')) {
  const inline = /<script>\s*const\s+BRAPI_TOKEN\s*=[\s\S]*?<\/script>/;
  if (!inline.test(html)) throw new Error('Script antigo com BRAPI_TOKEN não encontrado.');
  html = html.replace(inline, '<script src="app.js"></script>');
}

if (!html.includes('<script src="news-client.js"></script>')) {
  html = html.replace(
    '<script src="app.js"></script>',
    '<script src="app.js"></script>\n<script src="news-client.js"></script>'
  );
}

html = html.replace('NYSE / NASDAQ</span>', 'NYSE / NASDAQ · AUTO</span>');
html = html.replace(/NYSE \/ NASDAQ(?: · AUTO)+<\/span>/, 'NYSE / NASDAQ · AUTO</span>');

html = html.replace(
  /Fontes: InfoMoney · AwesomeAPI · BCB · BRAPI \(08h, 12h, 16h\) · IBGE · FGV(?: · Yahoo Finance)*/,
  'Fontes: InfoMoney · AwesomeAPI · BCB · BRAPI (08h, 12h, 16h) · IBGE · FGV · Yahoo Finance'
);

await writeFile(file, html, 'utf8');
console.log('index.html atualizado: motor seguro, feed local e rodapé normalizado.');
