/**
 * Turismo OS — posSettingsService.js
 * =====================================================================
 * Serviço de configurações da empresa, usado por TODAS as telas do PDV,
 * caixa, pedidos e estoque.
 *
 * POR QUE ESTE ARQUIVO EXISTE:
 *   Nenhum componente do sistema deve "saber" que existe uma configuração
 *   `bloquearVendaFracionadaUnidadeInteira`. O componente pergunta ao
 *   serviço e age conforme a resposta. Assim ligar/desligar um parâmetro
 *   na tela de Configurações muda o comportamento SEM alterar componente.
 *
 * COMO USA:
 *   posSettingsService.carregar(empresaId).then(function () {
 *     if (posSettingsService.get('bloquearItemValorZerado')) { ... }
 *   });
 *
 * O serviço mantém um cache em memória (carregado uma vez por sessão) e
 * se invalida quando a configuração é alterada em outra aba/dispositivo
 * (usa o mesmo canal de tempo real do DB).
 */
(function (global) {
  'use strict';

  /* Defaults espelhados de servidor/config.mjs.
   *
   * IMPORTANTE: estes valores precisam ser IDÊNTICOS aos do servidor.
   * Eles existem aqui apenas para o modo local (sem servidor); em modo
   * servidor quem responde é a API. Testes de integração conferem os
   * defaults do servidor, e esta lista segue a mesma especificação. */
  var DEFAULTS = {
    // PDV
    abrirVariasInstancias: false,
    escolherGarcomVendaDireta: false,
    confirmarPagamentoAutomatico: true,
    finalizarVendaAutomaticamente: false,
    senhaAoMudarTelaComVenda: false,
    arredondamentoAbnt: false,
    naoExibirProdutosVendaBalcao: false,
    naoExibirProdutosPedido: false,
    // Controle de quantidade
    bloquearVendaFracionadaUnidadeInteira: false,
    bloquearAlteracaoQtdAposBalanca: false,
    bloquearDivisaoValorPelaQuantidade: false,
    bloquearQuantidadeExorbitante: true,
    bloquearItemValorZerado: true,
    limiteQuantidadeExorbitante: 1000,
    // Caixa
    exigeAberturaCaixa: true,
    sangriaComAutorizacao: true,
    fechamentoCego: false,
    limiteSangria: 0,
    formasPagamento: ['Dinheiro', 'Pix', 'Debito', 'Credito', 'Faturado'],
    // Pedidos
    permitirMesmaMesaMultiplasComandas: false,
    exigirGarcomAoAbrirMesa: true,
    taxaServicoPadrao: 0,
    imprimirCozinhaAutomatico: false,
    permitirDelivery: false,
    tempoCancelamentoMin: 0,
    // Estoque
    ativarControleAutomaticoNovosProdutos: true,
    alertarEstoqueMinimo: false,
    alertarValidadeVencida: false,
    alertarFalhaAtualizacao: true,
    atualizarEstoqueTempoReal: false,
    controlarDisponibilidadeCardapio: false,
    considerarEstoqueIngredientes: false,
    permitirEstoqueNegativo: false,
    diasAlertaValidade: 30,
    metodoBaixaEstoque: 'DESATIVADO',
    exigirLoteEmEntrada: false,
    exigirValidadeEmEntrada: false,
    // Integrações
    whatsappAtivo: false,
    whatsappNumero: '',
    balancaAtiva: false,
    balancaProtocolo: 'NENHUM',
    cardapioDigitalAtivo: false,
    cardapioDigitalUrl: '',
    impressoraAtiva: false,
    impressoraNome: '',
    // API
    apiAtiva: false,
    apiSomenteLeitura: true,
    apiUrlsPermitidas: '',
    webhookUrl: '',
    // Segurança
    exigirSenhaAcoesSensiveis: true,
    expirarSessaoMin: 720,
    logAcessoAtivo: true,
    bloquearAposTentativas: 0,
    ipPermitidos: '',
    // Cadastros
    exigirCpfHospede: false,
    codigoInternoAutomatico: true,
    validarNcmObrigatorio: false,
    permitirExcluirProdutoVendido: false
  };

  /* Unidades em que a venda fracionada NÃO faz sentido. A lista sai da
   * definição do parâmetro `bloquearVendaFracionadaUnidadeInteira`, não de
   * um `if` espalhado pelo PDV. */
  var UNIDADES_INTEIRAS = ['UN', 'PC', 'CX', 'PCT', 'FD', 'DZ', 'RL', 'KIT'];

  var cache = {};
  var carregado = false;
  var _empresaId = null;
  var _ouvintes = [];

  function empresaPadrao() {
    try {
      var s = JSON.parse(localStorage.getItem('turismo_session') || 'null');
      return (s && s.empresaId != null) ? s.empresaId : 1;
    } catch (e) { return 1; }
  }

  /* Carrega a configuração da empresa (uma vez por sessão). */
  function carregar(empresaId) {
    _empresaId = empresaId || empresaPadrao();
    return DB.configListar(_empresaId).then(function (r) {
      var cfg = (r && r.config) ? r.config : {};
      // Achatamos as seções num único objeto: o componente pergunta pela
      // chave e não precisa saber de qual seção ela veio.
      var plano = {};
      Object.keys(cfg).forEach(function (secao) {
        var secaoDados = cfg[secao] || {};
        Object.keys(secaoDados).forEach(function (chave) { plano[chave] = secaoDados[chave]; });
      });
      cache = merge(DEFAULTS, plano);
      carregado = true;
      _ouvintes.forEach(function (fn) { try { fn(cache); } catch (e) { } });
      return cache;
    }).catch(function (e) {
      // Falha ao carregar NÃO pode derrubar o PDV: usa os defaults e avisa.
      console.warn('[posSettings] usando valores padrão:', e.message);
      cache = merge(DEFAULTS, {});
      carregado = true;
      return cache;
    });
  }

  function merge(base, extra) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(extra || {}).forEach(function (k) {
      if (extra[k] !== undefined && extra[k] !== null) out[k] = extra[k];
    });
    return out;
  }

  /* Lê um parâmetro. Se a configuração ainda não foi carregada, devolve o
   * PADRÃO (nunca undefined) — o PDV não pode quebrar por não ter chamado
   * carregar() antes. */
  function get(chave, padrao) {
    if (cache && cache[chave] !== undefined) return cache[chave];
    if (DEFAULTS[chave] !== undefined) return DEFAULTS[chave];
    return padrao;
  }

  function todos() { return merge(DEFAULTS, cache); }

  /* Salva uma seção. Invalida o cache e avisa quem escuta. */
  function salvar(secao, dados) {
    return DB.configSalvar(_empresaId || empresaPadrao(), secao, dados).then(function (novo) {
      var plano = {};
      Object.keys(novo || {}).forEach(function (k) { plano[k] = novo[k]; });
      cache = merge(cache, plano);
      _ouvintes.forEach(function (fn) { try { fn(cache); } catch (e) { } });
      return novo;
    });
  }

  function aoMudar(fn) {
    if (typeof fn === 'function') _ouvintes.push(fn);
    return function () { _ouvintes = _ouvintes.filter(function (f) { return f !== fn; }); };
  }

  /* ---------------- Validações de venda guiadas pela configuração -------
   *
   * Cada função abaixo responde uma pergunta do PDV. Nenhuma delas é
   * chamada por conta própria: quem chama é o componente de venda, quando
   * precisa decidir. Isso mantém o comportamento auditável. */

  /** Confere um item antes de fechar a venda. Devolve null (ok) ou o motivo. */
  function validarItemVenda(item, produto) {
    produto = produto || {};

    if (get('bloquearItemValorZerado')) {
      var total = (Number(item.quantidade) || 0) * (Number(item.preco) || 0);
      if (total <= 0) {
        return 'O item "' + (item.nome || item.produtoId) + '" está com valor total zerado. ' +
          'A configuração do PDV bloqueia a venda de itens sem valor.';
      }
    }

    if (get('bloquearQuantidadeExorbitante')) {
      var limite = Number(get('limiteQuantidadeExorbitante')) || 1000;
      if ((Number(item.quantidade) || 0) > limite) {
        return 'A quantidade de "' + (item.nome || item.produtoId) + '" (' + item.quantidade + ') ' +
          'passa do limite de ' + limite + ' configurado em PDV > Controle de quantidade.';
      }
    }

    if (get('bloquearVendaFracionadaUnidadeInteira')) {
      var un = String(produto.unidade || item.unidade || 'UN').toUpperCase();
      var q = Number(item.quantidade) || 0;
      if (UNIDADES_INTEIRAS.indexOf(un) !== -1 && Math.abs(q - Math.round(q)) > 0.0001) {
        return 'O produto "' + (item.nome || item.produtoId) + '" é vendido em ' + un +
          ' e a configuração bloqueia venda fracionada para unidade inteira.';
      }
    }

    return null;
  }

  /** Confere a venda inteira. Devolve { ok, motivos: [] }. */
  function validarVenda(itens, produtosPorId) {
    var motivos = [];
    (itens || []).forEach(function (it) {
      var p = produtosPorId ? produtosPorId[it.produtoId] : null;
      var m = validarItemVenda(it, p);
      if (m) motivos.push(m);
    });
    return { ok: motivos.length === 0, motivos: motivos };
  }

  /** O PDV deve esconder a lista de produtos na venda balcão? */
  function ocultarProdutosVendaBalcao() { return !!get('naoExibirProdutosVendaBalcao'); }

  /** O PDV deve esconder a lista de produtos em pedido (mesa/comanda/delivery)? */
  function ocultarProdutosPedido() { return !!get('naoExibirProdutosPedido'); }

  /** Aplica o arredondamento ABNT (quantidade x valor unitário) quando ligado. */
  function calcularValorItem(quantidade, valorUnitario) {
    var q = Number(quantidade) || 0;
    var v = Number(valorUnitario) || 0;
    if (get('arredondamentoAbnt')) {
      // ABNT NBR 5891: arredonda o produto para 2 casas com "meio para cima".
      return Math.round((q * v + Number.EPSILON) * 100) / 100;
    }
    return Number((q * v).toFixed(2));
  }

  /** Permite alterar a quantidade depois de capturada a balança? */
  function podeAlterarQuantidadeAposBalanca() { return !get('bloquearAlteracaoQtdAposBalanca'); }

  /** Permite dividir o valor pela quantidade (por pessoa / por item)? */
  function podeDividirValorPorQuantidade() { return !get('bloquearDivisaoValorPelaQuantidade'); }

  /** Pede senha ao trocar de tela com venda em andamento? */
  function exigeSenhaAoMudarTela() { return !!get('senhaAoMudarTelaComVenda'); }

  /** Finaliza a venda sem confirmação? */
  function finalizaAutomaticamente() { return !!get('finalizarVendaAutomaticamente'); }

  global.posSettingsService = {
    DEFAULTS: DEFAULTS,
    UNIDADES_INTEIRAS: UNIDADES_INTEIRAS,
    carregar: carregar,
    recarregar: function () { return carregar(_empresaId); },
    get: get,
    todos: todos,
    salvar: salvar,
    aoMudar: aoMudar,
    estaCarregado: function () { return carregado; },
    validarItemVenda: validarItemVenda,
    validarVenda: validarVenda,
    ocultarProdutosVendaBalcao: ocultarProdutosVendaBalcao,
    ocultarProdutosPedido: ocultarProdutosPedido,
    calcularValorItem: calcularValorItem,
    podeAlterarQuantidadeAposBalanca: podeAlterarQuantidadeAposBalanca,
    podeDividirValorPorQuantidade: podeDividirValorPorQuantidade,
    exigeSenhaAoMudarTela: exigeSenhaAoMudarTela,
    finalizaAutomaticamente: finalizaAutomaticamente
  };
})(window);