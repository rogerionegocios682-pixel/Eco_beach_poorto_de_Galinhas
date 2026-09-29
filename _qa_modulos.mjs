// QA das telas de módulo (Estoque, Fiscal, Auditoria).
// Espera-se um `alvo` no ambiente de execução; aqui cobrimos as três.
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 300)));

  // Login para obter sessão válida.
  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForFunction(() => !!localStorage.getItem('turismo_session'), { timeout: 30000 }).catch(() => { });
  const sessao = await page.evaluate(() => localStorage.getItem('turismo_session'));

  // Injeta a sessão ANTES dos scripts de cada página rodarem.
  await page.context().addInitScript((s) => {
    try { window.localStorage.setItem('turismo_session', s); } catch (e) { }
  }, sessao);
  out.sessaoInjetada = !!sessao;

  async function visitar(arquivo, tituloEsperado) {
    await page.goto('http://localhost:3000/' + arquivo, { waitUntil: 'load' });
    await page.waitForTimeout(9000);
    return await page.evaluate(() => ({
      url: location.pathname,
      titulo: document.title,
      abas: [...document.querySelectorAll('#tabs button, .tabs button')].map((b) => b.textContent.trim()),
      panes: [...document.querySelectorAll('.pane, .cfg-pane')].map((p) => p.id),
      avisos: (document.getElementById('avisos') || {}).textContent,
      bodyChars: document.body.innerText.length
    }));
  }

  out.estoque = await visitar('estoque.html');

  // Painel do estoque: indicadores carregados?
  out.painelEstoque = await page.evaluate(() => {
    const k = document.querySelectorAll('.kpi');
    return {
      kpis: k.length,
      textos: [...k].slice(0, 6).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      temAlertas: !!document.getElementById('painelConteudo')
    };
  });

  out.fiscal = await visitar('fiscal.html');
  out.auditoria = await visitar('auditoria.html');

  out.console = logs.slice(-15);
  return out;
}