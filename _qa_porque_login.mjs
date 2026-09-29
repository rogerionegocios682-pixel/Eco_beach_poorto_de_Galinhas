// QA: por que configuracoes.html volta para o login?
export default async function run(page) {
  const out = {};

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(3000);
  await page.fill('#usuario', 'admin');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForTimeout(10000);

  out.aposLogin = await page.evaluate(() => ({
    url: location.pathname,
    sessao: (() => { try { const s = JSON.parse(localStorage.getItem('turismo_session') || 'null'); return s ? { u: s.usuario, p: s.perfil, t: !!s.token } : null; } catch (e) { return 'erro'; } })()
  }));

  await page.goto('http://localhost:3000/configuracoes.html');
  await page.waitForTimeout(9000);

  out.naConfig = await page.evaluate(() => ({
    url: location.pathname,
    sessao: !!localStorage.getItem('turismo_session'),
    temTabs: !!document.getElementById('tabs'),
    abas: [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()),
    panes: [...document.querySelectorAll('.cfg-pane')].map((p) => p.id),
    avisos: (document.getElementById('avisos') || {}).textContent,
    renderTudo: typeof window.cfgRenderTudo,
    renderFiscal: typeof window.renderFiscal,
    renderDados: typeof window.renderDados,
    posSettings: typeof window.posSettingsService,
    cfgEstado: typeof window.cfgEstado,
    modo: (window.DB && window.DB.modoAtivo) ? window.DB.modoAtivo() : 'sem'
  }));

  return out;
}