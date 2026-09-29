// QA completo da tela de Configurações (11 abas).
export default async function run(page) {
  const out = {};

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(3000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForTimeout(9000);

  await page.goto('http://localhost:3000/configuracoes.html');
  await page.waitForTimeout(9000);

  out.url = page.url();
  out.titulo = await page.title();
  out.abas = await page.evaluate(() => [...document.querySelectorAll('#tabs button')].map((b) => b.textContent.trim()));
  out.panes = await page.evaluate(() => [...document.querySelectorAll('.cfg-pane')].map((p) => p.id));
  out.paramsTotal = await page.evaluate(() => document.querySelectorAll('.param').length);
  out.modo = await page.evaluate(() => (window.DB && window.DB.modoAtivo) ? window.DB.modoAtivo() : 'sem DB');

  out.empresa = await page.evaluate(() => ({
    razao: (document.getElementById('eRazaoSocial') || {}).value,
    cnpj: (document.getElementById('eCnpj') || {}).value,
    cidade: (document.getElementById('eCidade') || {}).value,
    uf: (document.getElementById('eEstado') || {}).value
  }));

  const pegar = () => {
    const g = (chave) => {
      const el = document.querySelector('[data-chave="' + chave + '"]');
      if (!el) return 'AUSENTE';
      return el.type === 'checkbox' ? el.checked : el.value;
    };
    return {
      confirmarPagamentoAutomatico: g('confirmarPagamentoAutomatico'),
      bloquearQuantidadeExorbitante: g('bloquearQuantidadeExorbitante'),
      bloquearItemValorZerado: g('bloquearItemValorZerado'),
      abrirVariasInstancias: g('abrirVariasInstancias'),
      finalizarVendaAutomaticamente: g('finalizarVendaAutomaticamente'),
      arredondamentoAbnt: g('arredondamentoAbnt'),
      bloquearVendaFracionadaUnidadeInteira: g('bloquearVendaFracionadaUnidadeInteira'),
      bloquearAlteracaoQtdAposBalanca: g('bloquearAlteracaoQtdAposBalanca'),
      bloquearDivisaoValorPelaQuantidade: g('bloquearDivisaoValorPelaQuantidade'),
      metodoBaixaEstoque: g('metodoBaixaEstoque'),
      ativarControleAutomaticoNovosProdutos: g('ativarControleAutomaticoNovosProdutos'),
      alertarFalhaAtualizacao: g('alertarFalhaAtualizacao'),
      controlarDisponibilidadeCardapio: g('controlarDisponibilidadeCardapio'),
      considerarEstoqueIngredientes: g('considerarEstoqueIngredientes')
    };
  };
  out.paramsChave = await page.evaluate(pegar);

  // Aba FISCAL
  await page.evaluate(() => document.querySelector('#tabs button[data-aba="fiscal"]').click());
  await page.waitForTimeout(3000);
  out.fiscal = await page.evaluate(() => ({
    visivel: !!document.querySelector('#pane-fiscal.on'),
    prontidaoBadge: (document.querySelector('#pane-fiscal .badge') || {}).textContent,
    temCertificado: !!document.getElementById('btnCertificado'),
    temSerie: !!document.getElementById('btnSerie'),
    temSimulador: !!document.getElementById('btnSimular'),
    temRegras: !!document.getElementById('btnAtualizarRegras'),
    temContingencia: !!document.getElementById('btnContingenciaOn'),
    temLogs: !!document.getElementById('btnVerLogs'),
    produtosNoSimulador: document.querySelectorAll('#simProduto option').length
  }));

  // Simulador tributário (usa a API real)
  await page.evaluate(() => document.getElementById('btnSimular').click());
  await page.waitForTimeout(5000);
  out.simulador = await page.evaluate(() => {
    const el = document.getElementById('simResultado');
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 400) : 'AUSENTE';
  });

  // Regras tributárias
  await page.evaluate(() => document.getElementById('btnAtualizarRegras').click());
  await page.waitForTimeout(4000);
  out.regras = await page.evaluate(() => {
    const el = document.getElementById('listaRegras');
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : 'AUSENTE';
  });

  // Séries
  out.series = await page.evaluate(() => {
    const el = document.getElementById('listaSeries');
    return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : 'AUSENTE';
  });

  // Aba ESTOQUE
  await page.evaluate(() => document.querySelector('#tabs button[data-aba="estoque"]').click());
  await page.waitForTimeout(1500);
  out.estoque = await page.evaluate(() => ({
    visivel: !!document.querySelector('#pane-estoque.on'),
    subtitulos: [...document.querySelectorAll('#pane-estoque .subtitulo')].map((s) => s.textContent.trim()),
    opcoesMetodo: [...(document.querySelector('[data-chave="metodoBaixaEstoque"]') || {}).options || []].map((o) => o.value)
  }));

  // Aba DADOS
  await page.evaluate(() => document.querySelector('#tabs button[data-aba="dados"]').click());
  await page.waitForTimeout(1500);
  out.dados = await page.evaluate(() => ({
    visivel: !!document.querySelector('#pane-dados.on'),
    temExportar: !!document.getElementById('btnExportarConfig'),
    temImportar: !!document.getElementById('arqImport'),
    temResumo: !!document.getElementById('btnResumoBanco')
  }));

  // Abas restantes
  for (const aba of ['caixa', 'pedidos', 'cadastros', 'integracoes', 'api', 'seguranca']) {
    await page.evaluate((a) => document.querySelector('#tabs button[data-aba="' + a + '"]').click(), aba);
    await page.waitForTimeout(700);
    out['aba_' + aba] = await page.evaluate((a) => {
      const p = document.getElementById('pane-' + a);
      return { visivel: p ? p.classList.contains('on') : false, params: p ? p.querySelectorAll('.param').length : 0 };
    }, aba);
  }

  return out;
}