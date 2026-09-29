// QA: fluxo real ponta a ponta, executado NO MUNDO DA PÁGINA.
export default async function run(page) {
  const out = {};

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);
  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForFunction(() => !!localStorage.getItem('turismo_session'), { timeout: 30000 }).catch(() => {});
  const sessao = await page.evaluate(() => localStorage.getItem('turismo_session'));
  await page.context().addInitScript((s) => {
    try { window.localStorage.setItem('turismo_session', s); } catch (e) { }
  }, sessao);

  await page.goto('http://localhost:3000/estoque.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.DB !== 'undefined' && typeof window.DB.movimentarEstoqueLocal === 'function', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(6000);

  // Injeta o fluxo como <script> — roda no MESMO contexto de window.DB.
  out.fluxo = await page.evaluate(() => new Promise((resolve) => {
    const codigo = `
      (function () {
        var EMP = 1, USU = 'QA automatizado';
        var r = {};
        var api = function (rota, payload) {
          return fetch('/api/' + rota, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ empresaId: EMP, perfil: 'admin', usuarioNome: USU }, payload || {}))
          }).then(function (x) { return x.json(); }).then(function (j) {
            if (!j.ok) throw new Error(j.erro || 'falha na API');
            return j.dados;
          });
        };
        var nome = 'QA ' + Date.now();
        var insumo, prato;
        api('produtos/criar', { nome: nome + ' Carne', categoria: 'QA', preco: 0 })
          .then(function (id) {
            insumo = id;
            return api('produtos/criar', { nome: nome + ' Prato', categoria: 'QA', preco: 68 });
          })
          .then(function (id) {
            prato = id;
            // Marca controle de estoque via rota de produto completo.
            return api('produto/salvar-completo', { dados: { id: insumo, controlaEstoque: 1, unidade: 'KG', precoCusto: 30, ncm: '02013000' } });
          })
          .then(function () {
            return api('estoque/entrada', { dados: { produtoId: insumo, quantidade: 10, custoUnitario: 30, setor: 'ESTOQUE CENTRAL', origem: 'QA' } });
          })
          .then(function (e) {
            r.entrada = { anterior: e.estoqueAnterior, posterior: e.estoquePosterior };
            return api('estoque/ficha-salvar', { dados: {
              produtoId: prato, nome: 'QA File', rendimento: 1,
              itens: [{ ingredienteId: insumo, quantidade: 0.25, unidade: 'KG' }]
            } });
          })
          .then(function (f) { r.ficha = f; })
          .then(function () {
            // Simula a venda: 2 porções do prato pelo tipo SAIDA_PEDIDO,
            // exatamente como o fechamento de comanda faz.
            return api('estoque/saida', { dados: {
              produtoId: prato, quantidade: 2, tipoMovimento: 'SAIDA_PEDIDO',
              origem: 'QA', documentoId: 'QA-VENDA-' + Date.now()
            } });
          })
          .then(function () { r.baixaDireta = 'ok'; })
          .catch(function (e) { r.baixaDireta = 'erro: ' + e.message; })
          .then(function () {
            return Promise.all([
              api('estoque/saldo-produto', { produtoId: insumo }),
              api('estoque/saldo-produto', { produtoId: prato }).catch(function () { return null; }),
              api('estoque/movimentacoes', { filtro: { produtoId: insumo } }),
              api('estoque/fichas', {}),
              api('estoque/indicadores', {}),
              api('estoque/disponibilidade', { produtoId: prato }).catch(function (e) { return { erro: e.message }; }),
              api('fiscal/regras', { filtro: {} }),
              api('auditoria/detalhada', { limite: 5 }),
              api('estoque/relatorio', { nome: 'estoque_atual', filtro: {} })
            ]);
          })
          .then(function (res) {
            r.saldoInsumo = res[0].estoqueAtual;
            r.saldoPrato = res[1] ? res[1].estoqueAtual : null;
            r.movimentosInsumo = (res[2].linhas || []).map(function (m) { return m.tipoMovimento; });
            r.fichasCadastradas = (res[3] || []).length;
            r.indicadores = { produtos: res[4].totalProdutos, valor: res[4].valorTotalEstoque };
            r.disponibilidade = res[5];
            r.regrasTributarias = (res[6] || []).length;
            r.auditoria = (res[7] || []).length;
            r.relatorioLinhas = (res[8].linhas || []).length;
            fim(r);
          })
          .catch(function (e) { r.erroGeral = e.message; fim(r); });

        function fim(v) {
          var p = document.createElement('pre');
          p.id = '__qa_fluxo'; p.textContent = JSON.stringify(v);
          document.body.appendChild(p);
        }
      })();
    `;
    const s = document.createElement('script');
    s.textContent = codigo;
    document.body.appendChild(s); s.remove();
    const it = setInterval(() => {
      const el = document.getElementById('__qa_fluxo');
      if (el) { clearInterval(it); resolve(JSON.parse(el.textContent)); }
    }, 150);
    setTimeout(() => { clearInterval(it); resolve({ erro: 'timeout' }); }, 60000);
  }));

  return out;
}