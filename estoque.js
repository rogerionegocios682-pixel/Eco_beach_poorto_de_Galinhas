/*
 * Turismo OS — Estoque (estoque.js)
 * =====================================================================
 * Telas: Painel, Saldos, Movimentações, Entrada/Saída, Perdas,
 * Transferência, Inventário, Ficha técnica, Cardápio, CMV, Relatórios e
 * Falhas (reconciliação).
 *
 * REGRA DE OURO DESTA TELA: nenhuma escrita de saldo acontece aqui.
 * Tudo passa pelas rotas do servidor (estoque/entrada, estoque/perda,
 * estoque/transferir, estoque/ajustar...), que registram a movimentação
 * com usuário, empresa e documento. Quando só o servidor tem o recurso
 * (inventário, ficha técnica, CMV, relatórios), a tela DIZ isso em vez de
 * mostrar um botão que não funciona.
 */
(function () {
  'use strict';

  var sessao = null;
  try { sessao = JSON.parse(localStorage.getItem('turismo_session') || 'null'); } catch (e) { sessao = null; }
  if (!sessao) { window.location.href = 'login.html'; return; }

  var EMPRESA = (sessao.empresaId != null) ? sessao.empresaId : 1;
  var USUARIO = sessao.nome || sessao.usuario || 'sistema';
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Permissões (mesma regra do servidor) ---------- */
  var PADRAO_PERFIL = {
    admin: ['*'],
    gerente: ['estoque.visualizar', 'estoque.movimentar', 'estoque.ajustar', 'estoque.inventario',
      'estoque.transferir', 'produto.editar', 'produto.fiscal'],
    recepcao: ['estoque.visualizar'],
    garcom: ['estoque.visualizar']
  };
  function pode(c) {
    var perfil = String(sessao.perfil || 'admin').toLowerCase();
    if (perfil === 'admin') return true;
    var lista = (sessao.permissoes && sessao.permissoes.length) ? sessao.permissoes : (PADRAO_PERFIL[perfil] || []);
    if (lista.indexOf('*') !== -1) return true;
    var g = String(c).split('.')[0];
    return lista.indexOf(c) !== -1 || lista.indexOf(g + '.*') !== -1;
  }

  /* ---------- Utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function brl(v) {
    return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(v, casas) {
    return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas == null ? 3 : casas });
  }
  function toast(msg, tipo) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (tipo ? ' ' + tipo : '');
    setTimeout(function () { t.className = 'toast'; }, tipo === 'err' ? 6500 : 3000);
  }
  function abrirModal(html, largo) {
    $('modalBox').className = 'modal' + (largo ? ' wide' : '');
    $('modalBox').innerHTML = html;
    $('overlay').classList.add('show');
  }
  function fecharModal() { $('overlay').classList.remove('show'); $('modalBox').innerHTML = ''; }
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) fecharModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharModal(); });
  function modoServidor() { return DB.modoAtivo() === 'servidor'; }
  function badge(ok, txtOk, txtNao) {
    return '<span class="badge ' + (ok ? 'on' : 'off') + '">' + esc(ok ? txtOk : txtNao) + '</span>';
  }
  function baixar(nome, conteudo, mime) {
    var blob = new Blob([conteudo], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- Cabeçalho ---------- */
  $('uNome').textContent = sessao.nome || sessao.usuario;
  $('uPerfil').textContent = sessao.perfil || '';
  $('uAvatar').textContent = (sessao.nome || sessao.usuario || '?').trim().charAt(0).toUpperCase();
  $('btnLogout').addEventListener('click', function () {
    if (confirm('Deseja sair do sistema?')) {
      try { localStorage.removeItem('turismo_session'); } catch (e) {}
      window.location.href = 'login.html';
    }
  });
  $('btnMenu').addEventListener('click', function () { $('sidebar').classList.add('open'); $('sidebarBg').classList.add('show'); });
  $('sidebarBg').addEventListener('click', function () { $('sidebar').classList.remove('open'); $('sidebarBg').classList.remove('show'); });

  /* ================================================================== */
  /* ABAS E ESTADO                                                      */
  /* ================================================================== */

  var ABAS = [
    { id: 'painel', titulo: 'Painel' },
    { id: 'saldos', titulo: 'Saldos' },
    { id: 'movimentos', titulo: 'Movimentações' },
    { id: 'lancar', titulo: 'Entrada / Saída' },
    { id: 'perdas', titulo: 'Perdas e avarias' },
    { id: 'transferir', titulo: 'Transferência' },
    { id: 'inventario', titulo: 'Inventário' },
    { id: 'fichas', titulo: 'Ficha técnica' },
    { id: 'cardapio', titulo: 'Cardápio digital' },
    { id: 'cmv', titulo: 'CMV' },
    { id: 'relatorios', titulo: 'Relatórios' },
    { id: 'falhas', titulo: 'Falhas de baixa' }
  ];

  var SUBS = {
    painel: 'Indicadores, alertas e valor do estoque',
    saldos: 'Saldo atual por produto e por setor',
    movimentos: 'Histórico completo de entradas, saídas e ajustes',
    lancar: 'Registrar entrada, saída ou ajuste de saldo',
    perdas: 'Registrar e acompanhar perdas e avarias',
    transferir: 'Mover produto entre setores (cozinha, bar, produção…)',
    inventario: 'Contagem física com ajuste automático da divergência',
    fichas: 'Ingredientes por prato e custo por porção',
    cardapio: 'Disponibilidade dos produtos no cardápio digital',
    cmv: 'Custo da mercadoria vendida — contábil e gerencial',
    relatorios: 'Relatórios de estoque com exportação',
    falhas: 'Reconciliação das baixas que falharam'
  };

  var estado = {
    produtos: [], setores: [], saldos: [], movimentos: [],
    produtosPorId: {}, aba: 'painel', falhas: [], relatorio: null
  };

  function renderTabs() {
    $('tabs').innerHTML = ABAS.map(function (a) {
      return '<button data-aba="' + a.id + '" class="' + (a.id === estado.aba ? 'on' : '') + '">' + esc(a.titulo) + '</button>';
    }).join('');
    $('tabs').querySelectorAll('[data-aba]').forEach(function (b) {
      b.addEventListener('click', function () { trocar(b.dataset.aba); });
    });
  }

  function trocar(id) {
    estado.aba = id;
    renderTabs();
    $('panes').querySelectorAll('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + id); });
    $('pageSub').textContent = SUBS[id] || '';
    if (id === 'painel') carregarPainel();
    if (id === 'saldos') renderSaldos();
    if (id === 'movimentos') carregarMovimentos();
    if (id === 'inventario') carregarInventarios();
    if (id === 'fichas') carregarFichas();
    if (id === 'cardapio') carregarCardapio();
    if (id === 'cmv') calcularCMV();
    if (id === 'falhas') carregarFalhas();
    if (id === 'transferir') { carregarSetores(); renderSetores(); }
  }/* ================================================================== */
  /* RENDER GERAL                                                       */
  /* ================================================================== */

  function renderTudo() {
    $('modoInfo').textContent = modoServidor() ? 'Modo servidor' : 'Modo local';
    $('avisos').innerHTML = modoServidor() ? '' :
      '<div class="aviso-servidor"><b>Modo local:</b> inventário, ficha técnica, CMV e relatórios exigem o servidor no ar. ' +
      'Entrada, saída, perda e transferência funcionam nos dois modos.</div>';
    if (!pode('estoque.visualizar')) {
      $('avisos').innerHTML = '<div class="erro-box">Seu perfil não tem a permissão <b>estoque.visualizar</b>.</div>';
    }

    $('panes').innerHTML =
      renderPainel() + renderSaldosPane() + renderMovimentos() + renderLancar() +
      renderPerdas() + renderTransferir() + renderInventario() + renderFichas() +
      renderCardapio() + renderCMV() + renderRelatorios() + renderFalhas();

    ligarTudo();
    carregarProdutos().then(function () { trocar(estado.aba); });
  }

  /* ---------------- PAINEL ---------------- */
  function renderPainel() {
    return '<div class="pane" id="pane-painel"><div id="painelConteudo"><div class="muted">Carregando indicadores…</div></div></div>';
  }

  function carregarPainel() {
    var el = $('painelConteudo');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando indicadores…</div>';

    Promise.all([
      DB.listarAlertasEstoque(EMPRESA).catch(function () { return []; }),
      DB.indicadoresEstoque(EMPRESA, {}).catch(function (e) { return { erro: e.message }; })
    ]).then(function (r) {
      var alertas = r[0] || [];
      var ind = r[1] || {};
      if (ind.erro) { el.innerHTML = '<div class="aviso-servidor">' + esc(ind.erro) + '</div>'; return; }

      el.innerHTML =
        '<div class="kpis">' +
          kpi('azul', 'Total de produtos', num(ind.totalProdutos, 0), '<path d="M3 3h18v4H3z"/><path d="M5 7v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7"/>') +
          kpi('verde', 'Valor do estoque', brl(ind.valorTotalEstoque), '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>') +
          kpi('amarelo', 'Abaixo do mínimo', num(ind.produtosAbaixoMinimo, 0), '<circle cx="12" cy="12" r="10"/><path d="M12 9v4M12 17h.01"/>') +
          kpi('vermelho', 'Sem estoque', num(ind.produtosSemEstoque, 0), '<path d="M18 6L6 18M6 6l12 12"/>') +
          kpi('roxo', 'Lotes vencidos', num(ind.lotesVencidos, 0), '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>') +
          kpi('cinza', 'Próx. vencimento', num(ind.lotesProximosVencimento, 0), '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>') +
        '</div>' +
        '<div class="grid2">' +
          '<div class="panel"><div class="panel-head"><h2>Movimento do período</h2>' +
            '<span class="muted">' + num(ind.movimentacoes, 0) + ' movimentação(ões)</span></div>' +
            '<div class="panel-body"><table><tbody>' +
              linhaMov('Entradas', ind.entradasPeriodo, ind.entradasQuantidade, 'on') +
              linhaMov('Saídas', ind.saidasPeriodo, ind.saidasQuantidade, 'info') +
              linhaMov('Perdas e avarias', ind.perdas, ind.perdasQuantidade, 'err') +
              linhaMov('Ajustes e inventário', ind.ajustes, ind.ajustesQuantidade, 'warn') +
            '</tbody></table></div></div>' +
          '<div class="panel"><div class="panel-head"><h2>Produtos mais consumidos</h2>' +
            '<span class="muted">por valor de custo</span></div>' +
            '<div class="panel-body" style="padding:0"><div style="overflow-x:auto"><table><thead><tr>' +
            '<th>Produto</th><th>Quantidade</th><th>Custo</th></tr></thead><tbody>' +
            ((ind.produtosMaisConsumidos || []).length
              ? ind.produtosMaisConsumidos.slice(0, 10).map(function (c) {
                return '<tr><td>' + esc(c.nome) + '</td><td>' + num(c.quantidade) + '</td><td>' + brl(c.valor) + '</td></tr>';
              }).join('')
              : '<tr><td colspan="3" class="empty">Sem consumo registrado.</td></tr>') +
            '</tbody></table></div></div></div>' +
        '</div>' +
        '<div class="panel"><div class="panel-head"><h2>Alertas</h2>' +
          '<span class="badge ' + (alertas.length ? 'warn' : 'on') + '">' + alertas.length + ' alerta(s)</span></div>' +
          '<div class="panel-body">' +
          (alertas.length
            ? '<ul class="checks">' + alertas.slice(0, 40).map(function (a) {
              return '<li><b>' + esc(rotuloAlerta(a.tipo)) + '</b>: ' + esc(a.mensagem) + '</li>';
            }).join('') + '</ul>' +
              '<div class="info-box" style="margin-top:12px">Os alertas exibidos dependem do que está ligado em ' +
              '<b>Configurações → Estoque</b>.</div>'
            : '<div class="muted">Nenhum alerta. Os avisos de estoque mínimo, validade e falha de baixa dependem da ' +
              'configuração em <b>Configurações → Estoque</b>.</div>') +
          '</div></div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>';
    });
  }

  function kpi(cor, titulo, valor, svg) {
    return '<div class="kpi"><div class="ico ' + cor + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + svg + '</svg></div>' +
      '<div><div class="n">' + valor + '</div><div class="t">' + esc(titulo) + '</div></div></div>';
  }
  function linhaMov(rotulo, valor, qtd, cor) {
    return '<tr><td><span class="badge ' + cor + '">' + esc(rotulo) + '</span></td>' +
      '<td>' + num(qtd) + '</td><td><b>' + brl(valor) + '</b></td></tr>';
  }
  function rotuloAlerta(t) {
    return { ESTOQUE_MINIMO: 'Estoque mínimo', VALIDADE_VENCIDA: 'Vencido', VALIDADE_PROXIMA: 'Vencendo', FALHA_ATUALIZACAO: 'Falha de baixa' }[t] || t;
  }

  /* ---------------- SALDOS ---------------- */
  function renderSaldosPane() {
    return '<div class="pane" id="pane-saldos">' +
      '<div class="panel"><div class="panel-head"><div><h2>Saldos</h2>' +
        '<div class="desc">Saldo consolidado e a quebra por setor. Toda alteração passa por movimentação registrada.</div></div>' +
        '<div class="actions">' +
          '<button class="btn btn-ghost-m btn-sm" id="btnRecarregarSaldos">Recarregar</button>' +
          '<button class="btn btn-ghost-m btn-sm" id="btnExportarSaldos">Exportar CSV</button>' +
        '</div></div>' +
        '<div class="panel-body">' +
          '<div class="filtros">' +
            '<div class="field"><label for="fBuscaSaldo">Buscar</label>' +
              '<input id="fBuscaSaldo" placeholder="nome, código interno ou código de barras" /></div>' +
            '<div class="field"><label for="fCatSaldo">Categoria</label><select id="fCatSaldo"><option value="">Todas</option></select></div>' +
            '<div class="field"><label for="fSitSaldo">Situação</label><select id="fSitSaldo">' +
              '<option value="">Todas</option><option value="abaixo">Abaixo do mínimo</option>' +
              '<option value="zero">Sem estoque</option><option value="ok">Normal</option></select></div>' +
          '</div>' +
          '<div id="listaSaldos"><div class="muted">Carregando…</div></div>' +
        '</div></div></div>';
  }

  function renderSaldos() {
    var el = $('listaSaldos');
    if (!el) return;
    var busca = ($('fBuscaSaldo') || {}).value || '';
    var cat = ($('fCatSaldo') || {}).value || '';
    var sit = ($('fSitSaldo') || {}).value || '';

    DB.listarSaldosEstoque(EMPRESA, { busca: busca, categoria: cat }).then(function (arr) {
      estado.saldos = arr;
      estado.produtosPorId = {};
      arr.forEach(function (p) { estado.produtosPorId[p.id] = p; });

      var sel = $('fCatSaldo');
      if (sel && sel.options.length <= 1) {
        var cats = {};
        arr.forEach(function (p) { if (p.categoria) cats[p.categoria] = 1; });
        sel.innerHTML = '<option value="">Todas</option>' + Object.keys(cats).sort().map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
        }).join('');
        sel.value = cat;
      }

      var lista = arr.filter(function (p) {
        if (sit === 'abaixo' && !p.abaixoMinimo) return false;
        if (sit === 'zero' && p.estoqueAtual > 0) return false;
        if (sit === 'ok' && (p.abaixoMinimo || p.estoqueAtual <= 0)) return false;
        return true;
      });

      if (!lista.length) { el.innerHTML = '<div class="empty">Nenhum produto encontrado com estes filtros.</div>'; return; }

      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Mínimo</th>' +
        '<th>Custo</th><th>Valor total</th><th>Setores</th><th>Situação</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + lista.map(function (p) {
          var sitTxt = p.estoqueAtual <= 0 ? 'SEM ESTOQUE' : (p.abaixoMinimo ? 'ABAIXO DO MIN.' : 'OK');
          var sitCls = p.estoqueAtual <= 0 ? 'err' : (p.abaixoMinimo ? 'warn' : 'on');
          var setores = (p.setores || []).filter(function (s) { return Math.abs(s.quantidade) > 0.0001; })
            .map(function (s) { return esc(s.setor) + ': ' + num(s.quantidade); }).join(' · ') || '—';
          return '<tr><td><b>' + esc(p.nome) + '</b>' +
            (p.codigoInterno ? '<br /><span class="mono muted">' + esc(p.codigoInterno) + '</span>' : '') + '</td>' +
            '<td>' + esc(p.categoria || '—') + '</td>' +
            '<td>' + esc(p.unidade) + '</td>' +
            '<td><b' + (p.estoqueAtual < 0 ? ' class="neg"' : '') + '>' + num(p.estoqueAtual) + '</b></td>' +
            '<td>' + num(p.estoqueMinimo) + '</td>' +
            '<td>' + brl(p.precoCusto) + '</td>' +
            '<td>' + brl(p.estoqueAtual * p.precoCusto) + '</td>' +
            '<td class="muted" style="max-width:180px">' + setores + '</td>' +
            '<td><span class="badge ' + sitCls + '">' + esc(sitTxt) + '</span></td>' +
            '<td><div class="td-actions">' +
              (pode('estoque.ajustar') ? '<button class="btn btn-sm btn-ghost-m" data-ajustar="' + p.id + '">Ajustar</button>' : '') +
              '<button class="btn btn-sm btn-ghost-m" data-hist="' + p.id + '">Histórico</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>';

      el.querySelectorAll('[data-ajustar]').forEach(function (b) {
        b.addEventListener('click', function () { modalAjuste(estado.produtosPorId[Number(b.dataset.ajustar)]); });
      });
      el.querySelectorAll('[data-hist]').forEach(function (b) {
        b.addEventListener('click', function () { modalHistoricoProduto(Number(b.dataset.hist)); });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>';
    });
  }/* ---------------- MOVIMENTAÇÕES ---------------- */
  function renderMovimentos() {
    return '<div class="pane" id="pane-movimentos">' +
      '<div class="panel"><div class="panel-head"><div><h2>Movimentações</h2>' +
        '<div class="desc">Cada linha é uma alteração de saldo, com usuário, origem e documento. Nada é sobrescrito — o histórico é permanente.</div></div>' +
        '<div class="actions">' +
          '<button class="btn btn-ghost-m btn-sm" id="btnFiltrarMov">Filtrar</button>' +
          '<button class="btn btn-ghost-m btn-sm" id="btnExportarMov">Exportar CSV</button>' +
        '</div></div>' +
        '<div class="panel-body">' +
          '<div class="filtros">' +
            '<div class="field"><label for="mvPeriodo">Período</label><select id="mvPeriodo">' +
              '<option value="hoje">Hoje</option><option value="7dias">7 dias</option>' +
              '<option value="30dias" selected>30 dias</option><option value="mes">Mês atual</option>' +
              '<option value="">Todo o período</option></select></div>' +
            '<div class="field"><label for="mvTipo">Tipo</label><select id="mvTipo"><option value="">Todos</option>' +
              ['ENTRADA_COMPRA', 'ENTRADA_MANUAL', 'SAIDA_PDV', 'SAIDA_PEDIDO', 'SAIDA_DELIVERY', 'SAIDA_PRODUCAO',
                'PERDA', 'AVARIA', 'DEVOLUCAO', 'TRANSFERENCIA', 'AJUSTE', 'INVENTARIO', 'CANCELAMENTO', 'ESTORNO']
                .map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="mvSetor">Setor</label><select id="mvSetor"><option value="">Todos</option></select></div>' +
          '</div>' +
          '<div id="listaMov"><div class="muted">Carregando…</div></div>' +
        '</div></div></div>';
  }

  function carregarMovimentos() {
    var el = $('listaMov');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarMovimentacoesEstoque(EMPRESA, {
      periodo: ($('mvPeriodo') || {}).value || '30dias',
      tipoMovimento: ($('mvTipo') || {}).value || '',
      setor: ($('mvSetor') || {}).value || ''
    }).then(function (r) {
      var linhas = (r && r.linhas) || [];
      estado.movimentos = linhas;
      if (!linhas.length) { el.innerHTML = '<div class="empty">Nenhuma movimentação no período.</div>'; return; }

      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Data</th><th>Produto</th><th>Tipo</th><th>Qtd</th><th>Saldo ant.</th><th>Saldo novo</th>' +
        '<th>Custo</th><th>Valor</th><th>Lote</th><th>Origem</th><th>Documento</th><th>Usuário</th>' +
        '</tr></thead><tbody>' + linhas.map(function (m) {
          var entrada = ['ENTRADA_COMPRA', 'ENTRADA_MANUAL', 'DEVOLUCAO', 'CANCELAMENTO', 'ESTORNO'].indexOf(m.tipoMovimento) !== -1;
          return '<tr><td class="muted">' + esc(m.data) + '</td>' +
            '<td>' + esc(m.produtoNome || ('#' + m.produtoId)) + '</td>' +
            '<td><span class="badge ' + (entrada ? 'on' : 'info') + '">' + esc(m.tipoMovimento) + '</span></td>' +
            '<td>' + num(m.quantidadeNum) + ' ' + esc(m.unidade || '') + '</td>' +
            '<td class="muted">' + num(m.estoqueAnteriorNum) + '</td>' +
            '<td><b>' + num(m.estoquePosteriorNum) + '</b></td>' +
            '<td>' + brl(m.custoUnitarioNum) + '</td>' +
            '<td>' + brl(m.valorTotalNum) + '</td>' +
            '<td class="mono">' + esc(m.lote || '—') + '</td>' +
            '<td class="muted">' + esc(m.origem || '—') + '</td>' +
            '<td class="mono muted">' + esc(m.documentoId || '—') + '</td>' +
            '<td class="muted">' + esc(m.usuario || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">' + linhas.length + ' movimentação(ões) no período.</div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>';
    });
  }

  /* ---------------- ENTRADA / SAÍDA ---------------- */
  function renderLancar() {
    var ro = !pode('estoque.movimentar') ? ' disabled' : '';
    return '<div class="pane" id="pane-lancar">' +
      '<div class="panel"><div class="panel-head"><div><h2>Entrada, saída e ajuste</h2>' +
        '<div class="desc">Toda operação gera movimentação com o seu usuário. O saldo nunca é editado direto.</div></div></div>' +
        '<div class="panel-body">' +
          (!pode('estoque.movimentar') ? '<div class="erro-box">Seu perfil não tem a permissão <b>estoque.movimentar</b>.</div>' : '') +
          '<div class="grid3">' +
            '<div class="field full"><label for="lProduto">Produto</label><select id="lProduto"' + ro + '></select></div>' +
            '<div class="field"><label for="lTipo">Operação</label><select id="lTipo"' + ro + '>' +
              '<option value="ENTRADA_COMPRA">Entrada por compra</option>' +
              '<option value="ENTRADA_MANUAL">Entrada manual</option>' +
              '<option value="SAIDA_PEDIDO">Saída (pedido/consumo)</option>' +
              '<option value="DEVOLUCAO">Devolução</option>' +
              '<option value="AJUSTE">Ajuste de saldo</option>' +
            '</select></div>' +
            '<div class="field"><label for="lQtd">Quantidade</label><input id="lQtd" type="number" step="0.001" min="0" value="1"' + ro + ' /></div>' +
            '<div class="field"><label for="lCusto">Custo unitário (R$)</label><input id="lCusto" type="number" step="0.01" min="0" value="0"' + ro + ' />' +
              '<span class="hint">Em entrada por compra, este valor atualiza o custo médio do produto.</span></div>' +
            '<div class="field"><label for="lSetor">Setor</label><select id="lSetor"' + ro + '></select></div>' +
            '<div class="field"><label for="lLote">Lote</label><input id="lLote" placeholder="opcional"' + ro + ' /></div>' +
            '<div class="field"><label for="lValidade">Validade</label><input id="lValidade" type="date"' + ro + ' /></div>' +
            '<div class="field full"><label for="lObs">Observação</label><input id="lObs" placeholder="ex.: NF 1234 do fornecedor"' + ro + ' /></div>' +
          '</div>' +
          '<div class="actions" style="margin-top:16px">' +
            '<button class="btn btn-primary" id="btnLancar"' + ro + '>Registrar movimentação</button>' +
          '</div>' +
          '<div id="resultadoLancar" style="margin-top:14px"></div>' +
        '</div></div></div>';
  }

  function carregarSetores() {
    return DB.listarSetoresEstoque(EMPRESA).then(function (arr) {
      estado.setores = arr || [];
      var opts = '<option value="">— padrão da empresa —</option>' + estado.setores.map(function (s) {
        return '<option value="' + esc(s.nome) + '">' + esc(s.nome) + (s.tipo ? ' (' + esc(s.tipo) + ')' : '') + '</option>';
      }).join('');
      ['lSetor', 'mvSetor', 'tfOrigem', 'tfDestino', 'pdSetor'].forEach(function (id) {
        var el = $(id);
        if (!el) return;
        var atual = el.value;
        el.innerHTML = opts;
        if (atual && el.querySelector('option[value="' + atual + '"]')) el.value = atual;
      });
      return estado.setores;
    }).catch(function () { return []; });
  }

  function carregarProdutos() {
    return DB.listarProdutos(EMPRESA).then(function (arr) {
      estado.produtos = arr || [];
      var opts = '<option value="">— selecione —</option>' + estado.produtos.map(function (p) {
        return '<option value="' + p.id + '">' + esc(p.nome) + (p.unidade ? ' (' + esc(p.unidade) + ')' : '') + '</option>';
      }).join('');
      ['lProduto', 'pdProduto', 'tfProduto', 'ajProduto'].forEach(function (id) {
        var el = $(id);
        if (el) el.innerHTML = opts;
      });
      return carregarSetores();
    }).catch(function () { return null; });
  }

  /* ---------------- PERDAS ---------------- */
  function renderPerdas() {
    var ro = !pode('estoque.movimentar') ? ' disabled' : '';
    return '<div class="pane" id="pane-perdas">' +
      '<div class="panel"><div class="panel-head"><div><h2>Registrar perda ou avaria</h2>' +
        '<div class="desc">A perda baixa o estoque e fica registrada com motivo e custo — é o que permite medir o que se perde na operação.</div></div></div>' +
        '<div class="panel-body">' +
          (!pode('estoque.movimentar') ? '<div class="erro-box">Seu perfil não tem a permissão <b>estoque.movimentar</b>.</div>' : '') +
          '<div class="grid3">' +
            '<div class="field full"><label for="pdProduto">Produto</label><select id="pdProduto"' + ro + '></select></div>' +
            '<div class="field"><label for="pdTipo">Tipo</label><select id="pdTipo"' + ro + '>' +
              '<option value="PERDA">Perda</option><option value="AVARIA">Avaria</option></select></div>' +
            '<div class="field"><label for="pdQtd">Quantidade</label><input id="pdQtd" type="number" step="0.001" min="0" value="1"' + ro + ' /></div>' +
            '<div class="field"><label for="pdSetor">Setor</label><select id="pdSetor"' + ro + '></select></div>' +
            '<div class="field"><label for="pdLote">Lote</label><input id="pdLote"' + ro + ' /></div>' +
            '<div class="field full"><label for="pdMotivo">Motivo *</label>' +
              '<input id="pdMotivo" placeholder="ex.: produto vencido, embalagem rompida, quebra no manuseio"' + ro + ' /></div>' +
          '</div>' +
          '<div class="actions" style="margin-top:16px">' +
            '<button class="btn btn-danger" id="btnRegistrarPerda"' + ro + '>Registrar perda</button>' +
          '</div>' +
          '<div id="resultadoPerda" style="margin-top:14px"></div>' +
        '</div></div>' +
      '<div class="panel"><div class="panel-head"><h2>Perdas registradas</h2>' +
        '<button class="btn btn-ghost-m btn-sm" id="btnVerPerdas">Carregar perdas</button></div>' +
        '<div class="panel-body" id="listaPerdas"><div class="muted">Clique em "Carregar perdas".</div></div></div>' +
      '</div>';
  }

  /* ---------------- TRANSFERÊNCIA ---------------- */
  function renderTransferir() {
    var ro = !pode('estoque.transferir') ? ' disabled' : '';
    return '<div class="pane" id="pane-transferir">' +
      '<div class="panel"><div class="panel-head"><div><h2>Transferência entre setores</h2>' +
        '<div class="desc">Move o saldo de um setor para outro (estoque central → cozinha, bar → restaurante…). ' +
        'O saldo consolidado da empresa NÃO muda: o produto apenas mudou de lugar.</div></div></div>' +
        '<div class="panel-body">' +
          (!pode('estoque.transferir') ? '<div class="erro-box">Seu perfil não tem a permissão <b>estoque.transferir</b>.</div>' : '') +
          '<div class="grid3">' +
            '<div class="field full"><label for="tfProduto">Produto</label><select id="tfProduto"' + ro + '></select></div>' +
            '<div class="field"><label for="tfOrigem">Setor de origem *</label><select id="tfOrigem"' + ro + '></select></div>' +
            '<div class="field"><label for="tfDestino">Setor de destino *</label><select id="tfDestino"' + ro + '></select></div>' +
            '<div class="field"><label for="tfQtd">Quantidade</label><input id="tfQtd" type="number" step="0.001" min="0" value="1"' + ro + ' /></div>' +
            '<div class="field full"><label for="tfObs">Observação</label><input id="tfObs"' + ro + ' /></div>' +
          '</div>' +
          '<div class="actions" style="margin-top:16px">' +
            '<button class="btn btn-primary" id="btnTransferir"' + ro + '>Transferir</button>' +
            (pode('estoque.movimentar') ? '<button class="btn btn-ghost-m" id="btnNovoSetor">+ Criar setor</button>' : '') +
          '</div>' +
          '<div id="resultadoTransferir" style="margin-top:14px"></div>' +
        '</div></div>' +
      '<div class="panel"><div class="panel-head"><h2>Setores cadastrados</h2></div>' +
        '<div class="panel-body" id="listaSetores"><div class="muted">Carregando…</div></div></div>' +
      '</div>';
  }

  function renderSetores() {
    var el = $('listaSetores');
    if (!el) return;
    if (!estado.setores.length) { el.innerHTML = '<div class="muted">Nenhum setor cadastrado.</div>'; return; }
    el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Código</th><th>Nome</th><th>Tipo</th><th>Padrão</th><th>Situação</th></tr></thead><tbody>' +
      estado.setores.map(function (s) {
        return '<tr><td class="mono">' + esc(s.codigo || '—') + '</td><td><b>' + esc(s.nome) + '</b></td>' +
          '<td>' + esc(s.tipo || '—') + '</td><td>' + (s.padrao ? '<span class="badge info">padrão</span>' : '—') + '</td>' +
          '<td>' + badge(!!s.ativo, 'Ativo', 'Inativo') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }/* ---------------- INVENTÁRIO ---------------- */
  function renderInventario() {
    return '<div class="pane" id="pane-inventario">' +
      '<div class="panel"><div class="panel-head"><div><h2>Inventário</h2>' +
        '<div class="desc">A abertura CONGELA o saldo do sistema. Ao fechar, cada divergência vira um ajuste com movimentação — nunca uma edição direta do saldo.</div></div>' +
        (pode('estoque.inventario') ? '<button class="btn btn-primary btn-sm" id="btnAbrirInventario">Abrir inventário</button>' : '') +
      '</div>' +
        '<div class="panel-body" id="listaInventarios"><div class="muted">Carregando…</div></div></div></div>';
  }

  function carregarInventarios() {
    var el = $('listaInventarios');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.executarRelatorioEstoque(EMPRESA, 'inventario', {}).then(function (r) {
      var linhas = (r && r.linhas) || [];
      if (!linhas.length) {
        el.innerHTML = '<div class="muted">Nenhum inventário ainda. Use "Abrir inventário" para iniciar a contagem.</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Nº</th><th>Descrição</th><th>Setor</th><th>Status</th><th>Aberto</th><th>Fechado</th>' +
        '<th>Itens</th><th>Divergências</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + linhas.map(function (i) {
          var cls = i.status === 'aberto' ? 'warn' : (i.status === 'fechado' ? 'on' : 'off');
          return '<tr><td class="mono">' + esc(i.id) + '</td>' +
            '<td>' + esc(i.descricao || '—') + '</td>' +
            '<td>' + esc(i.setor || 'todos') + '</td>' +
            '<td><span class="badge ' + cls + '">' + esc(i.status) + '</span></td>' +
            '<td class="muted">' + esc(i.abertoEmTxt) + '</td>' +
            '<td class="muted">' + esc(i.fechadoEmTxt || '—') + '</td>' +
            '<td>' + i.itens + '</td>' +
            '<td>' + (i.divergentes ? '<span class="badge warn">' + i.divergentes + '</span>' : '0') + '</td>' +
            '<td><div class="td-actions">' +
              '<button class="btn btn-sm btn-ghost-m" data-contar-inv="' + i.id + '">Contar</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>';

      el.querySelectorAll('[data-contar-inv]').forEach(function (b) {
        b.addEventListener('click', function () { modalContagem(Number(b.dataset.contarInv)); });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  function modalContagem(inventarioId) {
    DB.obterInventario(EMPRESA, inventarioId).then(function (inv) {
      var aberto = inv.status === 'aberto';
      abrirModal('<h3>Inventário #' + inv.id + (inv.setor ? ' — ' + esc(inv.setor) : '') + '</h3>' +
        '<div class="sub">Status: <b>' + esc(inv.status) + '</b>. ' +
        (aberto ? 'Informe a quantidade contada. Deixe em branco o que ainda não foi contado.'
          : 'Inventário já fechado — apenas consulta.') + '</div>' +
        '<div style="max-height:420px;overflow-y:auto"><table><thead><tr>' +
        '<th>Produto</th><th>Sistema</th><th>Contado</th><th>Divergência</th></tr></thead><tbody>' +
        inv.itens.map(function (it) {
          var div = Number(it.divergencia) || 0;
          return '<tr><td>' + esc(it.produtoNome) + ' <span class="muted">' + esc(it.unidade || '') + '</span></td>' +
            '<td>' + num(it.quantidadeSistema) + '</td>' +
            '<td>' + (aberto
              ? '<input type="number" step="0.001" min="0" data-contar="' + it.id + '" value="' +
                (it.quantidadeContada == null ? '' : Number(it.quantidadeContada)) +
                '" style="padding:5px 8px;border:1.5px solid #e2e8f0;border-radius:7px;width:110px" />'
              : num(it.quantidadeContada)) + '</td>' +
            '<td>' + (div === 0 ? '—' : '<span class="badge ' + (div < 0 ? 'err' : 'on') + '">' + num(div) + '</span>') +
            (it.ajustado ? ' <span class="badge info">ajustado</span>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="modal-foot">' +
          (aberto && pode('estoque.inventario')
            ? '<button class="btn btn-danger" style="margin-right:auto" id="mCancelarInv">Cancelar inventário</button>' +
              '<button class="btn btn-ghost-m" id="mSalvarContagem">Salvar contagem</button>' +
              '<button class="btn btn-primary" id="mFecharInv">Fechar e ajustar</button>'
            : '<button class="btn btn-primary" id="mCancel">Fechar</button>') +
        '</div>', true);

      /* Salva em sequência (não em paralelo) para a mensagem de erro apontar
       * exatamente qual item falhou, em vez de "alguma coisa falhou". */
      function salvarContagem() {
        var campos = $('modalBox').querySelectorAll('[data-contar]');
        var fila = Promise.resolve();
        var salvos = 0;
        campos.forEach(function (c) {
          if (c.value === '' || c.value == null) return;
          fila = fila.then(function () {
            return DB.contarItemInventario(EMPRESA, {
              itemId: Number(c.dataset.contar), quantidadeContada: Number(c.value)
            }).then(function () { salvos++; });
          });
        });
        return fila.then(function () { return salvos; });
      }

      if ($('mCancel')) $('mCancel').addEventListener('click', fecharModal);
      if ($('mCancelarInv')) $('mCancelarInv').addEventListener('click', function () {
        if (!confirm('Cancelar o inventário? Nenhum ajuste será aplicado.')) return;
        DB.cancelarInventario(EMPRESA, inventarioId).then(function () {
          fecharModal(); toast('Inventário cancelado.', 'ok'); carregarInventarios();
        }).catch(function (e) { toast(e.message, 'err'); });
      });
      if ($('mSalvarContagem')) $('mSalvarContagem').addEventListener('click', function () {
        salvarContagem().then(function (n) {
          toast(n + ' item(ns) contado(s) salvos.', 'ok');
          modalContagem(inventarioId);
        }).catch(function (e) { toast(e.message, 'err'); });
      });
      if ($('mFecharInv')) $('mFecharInv').addEventListener('click', function () {
        if (!confirm('Fechar o inventário e aplicar as divergências como ajuste de estoque?')) return;
        salvarContagem().then(function () { return DB.fecharInventario(EMPRESA, inventarioId); })
          .then(function (r) {
            fecharModal();
            abrirModal('<h3>Inventário fechado</h3>' +
              '<div class="ok-box">' + r.ajustes.length + ' ajuste(s) aplicado(s).</div>' +
              (r.ajustes.length
                ? '<div style="overflow-x:auto"><table><thead><tr><th>Produto</th><th>Divergência</th></tr></thead><tbody>' +
                  r.ajustes.map(function (a) {
                    return '<tr><td>' + esc(a.nome) + '</td><td>' + num(a.divergencia) + '</td></tr>';
                  }).join('') + '</tbody></table></div>' : '') +
              (r.falhas.length
                ? '<div class="erro-box">' + r.falhas.length + ' item(ns) não ajustados:</div><ul class="checks">' +
                  r.falhas.map(function (f) { return '<li>' + esc(f.nome) + ': ' + esc(f.erro) + '</li>'; }).join('') + '</ul>'
                : '') +
              '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
            $('mCancel').addEventListener('click', fecharModal);
            carregarInventarios();
          }).catch(function (e) { toast(e.message, 'err'); });
      });
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------------- FICHA TÉCNICA ---------------- */
  function renderFichas() {
    return '<div class="pane" id="pane-fichas">' +
      '<div class="panel"><div class="panel-head"><div><h2>Ficha técnica</h2>' +
        '<div class="desc">Ao vender o prato, o sistema baixa os INGREDIENTES conforme a ficha — não o prato. ' +
        'O rendimento divide a receita (1 receita para 10 porções = quantidade ÷ 10).</div></div>' +
        (pode('produto.editar') ? '<button class="btn btn-primary btn-sm" id="btnNovaFicha">+ Nova ficha técnica</button>' : '') +
      '</div>' +
        '<div class="panel-body" id="listaFichas"><div class="muted">Carregando…</div></div></div></div>';
  }

  function carregarFichas() {
    var el = $('listaFichas');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarFichasTecnicas(EMPRESA).then(function (arr) {
      if (!arr.length) {
        el.innerHTML = '<div class="muted">Nenhuma ficha técnica cadastrada. Cadastre os ingredientes de cada prato ' +
          'para que a venda baixe o estoque corretamente.</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Produto vendido</th><th>Rendimento</th><th>Ingredientes</th><th>Custo porção</th><th>Preço</th><th>Margem</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + arr.map(function (f) {
          var margem = Number(f.margemPercentual) || 0;
          return '<tr><td><b>' + esc(f.produtoNome) + '</b></td>' +
            '<td>' + num(f.rendimento || 1) + ' ' + esc(f.unidadeRendimento || '') + '</td>' +
            '<td>' + f.qtdIngredientes + '</td>' +
            '<td>' + brl(f.custoTotal) + '</td>' +
            '<td>' + brl(f.preco) + '</td>' +
            '<td><span class="badge ' + (margem > 0 ? 'on' : 'err') + '">' + num(margem, 1) + '%</span></td>' +
            '<td><div class="td-actions">' +
              '<button class="btn btn-sm btn-ghost-m" data-verficha="' + f.produtoId + '">Ver</button>' +
              (pode('produto.editar') ? '<button class="btn btn-sm btn-warn" data-edficha="' + f.produtoId + '">Editar</button>' : '') +
              (pode('produto.editar') ? '<button class="btn btn-sm btn-danger" data-delficha="' + f.produtoId + '">Excluir</button>' : '') +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>';

      el.querySelectorAll('[data-verficha]').forEach(function (b) {
        b.addEventListener('click', function () { modalFicha(Number(b.dataset.verficha), false); });
      });
      el.querySelectorAll('[data-edficha]').forEach(function (b) {
        b.addEventListener('click', function () { modalFicha(Number(b.dataset.edficha), true); });
      });
      el.querySelectorAll('[data-delficha]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Excluir a ficha técnica deste produto? A venda volta a baixar o próprio produto.')) return;
          DB.removerFichaTecnica(EMPRESA, Number(b.dataset.delficha))
            .then(function () { toast('Ficha técnica excluída.', 'ok'); carregarFichas(); })
            .catch(function (e) { toast(e.message, 'err'); });
        });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }/* ---------------- CARDÁPIO DIGITAL ---------------- */
  function renderCardapio() {
    return '<div class="pane" id="pane-cardapio">' +
      '<div class="panel"><div class="panel-head"><div><h2>Disponibilidade no cardápio digital</h2>' +
        '<div class="desc">O que aparece aqui depende de <b>Configurações → Estoque</b>: ' +
        '"Controlar disponibilidade" e "Considerar estoque dos ingredientes".</div></div>' +
        '<button class="btn btn-ghost-m btn-sm" id="btnRecarregarCardapio">Recarregar</button></div>' +
        '<div class="panel-body" id="listaCardapio"><div class="muted">Carregando…</div></div></div></div>';
  }

  function carregarCardapio() {
    var el = $('listaCardapio');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarCardapio(EMPRESA).then(function (arr) {
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhum produto de venda cadastrado.</div>'; return; }
      var indisponiveis = arr.filter(function (p) { return !p.disponivel; }).length;

      el.innerHTML =
        '<div class="kpis">' +
          kpi('verde', 'Disponíveis', num(arr.length - indisponiveis, 0), '<path d="M20 6L9 17l-5-5"/>') +
          kpi('vermelho', 'Indisponíveis', num(indisponiveis, 0), '<path d="M18 6L6 18M6 6l12 12"/>') +
        '</div>' +
        '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Produto</th><th>Categoria</th><th>Preço</th><th>Situação</th><th>Motivo</th></tr></thead><tbody>' +
        arr.map(function (p) {
          return '<tr><td><b>' + esc(p.nome) + '</b></td><td>' + esc(p.categoria || '—') + '</td>' +
            '<td>' + brl(p.preco) + '</td>' +
            '<td><span class="badge ' + (p.disponivel ? 'on' : 'err') + '">' +
              (p.disponivel ? 'DISPONÍVEL' : 'INDISPONÍVEL') + '</span></td>' +
            '<td class="muted">' + esc(p.motivo || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  /* ---------------- CMV ---------------- */
  function renderCMV() {
    return '<div class="pane" id="pane-cmv">' +
      '<div class="panel"><div class="panel-head"><div><h2>CMV — Custo da Mercadoria Vendida</h2>' +
        '<div class="desc">O sistema apura pelas DUAS metodologias e NUNCA as mistura. Cada bloco diz qual método usou.</div></div>' +
        '<div class="actions">' +
          '<select id="cmvPeriodo" style="padding:8px 12px;border:1.5px solid #e2e8f0;border-radius:9px;font-family:inherit">' +
            '<option value="mes">Mês atual</option><option value="hoje">Hoje</option>' +
            '<option value="7dias">7 dias</option><option value="30dias" selected>30 dias</option>' +
            '<option value="">Todo o período</option></select>' +
          '<button class="btn btn-primary btn-sm" id="btnCalcularCMV">Calcular</button>' +
        '</div></div>' +
        '<div class="panel-body" id="resultadoCMV"><div class="muted">Escolha o período e clique em Calcular.</div></div></div></div>';
  }

  function calcularCMV() {
    var el = $('resultadoCMV');
    if (!el) return;
    el.innerHTML = '<div class="muted">Calculando…</div>';
    DB.calcularCMV(EMPRESA, { periodo: ($('cmvPeriodo') || {}).value || '30dias' }).then(function (r) {
      if (!r) { el.innerHTML = '<div class="muted">Sem resultado.</div>'; return; }
      el.innerHTML =
        '<div class="grid2">' +
          '<div class="panel" style="margin:0"><div class="panel-head"><h2>CMV contábil</h2>' +
            '<span class="badge info">CONTÁBIL</span></div><div class="panel-body">' +
            '<div class="muted" style="margin-bottom:12px">' + esc(r.contabil.descricao) + '</div>' +
            '<table><tbody>' +
              '<tr><td>Estoque inicial</td><td><b>' + brl(r.contabil.estoqueInicial) + '</b></td></tr>' +
              '<tr><td>(+) Compras</td><td>' + brl(r.contabil.compras) + '</td></tr>' +
              '<tr><td>(−) Estoque final</td><td>' + brl(r.contabil.estoqueFinal) + '</td></tr>' +
              '<tr style="background:#f0f9ff"><td><b>CMV</b></td><td><b>' + brl(r.contabil.cmv) + '</b></td></tr>' +
            '</tbody></table></div></div>' +
          '<div class="panel" style="margin:0"><div class="panel-head"><h2>CMV gerencial</h2>' +
            '<span class="badge warn">GERENCIAL</span></div><div class="panel-body">' +
            '<div class="muted" style="margin-bottom:12px">' + esc(r.gerencial.descricao) + '</div>' +
            '<div style="font-size:26px;font-weight:700;margin-bottom:12px">' + brl(r.gerencial.cmv) + '</div>' +
            ((r.gerencial.itens || []).length
              ? '<div style="max-height:260px;overflow-y:auto"><table><thead><tr><th>Produto</th><th>Qtd</th><th>Custo</th></tr></thead><tbody>' +
                r.gerencial.itens.slice(0, 30).map(function (i) {
                  return '<tr><td>' + esc(i.nome) + '</td><td>' + num(i.quantidade) + '</td><td>' + brl(i.custo) + '</td></tr>';
                }).join('') + '</tbody></table></div>'
              : '<div class="muted">Sem vendas no período.</div>') +
          '</div></div>' +
        '</div>' +
        '<div class="aviso-servidor" style="margin-top:16px"><b>Atenção:</b> ' + esc(r.aviso) + '</div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  /* ---------------- RELATÓRIOS ---------------- */
  var RELATORIOS = [
    ['estoque_atual', 'Estoque atual'], ['movimentacoes', 'Movimentação de estoque'],
    ['entradas', 'Entradas'], ['saidas', 'Saídas'], ['perdas', 'Perdas'],
    ['ajustes', 'Ajustes'], ['inventario', 'Inventários'], ['vencidos', 'Produtos vencidos'],
    ['a_vencer', 'Próximos do vencimento'], ['consumo', 'Consumo por período'],
    ['consumo_setor', 'Consumo por setor'], ['curva_abc', 'Curva ABC'],
    ['custo_estoque', 'Custo de estoque'], ['ficha_tecnica', 'Ficha técnica'],
    ['produtos_vendidos', 'Produtos vendidos'], ['sem_estoque', 'Produtos sem estoque']
  ];

  function renderRelatorios() {
    return '<div class="pane" id="pane-relatorios">' +
      '<div class="panel"><div class="panel-head"><div><h2>Relatórios</h2>' +
        '<div class="desc">Exportação em CSV (Excel pt-BR), Excel e PDF (pela impressão da tela).</div></div></div>' +
        '<div class="panel-body">' +
          '<div class="filtros">' +
            '<div class="field"><label for="rlNome">Relatório</label><select id="rlNome">' +
              RELATORIOS.map(function (r) { return '<option value="' + r[0] + '">' + r[1] + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="rlPeriodo">Período</label><select id="rlPeriodo">' +
              '<option value="hoje">Hoje</option><option value="7dias">7 dias</option>' +
              '<option value="30dias" selected>30 dias</option><option value="mes">Mês atual</option>' +
              '<option value="">Todo o período</option><option value="custom">Personalizado</option></select></div>' +
            '<div class="field" id="wrapRlDe" style="display:none"><label for="rlDe">De</label><input id="rlDe" type="date" /></div>' +
            '<div class="field" id="wrapRlAte" style="display:none"><label for="rlAte">Até</label><input id="rlAte" type="date" /></div>' +
            '<div class="field"><label for="rlSetor">Setor</label><select id="rlSetor"><option value="">Todos</option></select></div>' +
            '<div class="field"><label for="rlCategoria">Categoria</label><input id="rlCategoria" placeholder="todas" /></div>' +
          '</div>' +
          '<div class="actions">' +
            '<button class="btn btn-primary" id="btnGerarRelatorio">Gerar relatório</button>' +
            '<button class="btn btn-ghost-m" id="btnExportarCSV">Exportar CSV</button>' +
            '<button class="btn btn-ghost-m" id="btnExportarExcel">Exportar Excel</button>' +
            '<button class="btn btn-ghost-m" id="btnImprimirRelatorio">Imprimir / salvar PDF</button>' +
          '</div>' +
          '<div id="resultadoRelatorio" style="margin-top:18px"><div class="muted">Escolha o relatório e clique em Gerar.</div></div>' +
        '</div></div></div>';
  }

  function filtroRelatorio() {
    var per = ($('rlPeriodo') || {}).value || '30dias';
    var f = { setor: ($('rlSetor') || {}).value || '', categoria: ($('rlCategoria') || {}).value || '' };
    if (per === 'custom') { f.de = ($('rlDe') || {}).value; f.ate = ($('rlAte') || {}).value; }
    else f.periodo = per;
    return f;
  }

  function gerarRelatorio() {
    var el = $('resultadoRelatorio');
    var nome = ($('rlNome') || {}).value || 'estoque_atual';
    el.innerHTML = '<div class="muted">Gerando…</div>';
    DB.executarRelatorioEstoque(EMPRESA, nome, filtroRelatorio()).then(function (r) {
      if (!r) { el.innerHTML = '<div class="muted">Sem dados.</div>'; return; }

      /* Relatórios de indicadores e CMV vêm com um bloco `bruto` em vez de
       * tabela — são painéis, não linhas. */
      if (r.bruto) {
        el.innerHTML = '<div class="info-box">' + esc(r.titulo) + '</div>' +
          '<pre class="mono" style="background:#f8fafc;padding:14px;border-radius:11px;overflow-x:auto;font-size:12px">' +
          esc(JSON.stringify(r.bruto, null, 2)) + '</pre>';
        estado.relatorio = null;
        return;
      }

      estado.relatorio = r;
      if (!r.linhas.length) { el.innerHTML = '<div class="empty">Nenhum registro para este filtro.</div>'; return; }

      el.innerHTML = '<div class="panel-head" style="padding:0 0 12px"><div>' +
        '<h2>' + esc(r.titulo) + '</h2>' +
        (r.periodo ? '<div class="desc">' + esc(r.periodo.rotulo || '') + '</div>' : '') +
        '</div><span class="badge info">' + r.linhas.length + ' linha(s)</span></div>' +
        '<div style="overflow-x:auto;max-height:560px"><table><thead><tr>' +
        r.colunas.map(function (c) { return '<th>' + esc(c.titulo) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + r.linhas.slice(0, 400).map(function (l) {
          return '<tr>' + r.colunas.map(function (c) {
            var v = l[c.chave];
            if (typeof v === 'number') return '<td>' + (Number.isInteger(v) ? num(v, 0) : num(v, 3)) + '</td>';
            return '<td>' + esc(v == null ? '—' : v) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (r.totais ? '<div class="info-box" style="margin-top:12px"><b>Totais:</b> ' +
          Object.keys(r.totais).map(function (k) { return esc(k) + ': ' + (typeof r.totais[k] === 'number' ? num(r.totais[k], 3) : esc(r.totais[k])); }).join(' | ') +
          '</div>' : '');
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  function exportarRelatorio(formato) {
    var nome = ($('rlNome') || {}).value || 'estoque_atual';
    if (formato === 'pdf') {
      /* PDF pela janela de impressão: o que o usuário vê é o que sai. */
      if (!estado.relatorio) return toast('Gere o relatório antes de imprimir.', 'err');
      var janela = window.open('', '_blank');
      var r = estado.relatorio;
      janela.document.write('<html><head><meta charset="utf-8"><title>' + esc(r.titulo) + '</title>' +
        '<style>body{font-family:Segoe UI,Arial,sans-serif;font-size:11px;padding:20px}' +
        'h2{margin:0 0 4px}.sub{color:#64748b;margin-bottom:12px}' +
        'table{border-collapse:collapse;width:100%}th{background:#f1f5f9;border:1px solid #cbd5e1;padding:5px;text-align:left}' +
        'td{border:1px solid #e2e8f0;padding:4px}</style></head><body>' +
        '<h2>' + esc(r.titulo) + '</h2><div class="sub">Turismo OS &middot; ' + new Date().toLocaleString('pt-BR') + '</div>' +
        '<table><thead><tr>' + r.colunas.map(function (c) { return '<th>' + esc(c.titulo) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.linhas.map(function (l) {
          return '<tr>' + r.colunas.map(function (c) {
            var v = l[c.chave];
            return '<td>' + esc(typeof v === 'number' ? num(v, 3) : (v == null ? '' : v)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></body></html>');
      janela.document.close();
      janela.focus();
      setTimeout(function () { janela.print(); }, 400);
      return;
    }

    DB.exportarRelatorioEstoque(EMPRESA, nome, formato === 'excel' ? 'excel' : 'csv', filtroRelatorio())
      .then(function (r) {
        baixar(r.nomeArquivo, r.conteudo, r.mime);
        toast('Arquivo gerado: ' + r.nomeArquivo, 'ok');
      }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------------- FALHAS DE BAIXA ---------------- */
  function renderFalhas() {
    return '<div class="pane" id="pane-falhas">' +
      '<div class="panel"><div class="panel-head"><div><h2>Falhas de baixa de estoque</h2>' +
        '<div class="desc">Quando a baixa falha (falta de saldo, por exemplo), a VENDA NÃO É PERDIDA: ' +
        'ela fica aqui para reconciliação. Reprocessar não duplica movimentação.</div></div>' +
        '<button class="btn btn-ghost-m btn-sm" id="btnRecarregarFalhas">Recarregar</button></div>' +
        '<div class="panel-body" id="listaFalhas"><div class="muted">Carregando…</div></div></div></div>';
  }

  function carregarFalhas() {
    var el = $('listaFalhas');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarFalhasEstoque(EMPRESA, 'PENDENTE').then(function (arr) {
      estado.falhas = arr || [];
      if (!arr.length) {
        el.innerHTML = '<div class="ok-box">Nenhuma falha pendente. As baixas de estoque estão em dia.</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Documento</th><th>Origem</th><th>Operação</th><th>Tentativas</th><th>Erro</th><th>Criado</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + arr.map(function (f) {
          return '<tr><td class="mono">' + esc(f.documentoId || '—') + '</td>' +
            '<td>' + esc(f.origem || '—') + '</td>' +
            '<td><span class="badge warn">' + esc(f.operacao) + '</span></td>' +
            '<td>' + (f.tentativas || 1) + '</td>' +
            '<td class="muted" style="max-width:300px">' + esc(f.erro || '') + '</td>' +
            '<td class="muted">' + esc(String(f.criadoEm || '').slice(0, 16).replace('T', ' ')) + '</td>' +
            '<td><div class="td-actions">' +
              (pode('estoque.ajustar')
                ? '<button class="btn btn-sm btn-ok" data-reproc="' + f.id + '">Reprocessar</button>' +
                  '<button class="btn btn-sm btn-ghost-m" data-descartar="' + f.id + '">Descartar</button>'
                : '') +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>';

      el.querySelectorAll('[data-reproc]').forEach(function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          DB.reprocessarFalhaEstoque(EMPRESA, Number(b.dataset.reproc)).then(function (r) {
            toast(r.resolvido ? 'Baixa reprocessada com sucesso.' : ('Ainda falhou: ' + r.erro), r.resolvido ? 'ok' : 'err');
            carregarFalhas();
          }).catch(function (e) { b.disabled = false; toast(e.message, 'err'); });
        });
      });
      el.querySelectorAll('[data-descartar]').forEach(function (b) {
        b.addEventListener('click', function () {
          var motivo = prompt('Motivo para descartar esta falha (fica registrado):');
          if (!motivo) return;
          DB.descartarFalhaEstoque(EMPRESA, Number(b.dataset.descartar), motivo)
            .then(function () { toast('Falha descartada.', 'ok'); carregarFalhas(); })
            .catch(function (e) { toast(e.message, 'err'); });
        });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }/* ================================================================== */
  /* MODAIS                                                             */
  /* ================================================================== */

  function modalAjuste(p) {
    if (!p) return;
    abrirModal('<h3>Ajustar estoque — ' + esc(p.nome) + '</h3>' +
      '<div class="sub">O ajuste vira uma movimentação do tipo AJUSTE, com o seu usuário e o motivo informado.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Estoque atual</label><input value="' + num(p.estoqueAtual) + '" disabled /></div>' +
        '<div class="field"><label>Quantidade nova *</label><input id="ajNova" type="number" step="0.001" min="0" value="' + p.estoqueAtual + '" /></div>' +
        '<div class="field"><label>Setor</label><select id="ajSetor"><option value="">— padrão —</option>' +
          estado.setores.map(function (s) { return '<option>' + esc(s.nome) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field full"><label>Motivo *</label><input id="ajMotivo" placeholder="ex.: erro de digitação, contagem física" /></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Aplicar ajuste</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var nova = Number($('ajNova').value);
      var motivo = $('ajMotivo').value.trim();
      if (!motivo) return toast('Informe o motivo do ajuste.', 'err');
      $('mOk').disabled = true;
      DB.ajustarEstoque(EMPRESA, {
        produtoId: p.id, quantidadeNova: nova, motivo: motivo,
        setor: $('ajSetor').value || undefined, usuario: USUARIO
      }).then(function (r) {
        fecharModal();
        toast('Ajuste aplicado. Saldo: ' + num(r.estoquePosterior), 'ok');
        renderSaldos();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function modalHistoricoProduto(produtoId) {
    var p = estado.produtosPorId[produtoId] || {};
    DB.listarMovimentacoesEstoque(EMPRESA, { produtoId: produtoId }).then(function (r) {
      var linhas = (r && r.linhas) || [];
      abrirModal('<h3>Histórico — ' + esc(p.nome || ('#' + produtoId)) + '</h3>' +
        '<div class="sub">' + linhas.length + ' movimentação(ões). O histórico é permanente: nada é apagado.</div>' +
        (linhas.length
          ? '<div style="max-height:420px;overflow-y:auto"><table><thead><tr>' +
            '<th>Data</th><th>Tipo</th><th>Qtd</th><th>Saldo novo</th><th>Lote</th><th>Usuário</th></tr></thead><tbody>' +
            linhas.map(function (m) {
              return '<tr><td class="muted">' + esc(m.data) + '</td>' +
                '<td><span class="badge info">' + esc(m.tipoMovimento) + '</span></td>' +
                '<td>' + num(m.quantidadeNum) + '</td><td>' + num(m.estoquePosteriorNum) + '</td>' +
                '<td class="mono">' + esc(m.lote || '—') + '</td>' +
                '<td class="muted">' + esc(m.usuario || '—') + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="muted">Nenhuma movimentação registrada.</div>') +
        '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>', true);
      $('mCancel').addEventListener('click', fecharModal);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function modalFicha(produtoId, editar) {
    DB.obterFichaTecnica(EMPRESA, produtoId).then(function (ficha) {
      var temFicha = !!ficha;
      if (!temFicha && !editar) { toast('Este produto não possui ficha técnica.', 'err'); return; }
      var p = estado.produtosPorId[produtoId] || estado.produtos.filter(function (x) { return x.id === produtoId; })[0] || {};

      if (temFicha && !editar) {
        abrirModal('<h3>Ficha técnica — ' + esc(ficha.nome || p.nome) + '</h3>' +
          '<div class="grid3">' +
            '<div class="field"><label>Rendimento</label><div><b>' + num(ficha.rendimento) + '</b> ' + esc(ficha.unidadeRendimento || '') + '</div></div>' +
            '<div class="field"><label>Custo por porção</label><div><b>' + brl(ficha.custoPorcao) + '</b></div></div>' +
            '<div class="field"><label>Preço de venda</label><div>' + brl(p.preco) + '</div></div>' +
          '</div>' +
          '<div class="subtitulo" style="margin-top:16px;font-size:12px;text-transform:uppercase;color:#64748b;font-weight:700">Ingredientes</div>' +
          '<div style="overflow-x:auto"><table><thead><tr>' +
          '<th>Ingrediente</th><th>Qtd na receita</th><th>Perda %</th><th>Consumo/porção</th><th>Custo/porção</th><th>Estoque</th>' +
          '</tr></thead><tbody>' + ficha.itens.map(function (it) {
            var porcao = (Number(it.quantidade) / (Number(ficha.rendimento) || 1)) * (1 + (Number(it.fatorPerda) || 0) / 100);
            return '<tr><td>' + esc(it.ingredienteNome) + '</td>' +
              '<td>' + num(it.quantidade) + ' ' + esc(it.unidade || '') + '</td>' +
              '<td>' + num(it.fatorPerda) + '</td>' +
              '<td>' + num(porcao) + ' ' + esc(it.unidade || '') + '</td>' +
              '<td>' + brl(porcao * (Number(it.precoCusto) || 0)) + '</td>' +
              '<td>' + num(it.estoqueAtual) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>', true);
        $('mCancel').addEventListener('click', fecharModal);
        return;
      }

      /* Edição: as linhas de ingrediente são dinâmicas. Os produtos que já
       * têm ficha não aparecem como ingrediente de si mesmos. */
      var itens = temFicha ? ficha.itens.map(function (i) {
        return { ingredienteId: i.ingredienteId, quantidade: Number(i.quantidade), unidade: i.unidade, fatorPerda: Number(i.fatorPerda) || 0 };
      }) : [{ ingredienteId: '', quantidade: 0, unidade: '', fatorPerda: 0 }];

      abrirModal('<h3>Ficha técnica — ' + esc(p.nome || ('#' + produtoId)) + '</h3>' +
        '<div class="sub">Ao vender 1 unidade do produto, o sistema baixa a quantidade informada dividida pelo rendimento.</div>' +
        '<div class="grid3">' +
          '<div class="field"><label>Nome da ficha</label><input id="fcNome" value="' + esc((ficha && ficha.nome) || p.nome || '') + '" /></div>' +
          '<div class="field"><label>Rendimento (porções) *</label>' +
            '<input id="fcRend" type="number" step="0.01" min="0.01" value="' + ((ficha && ficha.rendimento) || 1) + '" /></div>' +
          '<div class="field"><label>Unidade do rendimento</label>' +
            '<input id="fcUnidade" value="' + esc((ficha && ficha.unidadeRendimento) || p.unidade || 'UN') + '" /></div>' +
        '</div>' +
        '<div class="field" style="margin-top:12px"><label>Modo de preparo</label><textarea id="fcModo">' + esc((ficha && ficha.modoPreparo) || '') + '</textarea></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px">' +
          '<b style="font-size:13px">Ingredientes</b>' +
          '<button class="btn btn-sm btn-ghost-m" id="btnAddIng">+ Adicionar ingrediente</button>' +
        '</div>' +
        '<div id="fcItens" style="margin-top:8px"></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="mOk">Salvar ficha técnica</button></div>', true);

      function renderItens() {
        $('fcItens').innerHTML = itens.map(function (it, i) {
          return '<div class="filtros" style="margin-bottom:8px" data-linha="' + i + '">' +
            '<div class="field" style="flex:2;min-width:200px"><label>Ingrediente</label><select data-ing="' + i + '">' +
              '<option value="">— selecione —</option>' +
              estado.produtos.filter(function (x) { return x.id !== produtoId; }).map(function (x) {
                return '<option value="' + x.id + '"' + (x.id === it.ingredienteId ? ' selected' : '') + '>' + esc(x.nome) + '</option>';
              }).join('') + '</select></div>' +
            '<div class="field" style="min-width:110px"><label>Quantidade</label>' +
              '<input type="number" step="0.0001" min="0" data-qtd="' + i + '" value="' + it.quantidade + '" /></div>' +
            '<div class="field" style="min-width:90px"><label>Unidade</label>' +
              '<input data-un="' + i + '" value="' + esc(it.unidade || '') + '" /></div>' +
            '<div class="field" style="min-width:90px"><label>Perda %</label>' +
              '<input type="number" step="0.01" min="0" data-perda="' + i + '" value="' + it.fatorPerda + '" /></div>' +
            '<button class="btn btn-sm btn-danger" data-rem="' + i + '" style="margin-bottom:2px">Remover</button>' +
          '</div>';
        }).join('');

        function ler() {
          $('fcItens').querySelectorAll('[data-ing]').forEach(function (s) {
            var i = Number(s.dataset.ing);
            itens[i].ingredienteId = s.value ? Number(s.value) : '';
          });
          $('fcItens').querySelectorAll('[data-qtd]').forEach(function (s) { itens[Number(s.dataset.qtd)].quantidade = Number(s.value) || 0; });
          $('fcItens').querySelectorAll('[data-un]').forEach(function (s) { itens[Number(s.dataset.un)].unidade = s.value; });
          $('fcItens').querySelectorAll('[data-perda]').forEach(function (s) { itens[Number(s.dataset.perda)].fatorPerda = Number(s.value) || 0; });
        }

        $('fcItens').querySelectorAll('select[data-ing]').forEach(function (s) {
          s.addEventListener('change', function () {
            ler();
            var ing = estado.produtos.filter(function (x) { return x.id === Number(s.value); })[0];
            if (ing) itens[Number(s.dataset.ing)].unidade = ing.unidade || 'UN';
            renderItens();
          });
        });
        $('fcItens').querySelectorAll('[data-rem]').forEach(function (b) {
          b.addEventListener('click', function () {
            ler();
            itens.splice(Number(b.dataset.rem), 1);
            if (!itens.length) itens.push({ ingredienteId: '', quantidade: 0, unidade: '', fatorPerda: 0 });
            renderItens();
          });
        });
        $('fcItens')._lerItens = ler;
      }
      renderItens();

      $('btnAddIng').addEventListener('click', function () {
        $('fcItens')._lerItens();
        itens.push({ ingredienteId: '', quantidade: 0, unidade: '', fatorPerda: 0 });
        renderItens();
      });
      $('mCancel').addEventListener('click', fecharModal);
      $('mOk').addEventListener('click', function () {
        $('fcItens')._lerItens();
        var validos = itens.filter(function (i) { return i.ingredienteId && Number(i.quantidade) > 0; });
        if (!validos.length) return toast('Informe ao menos um ingrediente com quantidade maior que zero.', 'err');
        $('mOk').disabled = true;
        DB.salvarFichaTecnica(EMPRESA, {
          produtoId: produtoId, nome: $('fcNome').value.trim(),
          rendimento: Number($('fcRend').value) || 1,
          unidadeRendimento: $('fcUnidade').value.trim(),
          modoPreparo: $('fcModo').value, itens: validos
        }).then(function (r) {
          fecharModal();
          toast('Ficha técnica salva. Custo por porção: ' + brl(r.custoUnitario), 'ok');
          carregarFichas();
        }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
      });
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function modalNovoSetor() {
    abrirModal('<h3>Novo setor de estoque</h3>' +
      '<div class="sub">Setores permitem separar o saldo por local: cozinha, bar, frigobar, almoxarifado…</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Nome *</label><input id="stNome" placeholder="ex.: ADEGA" /></div>' +
        '<div class="field"><label>Tipo</label><select id="stTipo">' +
          ['CENTRAL', 'PRODUCAO', 'VENDA', 'OUTROS'].map(function (t) { return '<option>' + t + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Criar setor</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var nome = $('stNome').value.trim();
      if (!nome) return toast('Informe o nome do setor.', 'err');
      DB.criarSetorEstoque(EMPRESA, { nome: nome, tipo: $('stTipo').value })
        .then(function () {
          fecharModal(); toast('Setor criado.', 'ok');
          return carregarSetores();
        }).then(function () { renderSetores(); })
        .catch(function (e) { toast(e.message, 'err'); });
    });
  }

  function modalAbrirInventario() {
    abrirModal('<h3>Abrir inventário</h3>' +
      '<div class="sub">A abertura congela o saldo atual do sistema para comparação com a contagem física.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Setor</label><select id="invSetor"><option value="">Todos os produtos controlados</option>' +
          estado.setores.map(function (s) { return '<option>' + esc(s.nome) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>Descrição</label><input id="invDesc" placeholder="ex.: Contagem mensal de janeiro" /></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Abrir inventário</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      $('mOk').disabled = true;
      DB.abrirInventario(EMPRESA, {
        setor: $('invSetor').value || undefined,
        descricao: $('invDesc').value.trim(), usuario: USUARIO
      }).then(function (r) {
        fecharModal();
        toast('Inventário aberto com ' + r.itens + ' item(ns).', 'ok');
        carregarInventarios();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function modalLancarResultado(titulo, r) {
    var el = $('resultado' + (titulo === 'perda' ? 'Perda' : titulo === 'transferencia' ? 'Transferir' : 'Lancar'));
    if (!el) return;
    el.innerHTML = '<div class="ok-box"><b>Registrado.</b> ' + esc(r.nomeProduto || '') + '<br />' +
      'Saldo anterior: ' + num(r.estoqueAnterior) + ' → Saldo atual: <b>' + num(r.estoquePosterior) + '</b>' +
      (r.lotes && r.lotes.length
        ? '<br />Lote(s): ' + r.lotes.map(function (l) { return esc(l.lote) + ' (' + num(l.quantidade) + ')'; }).join(', ')
        : '') +
      '</div>';
  }

  /* ================================================================== */
  /* LIGAÇÕES DE EVENTOS                                                */
  /* ================================================================== */

  function ligarTudo() {
    // SALDOS
    if ($('btnRecarregarSaldos')) $('btnRecarregarSaldos').addEventListener('click', renderSaldos);
    if ($('fBuscaSaldo')) $('fBuscaSaldo').addEventListener('input', debounce(renderSaldos, 350));
    if ($('fCatSaldo')) $('fCatSaldo').addEventListener('change', renderSaldos);
    if ($('fSitSaldo')) $('fSitSaldo').addEventListener('change', renderSaldos);
    if ($('btnExportarSaldos')) $('btnExportarSaldos').addEventListener('click', function () {
      DB.exportarRelatorioEstoque(EMPRESA, 'estoque_atual', 'csv', {})
        .then(function (r) { baixar(r.nomeArquivo, r.conteudo, r.mime); toast('CSV gerado.', 'ok'); })
        .catch(function (e) { toast(e.message, 'err'); });
    });

    // MOVIMENTAÇÕES
    if ($('btnFiltrarMov')) $('btnFiltrarMov').addEventListener('click', carregarMovimentos);
    if ($('mvPeriodo')) $('mvPeriodo').addEventListener('change', carregarMovimentos);
    if ($('mvTipo')) $('mvTipo').addEventListener('change', carregarMovimentos);
    if ($('mvSetor')) $('mvSetor').addEventListener('change', carregarMovimentos);
    if ($('btnExportarMov')) $('btnExportarMov').addEventListener('click', function () {
      DB.exportarRelatorioEstoque(EMPRESA, 'movimentacoes', 'csv', {
        periodo: ($('mvPeriodo') || {}).value || '30dias',
        tipoMovimento: ($('mvTipo') || {}).value || ''
      }).then(function (r) { baixar(r.nomeArquivo, r.conteudo, r.mime); toast('CSV gerado.', 'ok'); })
        .catch(function (e) { toast(e.message, 'err'); });
    });

    // LANÇAR
    if ($('btnLancar')) $('btnLancar').addEventListener('click', function () {
      var produtoId = Number($('lProduto').value);
      if (!produtoId) return toast('Selecione o produto.', 'err');
      var qtd = Number($('lQtd').value);
      if (!(qtd > 0)) return toast('A quantidade deve ser maior que zero.', 'err');
      var tipo = $('lTipo').value;
      var base = {
        produtoId: produtoId, quantidade: qtd, usuario: USUARIO,
        custoUnitario: Number($('lCusto').value) || undefined,
        setor: $('lSetor').value || undefined,
        lote: $('lLote').value.trim() || undefined,
        dataValidade: $('lValidade').value || undefined,
        observacao: $('lObs').value.trim() || undefined
      };
      $('btnLancar').disabled = true;

      var acao;
      if (tipo === 'AJUSTE') {
        // Ajuste trabalha com a QUANTIDADE NOVA, não com a diferença.
        var p = estado.produtosPorId[produtoId] || estado.produtos.filter(function (x) { return x.id === produtoId; })[0];
        DB.ajustarEstoque(EMPRESA, {
          produtoId: produtoId, quantidadeNova: qtd, setor: base.setor,
          motivo: base.observacao || 'Ajuste pela tela de estoque', usuario: USUARIO
        }).then(function (r) { modalLancarResultado('lancar', r); })
          .catch(function (e) { toast(e.message, 'err'); })
          .then(function () { $('btnLancar').disabled = false; renderSaldos(); });
        return;
      }
      if (tipo === 'ENTRADA_COMPRA' || tipo === 'ENTRADA_MANUAL' || tipo === 'DEVOLUCAO') {
        acao = DB.entradaEstoque(EMPRESA, Object.assign({}, base, { tipoMovimento: tipo, origem: tipo }));
      } else {
        acao = DB.saidaEstoque(EMPRESA, Object.assign({}, base, { tipoMovimento: tipo, origem: tipo }));
      }
      acao.then(function (r) { modalLancarResultado('lancar', r); toast('Movimentação registrada.', 'ok'); })
        .catch(function (e) { toast(e.message, 'err'); })
        .then(function () { $('btnLancar').disabled = false; renderSaldos(); });
    });

    // PERDAS
    if ($('btnRegistrarPerda')) $('btnRegistrarPerda').addEventListener('click', function () {
      var produtoId = Number($('pdProduto').value);
      if (!produtoId) return toast('Selecione o produto.', 'err');
      var motivo = $('pdMotivo').value.trim();
      if (!motivo) return toast('Informe o motivo da perda.', 'err');
      var p = estado.produtos.filter(function (x) { return x.id === produtoId; })[0] || {};
      $('btnRegistrarPerda').disabled = true;
      DB.registrarPerdaEstoque(EMPRESA, {
        produtoId: produtoId, quantidade: Number($('pdQtd').value) || 0,
        tipo: $('pdTipo').value, setor: $('pdSetor').value || undefined,
        lote: $('pdLote').value.trim() || undefined,
        custoUnitario: Number(p.precoCusto) || 0,
        motivo: motivo, usuario: USUARIO
      }).then(function (r) {
        modalLancarResultado('perda', r);
        toast('Perda registrada.', 'ok');
        $('pdMotivo').value = '';
        $('pdQtd').value = 1;
        carregarListaPerdas();
      }).catch(function (e) { toast(e.message, 'err'); })
        .then(function () { $('btnRegistrarPerda').disabled = false; renderSaldos(); });
    });
    if ($('btnVerPerdas')) $('btnVerPerdas').addEventListener('click', carregarListaPerdas);

    // TRANSFERÊNCIA
    if ($('btnTransferir')) $('btnTransferir').addEventListener('click', function () {
      var produtoId = Number($('tfProduto').value);
      if (!produtoId) return toast('Selecione o produto.', 'err');
      if (!$('tfOrigem').value || !$('tfDestino').value) return toast('Informe o setor de origem e o de destino.', 'err');
      $('btnTransferir').disabled = true;
      DB.transferirEstoque(EMPRESA, {
        produtoId: produtoId, setorOrigem: $('tfOrigem').value, setorDestino: $('tfDestino').value,
        quantidade: Number($('tfQtd').value) || 0, observacao: $('tfObs').value.trim(), usuario: USUARIO
      }).then(function (r) {
        modalLancarResultado('transferencia', r);
        toast('Transferência concluída.', 'ok');
        renderSaldos();
      }).catch(function (e) { toast(e.message, 'err'); })
        .then(function () { $('btnTransferir').disabled = false; });
    });
    if ($('btnNovoSetor')) $('btnNovoSetor').addEventListener('click', modalNovoSetor);

    // INVENTÁRIO
    if ($('btnAbrirInventario')) $('btnAbrirInventario').addEventListener('click', modalAbrirInventario);

    // FICHA TÉCNICA
    if ($('btnNovaFicha')) $('btnNovaFicha').addEventListener('click', function () {
      var produtoId = Number(($('lProduto') || {}).value || 0) || (estado.produtos[0] || {}).id;
      if (!produtoId) return toast('Cadastre um produto primeiro.', 'err');
      modalFicha(produtoId, true);
    });

    // CARDÁPIO
    if ($('btnRecarregarCardapio')) $('btnRecarregarCardapio').addEventListener('click', carregarCardapio);

    // CMV
    if ($('btnCalcularCMV')) $('btnCalcularCMV').addEventListener('click', calcularCMV);

    // RELATÓRIOS
    if ($('rlPeriodo')) $('rlPeriodo').addEventListener('change', function () {
      var custom = this.value === 'custom';
      if ($('wrapRlDe')) $('wrapRlDe').style.display = custom ? '' : 'none';
      if ($('wrapRlAte')) $('wrapRlAte').style.display = custom ? '' : 'none';
    });
    if ($('btnGerarRelatorio')) $('btnGerarRelatorio').addEventListener('click', gerarRelatorio);
    if ($('btnExportarCSV')) $('btnExportarCSV').addEventListener('click', function () { exportarRelatorio('csv'); });
    if ($('btnExportarExcel')) $('btnExportarExcel').addEventListener('click', function () { exportarRelatorio('excel'); });
    if ($('btnImprimirRelatorio')) $('btnImprimirRelatorio').addEventListener('click', function () { exportarRelatorio('pdf'); });

    // FALHAS
    if ($('btnRecarregarFalhas')) $('btnRecarregarFalhas').addEventListener('click', carregarFalhas);
  }

  function carregarListaPerdas() {
    var el = $('listaPerdas');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.executarRelatorioEstoque(EMPRESA, 'perdas', { periodo: '30dias' }).then(function (r) {
      var linhas = (r && r.linhas) || [];
      if (!linhas.length) { el.innerHTML = '<div class="muted">Nenhuma perda nos últimos 30 dias.</div>'; return; }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Data</th><th>Produto</th><th>Tipo</th><th>Qtd</th><th>Custo</th><th>Valor</th><th>Lote</th><th>Usuário</th>' +
        '</tr></thead><tbody>' + linhas.map(function (l) {
          return '<tr><td class="muted">' + esc(l.data) + '</td><td>' + esc(l.produtoNome) + '</td>' +
            '<td><span class="badge err">' + esc(l.tipoMovimento) + '</span></td>' +
            '<td>' + num(l.quantidadeNum) + '</td><td>' + brl(l.custoUnitarioNum) + '</td>' +
            '<td><b>' + brl(l.valorTotalNum) + '</b></td>' +
            '<td class="mono">' + esc(l.lote || '—') + '</td>' +
            '<td class="muted">' + esc(l.usuario || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">Total no período: <b>' + brl(r.totais.valorTotalNum) + '</b></div>';
    }).catch(function (e) { el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>'; });
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  /* ---------- Boot ---------- */
  $('btnRefresh').addEventListener('click', function () {
    carregarProdutos().then(function () { trocar(estado.aba); }).then(function () {
      toast('Estoque atualizado.', 'ok');
    }).catch(function (e) { toast(e.message, 'err'); });
  });

  DB.aoAtualizar(function (msg) {
    if (msg && (msg.entidade === 'estoque' || msg.entidade === 'produto')) {
      carregarProdutos().then(function () { trocar(estado.aba); }).catch(function () {});
    }
  });

  DB.init().then(renderTudo).catch(function (e) {
    $('avisos').innerHTML = '<div class="erro-box">Falha ao abrir o sistema: ' + esc(e.message) + '</div>';
  });
})();