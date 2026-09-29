// QA: captura o erro real que impede configuracoes.js de rodar.
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 500) + ' | ' + String(e.stack || '').split('\n').slice(0, 3).join(' <- ')));

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForURL(/dashboard\.html/, { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(4000);

  // Carrega cada script isoladamente e captura o erro de sintaxe/execução.
  out.scripts = await page.evaluate(async () => {
    const resultado = [];
    for (const src of ['db.js', 'posSettingsService.js', 'configuracoes.js', 'configuracoes_fiscal.js', 'configuracoes_dados.js']) {
      const r = await fetch('/' + src);
      const txt = await r.text();
      resultado.push({ src: src, status: r.status, bytes: txt.length, comeca: txt.slice(0, 60).replace(/\n/g, ' ') });
    }
    return resultado;
  });

  await page.goto('http://localhost:3000/configuracoes.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);

  out.globais = await page.evaluate(() => ({
    DB: typeof window.DB,
    posSettingsService: typeof window.posSettingsService,
    cfgEstado: typeof window.cfgEstado,
    cfgRenderTudo: typeof window.cfgRenderTudo,
    renderFiscal: typeof window.renderFiscal,
    renderDados: typeof window.renderDados,
    cfgEsc: typeof window.cfgEsc,
    abas: [...document.querySelectorAll('#tabs button')].length,
    panes: [...document.querySelectorAll('.cfg-pane')].length
  }));

  out.console = logs.slice(-20);
  return out;
}