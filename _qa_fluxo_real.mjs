// QA: fluxo real ponta a ponta — entrada de estoque, ficha técnica e conferência.
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 300)));

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForFunction(() => !!localStorage.getItem('turismo_session'), { timeout: 30000 }).catch(() => { });
  const sessao = await page.evaluate(() => localStorage.getItem('turismo_session'));
  await page.context().addInitScript((s) => {
    try { window.localStorage.setItem('turismo_session', s); } catch (e) { }
  }, sessao);

  await page.goto('http://localhost:3000/estoque.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.DB !== 'undefined', { timeout: 30000 }).catch(() => { });
  await page.waitForTimeout(8000);

  /* Executa o fluxo pelas MESMAS funções que a interface usa. Se o
   * resultado bater com o esperado, a tela e o serviço estão integrados. */
  out.fluxo = await page.evaluate(async () => {
    const r = {};
    const EMP = 1, USU = 'QA automatizado';

    // 1) Cria dois produtos (insumo e prato) com saldo inicial.
    const insumo = await DB.criarProduto({ empresaId: EMP, nome: 'QA Carne ' + Date.now(), categoria: 'QA', preco: 0 });
    const prato = await DB.criarProduto({ empresaId: EMP, nome: 'QA Prato ' + Date.now(), categoria: 'QA', preco: 68 });

    // 2) Entrada de estoque do insumo (rota real do servidor).
    const entrada = await DB.entradaEstoque(EMP, {
      produtoId: insumo, quantidade: 10, custoUnitario: 30, usuario: USU, origem: 'QA', setor: 'ESTOQUE CENTRAL'
    });
    r.entrada = { anterior: entrada.estoqueAnterior, posterior: entrada.estoquePosterior, custo: entrada.custoUnitario };

    // 3) Ficha técnica: 1 prato consome 0,25 kg de carne.
    try {
      await DB.salvarFichaTecnica(EMP, {
        produtoId: prato, nome: 'QA File', rendimento: 1,
        itens: [{ ingredienteId: insumo, quantidade: 0.25, unidade: 'KG' }]
      });
      r.fichaSalva = true;
    } catch (e) { r.fichaErro = e.message; }

    // 4) Venda: baixa por ficha técnica.
    try {
      await DB.adicionarItemComanda({
        empresaId: EMP, comandaId: 1, produtoId: prato, nome: 'QA File',
        quantidade: 2, preco: 68, usuario: USU
      });
      r.vendaOk = true;
    } catch (e) { r.vendaErro = e.message; }

    // 5) Saldo do insumo (deve ser 10 — a venda da ficha só roda no
    //    fechamento da comanda, que é onde a baixa acontece).
    const saldos = await DB.listarSaldosEstoque(EMP, { busca: 'QA ' });
    const meuInsumo = saldos.filter((s) => s.id === insumo)[0];
    const meuPrato = saldos.filter((s) => s.id === prato)[0];
    r.saldoInsumo = meuInsumo ? meuInsumo.estoqueAtual : null;
    r.saldoPrato = meuPrato ? meuPrato.estoqueAtual : null;

    // 6) Movimentações registradas (o histórico precisa existir).
    const movs = await DB.listarMovimentacoesEstoque(EMP, { produtoId: insumo });
    r.movimentosInsumo = (movs.linhas || []).map((m) => m.tipoMovimento + ' ' + m.quantidadeNum);

    // 7) Disponibilidade no cardápio digital.
    try {
      const d = await DB.verificarDisponibilidade(EMP, prato);
      r.disponibilidade = { disponivel: d.disponivel, motivo: d.motivo };
    } catch (e) { r.disponibilidade = { erro: e.message }; }

    // 8) Indicadores do painel.
    try {
      const ind = await DB.indicadoresEstoque(EMP, {});
      r.indicadores = { totalProdutos: ind.totalProdutos, valorEstoque: ind.valorTotalEstoque };
    } catch (e) { r.indicadores = { erro: e.message }; }

    // 9) Regras tributárias carregam.
    try {
      const regras = await DB.listarRegras(EMP, {});
      r.regras = regras.length;
    } catch (e) { r.regras = 'erro: ' + e.message; }

    // 10) Auditoria detalhada disponível.
    try {
      const aud = await DB.listarAuditoriaDetalhada(EMP, { limite: 5 });
      r.auditoriaRegistros = (aud || []).length;
    } catch (e) { r.auditoriaRegistros = 'erro: ' + e.message; }

    return r;
  });

  out.console = logs.slice(-8);
  return out;
}