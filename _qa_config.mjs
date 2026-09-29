// QA passo a passo: login, depois inspeciona a tela de configurações.
export default async function run(page) {
  const out = {};

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.fill('#usuario', 'admin');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');

  await page.waitForFunction(() => !!localStorage.getItem('turismo_session'), { timeout: 30000 }).catch(() => {});
  out.sessao = await page.evaluate(() => {
    try {
      const s = JSON.parse(localStorage.getItem('turismo_session') || 'null');
      return s ? { usuario: s.usuario, perfil: s.perfil, temToken: !!s.token } : null;
    } catch (e) { return 'erro'; }
  });

  await page.goto('http://localhost:3000/configuracoes.html');
  await page.waitForTimeout(8000);

  out.url = page.url();
  out.titulo = await page.title();
  out.diagnostico = await page.evaluate(() => ({
    temTabs: !!document.getElementById('tabs'),
    tabs: [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()),
    panes: [...document.querySelectorAll('.cfg-pane')].map((p) => p.id),
    avisos: (document.getElementById('avisos') || {}).textContent,
    temDB: typeof window.DB,
    temCFG: typeof window.cfgEstado,
    renderFiscal: typeof window.renderFiscal,
    renderDados: typeof window.renderDados,
    sessaoLocal: !!localStorage.getItem('turismo_session'),
    modo: (window.DB && window.DB.modoAtivo) ? window.DB.modoAtivo() : 'sem DB'
  }));

  return out;
}