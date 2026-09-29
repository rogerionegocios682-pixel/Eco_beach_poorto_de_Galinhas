// QA focado: abre configuracoes.html com sessão válida e inspeciona.
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 200)));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 300)));

  // 1) Login
  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForURL(/dashboard\.html/, { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(5000);

  out.sessao = await page.evaluate(() => {
    try { const s = JSON.parse(localStorage.getItem('turismo_session') || 'null'); return s ? { u: s.usuario, p: s.perfil } : null; } catch (e) { return 'erro'; }
  });

  // 2) Configurações
  await page.goto('http://localhost:3000/configuracoes.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(16000);

  out.estado = await page.evaluate(() => ({
    url: location.pathname,
    title: document.title,
    temTabs: !!document.getElementById('tabs'),
    abas: [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()),
    panes: [...document.querySelectorAll('.cfg-pane')].map((p) => p.id),
    params: document.querySelectorAll('.param').length,
    avisos: (document.getElementById('avisos') || {}).textContent,
    renderFiscal: typeof window.renderFiscal,
    renderDados: typeof window.renderDados,
    cfgRenderTudo: typeof window.cfgRenderTudo,
    cfgEstado: window.cfgEstado ? Object.keys(window.cfgEstado) : null,
    modo: (window.DB && window.DB.modoAtivo) ? window.DB.modoAtivo() : 'sem'
  }));

  out.console = logs.slice(-15);
  return out;
}