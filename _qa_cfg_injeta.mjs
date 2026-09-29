// QA: a tela de configurações carrega quando a sessão é injetada ANTES do script rodar?
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 250)));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 300)));

  // 1) Login para obter um token VÁLIDO do servidor.
  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForURL(/dashboard\.html/, { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(4000);

  const sessao = await page.evaluate(() => localStorage.getItem('turismo_session'));
  out.sessaoCapturada = !!sessao;

  /* 2) Injeta a sessão ANTES de qualquer script da página rodar, usando
   * addInitScript — é o equivalente a "chegar já logado". */
  await page.context().addInitScript((s) => {
    try { window.localStorage.setItem('turismo_session', s); } catch (e) { }
  }, sessao);

  await page.goto('http://localhost:3000/configuracoes.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.cfgRenderTudo !== 'undefined', { timeout: 30000 }).catch(() => { });
  await page.waitForTimeout(6000);

  out.pagina = await page.evaluate(() => ({
    url: location.pathname,
    titulo: document.title,
    DB: typeof window.DB,
    cfgRenderTudo: typeof window.cfgRenderTudo,
    renderFiscal: typeof window.renderFiscal,
    renderDados: typeof window.renderDados,
    abas: [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()),
    panes: [...document.querySelectorAll('.cfg-pane')].map((p) => p.id),
    params: document.querySelectorAll('.param').length,
    cnpj: (document.getElementById('eCnpj') || {}).value,
    modo: (window.DB && window.DB.modoAtivo) ? window.DB.modoAtivo() : 'sem'
  }));

  out.console = logs.slice(-12);
  return out;
}