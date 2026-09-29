// QA da tela de Configurações — roda DEPOIS do login na mesma sessão.
// Uso:  browser.mjs --session cfgqa --script _qa_cfg_sessao.mjs
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 250)));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 300)));

  // 1) Login (a sessão fica no localStorage desta sessão do navegador).
  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForURL(/dashboard\.html/, { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(4000);

  out.sessao = await page.evaluate(() => {
    try { const s = JSON.parse(localStorage.getItem('turismo_session') || 'null'); return s ? { usuario: s.usuario, perfil: s.perfil, temToken: !!s.token } : null; } catch (e) { return 'erro'; }
  });

  // 2) Configurações (mesma sessão: o localStorage acompanha).
  await page.goto('http://localhost:3000/configuracoes.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.cfgRenderTudo !== 'undefined', { timeout: 30000 }).catch(() => { });
  await page.waitForTimeout(5000);

  out.pagina = await page.evaluate(() => ({
    url: location.pathname,
    titulo: document.title,
    abas: [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()),
    panes: [...document.querySelectorAll('.cfg-pane')].map((p) => p.id),
    params: document.querySelectorAll('.param').length,
    inputs: document.querySelectorAll('.cfg-pane input, .cfg-pane select').length,
    empresa: {
      razao: (document.getElementById('eRazaoSocial') || {}).value,
      cnpj: (document.getElementById('eCnpj') || {}).value,
      cidade: (document.getElementById('eCidade') || {}).value,
      uf: (document.getElementById('eEstado') || {}).value
    },
    modo: window.DB.modoAtivo()
  }));

  // 3) Parâmetros exigidos pela especificação.
  out.paramsChave = await page.evaluate(() => {
    const g = (k) => {
      const el = document.querySelector('[data-chave="' + k + '"]');
      if (!el) return 'AUSENTE';
      return el.type === 'checkbox' ? el.checked : el.value;
    };
    return {
      confirmarPagamentoAutomatico: g('confirmarPagamentoAutomatico'),
      bloquearQuantidadeExorbitante: g('bloquearQuantidadeExorbitante'),
      bloquearItemValorZerado: g('bloquearItemValorZerado'),
      abrirVariasInstancias: g('abrirVariasInstancias'),
      arredondamentoAbnt: g('arredondamentoAbnt'),
      bloquearVendaFracionadaUnidadeInteira: g('bloquearVendaFracionadaUnidadeInteira'),
      metodoBaixaEstoque: g('metodoBaixaEstoque'),
      ativarControleAutomaticoNovosProdutos: g('ativarControleAutomaticoNovosProdutos'),
      controlarDisponibilidadeCardapio: g('controlarDisponibilidadeCardapio'),
      considerarEstoqueIngredientes: g('considerarEstoqueIngredientes')
    };
  });

  // 4) Aba FISCAL completa.
  await page.evaluate(() => document.querySelector('#tabs button[data-aba="fiscal"]').click());
  await page.waitForTimeout(4000);
  out.fiscal = await page.evaluate(() => ({
    visivel: !!document.querySelector('#pane-fiscal.on'),
    temCertificado: !!document.getElementById('btnCertificado'),
    temSerie: !!document.getElementById('btnSerie'),
    temSimulador: !!document.getElementById('btnSimular'),
    temRegras: !!document.getElementById('btnAtualizarRegras'),
    temContingencia: !!document.getElementById('btnContingenciaOn'),
    temLogs: !!document.getElementById('btnVerLogs'),
    produtosSimulador: document.querySelectorAll('#simProduto option').length,
    prontidao: (document.querySelector('#pane-fiscal .badge') || {}).textContent
  }));

  // 5) Simulador tributário (usa a API real do servidor).
  await page.evaluate(() => document.getElementById('btnSimular').click());
  await page.waitForTimeout(6000);
  out.simulador = await page.evaluate(() => {
    const e = document.getElementById('simResultado');
    return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) : 'AUSENTE';
  });

  // 6) Regras e séries.
  await page.evaluate(() => document.getElementById('btnAtualizarRegras').click());
  await page.waitForTimeout(5000);
  out.regras = await page.evaluate(() => {
    const e = document.getElementById('listaRegras');
    return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 260) : 'AUSENTE';
  });
  out.series = await page.evaluate(() => {
    const e = document.getElementById('listaSeries');
    return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : 'AUSENTE';
  });

  // 7) Demais abas.
  for (const aba of ['estoque', 'cadastros', 'caixa', 'pedidos', 'integracoes', 'api', 'seguranca', 'dados']) {
    await page.evaluate((a) => document.querySelector('#tabs button[data-aba="' + a + '"]').click(), aba);
    await page.waitForTimeout(900);
    out['aba_' + aba] = await page.evaluate((a) => {
      const p = document.getElementById('pane-' + a);
      return { visivel: p ? p.classList.contains('on') : false, params: p ? p.querySelectorAll('.param').length : 0 };
    }, aba);
  }

  out.console = logs.slice(-12);
  return out;
}