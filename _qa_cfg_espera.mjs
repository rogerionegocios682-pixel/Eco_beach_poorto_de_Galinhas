// QA: espera os scripts terminarem de carregar e então inspeciona.
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 400)));

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForURL(/dashboard\.html/, { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(4000);

  // Navega e ESPERA o DB aparecer (os scripts são carregados na ordem).
  await page.goto('http://localhost:3000/configuracoes.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.DB !== 'undefined', { timeout: 30000 }).catch(() => { });
  await page.waitForFunction(() => typeof window.cfgRenderTudo !== 'undefined', { timeout: 30000 }).catch(() => { });
  await page.waitForTimeout(6000);

  out.globais = await page.evaluate(() => ({
    url: location.pathname,
    title: document.title,
    DB: typeof window.DB,
    posSettingsService: typeof window.posSettingsService,
    cfgEstado: typeof window.cfgEstado,
    cfgRenderTudo: typeof window.cfgRenderTudo,
    renderFiscal: typeof window.renderFiscal,
    renderDados: typeof window.renderDados,
    abas: [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()),
    panes: [...document.querySelectorAll('.cfg-pane')].map((p) => p.id),
    params: document.querySelectorAll('.param').length,
    cnpjExibido: (document.getElementById('eCnpj') || {}).value,
    avisos: (document.getElementById('avisos') || {}).textContent
  }));

  out.console = logs.slice(-15);
  return out;
}