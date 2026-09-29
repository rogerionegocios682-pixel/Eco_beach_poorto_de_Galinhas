/**
 * Turismo OS — Camada de banco de dados (IndexedDB)
 * --------------------------------------------------------------
 * Banco nativo do navegador: persiste de verdade entre sessões
 * sem precisar instalar Node/MySQL/Postgres.
 *
 * Objetos (tabelas):
 *   usuarios  — contas de acesso (keyPath: id, índice único: usuario)
 *   sessoes   — log de acessos (keyPath: id, índice: usuario)
 *   salas     — quartos/salas do hotel (keyPath: id)
 *   mesas     — mesas do restaurante (keyPath: id)
 *   meta      — controle de versão/seed (keyPath: chave)
 *
 *   --- v3: retaguarda (gestão operacional) ---
 *   empresas  — estabelecimentos (multiempresa, keyPath: id)
 *   aptos     — apartamentos cadastrados (keyPath: id, índices: empresaId, numero)
 *   hospedes  — clientes/hóspedes (keyPath: id, índice: empresaId)
 *   reservas  — reservas criadas (keyPath: id, índices: empresaId, aptoId)
 *   hospedagens — estadias ativas/históricas (keyPath: id, índices: empresaId, aptoId)
 *   consumos  — consumo do restaurante vinculado à hospedagem/mesa (keyPath: id, índices: empresaId, hospedagemId)
 *   passantes — clientes sem hospedagem (keyPath: id, índice: empresaId)
 *
 *   TODAS as coleções de negócio carregam empresaId, isolando o acesso
 *   por estabelecimento (uma empresa nunca lê dados de outra).
 *
 * API usada pelo app:
 *   DB.init()                  -> abre e popula o banco
 *   DB.autenticar(u, s)        -> { ok, usuario } | { ok:false, erro }
 *   DB.listarUsuarios()        -> array
 *   DB.criarUsuario(obj)       -> id
 *   DB.atualizarUsuario(id, d) -> ok
 *   DB.removerUsuario(id)      -> ok
 *   DB.listarSalas() / listarMesas()
 *   DB.registrarSessao(u)      -> id
 *   DB.listarSessoes(limite)   -> array
 *   DB.resetarBanco()          -> apaga e recria (útil em testes)
 *   DB.modoAtivo()             -> 'servidor' | 'local'
 *   DB.servidorURL()           -> URL do servidor detectado
 */
(function (global) {
  'use strict';

  var DB_NOME = 'turismo_os';
  // v6: acrescenta empresa_config (parametros por secao), product_stock
  // (saldo por setor), recipe/recipe_items (ficha tecnica) e a fila de
  // falhas de estoque. Nenhum store existente e alterado ou removido.
  var DB_VERSAO = 6;
  var _db = null;

  /* ==============================================================
   * MODO SERVIDOR (tempo real entre dispositivos)
   * --------------------------------------------------------------
   * Se houver um servidor Node no ar, o sistema opera sobre ele via
   * HTTP + WebSocket - os MESMOS dados aparecem em celular, tablet e
   * computador. Se o servidor nao responder, cai automaticamente para
   * o IndexedDB local (modo offline), sem quebrar nada.
   *
   * A URL do servidor e derivada da propria origem da pagina quando ela
   * e servida por http/https. Para paginas abertas por file://, procura
   * em http://localhost:3000.
   * ============================================================== */
  var SERVIDOR = (function () {
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
    } catch (e) {}
    return 'http://localhost:3000';
  })();

  var _modo = 'local';   // 'local' (IndexedDB) | 'servidor'
  var _ws = null;
  var _wsTentando = false;

  function modoServidor() { return _modo === 'servidor'; }

  // Chama a API do servidor. Devolve o campo `dados` da resposta.
  function api(rota, payload) {
    return fetch(SERVIDOR + '/api/' + rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          var err = new Error(j.erro || ('Falha na API (' + r.status + ')'));
          if (j.conflito) err.conflito = j.conflito;
          throw err;
        });
      }
      return r.json();
    }).then(function (j) { return j.dados; });
  }

  // Detecta se ha servidor disponivel (timeout curto para nao travar o app).
  function detectarServidor() {
    return new Promise(function (resolve) {
      var controle = ('AbortController' in window) ? new AbortController() : null;
      var timer = setTimeout(function () { if (controle) controle.abort(); resolve(false); }, 1500);
      fetch(SERVIDOR + '/api/sync/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: 1 }),
        signal: controle ? controle.signal : undefined
      }).then(function (r) {
        clearTimeout(timer); resolve(r.ok);
      }).catch(function () { clearTimeout(timer); resolve(false); });
    });
  }

  // Token de sessao gravado pelo login (prova quem esta conectado ao WS).
  function lerToken() {
    try {
      var s = JSON.parse(localStorage.getItem('turismo_session') || 'null');
      return (s && s.token) || null;
    } catch (e) { return null; }
  }

  function conectarWS(empresaId, usuario) {
    if (typeof WebSocket === 'undefined') return;
    try {
      var url = SERVIDOR.replace(/^http/, 'ws') + '/ws';
      _ws = new WebSocket(url);
      _ws.onopen = function () {
        try {
          _ws.send(JSON.stringify({
            tipo: 'ola', empresaId: empresaId || 1,
            usuario: usuario || null, token: lerToken()
          }));
        } catch (e) {}
        console.info('[Turismo OS] tempo real conectado (servidor).');
      };
      _ws.onmessage = function (ev) {
        try {
          var m = JSON.parse(ev.data);
          if (m && m.tipo === 'mudanca') _entregar(m);
        } catch (e) {}
      };
      _ws.onclose = function () {
        // Reconecta em 3s para nao perder o tempo real.
        if (modoServidor() && !_wsTentando) {
          _wsTentando = true;
          setTimeout(function () { _wsTentando = false; conectarWS(empresaId, usuario); }, 3000);
        }
      };
      _ws.onerror = function () {};
    } catch (e) { _ws = null; }
  }

  /* ------------------- TEMPO REAL -------------------
   * Canal de difusão nativo do navegador: propaga mudanças para TODAS as
   * abas/janelas abertas (mesmo dispositivo). Entre dispositivos diferentes
   * depende de um servidor — a interface já reage a ambos os casos.
   * Persistência é sempre no banco real; o canal só notifica. */
  var CANAL = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      CANAL = new BroadcastChannel('turismo_os_rt');
    }
  } catch (e) { CANAL = null; }

  var _abaId = 'aba_' + Math.random().toString(36).slice(2) + '_' + Date.now();
  var _ouvintes = [];

  function _entregar(msg) {
    if (!msg || msg.origem === _abaId) return; // ignora eco da própria aba
    _ouvintes.forEach(function (fn) { try { fn(msg); } catch (e) {} });
  }

  if (CANAL) {
    CANAL.onmessage = function (ev) { _entregar(ev && ev.data); };
  }

  /* Reforço para protocolo file:// (origem opaca impedia o BroadcastChannel
   * de cruzar abas). O evento 'storage' do localStorage funciona entre abas
   * da mesma origem — inclusive file:// — e também entre abas de um servidor.
   * Aditivo: não substitui o BroadcastChannel, apenas complementa. */
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', function (ev) {
      if (ev.key !== 'turismo_os_rt') return;
      try { _entregar(JSON.parse(ev.newValue)); } catch (e) { /* payload inválido */ }
    });
  }

  // Empresa padrão (o app hoje é single-tenant; a coluna empresaId já prepara
  // o isolamento multiempresa sem quebrar os dados existentes).
  var EMPRESA_PADRAO = 1;

  /* ---------------- Utilitários internos ---------------- */

  /* Secoes de configuracao gravadas em `empresa_config` (uma linha por
   * secao). As secoes "empresa" e "fiscal" NAO entram aqui: elas sao
   * colunas do cadastro da empresa, nao JSON. */
  var SECOES_CONFIG = ['pdv', 'caixa', 'pedidos', 'estoque', 'integracoes', 'api', 'seguranca', 'cadastros'];

  /* Distribui as chaves de posSettingsService.DEFAULTS pelas secoes, para o
   * modo local montar o MESMO objeto que o servidor devolve. Cada chave
   * aparece em exatamente uma secao — se uma chave nova for criada no
   * servico e esquecida aqui, ela simplesmente usa o default, sem quebrar. */
  var CHAVES_POR_SECAO = {
    pdv: ['abrirVariasInstancias', 'escolherGarcomVendaDireta', 'confirmarPagamentoAutomatico',
      'finalizarVendaAutomaticamente', 'senhaAoMudarTelaComVenda', 'arredondamentoAbnt',
      'naoExibirProdutosVendaBalcao', 'naoExibirProdutosPedido',
      'bloquearVendaFracionadaUnidadeInteira', 'bloquearAlteracaoQtdAposBalanca',
      'bloquearDivisaoValorPelaQuantidade', 'bloquearQuantidadeExorbitante',
      'bloquearItemValorZerado', 'limiteQuantidadeExorbitante'],
    caixa: ['exigeAberturaCaixa', 'sangriaComAutorizacao', 'fechamentoCego', 'limiteSangria', 'formasPagamento'],
    pedidos: ['permitirMesmaMesaMultiplasComandas', 'exigirGarcomAoAbrirMesa', 'taxaServicoPadrao',
      'imprimirCozinhaAutomatico', 'permitirDelivery', 'tempoCancelamentoMin'],
    estoque: ['ativarControleAutomaticoNovosProdutos', 'alertarEstoqueMinimo', 'alertarValidadeVencida',
      'alertarFalhaAtualizacao', 'atualizarEstoqueTempoReal', 'controlarDisponibilidadeCardapio',
      'considerarEstoqueIngredientes', 'permitirEstoqueNegativo', 'diasAlertaValidade',
      'metodoBaixaEstoque', 'exigirLoteEmEntrada', 'exigirValidadeEmEntrada'],
    integracoes: ['whatsappAtivo', 'whatsappNumero', 'balancaAtiva', 'balancaProtocolo',
      'cardapioDigitalAtivo', 'cardapioDigitalUrl', 'impressoraAtiva', 'impressoraNome'],
    api: ['apiAtiva', 'apiSomenteLeitura', 'apiUrlsPermitidas', 'webhookUrl'],
    seguranca: ['exigirSenhaAcoesSensiveis', 'expirarSessaoMin', 'logAcessoAtivo',
      'bloquearAposTentativas', 'ipPermitidos'],
    cadastros: ['exigirCpfHospede', 'codigoInternoAutomatico', 'validarNcmObrigatorio',
      'permitirExcluirProdutoVendido']
  };

  /* Cópia rasa de objetos (não usa Object.assign para continuar compatível
   * com navegadores antigos, como o resto deste arquivo). */
  function mergeObj(alvo, extra) {
    var out = {};
    Object.keys(alvo || {}).forEach(function (k) { out[k] = alvo[k]; });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== undefined) out[k] = extra[k]; });
    return out;
  }

  function req(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function tx(storeName, mode) {
    return _db.transaction(storeName, mode || 'readonly').objectStore(storeName);
  }

  // Combina uma data (yyyy-mm-dd ou Date) com um horário (HH:mm) preservando
  // o horário quando a data já traz hora (ex.: edição de reserva existente).
  function combineData(data, hora) {
    var d = (data instanceof Date) ? new Date(data.getTime()) : new Date(data);
    if (isNaN(d.getTime())) d = new Date();
    var temHora = (data instanceof Date) ||
                  (typeof data === 'string' && data.indexOf('T') !== -1);
    if (!temHora && hora && /^\d{1,2}:\d{2}$/.test(hora)) {
      var p = hora.split(':');
      d.setHours(Number(p[0]), Number(p[1]), 0, 0);
    }
    return d;
  }

  // Hash simples (NÃO é segurança de produção — apenas para não gravar
  // a senha em texto puro no banco do navegador).
  function hash(senha, salt) {
    var s = (salt || '') + '::' + senha + '::turismo-os';
    var h = 0, i;
    for (i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return 'h' + (h >>> 0).toString(16);
  }

  /* ---------------- Dados iniciais (seed) ---------------- */

  var SEED_USUARIOS = [
    { usuario: 'admin',    senha: '123456', nome: 'Gerente Geral', perfil: 'admin',    email: 'admin@turismoos.com',    ativo: true },
    { usuario: 'recepcao', senha: '123456', nome: 'Recepção',      perfil: 'recepcao', email: 'recepcao@turismoos.com', ativo: true },
    { usuario: 'garcom',   senha: '123456', nome: 'Garçom',        perfil: 'garcom',   email: 'garcom@turismoos.com',   ativo: true }
  ];

  var SEED_SALAS = [
    { numero: '101', tipo: 'Standard',   capacidade: 2, diaria: 180, status: 'livre' },
    { numero: '102', tipo: 'Standard',   capacidade: 2, diaria: 180, status: 'ocupada' },
    { numero: '201', tipo: 'Superior',   capacidade: 3, diaria: 260, status: 'livre' },
    { numero: '301', tipo: 'Suíte',      capacidade: 4, diaria: 420, status: 'limpeza' }
  ];

  var SEED_MESAS = [
    { numero: 1, nome: 'Mesa 01', lugares: 2, setor: 'Salão', status: 'livre', ativo: true, observacoes: '' },
    { numero: 2, nome: 'Mesa 02', lugares: 4, setor: 'Salão', status: 'livre', ativo: true, observacoes: '' },
    { numero: 3, nome: 'Mesa 03', lugares: 4, setor: 'Salão', status: 'livre', ativo: true, observacoes: '' },
    { numero: 4, nome: 'Mesa 04', lugares: 6, setor: 'Varanda', status: 'livre', ativo: true, observacoes: '' },
    { numero: 5, nome: 'Mesa 05', lugares: 2, setor: 'Varanda', status: 'livre', ativo: true, observacoes: '' },
    { numero: 6, nome: 'Mesa 06', lugares: 8, setor: 'Salão', status: 'livre', ativo: true, observacoes: '' }
  ];

  // Catálogo ÚNICO de produtos — usado tanto no restaurante (mesa) quanto no
  // consumo do apartamento. Não existe segundo cadastro de produtos.
  var SEED_PRODUTOS = [
    { nome: 'Água mineral 500ml', categoria: 'Bebidas', preco: 5.00 },
    { nome: 'Coca-Cola lata',     categoria: 'Bebidas', preco: 6.00 },
    { nome: 'Suco de laranja',    categoria: 'Bebidas', preco: 9.00 },
    { nome: 'Cerveja long neck',  categoria: 'Bebidas', preco: 12.00 },
    { nome: 'Camarão ao alho e óleo', categoria: 'Pratos', preco: 79.90 },
    { nome: 'Pizza margherita',   categoria: 'Pratos', preco: 60.00 },
    { nome: 'Batata frita',       categoria: 'Porções', preco: 35.00 },
    { nome: 'Isca de frango',     categoria: 'Porções', preco: 42.00 },
    { nome: 'Filet à parmegiana', categoria: 'Pratos', preco: 68.00 },
    { nome: 'Pudim',              categoria: 'Sobremesas', preco: 25.00 },
    { nome: 'Sorvete 2 bolas',    categoria: 'Sobremesas', preco: 18.00 },
    { nome: 'Café expresso',      categoria: 'Bebidas', preco: 7.00 }
  ];

  /* ---------------- Abertura e criação das tabelas ---------------- */

  function abrir() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NOME, DB_VERSAO);

      request.onupgradeneeded = function (ev) {
        var db = ev.target.result;

        var usuarios;
        if (!db.objectStoreNames.contains('usuarios')) {
          usuarios = db.createObjectStore('usuarios', { keyPath: 'id', autoIncrement: true });
          usuarios.createIndex('usuario', 'usuario', { unique: true });
          usuarios.createIndex('perfil', 'perfil', { unique: false });
        }

        if (!db.objectStoreNames.contains('sessoes')) {
          var sessoes = db.createObjectStore('sessoes', { keyPath: 'id', autoIncrement: true });
          sessoes.createIndex('usuario', 'usuario', { unique: false });
          sessoes.createIndex('em', 'em', { unique: false });
        }

        if (!db.objectStoreNames.contains('salas')) {
          db.createObjectStore('salas', { keyPath: 'id', autoIncrement: true });
        }

        if (!db.objectStoreNames.contains('mesas')) {
          db.createObjectStore('mesas', { keyPath: 'id', autoIncrement: true });
        }

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'chave' });
        }

        /* ---------- v3: stores da retaguarda ---------- */

        if (!db.objectStoreNames.contains('empresas')) {
          db.createObjectStore('empresas', { keyPath: 'id', autoIncrement: true });
        }

        if (!db.objectStoreNames.contains('aptos')) {
          var aptos = db.createObjectStore('aptos', { keyPath: 'id', autoIncrement: true });
          aptos.createIndex('empresaId', 'empresaId', { unique: false });
          aptos.createIndex('numero', 'numero', { unique: false });
        }

        var hospedes;
        if (!db.objectStoreNames.contains('hospedes')) {
          hospedes = db.createObjectStore('hospedes', { keyPath: 'id', autoIncrement: true });
          hospedes.createIndex('empresaId', 'empresaId', { unique: false });
          hospedes.createIndex('nome', 'nome', { unique: false });
        } else {
          hospedes = ev.target.transaction.objectStore('hospedes');
        }
        // v4: busca por documento (CPF/RG) para reaproveitar cadastro (FNRH).
        if (!hospedes.indexNames.contains('documento')) {
          hospedes.createIndex('documento', 'documento', { unique: false });
        }

        if (!db.objectStoreNames.contains('reservas')) {
          var reservas = db.createObjectStore('reservas', { keyPath: 'id', autoIncrement: true });
          reservas.createIndex('empresaId', 'empresaId', { unique: false });
          reservas.createIndex('aptoId', 'aptoId', { unique: false });
          reservas.createIndex('status', 'status', { unique: false });
        }

        var hosp;
        if (!db.objectStoreNames.contains('hospedagens')) {
          hosp = db.createObjectStore('hospedagens', { keyPath: 'id', autoIncrement: true });
          hosp.createIndex('empresaId', 'empresaId', { unique: false });
          hosp.createIndex('aptoId', 'aptoId', { unique: false });
          hosp.createIndex('status', 'status', { unique: false });
        } else {
          hosp = ev.target.transaction.objectStore('hospedagens');
        }
        // v4: índice de apoio ao calendário (criado só se o store já existir/for novo).
        if (!hosp.indexNames.contains('checkinPrevisto')) {
          hosp.createIndex('checkinPrevisto', 'checkinPrevisto', { unique: false });
        }

        if (!db.objectStoreNames.contains('consumos')) {
          var cons = db.createObjectStore('consumos', { keyPath: 'id', autoIncrement: true });
          cons.createIndex('empresaId', 'empresaId', { unique: false });
          cons.createIndex('hospedagemId', 'hospedagemId', { unique: false });
          cons.createIndex('aptoId', 'aptoId', { unique: false });
        }

        if (!db.objectStoreNames.contains('passantes')) {
          var pas = db.createObjectStore('passantes', { keyPath: 'id', autoIncrement: true });
          pas.createIndex('empresaId', 'empresaId', { unique: false });
        }

        /* ---------- v4: auditoria + contadores ---------- */
        if (!db.objectStoreNames.contains('auditoria')) {
          var aud = db.createObjectStore('auditoria', { keyPath: 'id', autoIncrement: true });
          aud.createIndex('empresaId', 'empresaId', { unique: false });
          aud.createIndex('entidade', 'entidade', { unique: false });
          aud.createIndex('em', 'em', { unique: false });
        }

        if (!db.objectStoreNames.contains('contadores')) {
          db.createObjectStore('contadores', { keyPath: 'chave' });
        }

        /* ---------- v5: restaurante (mesas, produtos, comandas) ----------
         * Reaproveita o store 'mesas' existente acrescentando índices de
         * apoio; cria 'produtos' (catálogo único, usado por mesa E apto) e
         * 'comandas' / 'comanda_itens' para a operação do restaurante. */
        var mesasStore;
        if (!db.objectStoreNames.contains('mesas')) {
          mesasStore = db.createObjectStore('mesas', { keyPath: 'id', autoIncrement: true });
        } else {
          mesasStore = ev.target.transaction.objectStore('mesas');
        }
        if (!mesasStore.indexNames.contains('empresaId')) {
          mesasStore.createIndex('empresaId', 'empresaId', { unique: false });
        }

        var produtos;
        if (!db.objectStoreNames.contains('produtos')) {
          produtos = db.createObjectStore('produtos', { keyPath: 'id', autoIncrement: true });
          produtos.createIndex('empresaId', 'empresaId', { unique: false });
          produtos.createIndex('nome', 'nome', { unique: false });
          produtos.createIndex('categoria', 'categoria', { unique: false });
        }

        if (!db.objectStoreNames.contains('comandas')) {
          var comandas = db.createObjectStore('comandas', { keyPath: 'id', autoIncrement: true });
          comandas.createIndex('empresaId', 'empresaId', { unique: false });
          comandas.createIndex('mesaId', 'mesaId', { unique: false });
          comandas.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains('comanda_itens')) {
          var itens = db.createObjectStore('comanda_itens', { keyPath: 'id', autoIncrement: true });
          itens.createIndex('empresaId', 'empresaId', { unique: false });
          itens.createIndex('comandaId', 'comandaId', { unique: false });
        }

        /* ---------- v6: empresa/estoque (config por secao, saldos, ficha) ----------
         * O modo servidor ja tem as tabelas equivalentes (empresa_config,
         * product_stock, recipe, recipe_items). Aqui os mesmos dados existem
         * no navegador para o sistema funcionar tambem SEM servidor —
         * mantendo os mesmos nomes de campo, para nao haver duas verdades. */
        if (!db.objectStoreNames.contains('empresa_config')) {
          var empCfg = db.createObjectStore('empresa_config', { keyPath: 'id', autoIncrement: true });
          empCfg.createIndex('empresaId', 'empresaId', { unique: false });
          empCfg.createIndex('secao', 'secao', { unique: false });
        }

        if (!db.objectStoreNames.contains('estabelecimentos')) {
          var estab = db.createObjectStore('estabelecimentos', { keyPath: 'id', autoIncrement: true });
          estab.createIndex('empresaId', 'empresaId', { unique: false });
          estab.createIndex('cnpj', 'cnpj', { unique: false });
        }

        if (!db.objectStoreNames.contains('product_stock')) {
          var ps = db.createObjectStore('product_stock', { keyPath: 'id', autoIncrement: true });
          ps.createIndex('empresaId', 'empresaId', { unique: false });
          ps.createIndex('produtoId', 'produtoId', { unique: false });
          ps.createIndex('setor', 'setor', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_movements')) {
          var sm = db.createObjectStore('stock_movements', { keyPath: 'id', autoIncrement: true });
          sm.createIndex('empresaId', 'empresaId', { unique: false });
          sm.createIndex('produtoId', 'produtoId', { unique: false });
          sm.createIndex('tipoMovimento', 'tipoMovimento', { unique: false });
          sm.createIndex('documentoId', 'documentoId', { unique: false });
          sm.createIndex('created_at', 'created_at', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_lots')) {
          var sl = db.createObjectStore('stock_lots', { keyPath: 'id', autoIncrement: true });
          sl.createIndex('empresaId', 'empresaId', { unique: false });
          sl.createIndex('produtoId', 'produtoId', { unique: false });
          sl.createIndex('dataValidade', 'dataValidade', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_sectors')) {
          var ss = db.createObjectStore('stock_sectors', { keyPath: 'id', autoIncrement: true });
          ss.createIndex('empresaId', 'empresaId', { unique: false });
        }

        if (!db.objectStoreNames.contains('recipe')) {
          var rc = db.createObjectStore('recipe', { keyPath: 'id', autoIncrement: true });
          rc.createIndex('empresaId', 'empresaId', { unique: false });
          rc.createIndex('produtoId', 'produtoId', { unique: false });
        }

        if (!db.objectStoreNames.contains('recipe_items')) {
          var ri = db.createObjectStore('recipe_items', { keyPath: 'id', autoIncrement: true });
          ri.createIndex('recipeId', 'recipeId', { unique: false });
          ri.createIndex('ingredienteId', 'ingredienteId', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_losses')) {
          var slo = db.createObjectStore('stock_losses', { keyPath: 'id', autoIncrement: true });
          slo.createIndex('empresaId', 'empresaId', { unique: false });
          slo.createIndex('produtoId', 'produtoId', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_transfers')) {
          var st = db.createObjectStore('stock_transfers', { keyPath: 'id', autoIncrement: true });
          st.createIndex('empresaId', 'empresaId', { unique: false });
          st.createIndex('produtoId', 'produtoId', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_failures')) {
          var sf = db.createObjectStore('stock_failures', { keyPath: 'id', autoIncrement: true });
          sf.createIndex('empresaId', 'empresaId', { unique: false });
          sf.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_inventory')) {
          var sinv = db.createObjectStore('stock_inventory', { keyPath: 'id', autoIncrement: true });
          sinv.createIndex('empresaId', 'empresaId', { unique: false });
        }

        if (!db.objectStoreNames.contains('stock_inventory_items')) {
          var sinvi = db.createObjectStore('stock_inventory_items', { keyPath: 'id', autoIncrement: true });
          sinvi.createIndex('inventarioId', 'inventarioId', { unique: false });
        }

        if (!db.objectStoreNames.contains('fiscal_documents')) {
          var fd = db.createObjectStore('fiscal_documents', { keyPath: 'id', autoIncrement: true });
          fd.createIndex('empresaId', 'empresaId', { unique: false });
          fd.createIndex('status', 'status', { unique: false });
          fd.createIndex('idempotencyKey', 'idempotencyKey', { unique: false });
        }

        if (!db.objectStoreNames.contains('fiscal_logs')) {
          var fl = db.createObjectStore('fiscal_logs', { keyPath: 'id', autoIncrement: true });
          fl.createIndex('empresaId', 'empresaId', { unique: false });
          fl.createIndex('documentoId', 'documentoId', { unique: false });
        }

        if (!db.objectStoreNames.contains('tax_rules')) {
          var tr = db.createObjectStore('tax_rules', { keyPath: 'id', autoIncrement: true });
          tr.createIndex('empresaId', 'empresaId', { unique: false });
          tr.createIndex('tributo', 'tributo', { unique: false });
        }

        if (!db.objectStoreNames.contains('audit_logs')) {
          var al = db.createObjectStore('audit_logs', { keyPath: 'id', autoIncrement: true });
          al.createIndex('empresaId', 'empresaId', { unique: false });
          al.createIndex('modulo', 'modulo', { unique: false });
        }
      };

      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function popular() {
    return req(tx('meta').get('seed')).then(function (m) {
      if (m && m.valor === DB_VERSAO) return false;

      var usuarios = _db.transaction('usuarios', 'readwrite').objectStore('usuarios');
      SEED_USUARIOS.forEach(function (u) {
        usuarios.put({
          usuario: u.usuario,
          senhaHash: hash(u.senha, u.usuario),
          nome: u.nome,
          perfil: u.perfil,
          email: u.email,
          ativo: u.ativo,
          criadoEm: new Date().toISOString()
        });
      });

      var salas = _db.transaction('salas', 'readwrite').objectStore('salas');
      SEED_SALAS.forEach(function (s) { salas.add(s); });

      var mesas = _db.transaction('mesas', 'readwrite').objectStore('mesas');
      SEED_MESAS.forEach(function (m) {
        mesas.add({
          empresaId: EMPRESA_PADRAO, numero: m.numero, nome: m.nome,
          lugares: m.lugares, setor: m.setor, status: m.status,
          ativo: m.ativo, observacoes: m.observacoes
        });
      });

      // Catálogo de produtos (v5)
      var produtos = _db.transaction('produtos', 'readwrite').objectStore('produtos');
      SEED_PRODUTOS.forEach(function (p) {
        produtos.add({
          empresaId: EMPRESA_PADRAO, nome: p.nome, categoria: p.categoria,
          preco: p.preco, ativo: true, criadoEm: new Date().toISOString()
        });
      });

      // ---- v3: dados operacionais (empresa, aptos, hóspedes, hospedagem, consumo) ----
      return semearOperacional().then(function () {
        return req(_db.transaction('meta', 'readwrite').objectStore('meta').put({ chave: 'seed', valor: DB_VERSAO }))
          .then(function () { return true; });
      });
    });
  }

  // Popula a camada operacional respeitando o isolamento por empresa.
  function semearOperacional() {
    var empresaId = EMPRESA_PADRAO;

    // Dados da empresa alimentam automaticamente a FNRH (nada digitado de novo).
    return req(_db.transaction('empresas', 'readwrite').objectStore('empresas').put({
      id: empresaId,
      nome: 'Hotel Turismo OS',
      razaoSocial: 'Turismo OS Hotelaria LTDA',
      cnpj: '12.345.678/0001-90',
      endereco: 'Av. Beira-Mar, 1500',
      cidade: 'Balneário Camboriú',
      estado: 'SC',
      pais: 'Brasil',
      cep: '88330-000',
      telefone: '(47) 3333-4444',
      email: 'reservas@turismoos.com',
      logo: '',
      registroEmbratur: '',
      ativo: true,
      criadoEm: new Date().toISOString()
    })).then(function () {
      // --- Apartamentos (numerados sequencialmente) ---
      var aptos = [];
      for (var n = 1; n <= 12; n++) {
        var numero = (n < 10 ? '0' : '') + n;
        var tipo = n <= 6 ? 'Standard' : (n <= 10 ? 'Superior' : 'Suíte');
        var capacidade = n <= 6 ? 2 : (n <= 10 ? 3 : 4);
        var diaria = n <= 6 ? 180 : (n <= 10 ? 260 : 420);
        var status = 'livre';
        if (n === 2) status = 'hospedado';
        else if (n === 5) status = 'reservado';
        else if (n === 8) status = 'limpeza';
        else if (n === 11) status = 'manutencao';
        aptos.push({
          empresaId: empresaId, numero: numero, identificacao: 'APT ' + numero,
          tipo: tipo, capacidade: capacidade, diaria: diaria, status: status,
          caracteristicas: '', observacoes: '', ativo: true,
          criadoEm: new Date().toISOString()
        });
      }
      var stAptos = _db.transaction('aptos', 'readwrite').objectStore('aptos');
      return Promise.all(aptos.map(function (a) { return req(stAptos.add(a)); }));
    }).then(function (aptoIds) {
      // --- Hóspedes ---
      // Campos de identificação do hóspede usados pela FNRH.
      var hospedes = [
        { empresaId: empresaId, nome: 'João Pereira', telefone: '(11) 98888-1111', documento: '123.456.789-00', cpf: '123.456.789-00', tipoDocumento: 'CPF', nascimento: '1985-03-12', nacionalidade: 'Brasileira', sexo: 'M', email: 'joao@email.com', endereco: 'Rua das Flores, 120', cidade: 'São Paulo', estado: 'SP', pais: 'Brasil', cep: '01000-000', criadoEm: new Date().toISOString() },
        { empresaId: empresaId, nome: 'Maria Souza', telefone: '(11) 97777-2222', documento: '987.654.321-00', cpf: '987.654.321-00', tipoDocumento: 'CPF', nascimento: '1990-07-25', nacionalidade: 'Brasileira', sexo: 'F', email: 'maria@email.com', endereco: 'Av. Paulista, 900', cidade: 'São Paulo', estado: 'SP', pais: 'Brasil', cep: '01310-100', criadoEm: new Date().toISOString() },
        { empresaId: empresaId, nome: 'Carlos Andrade', telefone: '(11) 96666-3333', documento: '111.222.333-44', cpf: '111.222.333-44', tipoDocumento: 'CPF', nascimento: '1978-11-03', nacionalidade: 'Brasileira', sexo: 'M', email: 'carlos@email.com', endereco: 'Rua do Sol, 45', cidade: 'Campinas', estado: 'SP', pais: 'Brasil', cep: '13000-000', criadoEm: new Date().toISOString() }
      ];
      var stHosp = _db.transaction('hospedes', 'readwrite').objectStore('hospedes');
      return Promise.all(hospedes.map(function (h) { return req(stHosp.add(h)); }))
        .then(function (hospedesIds) { return { aptoIds: aptoIds, hospedesIds: hospedesIds }; });
    }).then(function (ctx) {
      // aptoIds[1] => APT 02 (hospedado), aptoIds[4] => APT 05 (reservado)
      var apto02 = ctx.aptoIds[1];
      var apto05 = ctx.aptoIds[4];
      var hospedeMaria = ctx.hospedesIds[1];
      var hospedeJoao = ctx.hospedesIds[0];
      var hoje = new Date();
      var checkin = new Date(hoje.getTime() - 2 * 86400000);
      var checkout = new Date(hoje.getTime() + 2 * 86400000);

      // --- Hospedagem ativa no APT 02 ---
      var hospedagem = {
        empresaId: empresaId, aptoId: apto02, hospedeId: hospedeMaria,
        hospedeNome: 'Maria Souza', status: 'hospedado',
        pessoas: 3, adultos: 2, criancas: 1,
        checkin: checkin.toISOString(), checkinPrevisto: checkin.toISOString(),
        checkout: null, checkoutPrevisto: checkout.toISOString(),
        diaria: 180, formaPagamento: 'Crédito',
        observacoes: 'Hóspede solicitou berço no quarto.',
        criadoEm: new Date().toISOString()
      };
      var stHospedagem = _db.transaction('hospedagens', 'readwrite').objectStore('hospedagens');
      return req(stHospedagem.add(hospedagem)).then(function (hospedagemId) {
        // --- Consumos do restaurante vinculados àquela hospedagem ---
        var consumos = [
          { empresaId: empresaId, hospedagemId: hospedagemId, aptoId: apto02, comanda: 101, descricao: 'Jantar (2 pessoas)', valor: 120.50, itens: 4, status: 'fechado', em: hoje.getTime() - 86400000 },
          { empresaId: empresaId, hospedagemId: hospedagemId, aptoId: apto02, comanda: 118, descricao: 'Frigobar', valor: 65.00, itens: 2, status: 'aberto', em: hoje.getTime() - 3600000 }
        ];
        var stCons = _db.transaction('consumos', 'readwrite').objectStore('consumos');
        return Promise.all(consumos.map(function (c) { return req(stCons.add(c)); }))
          .then(function () { return { apto05: apto05, hospedeJoao: hospedeJoao }; });
      });
    }).then(function (ctx) {
      // --- Reserva futura no APT 05 ---
      var hoje = new Date();
      var ini = new Date(hoje.getTime() + 3 * 86400000);
      var fim = new Date(hoje.getTime() + 6 * 86400000);
      var stRes = _db.transaction('reservas', 'readwrite').objectStore('reservas');
      return req(stRes.add({
        empresaId: empresaId, aptoId: ctx.apto05, hospedeId: ctx.hospedeJoao,
        hospedeNome: 'João Pereira', status: 'reservado',
        pessoas: 2, adultos: 2, criancas: 0,
        entrada: ini.toISOString(), saida: fim.toISOString(),
        diaria: 260, origem: 'Telefone',
        observacoes: '', criadoEm: new Date().toISOString()
      }));
    });
  }

  /* ---------------- API pública ---------------- */

  var DB = {
    /* Detecta o servidor; se estiver no ar, opera em modo servidor
     * (dados compartilhados entre dispositivos). Senao, usa o IndexedDB. */
    init: function (opcoes) {
      opcoes = opcoes || {};
      var forcarLocal = opcoes.local === true;
      var pronto = forcarLocal ? Promise.resolve(false) : detectarServidor();

      return pronto.then(function (temServidor) {
        if (temServidor) {
          _modo = 'servidor';
          _db = { modo: 'servidor' }; // marcador para isReady()
          conectarWS(opcoes.empresaId || EMPRESA_PADRAO, opcoes.usuario);
          console.info('[Turismo OS] Modo SERVIDOR ativo em ' + SERVIDOR + ' - tempo real entre dispositivos.');
          return DB;
        }
        _modo = 'local';
        console.info('[Turismo OS] Modo LOCAL (IndexedDB) - servidor nao encontrado.');
        return abrir().then(function (db) {
          _db = db;
          return popular();
        }).then(function () { return DB; });
      });
    },

    isReady: function () { return !!_db; },

    modoAtivo: function () { return _modo; },
    servidorURL: function () { return SERVIDOR; },

    // Autenticação consultando o banco
    autenticar: function (usuario, senha) {
      usuario = (usuario || '').trim().toLowerCase();
      return req(tx('usuarios').index('usuario').get(usuario)).then(function (u) {
        if (!u) return { ok: false, erro: 'Usuário não encontrado.' };
        if (!u.ativo) return { ok: false, erro: 'Usuário inativo. Fale com o administrador.' };
        if (u.senhaHash !== hash(senha, u.usuario)) return { ok: false, erro: 'Usuário ou senha inválidos.' };
        return { ok: true, usuario: { id: u.id, usuario: u.usuario, nome: u.nome, perfil: u.perfil, email: u.email } };
      });
    },

    listarUsuarios: function () {
      if (modoServidor()) return api('usuarios/listar', { empresaId: EMPRESA_PADRAO });
      return req(tx('usuarios').getAll());
    },

    // Localiza usuário pelo login (campo `usuario`) OU pelo e-mail.
    // Funciona nos dois modos — usado pelo login por e-mail.
    buscarUsuario: function (login) {
      var chave = String(login || '').trim().toLowerCase();
      if (!chave) return Promise.resolve(null);
      if (modoServidor()) return api('usuarios/buscar', { login: chave });
      return DB.listarUsuarios().then(function (arr) {
        for (var i = 0; i < arr.length; i++) {
          if (String(arr[i].usuario || '').toLowerCase() === chave) return arr[i];
          if (String(arr[i].email || '').toLowerCase() === chave) return arr[i];
        }
        return null;
      });
    },

    criarUsuario: function (dados) {
      if (modoServidor()) {
        return api('usuarios/criar', {
          usuario: dados.usuario || dados.email || '',
          senha: dados.senha, nome: dados.nome, perfil: dados.perfil,
          email: dados.email || '', ativo: dados.ativo !== false
        }).then(function (r) { return r && r.id != null ? r.id : r; });
      }
      var u = {
        usuario: (dados.usuario || '').trim().toLowerCase(),
        senhaHash: hash(dados.senha, (dados.usuario || '').trim().toLowerCase()),
        nome: dados.nome,
        perfil: dados.perfil || 'recepcao',
        email: dados.email || '',
        ativo: dados.ativo !== false,
        criadoEm: new Date().toISOString()
      };
      return req(tx('usuarios', 'readwrite').add(u));
    },

    atualizarUsuario: function (id, dados) {
      if (modoServidor()) return api('usuarios/atualizar', { id: id, dados: dados });
      return req(tx('usuarios').get(id)).then(function (u) {
        if (!u) throw new Error('Usuário #' + id + ' não encontrado.');
        if (dados.nome != null) u.nome = dados.nome;
        if (dados.perfil != null) u.perfil = dados.perfil;
        if (dados.email != null) u.email = dados.email;
        if (dados.ativo != null) u.ativo = dados.ativo;
        if (dados.senha) u.senhaHash = hash(dados.senha, u.usuario);
        return req(tx('usuarios', 'readwrite').put(u)).then(function () { return true; });
      });
    },

    removerUsuario: function (id) {
      if (modoServidor()) return api('usuarios/remover', { id: id });
      return req(tx('usuarios', 'readwrite').delete(id)).then(function () { return true; });
    },

    listarSalas: function () { return req(tx('salas').getAll()); },
    listarMesas: function () { return req(tx('mesas').getAll()); },

    // Log de acesso local. No modo servidor nao ha store local, entao e no-op.
    registrarSessao: function (u) {
      if (modoServidor()) return Promise.resolve(null);
      return req(tx('sessoes', 'readwrite').add({
        usuario: u.usuario, nome: u.nome, perfil: u.perfil, em: Date.now()
      }));
    },

    listarSessoes: function (limite) {
      if (modoServidor()) return Promise.resolve([]);
      return req(tx('sessoes').getAll()).then(function (arr) {
        arr.sort(function (a, b) { return b.em - a.em; });
        return limite ? arr.slice(0, limite) : arr;
      });
    },

    // Apaga e recria tudo — útil para testes.
    resetarBanco: function () {
      var p = new Promise(function (resolve, reject) {
        if (_db) _db.close();
        var del = indexedDB.deleteDatabase(DB_NOME);
        del.onsuccess = function () { resolve(); };
        del.onerror = function () { reject(del.error); };
        del.onblocked = function () { resolve(); };
      });
      return p.then(function () { _db = null; return DB.init(); });
    },

    contar: function (store) {
      if (modoServidor()) return Promise.resolve(0);
      return req(tx(store).count());
    },

    /* ================= v3: retaguarda ================= */

    EMPRESA_PADRAO: EMPRESA_PADRAO,

    /* ---------- Apartamentos ---------- */
    listarAptos: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('aptos').index('empresaId').getAll(empresaId)).then(function (arr) {
        arr.sort(function (a, b) {
          return String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true });
        });
        return arr;
      });
    },

    obterApto: function (id) { return req(tx('aptos').get(id)); },

    criarApto: function (dados) {
      var numero = String(dados.numero || '').trim();
      if (!numero) throw new Error('Informe o número do apartamento.');
      var a = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        numero: numero,
        identificacao: dados.identificacao || ('APT ' + numero),
        tipo: dados.tipo || 'Standard',
        capacidade: Number(dados.capacidade) || 2,
        diaria: Number(dados.diaria) || 0,
        status: dados.status || 'livre',
        caracteristicas: dados.caracteristicas || '',
        observacoes: dados.observacoes || '',
        ativo: dados.ativo !== false,
        criadoEm: new Date().toISOString()
      };
      return req(tx('aptos', 'readwrite').add(a));
    },

    atualizarApto: function (id, dados) {
      return req(tx('aptos').get(id)).then(function (a) {
        if (!a) throw new Error('Apartamento #' + id + ' não encontrado.');
        ['numero', 'identificacao', 'tipo', 'capacidade', 'diaria', 'status',
         'caracteristicas', 'observacoes', 'ativo'].forEach(function (k) {
          if (dados[k] != null) a[k] = dados[k];
        });
        if (dados.capacidade != null) a.capacidade = Number(dados.capacidade) || 1;
        if (dados.diaria != null) a.diaria = Number(dados.diaria) || 0;
        return req(tx('aptos', 'readwrite').put(a)).then(function () { return true; });
      });
    },

    removerApto: function (id) {
      return req(tx('aptos', 'readwrite').delete(id)).then(function () { return true; });
    },

    /* ---------- Hóspedes ---------- */
    listarHospedes: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('hospedes').index('empresaId').getAll(empresaId)).then(function (arr) {
        arr.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
        return arr;
      });
    },

    obterHospede: function (id) { return req(tx('hospedes').get(id)); },

    // Localiza hóspede já cadastrado pelo documento (CPF/RG) — evita recadastro.
    buscarHospedePorDocumento: function (empresaId, documento) {
      empresaId = empresaId || EMPRESA_PADRAO;
      var doc = String(documento || '').replace(/\D/g, '');
      if (!doc) return Promise.resolve(null);
      return DB.listarHospedes(empresaId).then(function (arr) {
        return arr.filter(function (h) {
          return String(h.documento || '').replace(/\D/g, '') === doc ||
                 String(h.cpf || '').replace(/\D/g, '') === doc;
        })[0] || null;
      });
    },

    // Campos adicionais (FNRH) preservam o contrato anterior: quem já chamava
    // criarHospede só com {nome, telefone...} continua funcionando.
    criarHospede: function (dados) {
      var h = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        nome: dados.nome || '',
        telefone: dados.telefone || '',
        documento: dados.documento || dados.cpf || '',
        cpf: dados.cpf || dados.documento || '',
        tipoDocumento: dados.tipoDocumento || 'CPF',
        nascimento: dados.nascimento || '',
        nacionalidade: dados.nacionalidade || 'Brasileira',
        sexo: dados.sexo || '',
        email: dados.email || '',
        endereco: dados.endereco || '',
        cidade: dados.cidade || '',
        estado: dados.estado || '',
        pais: dados.pais || 'Brasil',
        cep: dados.cep || '',
        observacoes: dados.observacoes || '',
        criadoEm: new Date().toISOString()
      };
      return req(tx('hospedes', 'readwrite').add(h));
    },

    atualizarHospede: function (id, dados) {
      return req(tx('hospedes').get(id)).then(function (h) {
        if (!h) throw new Error('Hóspede #' + id + ' não encontrado.');
        ['nome', 'telefone', 'documento', 'cpf', 'tipoDocumento', 'nascimento',
         'nacionalidade', 'sexo', 'email', 'endereco', 'cidade', 'estado',
         'pais', 'cep', 'observacoes'].forEach(function (k) {
          if (dados[k] != null) h[k] = dados[k];
        });
        return req(tx('hospedes', 'readwrite').put(h)).then(function () { return true; });
      });
    },

    /* ---------- Empresa ---------- */
    // Dados cadastrais da empresa (alimentam a FNRH automaticamente).
    obterEmpresa: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('empresas').get(empresaId)).then(function (e) {
        return e || { id: empresaId, nome: 'Empresa', cnpj: '', endereco: '', telefone: '', email: '', logo: '' };
      });
    },

    atualizarEmpresa: function (empresaId, dados) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return DB.obterEmpresa(empresaId).then(function (e) {
        ['nome', 'razaoSocial', 'cnpj', 'endereco', 'cidade', 'estado', 'pais',
         'cep', 'telefone', 'email', 'logo', 'registroEmbratur'].forEach(function (k) {
          if (dados[k] != null) e[k] = dados[k];
        });
        e.id = empresaId;
        return req(tx('empresas', 'readwrite').put(e)).then(function () { return true; });
      });
    },

    /* ---------- Reservas ---------- */
    listarReservas: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('reservas').index('empresaId').getAll(empresaId)).then(function (arr) {
        arr.sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
        return arr;
      });
    },

    obterReserva: function (id) { return req(tx('reservas').get(id)); },

    // Número sequencial da reserva, por empresa (ex.: 000001).
    proximoNumeroReserva: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      var chave = 'reserva_' + empresaId;
      return req(tx('contadores').get(chave)).then(function (c) {
        var n = (c && c.valor ? c.valor : 0) + 1;
        return req(tx('contadores', 'readwrite').put({ chave: chave, valor: n })).then(function () { return n; });
      });
    },

    /* Verificação de conflito de reserva/hospedagem para um apto e período.
     * Retorna { conflito:boolean, motivo, itens:[] }. NÃO altera nada.
     * Regras verificadas (todas com dados reais do banco):
     *   - hospedagem ativa no apartamento;
     *   - outra reserva ativa sobreposta ao período;
     *   - bloqueio de manutenção do apartamento. */
    verificarConflito: function (empresaId, aptoId, entradaISO, saidaISO, ignorarReservaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      var ini = new Date(entradaISO).getTime();
      var fim = new Date(saidaISO).getTime();
      if (!(fim > ini)) return Promise.resolve({ conflito: true, motivo: 'A data de saída deve ser posterior à de entrada.', itens: [] });

      return DB.obterApto(aptoId).then(function (apto) {
        if (!apto) return { conflito: true, motivo: 'Apartamento não encontrado.', itens: [] };
        var itens = [];

        if (apto.status === 'manutencao') {
          itens.push({ tipo: 'manutencao', texto: 'APT ' + apto.numero + ' está em manutenção.' });
        }

        return DB.hospedagemAtivaDoApto(aptoId).then(function (hosp) {
          if (hosp) {
            itens.push({ tipo: 'hospedagem', texto: 'APT ' + apto.numero + ' possui hospedagem ativa (' + (hosp.hospedeNome || 'hóspede') + ').' });
          }
          return req(tx('reservas').index('aptoId').getAll(aptoId));
        }).then(function (reservas) {
          reservas.forEach(function (r) {
            if (r.status !== 'reservado' && r.status !== 'confirmado') return;
            if (ignorarReservaId && r.id === ignorarReservaId) return;
            var ri = new Date(r.entrada).getTime();
            var rf = new Date(r.saida).getTime();
            // Sobreposição de intervalos [ini,fim) x [ri,rf)
            if (ini < rf && ri < fim) {
              itens.push({
                tipo: 'reserva', reservaId: r.id, numero: r.numero,
                texto: 'Já existe a reserva nº ' + (r.numero || r.id) + ' para ' + (r.hospedeNome || 'hóspede') +
                       ' neste período (' + new Date(r.entrada).toLocaleDateString('pt-BR') + ' a ' + new Date(r.saida).toLocaleDateString('pt-BR') + ').'
              });
            }
          });
          return {
            conflito: itens.length > 0,
            motivo: itens.length ? itens[0].texto : '',
            itens: itens
          };
        });
      });
    },

    /* Cria a reserva com dados completos de hospedagem (FNRH).
     * Bloqueia automaticamente se houver conflito — não sobrescreve reserva existente. */
    criarReservaCompleta: function (dados, opts) {
      opts = opts || {};
      var empresaId = dados.empresaId || EMPRESA_PADRAO;
      var entrada = combineData(dados.entrada, dados.horaEntrada || '14:00');
      var saida = combineData(dados.saida, dados.horaSaida || '12:00');

      return DB.verificarConflito(empresaId, Number(dados.aptoId), entrada.toISOString(), saida.toISOString(), opts.ignorarReservaId)
        .then(function (conf) {
          if (conf.conflito && !opts.forcar) {
            var err = new Error(conf.motivo || 'Conflito de reserva.');
            err.conflito = conf;
            throw err;
          }
          var dias = Math.max(1, Math.round((saida - entrada) / 86400000));
          var diaria = Number(dados.diaria) || 0;
          var subtotal = dias * diaria;
          var desconto = Number(dados.desconto) || 0;
          var taxas = Number(dados.taxas) || 0;
          var total = Math.max(0, subtotal - desconto + taxas);

          return DB.proximoNumeroReserva(empresaId).then(function (num) {
            var r = {
              empresaId: empresaId,
              numero: String(num).padStart(6, '0'),
              aptoId: Number(dados.aptoId),
              hospedeId: dados.hospedeId || null,
              hospedeNome: dados.hospedeNome || '',
              status: dados.status || 'reservado',
              pessoas: Number(dados.pessoas) || 1,
              adultos: Number(dados.adultos) || Number(dados.pessoas) || 1,
              criancas: Number(dados.criancas) || 0,
              entrada: entrada.toISOString(),
              saida: saida.toISOString(),
              horaEntrada: dados.horaEntrada || '14:00',
              horaSaida: dados.horaSaida || '12:00',
              qtdDiarias: dias,
              diaria: diaria,
              subtotal: subtotal,
              desconto: desconto,
              taxas: taxas,
              total: total,
              formaPagamento: dados.formaPagamento || '',
              situacaoPagamento: dados.situacaoPagamento || 'pendente',
              origem: dados.origem || 'Balcão',
              observacoes: dados.observacoes || '',
              criadoEm: new Date().toISOString()
            };
            return req(tx('reservas', 'readwrite').add(r)).then(function (id) {
              return DB.registrarAuditoria(empresaId, 'reserva', id, 'criada', {
                numero: r.numero, hospedeNome: r.hospedeNome, aptoId: r.aptoId
              }).then(function () {
                return DB.recalcularStatusApto(r.aptoId).then(function () {
                  return DB.obterReserva(id);
                });
              });
            });
          });
        });
    },

    // Mantém compatibilidade com quem já chamava criarReserva (ex.: seed antigo).
    criarReserva: function (dados) {
      return DB.criarReservaCompleta(dados);
    },

    atualizarReserva: function (id, dados) {
      return DB.obterReserva(id).then(function (r) {
        if (!r) throw new Error('Reserva #' + id + ' não encontrada.');
        var empresaId = r.empresaId || EMPRESA_PADRAO;

        var entrada = combineData(dados.entrada || r.entrada, dados.horaEntrada || r.horaEntrada || '14:00');
        var saida = combineData(dados.saida || r.saida, dados.horaSaida || r.horaSaida || '12:00');
        var aptoId = dados.aptoId != null ? Number(dados.aptoId) : r.aptoId;

        // Reexecuta a verificação de disponibilidade (ignorando esta própria reserva).
        return DB.verificarConflito(empresaId, aptoId, entrada.toISOString(), saida.toISOString(), id).then(function (conf) {
          var bloqueioReserva = conf.itens.filter(function (i) { return i.tipo === 'reserva'; });
          if (bloqueioReserva.length) {
            var err = new Error(bloqueioReserva[0].texto);
            err.conflito = conf;
            throw err;
          }

          r.aptoId = aptoId;
          r.entrada = entrada.toISOString();
          r.saida = saida.toISOString();
          r.horaEntrada = dados.horaEntrada || r.horaEntrada;
          r.horaSaida = dados.horaSaida || r.horaSaida;
          if (dados.pessoas != null) r.pessoas = Number(dados.pessoas);
          if (dados.adultos != null) r.adultos = Number(dados.adultos);
          if (dados.criancas != null) r.criancas = Number(dados.criancas);
          if (dados.diaria != null) r.diaria = Number(dados.diaria);
          if (dados.desconto != null) r.desconto = Number(dados.desconto);
          if (dados.taxas != null) r.taxas = Number(dados.taxas);
          if (dados.formaPagamento != null) r.formaPagamento = dados.formaPagamento;
          if (dados.situacaoPagamento != null) r.situacaoPagamento = dados.situacaoPagamento;
          if (dados.observacoes != null) r.observacoes = dados.observacoes;
          if (dados.hospedeNome != null) r.hospedeNome = dados.hospedeNome;
          if (dados.hospedeId != null) r.hospedeId = dados.hospedeId;

          var dias = Math.max(1, Math.round((new Date(r.saida) - new Date(r.entrada)) / 86400000));
          r.qtdDiarias = dias;
          r.subtotal = dias * (Number(r.diaria) || 0);
          r.total = Math.max(0, r.subtotal - (Number(r.desconto) || 0) + (Number(r.taxas) || 0));

          return req(tx('reservas', 'readwrite').put(r)).then(function () {
            return DB.registrarAuditoria(empresaId, 'reserva', id, 'editada', {
              numero: r.numero, aptoId: r.aptoId
            }).then(function () {
              return DB.recalcularStatusApto(r.aptoId).then(function () { return true; });
            });
          });
        });
      });
    },

    cancelarReserva: function (id) {
      return DB.obterReserva(id).then(function (r) {
        if (!r) throw new Error('Reserva #' + id + ' não encontrada.');
        r.status = 'cancelado';
        r.canceladoEm = new Date().toISOString();
        return req(tx('reservas', 'readwrite').put(r)).then(function () {
          return DB.registrarAuditoria(r.empresaId || EMPRESA_PADRAO, 'reserva', id, 'cancelada', {
            numero: r.numero
          }).then(function () {
            return DB.recalcularStatusApto(r.aptoId).then(function () { return true; });
          });
        });
      });
    },

    /* Calendário: reservas ativas + hospedagens ativas, por apartamento. */
    listarCalendario: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return Promise.all([
        DB.listarReservas(empresaId),
        DB.listarHospedagens(empresaId),
        DB.listarAptos(empresaId)
      ]).then(function (res) {
        var reservas = res[0].filter(function (r) { return r.status === 'reservado' || r.status === 'confirmado'; });
        var hospedagens = res[1].filter(function (h) { return h.status === 'hospedado'; });
        var aptos = res[2];

        var eventos = [];
        reservas.forEach(function (r) {
          eventos.push({
            tipo: 'reserva', id: r.id, numero: r.numero, aptoId: r.aptoId,
            hospedeNome: r.hospedeNome, entrada: r.entrada, saida: r.saida,
            horaEntrada: r.horaEntrada, horaSaida: r.horaSaida,
            status: r.status, pessoas: r.pessoas, total: r.total
          });
        });
        hospedagens.forEach(function (h) {
          eventos.push({
            tipo: 'hospedagem', id: h.id, aptoId: h.aptoId,
            hospedeNome: h.hospedeNome, entrada: h.checkin,
            saida: h.checkoutPrevisto, horaEntrada: '', horaSaida: '',
            status: 'hospedado', pessoas: h.pessoas, total: null
          });
        });
        eventos.sort(function (a, b) { return new Date(a.entrada) - new Date(b.entrada); });
        return { aptos: aptos, eventos: eventos };
      });
    },

    /* ---------- Auditoria ---------- */
    // No modo servidor o proprio servidor registra a auditoria de cada operacao.
    registrarAuditoria: function (empresaId, entidade, entidadeId, acao, detalhe) {
      if (modoServidor()) return Promise.resolve(null);
      return req(tx('auditoria', 'readwrite').add({
        empresaId: empresaId || EMPRESA_PADRAO,
        entidade: entidade, entidadeId: entidadeId, acao: acao,
        detalhe: detalhe || {}, em: Date.now()
      })).catch(function () { return null; });
    },

    listarAuditoria: function (empresaId, limite) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('auditoria').index('empresaId').getAll(empresaId)).then(function (arr) {
        arr.sort(function (a, b) { return b.em - a.em; });
        return limite ? arr.slice(0, limite) : arr;
      });
    },

    /* ---------- Hospedagens ---------- */
    listarHospedagens: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('hospedagens').index('empresaId').getAll(empresaId));
    },

    // Hospedagem ativa (ainda sem checkout) de um apartamento.
    hospedagemAtivaDoApto: function (aptoId) {
      return req(tx('hospedagens').index('aptoId').getAll(aptoId)).then(function (arr) {
        var ativos = arr.filter(function (h) { return h.status === 'hospedado'; });
        ativos.sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
        return ativos[0] || null;
      });
    },

    criarHospedagem: function (dados) {
      var h = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        aptoId: Number(dados.aptoId),
        hospedeId: dados.hospedeId || null,
        hospedeNome: dados.hospedeNome || '',
        status: 'hospedado',
        pessoas: Number(dados.pessoas) || 1,
        adultos: Number(dados.adultos) || Number(dados.pessoas) || 1,
        criancas: Number(dados.criancas) || 0,
        checkin: dados.checkin ? new Date(dados.checkin).toISOString() : new Date().toISOString(),
        checkinPrevisto: dados.checkinPrevisto ? new Date(dados.checkinPrevisto).toISOString() : null,
        checkout: null,
        checkoutPrevisto: dados.checkoutPrevisto ? new Date(dados.checkoutPrevisto).toISOString() : null,
        diaria: Number(dados.diaria) || 0,
        formaPagamento: dados.formaPagamento || '',
        observacoes: dados.observacoes || '',
        criadoEm: new Date().toISOString()
      };
      return req(tx('hospedagens', 'readwrite').add(h)).then(function (id) {
        return DB.recalcularStatusApto(h.aptoId).then(function () { return id; });
      });
    },

    // Check-out: encerra a hospedagem e libera o apto para limpeza.
    fazerCheckout: function (hospedagemId, formaPagamento) {
      return req(tx('hospedagens').get(hospedagemId)).then(function (h) {
        if (!h) throw new Error('Hospedagem #' + hospedagemId + ' não encontrada.');
        h.status = 'finalizado';
        h.checkout = new Date().toISOString();
        if (formaPagamento) h.formaPagamento = formaPagamento;
        return req(tx('hospedagens', 'readwrite').put(h)).then(function () {
          return DB.atualizarApto(h.aptoId, { status: 'limpeza' })
            .then(function () { return true; });
        });
      });
    },

    /* ---------- Consumo do restaurante ---------- */
    listarConsumosPorHospedagem: function (hospedagemId) {
      return req(tx('consumos').index('hospedagemId').getAll(hospedagemId)).then(function (arr) {
        arr.sort(function (a, b) { return (a.em || 0) - (b.em || 0); });
        return arr;
      });
    },

    criarConsumo: function (dados) {
      var c = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        hospedagemId: dados.hospedagemId || null,
        aptoId: Number(dados.aptoId) || null,
        mesa: dados.mesa || null,
        comanda: dados.comanda || null,
        produtoId: dados.produtoId || null,
        categoria: dados.categoria || '',
        descricao: dados.descricao || '',
        valor: Number(dados.valor) || 0,
        itens: Number(dados.itens) || 1,
        status: dados.status || 'aberto',
        usuario: dados.usuario || '',
        em: dados.em || Date.now()
      };
      return req(tx('consumos', 'readwrite').add(c)).then(function (id) {
        // Notifica outros dispositivos/abas: a retaguarda atualiza o apto.
        DB.notificar('consumo', 'lancado', { aptoId: c.aptoId, hospedagemId: c.hospedagemId, id: id });
        return id;
      });
    },

    // Excluir um consumo do apto (com auditoria e notificação).
    removerConsumo: function (id, usuario) {
      return req(tx('consumos').get(id)).then(function (c) {
        if (!c) throw new Error('Consumo #' + id + ' não encontrado.');
        return req(tx('consumos', 'readwrite').delete(id)).then(function () {
          return DB.registrarAuditoria(c.empresaId, 'consumo', id, 'removido', {
            aptoId: c.aptoId, valor: c.valor, usuario: usuario
          }).then(function () {
            DB.notificar('consumo', 'removido', { aptoId: c.aptoId, id: id });
            return true;
          });
        });
      });
    },

    /* ---------- Passantes ---------- */
    listarPassantes: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('passantes').index('empresaId').getAll(empresaId)).then(function (arr) {
        arr.sort(function (a, b) { return (b.em || 0) - (a.em || 0); });
        return arr;
      });
    },

    criarPassante: function (dados) {
      var p = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        nome: dados.nome || '',
        telefone: dados.telefone || '',
        documento: dados.documento || '',
        origem: dados.origem || 'Restaurante',
        observacoes: dados.observacoes || '',
        valor: Number(dados.valor) || 0,
        em: dados.em || Date.now()
      };
      return req(tx('passantes', 'readwrite').add(p));
    },

    /* ---------- Tempo real ---------- */
    // Assina mudanças propagadas para outras abas/dispositivos.
    aoAtualizar: function (fn) {
      if (typeof fn === 'function') _ouvintes.push(fn);
      return function () { _ouvintes = _ouvintes.filter(function (f) { return f !== fn; }); };
    },
    // Notifica os demais clientes sobre uma alteração já persistida.
    notificar: function (entidade, acao, detalhe) {
      var msg = {
        origem: _abaId, entidade: entidade, acao: acao,
        detalhe: detalhe || {}, em: Date.now(),
        // marca extra para o evento 'storage' (que carrega o valor serializado)
        _rt: Math.random().toString(36).slice(2)
      };
      if (CANAL) { try { CANAL.postMessage(msg); } catch (e) {} }
      try { localStorage.setItem('turismo_os_rt', JSON.stringify(msg)); } catch (e) {}
    },

    /* ---------- Produtos (catálogo único: mesa e apto) ---------- */
    listarProdutos: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('produtos').index('empresaId').getAll(empresaId)).then(function (arr) {
        arr.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
        return arr;
      });
    },
    obterProduto: function (id) { return req(tx('produtos').get(id)); },
    criarProduto: function (dados) {
      var p = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        nome: dados.nome || '',
        categoria: dados.categoria || 'Geral',
        preco: Number(dados.preco) || 0,
        ativo: dados.ativo !== false,
        criadoEm: new Date().toISOString()
      };
      return req(tx('produtos', 'readwrite').add(p)).then(function (id) {
        DB.notificar('produto', 'criado', { id: id });
        return id;
      });
    },
    atualizarProduto: function (id, dados) {
      return req(tx('produtos').get(id)).then(function (p) {
        if (!p) throw new Error('Produto #' + id + ' não encontrado.');
        ['nome', 'categoria', 'preco', 'ativo'].forEach(function (k) { if (dados[k] != null) p[k] = dados[k]; });
        if (dados.preco != null) p.preco = Number(dados.preco) || 0;
        return req(tx('produtos', 'readwrite').put(p)).then(function () {
          DB.notificar('produto', 'editado', { id: id });
          return true;
        });
      });
    },
    removerProduto: function (id) {
      return req(tx('produtos', 'readwrite').delete(id)).then(function () {
        DB.notificar('produto', 'removido', { id: id });
        return true;
      });
    },

    /* ---------- Mesas (reuso do store existente + campos v5) ---------- */
    listarMesas: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('mesas').getAll()).then(function (arr) {
        // Compatibilidade: mesas antigas (sem empresaId) são consideradas da empresa padrão.
        var filtradas = arr.filter(function (m) {
          return (m.empresaId == null ? EMPRESA_PADRAO : m.empresaId) === empresaId;
        });
        filtradas.sort(function (a, b) { return Number(a.numero) - Number(b.numero); });
        return filtradas;
      });
    },
    obterMesa: function (id) { return req(tx('mesas').get(id)); },
    criarMesa: function (dados) {
      var numero = Number(dados.numero);
      if (!numero) throw new Error('Informe o número da mesa.');
      var m = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        numero: numero,
        nome: dados.nome || ('Mesa ' + (numero < 10 ? '0' + numero : numero)),
        lugares: Number(dados.lugares) || 2,
        setor: dados.setor || 'Salão',
        status: dados.status || 'livre',
        ativo: dados.ativo !== false,
        observacoes: dados.observacoes || ''
      };
      return req(tx('mesas', 'readwrite').add(m)).then(function (id) {
        DB.notificar('mesa', 'criada', { id: id });
        return id;
      });
    },
    atualizarMesa: function (id, dados) {
      return req(tx('mesas').get(id)).then(function (m) {
        if (!m) throw new Error('Mesa #' + id + ' não encontrada.');
        ['numero', 'nome', 'lugares', 'setor', 'status', 'ativo', 'observacoes'].forEach(function (k) {
          if (dados[k] != null) m[k] = dados[k];
        });
        return req(tx('mesas', 'readwrite').put(m)).then(function () {
          DB.notificar('mesa', 'atualizada', { id: id, status: m.status });
          return true;
        });
      });
    },
    removerMesa: function (id) {
      return req(tx('mesas', 'readwrite').delete(id)).then(function () {
        DB.notificar('mesa', 'removida', { id: id });
        return true;
      });
    },

    /* ---------- Comandas (restaurante) ---------- */
    // Comanda aberta de uma mesa (no máximo uma por vez).
    comandaAbertaDaMesa: function (mesaId) {
      return req(tx('comandas').index('mesaId').getAll(mesaId)).then(function (arr) {
        var abertas = arr.filter(function (c) { return c.status === 'aberta'; });
        abertas.sort(function (a, b) { return b.abertaEm - a.abertaEm; });
        return abertas[0] || null;
      });
    },

    proximoNumeroComanda: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      var chave = 'comanda_' + empresaId;
      return req(tx('contadores').get(chave)).then(function (c) {
        var n = (c && c.valor ? c.valor : 0) + 1;
        return req(tx('contadores', 'readwrite').put({ chave: chave, valor: n })).then(function () { return n; });
      });
    },

    // Abre a mesa: cria a comanda e marca a mesa como ocupada.
    abrirMesa: function (dados) {
      var empresaId = dados.empresaId || EMPRESA_PADRAO;
      return DB.comandaAbertaDaMesa(dados.mesaId).then(function (jaAberta) {
        if (jaAberta) throw new Error('Esta mesa já possui uma comanda aberta (nº ' + jaAberta.numero + ').');
        return DB.proximoNumeroComanda(empresaId).then(function (num) {
          var comanda = {
            empresaId: empresaId, mesaId: Number(dados.mesaId),
            numero: String(num).padStart(6, '0'),
            pessoas: Number(dados.pessoas) || 1,
            garcom: dados.garcom || '',
            garcomId: dados.garcomId || null,
            status: 'aberta',
            abertaEm: Date.now(),
            fechadaEm: null,
            subtotal: 0, desconto: 0, taxas: 0, total: 0,
            pagamentos: [], observacoes: dados.observacoes || ''
          };
          return req(tx('comandas', 'readwrite').add(comanda)).then(function (id) {
            return DB.atualizarMesa(dados.mesaId, { status: 'ocupada' }).then(function () {
              DB.notificar('comanda', 'aberta', { mesaId: dados.mesaId, comandaId: id });
              return id;
            });
          });
        });
      });
    },

    listarComandas: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      return req(tx('comandas').index('empresaId').getAll(empresaId)).then(function (arr) {
        arr.sort(function (a, b) { return b.abertaEm - a.abertaEm; });
        return arr;
      });
    },
    obterComanda: function (id) { return req(tx('comandas').get(id)); },

    listarItensComanda: function (comandaId) {
      return req(tx('comanda_itens').index('comandaId').getAll(comandaId)).then(function (arr) {
        arr.sort(function (a, b) { return a.em - b.em; });
        return arr;
      });
    },

    // Recalcula subtotal/total da comanda a partir dos itens ativos.
    recalcularComanda: function (comandaId) {
      if (modoServidor()) return DB.obterComanda(comandaId);
      return DB.listarItensComanda(comandaId).then(function (itens) {
        var ativos = itens.filter(function (i) { return i.status !== 'cancelado'; });
        var subtotal = ativos.reduce(function (s, i) { return s + (Number(i.valor) || 0); }, 0);
        return req(tx('comandas').get(comandaId)).then(function (c) {
          if (!c) throw new Error('Comanda #' + comandaId + ' não encontrada.');
          c.subtotal = subtotal;
          c.total = Math.max(0, subtotal - (Number(c.desconto) || 0) + (Number(c.taxas) || 0));
          return req(tx('comandas', 'readwrite').put(c)).then(function () { return c; });
        });
      });
    },

    // Adiciona um item à comanda (produto do catálogo único).
    adicionarItemComanda: function (dados) {
      var qtd = Number(dados.quantidade) || 1;
      var preco = Number(dados.preco) || 0;
      var item = {
        empresaId: dados.empresaId || EMPRESA_PADRAO,
        comandaId: Number(dados.comandaId),
        produtoId: dados.produtoId || null,
        nome: dados.nome || '',
        categoria: dados.categoria || '',
        quantidade: qtd,
        preco: preco,
        valor: Number((qtd * preco).toFixed(2)),
        observacao: dados.observacao || '',
        status: 'ativo',
        usuario: dados.usuario || '',
        em: Date.now()
      };
      return req(tx('comanda_itens', 'readwrite').add(item)).then(function (id) {
        return DB.recalcularComanda(dados.comandaId).then(function () {
          DB.notificar('comanda', 'item_adicionado', { comandaId: dados.comandaId, itemId: id });
          return id;
        });
      });
    },

    atualizarItemComanda: function (itemId, dados) {
      return req(tx('comanda_itens').get(itemId)).then(function (it) {
        if (!it) throw new Error('Item #' + itemId + ' não encontrado.');
        if (dados.quantidade != null) it.quantidade = Number(dados.quantidade) || 1;
        if (dados.observacao != null) it.observacao = dados.observacao;
        if (dados.status != null) it.status = dados.status;
        it.valor = Number((it.quantidade * (Number(it.preco) || 0)).toFixed(2));
        return req(tx('comanda_itens', 'readwrite').put(it)).then(function () {
          return DB.recalcularComanda(it.comandaId).then(function () {
            DB.notificar('comanda', 'item_atualizado', { comandaId: it.comandaId, itemId: itemId });
            return true;
          });
        });
      });
    },

    // Cancelar item exige usuário e motivo (auditoria).
    cancelarItemComanda: function (itemId, usuario, motivo) {
      return req(tx('comanda_itens').get(itemId)).then(function (it) {
        if (!it) throw new Error('Item #' + itemId + ' não encontrado.');
        it.status = 'cancelado';
        it.canceladoPor = usuario || '';
        it.canceladoMotivo = motivo || '';
        it.canceladoEm = Date.now();
        return req(tx('comanda_itens', 'readwrite').put(it)).then(function () {
          return DB.recalcularComanda(it.comandaId).then(function () {
            return DB.registrarAuditoria(it.empresaId, 'comanda_item', itemId, 'cancelado', {
              comandaId: it.comandaId, nome: it.nome, valor: it.valor, usuario: usuario
            }).then(function () {
              DB.notificar('comanda', 'item_cancelado', { comandaId: it.comandaId, itemId: itemId });
              return true;
            });
          });
        });
      });
    },

    // Registra pagamento parcial/total e fecha quando quitar.
    pagarComanda: function (comandaId, pagamento) {
      return req(tx('comandas').get(comandaId)).then(function (c) {
        if (!c) throw new Error('Comanda #' + comandaId + ' não encontrada.');
        c.pagamentos = c.pagamentos || [];
        c.pagamentos.push({
          forma: pagamento.forma || 'Dinheiro',
          valor: Number(pagamento.valor) || 0,
          usuario: pagamento.usuario || '',
          em: Date.now()
        });
        var pago = c.pagamentos.reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
        c.totalPago = pago;
        c.restante = Math.max(0, (Number(c.total) || 0) - pago);
        return req(tx('comandas', 'readwrite').put(c)).then(function () {
          return DB.registrarAuditoria(c.empresaId, 'comanda', comandaId, 'pagamento', {
            forma: pagamento.forma, valor: pagamento.valor, usuario: pagamento.usuario
          }).then(function () {
            DB.notificar('comanda', 'pagamento', { comandaId: comandaId, restante: c.restante });
            return c;
          });
        });
      });
    },

    // Marca a comanda como aguardando conta (cliente pediu a conta).
    solicitarConta: function (mesaId, comandaId) {
      return DB.atualizarMesa(mesaId, { status: 'aguardando' }).then(function () {
        DB.notificar('mesa', 'aguardando_conta', { mesaId: mesaId, comandaId: comandaId });
        return true;
      });
    },

    // Fecha a comanda (histórico preservado) e libera/suja a mesa.
    fecharComanda: function (comandaId, dados) {
      dados = dados || {};
      return req(tx('comandas').get(comandaId)).then(function (c) {
        if (!c) throw new Error('Comanda #' + comandaId + ' não encontrada.');
        c.status = 'fechada';
        c.fechadaEm = Date.now();
        c.fechadaPor = dados.usuario || '';
        c.divisao = dados.divisao || null;
        return req(tx('comandas', 'readwrite').put(c)).then(function () {
          var status = dados.deixarSuja === false ? 'livre' : 'suja';
          return DB.atualizarMesa(c.mesaId, { status: status }).then(function () {
            return DB.registrarAuditoria(c.empresaId, 'comanda', comandaId, 'fechada', {
              numero: c.numero, total: c.total, usuario: dados.usuario
            }).then(function () {
              DB.notificar('comanda', 'fechada', { comandaId: comandaId, mesaId: c.mesaId });
              return true;
            });
          });
        });
      });
    },

    // Histórico de comandas de uma mesa.
    historicoDaMesa: function (mesaId) {
      return req(tx('comandas').index('mesaId').getAll(mesaId)).then(function (arr) {
        arr.sort(function (a, b) { return b.abertaEm - a.abertaEm; });
        return arr;
      });
    },

    /* ==================================================
     * Regra derivada: estado do apartamento a partir dos
     * dados reais (reserva -> hospedagem -> consumo).
     * ================================================== */
    // Retorna { status, reserva, hospedagem, consumos, financeiro }
    estadoDoApto: function (aptoId) {
      var out = { status: 'livre', reserva: null, hospedagem: null, consumos: [], financeiro: null };

      return DB.obterApto(aptoId).then(function (apto) {
        if (!apto) throw new Error('Apartamento não encontrado.');
        out.apto = apto;
        return DB.hospedagemAtivaDoApto(aptoId);
      }).then(function (hosp) {
        if (hosp) {
          out.hospedagem = hosp;
          out.status = 'hospedado';
          return DB.listarConsumosPorHospedagem(hosp.id);
        }
        // Sem hospedagem ativa: verifica reserva futura e status manual (limpeza/manutenção)
        return req(tx('reservas').index('aptoId').getAll(aptoId)).then(function (reservas) {
          var ativas = reservas.filter(function (r) {
            return r.status === 'reservado' || r.status === 'confirmado';
          });
          if (ativas.length) {
            out.reserva = ativas[0];
            out.status = 'reservado';
          } else if (out.apto.status === 'limpeza' || out.apto.status === 'manutencao') {
            out.status = out.apto.status;
          } else {
            out.status = 'livre';
          }
          return [];
        });
      }).then(function (consumos) {
        out.consumos = consumos || [];
        out.financeiro = DB.calcularFinanceiro(out);
        return out;
      });
    },

    // Cálculo financeiro a partir do estado já carregado (sem duplicar cobrança).
    calcularFinanceiro: function (estado) {
      var diaria = 0, totalDiarias = 0, qtdDiarias = 0;
      var base = estado.hospedagem || estado.reserva;

      if (base) {
        diaria = Number(base.diaria) || Number(estado.apto && estado.apto.diaria) || 0;
        var ini = new Date(estado.hospedagem ? estado.hospedagem.checkin : estado.reserva.entrada);
        var fim = estado.hospedagem
          ? (estado.hospedagem.checkout ? new Date(estado.hospedagem.checkout) : new Date())
          : new Date(estado.reserva.saida);
        var dias = Math.max(1, Math.ceil((fim - ini) / 86400000));
        qtdDiarias = dias;
        totalDiarias = dias * diaria;
      }

      var totalConsumo = (estado.consumos || []).reduce(function (s, c) { return s + (Number(c.valor) || 0); }, 0);

      return {
        diaria: diaria,
        qtdDiarias: qtdDiarias,
        totalDiarias: totalDiarias,
        totalConsumo: totalConsumo,
        qtdConsumos: (estado.consumos || []).length,
        total: totalDiarias + totalConsumo
      };
    },

    // Reaplica a regra no banco: grava no apto o status derivado.
    // No modo servidor o proprio servidor ja recalcula em cada operacao.
    recalcularStatusApto: function (aptoId) {
      if (modoServidor()) return Promise.resolve(null);
      return DB.estadoDoApto(aptoId).then(function (est) {
        if (est.status !== est.apto.status) {
          return DB.atualizarApto(aptoId, { status: est.status }).then(function () { return est.status; });
        }
        return est.status;
      });
    },

    /* ================================================================
     * v6 — CONFIGURACOES, ESTOQUE, FISCAL E AUDITORIA (modo LOCAL)
     * ----------------------------------------------------------------
     * Estas implementacoes valem quando NAO ha servidor (modo offline).
     * Elas guardam no IndexedDB exatamente os mesmos nomes de campo do
     * banco do servidor, para o sistema se comportar igual nos dois modos.
     *
     * O calculo tributario completo e a transmissao fiscal ficam no
     * servidor por definicao (dado fiscal nao vive no navegador). Em modo
     * local, a tela avisa que a emissao exige servidor.
     * ================================================================ */

    /* ---------- Configuracoes ---------- */

    /* Le as secoes de configuracao da empresa. Os defaults vem do proprio
     * posSettingsService (fonte unica no frontend), e o que estiver gravado
     * no banco sobrepoe. */
    configListar: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('config/listar', { empresaId: empresaId });
      return req(tx('empresa_config').index('empresaId').getAll(empresaId)).then(function (linhas) {
        var out = {};
        var padroes = (global.posSettingsService && global.posSettingsService.DEFAULTS) || {};
        SECOES_CONFIG.forEach(function (secao) {
          var gravado = {};
          var l = linhas.filter(function (x) { return x.secao === secao; })[0];
          if (l && l.dados) { try { gravado = JSON.parse(l.dados); } catch (e) { gravado = {}; } }
          out[secao] = {};
          // Cada chave de DEFAULTS pertence a uma secao; distribui.
          Object.keys(padroes).forEach(function (k) {
            if (CHAVES_POR_SECAO[secao] && CHAVES_POR_SECAO[secao].indexOf(k) !== -1) out[secao][k] = padroes[k];
          });
          if (l) out[secao] = mergeObj(out[secao], gravado);
        });
        return { config: out, secoes: null };
      });
    },

    configObter: function (empresaId, secao) {
      return DB.configListar(empresaId).then(function (r) { return (r.config || {})[secao] || {}; });
    },

    configSalvar: function (empresaId, secao, dados) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('config/salvar', contextoApi([empresaId], { secao: secao, dados: dados }));
      return req(tx('empresa_config').index('empresaId').getAll(empresaId)).then(function (linhas) {
        var l = linhas.filter(function (x) { return x.secao === secao; })[0];
        var atual = {};
        if (l && l.dados) { try { atual = JSON.parse(l.dados); } catch (e) { atual = {}; } }
        var novo = mergeObj(atual, dados || {});
        var reg = { empresaId: empresaId, secao: secao, dados: JSON.stringify(novo), atualizadoEm: new Date().toISOString() };
        if (l) reg.id = l.id;
        return req(tx('empresa_config', 'readwrite').put(reg)).then(function () {
          DB.notificar('configuracao', 'alterada', { secao: secao });
          return novo;
        });
      });
    },

    /* ---------- Estabelecimentos (filiais) ---------- */
    listarEstabelecimentos: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('estabelecimentos/listar', { empresaId: empresaId });
      return req(tx('estabelecimentos').index('empresaId').getAll(empresaId));
    },

    criarEstabelecimento: function (empresaId, dados) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('estabelecimentos/criar', contextoApi([empresaId], { dados: dados }));
      var reg = mergeObj({ empresaId: empresaId, ativo: true, criadoEm: new Date().toISOString() }, dados || {});
      return req(tx('estabelecimentos', 'readwrite').add(reg)).then(function (id) {
        DB.notificar('estabelecimento', 'criado', { id: id });
        return id;
      });
    },

    atualizarEstabelecimento: function (empresaId, id, dados) {
      if (modoServidor()) return api('estabelecimentos/atualizar', contextoApi([empresaId], { id: id, dados: dados }));
      return req(tx('estabelecimentos').get(id)).then(function (e) {
        if (!e) throw new Error('Estabelecimento #' + id + ' nao encontrado.');
        var novo = mergeObj(e, dados || {});
        return req(tx('estabelecimentos', 'readwrite').put(novo)).then(function () {
          DB.notificar('estabelecimento', 'atualizado', { id: id });
          return true;
        });
      });
    },

    removerEstabelecimento: function (empresaId, id) {
      if (modoServidor()) return api('estabelecimentos/remover', contextoApi([empresaId], { id: id }));
      return DB.atualizarEstabelecimento(empresaId, id, { ativo: false });
    },

    /* ---------- Certificado: em modo local NAO se guarda senha ---------- *
     * Sem servidor nao existe chave de cifra confiavel — e guardar senha
     * de certificado em claro no navegador seria uma falha grave. Entao o
     * certificado simplesmente exige servidor, e a tela explica isso. */
    obterCertificado: function () {
      if (modoServidor()) return api('fiscal/certificado', contextoApi([]));
      return Promise.resolve({ certificado: null, existe: false, exigeServidor: true });
    },
    salvarCertificado: function () {
      if (modoServidor()) return api('fiscal/certificado-salvar', contextoApi([], {}));
      return Promise.reject(new Error(
        'O certificado digital exige o servidor: a senha precisa ser cifrada no backend. ' +
        'Inicie o servidor (iniciar-servidor.cmd) para cadastrar o certificado.'
      ));
    },

    /* ---------- Regime tributario ---------- */
    listarRegimes: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('fiscal/regimes', { empresaId: empresaId });
      return DB.obterEmpresa(empresaId).then(function (e) {
        return {
          historico: e.regimeTributario ? [{ regimeTributario: e.regimeTributario, crt: e.crt, dataInicio: null, dataFim: null }] : [],
          vigente: e.regimeTributario ? { regimeTributario: e.regimeTributario, crt: e.crt } : null,
          campos: null
        };
      });
    },
    registrarRegime: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/regime-registrar', contextoApi([empresaId], { dados: dados }));
      return DB.atualizarEmpresa(empresaId, { regimeTributario: dados.regimeTributario, crt: dados.crt });
    },

    /* ---------- Estoque: leitura ---------- */
    listarSaldosEstoque: function (empresaId, filtro) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('estoque/saldos', contextoApi([empresaId], filtro || {}));
      filtro = filtro || {};
      return DB.listarProdutos(empresaId).then(function (produtos) {
        return req(tx('product_stock').index('empresaId').getAll(empresaId)).then(function (linhas) {
          var porProduto = {};
          linhas.forEach(function (l) {
            if (!porProduto[l.produtoId]) porProduto[l.produtoId] = [];
            porProduto[l.produtoId].push({ setor: l.setor, quantidade: Number(l.quantidade) || 0 });
          });
          return produtos.filter(function (p) {
            if (filtro.categoria && p.categoria !== filtro.categoria) return false;
            if (filtro.apenasControlados && !p.controlaEstoque) return false;
            if (filtro.busca) {
              var f = String(filtro.busca).toLowerCase();
              var alvo = (String(p.nome || '') + ' ' + String(p.codigoInterno || '') + ' ' + String(p.codigoBarras || '')).toLowerCase();
              if (alvo.indexOf(f) === -1) return false;
            }
            return true;
          }).map(function (p) {
            var atual = Number(p.estoqueAtual) || 0;
            var minimo = Number(p.estoqueMinimo) || 0;
            return {
              id: p.id, nome: p.nome, categoria: p.categoria, unidade: p.unidade || 'UN',
              codigoInterno: p.codigoInterno, codigoBarras: p.codigoBarras,
              preco: Number(p.preco) || 0, precoCusto: Number(p.precoCusto) || 0,
              estoqueAtual: atual, estoqueMinimo: minimo, estoqueMaximo: Number(p.estoqueMaximo) || 0,
              controlaEstoque: !!p.controlaEstoque, controlaLote: !!p.controlaLote,
              controlaValidade: !!p.controlaValidade, setor: p.setor,
              abaixoMinimo: atual < minimo, setores: porProduto[p.id] || []
            };
          });
        });
      });
    },

    /* ---------- Estoque: movimentacao (mesmo contrato do servidor) ----------
     * Toda alteracao de saldo passa por aqui e gera um registro em
     * stock_movements. NUNCA se escreve estoqueAtual direto — no navegador
     * a regra e a mesma do servidor. */
    movimentarEstoqueLocal: function (m) {
      if (!m || !m.usuario) return Promise.reject(new Error('Movimentacao sem usuario. Toda movimentacao precisa de responsavel.'));
      var empresaId = m.empresaId || EMPRESA_PADRAO;
      var TIPOS = ['ENTRADA_COMPRA', 'ENTRADA_MANUAL', 'SAIDA_PDV', 'SAIDA_PEDIDO', 'SAIDA_DELIVERY',
        'SAIDA_PRODUCAO', 'PERDA', 'AVARIA', 'DEVOLUCAO', 'TRANSFERENCIA', 'AJUSTE',
        'INVENTARIO', 'CANCELAMENTO', 'ESTORNO'];
      if (TIPOS.indexOf(m.tipoMovimento) === -1) {
        return Promise.reject(new Error('Tipo de movimento invalido: ' + m.tipoMovimento + '.'));
      }
      var ENTRADAS = ['ENTRADA_COMPRA', 'ENTRADA_MANUAL', 'DEVOLUCAO', 'CANCELAMENTO', 'ESTORNO'];
      var entrada = ENTRADAS.indexOf(m.tipoMovimento) !== -1;
      var qtd = Number(m.quantidade);
      if (!(qtd > 0)) return Promise.reject(new Error('Quantidade da movimentacao deve ser maior que zero.'));

      return req(tx('produtos').get(m.produtoId)).then(function (produto) {
        if (!produto) throw new Error('Produto #' + m.produtoId + ' nao encontrado.');
        if (produto.ativo === false) throw new Error('Produto "' + produto.nome + '" esta INATIVO e nao pode ser movimentado.');

        var controla = !!produto.controlaEstoque;
        var transferencia = !!m.setorDestino && !entrada;
        var anterior = Number(produto.estoqueAtual) || 0;
        var delta = transferencia ? 0 : (entrada ? qtd : -qtd);
        var posterior = Math.round((anterior + delta) * 1e6) / 1e6;

        return DB.configObter(empresaId, 'estoque').then(function (cfg) {
          cfg = cfg || {};
          if (posterior < 0 && !cfg.permitirEstoqueNegativo && controla) {
            throw new Error('Estoque insuficiente para "' + produto.nome + '". Disponivel: ' + anterior + ', solicitado: ' + qtd + '.');
          }
          if (m.dataValidade && !/^\d{4}-\d{2}-\d{2}$/.test(String(m.dataValidade))) {
            throw new Error('Data invalida: ' + m.dataValidade + '. Use o formato AAAA-MM-DD.');
          }

          var custo = Number(m.custoUnitario != null ? m.custoUnitario : produto.precoCusto) || 0;
          var movimento = {
            empresaId: empresaId, produtoId: produto.id, tipoMovimento: m.tipoMovimento,
            quantidade: qtd, unidade: produto.unidade || 'UN',
            estoqueAnterior: anterior, estoquePosterior: posterior,
            custoUnitario: custo, valorTotal: Number((qtd * custo).toFixed(2)),
            lote: m.lote || null,
            dataFabricacao: m.dataFabricacao || null, dataValidade: m.dataValidade || null,
            origem: m.origem || 'MANUAL', documentoId: m.documentoId != null ? String(m.documentoId) : null,
            usuarioId: m.usuarioId || null, usuario: String(m.usuario),
            setorOrigem: m.setor || 'ESTOQUE CENTRAL', setorDestino: m.setorDestino || null,
            observacao: m.observacao || '', cancelado: 0,
            created_at: new Date().toISOString()
          };

          return req(tx('stock_movements', 'readwrite').add(movimento)).then(function (movId) {
            if (!controla) return { movimentoId: movId, estoqueAnterior: anterior, estoquePosterior: posterior, custoUnitario: custo, lotes: [], nomeProduto: produto.nome };

            var novoCusto = Number(produto.precoCusto) || 0;
            if (!transferencia) {
              produto.estoqueAtual = posterior;
              if (entrada && posterior > 0) {
                novoCusto = Number((((anterior * novoCusto) + movimento.valorTotal) / posterior).toFixed(6));
                produto.precoCusto = novoCusto;
              }
            }
            produto.updatedAt = new Date().toISOString();

            return req(tx('produtos', 'readwrite').put(produto)).then(function () {
              // Saldo por setor (mesma regra do servidor).
              return req(tx('product_stock').index('empresaId').getAll(empresaId)).then(function (linhas) {
                function setorAtual(nomeSetor) {
                  var l = linhas.filter(function (x) { return x.produtoId === produto.id && x.setor === nomeSetor; })[0];
                  return l ? l : { empresaId: empresaId, produtoId: produto.id, setor: nomeSetor, quantidade: 0, reservado: 0 };
                }
                var origem = setorAtual(movimento.setorOrigem);
                var ops = [];
                if (transferencia) {
                  origem.quantidade = Number(origem.quantidade) - qtd;
                  var destino = setorAtual(m.setorDestino);
                  destino.quantidade = Number(destino.quantidade) + qtd;
                  destino.custoMedio = custo;
                  ops.push(req(tx('product_stock', 'readwrite').put(origem)));
                  ops.push(req(tx('product_stock', 'readwrite').put(destino)));
                } else {
                  origem.quantidade = Number(origem.quantidade) + delta;
                  origem.custoMedio = m.tipoMovimento.indexOf('ENTRADA') === 0 ? novoCusto : custo;
                  ops.push(req(tx('product_stock', 'readwrite').put(origem)));
                }
                return Promise.all(ops).then(function () {
                  DB.notificar('estoque', 'movimentado', { produtoId: produto.id, tipo: m.tipoMovimento });
                  return { movimentoId: movId, estoqueAnterior: anterior, estoquePosterior: posterior, custoUnitario: custo, valorTotal: movimento.valorTotal, lotes: m.lote ? [{ lote: m.lote, quantidade: qtd }] : [], nomeProduto: produto.nome };
                });
              });
            });
          });
        });
      });
    },

    entradaEstoque: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/entrada', contextoApi([empresaId], { dados: dados }));
      return DB.movimentarEstoqueLocal(mergeObj(dados || {}, { empresaId: empresaId || EMPRESA_PADRAO, tipoMovimento: 'ENTRADA_MANUAL' }));
    },

    saidaEstoque: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/saida', contextoApi([empresaId], { dados: dados }));
      return DB.movimentarEstoqueLocal(mergeObj(dados || {}, { empresaId: empresaId || EMPRESA_PADRAO, tipoMovimento: (dados && dados.tipoMovimento) || 'SAIDA_PEDIDO' }));
    },

    registrarPerdaEstoque: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/perda', contextoApi([empresaId], { dados: dados }));
      return DB.movimentarEstoqueLocal(mergeObj(dados || {}, {
        empresaId: empresaId || EMPRESA_PADRAO,
        tipoMovimento: (dados && dados.tipo === 'AVARIA') ? 'AVARIA' : 'PERDA'
      }));
    },

    transferirEstoque: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/transferir', contextoApi([empresaId], { dados: dados }));
      dados = dados || {};
      if (!dados.setorOrigem || !dados.setorDestino) return Promise.reject(new Error('Informe o setor de origem e o de destino.'));
      if (dados.setorOrigem === dados.setorDestino) return Promise.reject(new Error('O setor de destino deve ser diferente do de origem.'));
      return DB.movimentarEstoqueLocal(mergeObj(dados, {
        empresaId: empresaId || EMPRESA_PADRAO, tipoMovimento: 'TRANSFERENCIA'
      }));
    },

    ajustarEstoque: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/ajustar', contextoApi([empresaId], { dados: dados }));
      dados = dados || {};
      return req(tx('produtos').get(dados.produtoId)).then(function (p) {
        if (!p) throw new Error('Produto #' + dados.produtoId + ' nao encontrado.');
        var nova = Number(dados.quantidadeNova);
        if (!(nova >= 0)) throw new Error('Quantidade de ajuste invalida.');
        var dif = Number((nova - (Number(p.estoqueAtual) || 0)).toFixed(6));
        if (dif === 0) throw new Error('A quantidade informada e igual ao estoque atual: nada a ajustar.');
        return DB.movimentarEstoqueLocal({
          empresaId: empresaId || EMPRESA_PADRAO, produtoId: dados.produtoId,
          tipoMovimento: 'AJUSTE', quantidade: Math.abs(dif), setor: dados.setor,
          usuario: dados.usuario, origem: 'AJUSTE',
          observacao: (dif > 0 ? 'Ajuste de entrada' : 'Ajuste de saida') + (dados.motivo ? ' - ' + dados.motivo : '')
        });
      });
    },

    listarSetoresEstoque: function (empresaId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('estoque/setores', { empresaId: empresaId });
      return req(tx('stock_sectors').index('empresaId').getAll(empresaId));
    },

    listarLotes: function (empresaId, filtro) {
      if (modoServidor()) return api('estoque/lotes', contextoApi([empresaId], filtro || {}));
      return req(tx('stock_lots').index('empresaId').getAll(empresaId || EMPRESA_PADRAO)).then(function (arr) {
        filtro = filtro || {};
        return arr.filter(function (l) {
          if (filtro.produtoId && l.produtoId !== filtro.produtoId) return false;
          if (filtro.apenasComSaldo && !(Number(l.quantidadeAtual) > 0)) return false;
          return true;
        });
      });
    },

    listarAlertasEstoque: function (empresaId) {
      if (modoServidor()) return api('estoque/alertas', { empresaId: empresaId || EMPRESA_PADRAO });
      empresaId = empresaId || EMPRESA_PADRAO;
      return Promise.all([DB.configObter(empresaId, 'estoque'), DB.listarSaldosEstoque(empresaId, {})]).then(function (r) {
        var cfg = r[0] || {}, produtos = r[1] || [], alertas = [];
        if (cfg.alertarEstoqueMinimo) {
          produtos.forEach(function (p) {
            if (p.controlaEstoque && p.estoqueAtual < p.estoqueMinimo) {
              alertas.push({ tipo: 'ESTOQUE_MINIMO', produtoId: p.id, mensagem: p.nome + ': ' + p.estoqueAtual + ' ' + p.unidade + ' (minimo ' + p.estoqueMinimo + ').' });
            }
          });
        }
        if (cfg.alertarValidadeVencida) {
          var hoje = new Date().toISOString().slice(0, 10);
          var limite = new Date(Date.now() + (Number(cfg.diasAlertaValidade) || 30) * 86400000).toISOString().slice(0, 10);
          return DB.listarLotes(empresaId, { apenasComSaldo: true }).then(function (lotes) {
            lotes.forEach(function (l) {
              if (!l.dataValidade) return;
              if (l.dataValidade < hoje) alertas.push({ tipo: 'VALIDADE_VENCIDA', produtoId: l.produtoId, mensagem: 'Lote ' + l.lote + ' vencido em ' + l.dataValidade + '.' });
              else if (l.dataValidade <= limite) alertas.push({ tipo: 'VALIDADE_PROXIMA', produtoId: l.produtoId, mensagem: 'Lote ' + l.lote + ' vence em ' + l.dataValidade + '.' });
            });
            return alertas;
          });
        }
        return alertas;
      });
    },

    /* ---------- Estoque: o que exige servidor ----------
     * Ficha tecnica, inventario, CMV, relatorios e fiscal usam tabelas do
     * servidor. Em modo local a tela explica a limitacao em vez de fingir
     * que funcionou. */
    _exigeServidor: function (recurso) {
      return Promise.reject(new Error('"' + recurso + '" precisa do servidor. Inicie o servidor (iniciar-servidor.cmd) para usar este recurso.'));
    },

    listarFichasTecnicas: function (empresaId) {
      if (modoServidor()) return api('estoque/fichas', { empresaId: empresaId || EMPRESA_PADRAO });
      return DB._exigeServidor('Ficha tecnica');
    },
    obterFichaTecnica: function (empresaId, produtoId) {
      if (modoServidor()) return api('estoque/ficha', contextoApi([empresaId], { produtoId: produtoId }));
      return DB._exigeServidor('Ficha tecnica');
    },
    salvarFichaTecnica: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/ficha-salvar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Ficha tecnica');
    },
    removerFichaTecnica: function (empresaId, produtoId) {
      if (modoServidor()) return api('estoque/ficha-remover', contextoApi([empresaId], { produtoId: produtoId }));
      return DB._exigeServidor('Ficha tecnica');
    },
    obterInventario: function (empresaId, id) {
      if (modoServidor()) return api('estoque/inventario', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Inventario');
    },
    abrirInventario: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/inventario-abrir', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Inventario');
    },
    contarItemInventario: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/inventario-contar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Inventario');
    },
    fecharInventario: function (empresaId, id) {
      if (modoServidor()) return api('estoque/inventario-fechar', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Inventario');
    },
    cancelarInventario: function (empresaId, id) {
      if (modoServidor()) return api('estoque/inventario-cancelar', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Inventario');
    },
    indicadoresEstoque: function (empresaId, filtro) {
      if (modoServidor()) return api('estoque/indicadores', contextoApi([empresaId], filtro || {}));
      return DB._exigeServidor('Indicadores de estoque');
    },
    listarFalhasEstoque: function (empresaId, status) {
      if (modoServidor()) return api('estoque/falhas', contextoApi([empresaId], { status: status }));
      return DB._exigeServidor('Reconciliacao de estoque');
    },
    reprocessarFalhaEstoque: function (empresaId, id) {
      if (modoServidor()) return api('estoque/falha-reprocessar', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Reconciliacao de estoque');
    },
    descartarFalhaEstoque: function (empresaId, id, motivo) {
      if (modoServidor()) return api('estoque/falha-descartar', contextoApi([empresaId], { id: id, motivo: motivo }));
      return DB._exigeServidor('Reconciliacao de estoque');
    },
    calcularCMV: function (empresaId, filtro) {
      if (modoServidor()) return api('estoque/cmv', contextoApi([empresaId], { filtro: filtro }));
      return DB._exigeServidor('CMV');
    },
    apurarCMV: function (empresaId, dados) {
      if (modoServidor()) return api('estoque/cmv-apurar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('CMV');
    },
    executarRelatorioEstoque: function (empresaId, nome, filtro) {
      if (modoServidor()) return api('estoque/relatorio', contextoApi([empresaId], { nome: nome, filtro: filtro }));
      return DB._exigeServidor('Relatorios de estoque');
    },
    exportarRelatorioEstoque: function (empresaId, nome, formato, filtro) {
      if (modoServidor()) return api('estoque/exportar', contextoApi([empresaId], { nome: nome, formato: formato, filtro: filtro }));
      return DB._exigeServidor('Exportacao de relatorio');
    },
    verificarDisponibilidade: function (empresaId, produtoId) {
      if (modoServidor()) return api('estoque/disponibilidade', contextoApi([empresaId], { produtoId: produtoId }));
      return Promise.resolve({ disponivel: true, motivo: 'Controle de disponibilidade exige o servidor.' });
    },
    listarCardapio: function (empresaId) {
      if (modoServidor()) return api('cardapio/listar', { empresaId: empresaId || EMPRESA_PADRAO });
      return DB.listarProdutos(empresaId || EMPRESA_PADRAO).then(function (prods) {
        return prods.filter(function (p) { return p.ativo !== false; })
          .map(function (p) { return { id: p.id, nome: p.nome, categoria: p.categoria, preco: p.preco, disponivel: true, motivo: 'Sem controle no modo local.' }; });
      });
    },

    /* ---------- Fiscal: leitura local e bloqueio da emissao ----------
     * Dado fiscal NAO vive no navegador: em modo local as listas voltam
     * vazias e a EMISSAO e explicitamente recusada, dizendo o motivo. */
    listarDocumentosFiscais: function (empresaId, filtro) {
      if (modoServidor()) return api('fiscal/documentos', contextoApi([empresaId], { filtro: filtro }));
      return req(tx('fiscal_documents').index('empresaId').getAll(empresaId || EMPRESA_PADRAO));
    },
    obterDocumentoFiscal: function (empresaId, id) {
      if (modoServidor()) return api('fiscal/documento', contextoApi([empresaId], { id: id }));
      return req(tx('fiscal_documents').get(id));
    },
    listarLogsFiscais: function (empresaId, filtro) {
      if (modoServidor()) return api('fiscal/logs', contextoApi([empresaId], { filtro: filtro }));
      return DB._exigeServidor('Log fiscal');
    },
    listarContingencias: function (empresaId) {
      if (modoServidor()) return api('fiscal/contingencias', { empresaId: empresaId || EMPRESA_PADRAO });
      return Promise.resolve([]);
    },
    listarRegras: function (empresaId, filtro) {
      if (modoServidor()) return api('fiscal/regras', contextoApi([empresaId], { filtro: filtro }));
      return req(tx('tax_rules').index('empresaId').getAll(empresaId || EMPRESA_PADRAO));
    },
    listarSeries: function (empresaId) {
      if (modoServidor()) return api('fiscal/series', { empresaId: empresaId || EMPRESA_PADRAO });
      return Promise.resolve([]);
    },
    listarInutilizacoes: function (empresaId) {
      if (modoServidor()) return api('fiscal/inutilizacoes', { empresaId: empresaId || EMPRESA_PADRAO });
      return Promise.resolve([]);
    },
    listarProvedoresFiscais: function () {
      if (modoServidor()) return api('fiscal/provedores', {});
      return Promise.resolve([{ chave: 'simulado', nome: 'SIMULADO (modo local)', capacidades: { transmite: false } }]);
    },
    validarProntidaoFiscal: function (empresaId) {
      if (modoServidor()) return api('fiscal/prontidao', contextoApi([empresaId]));
      return Promise.resolve({ pronto: false, motivos: ['A emissao fiscal exige o servidor no ar (o certificado e a assinatura ficam no backend).'] });
    },
    emitirDocumentoFiscal: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/emitir', contextoApi([empresaId], { dados: dados }));
      return Promise.reject(new Error('Emissao fiscal exige o servidor: o certificado, a assinatura e o envio ficam no backend. Nada foi emitido.'));
    },
    cancelarDocumentoFiscal: function (empresaId, id, dados) {
      if (modoServidor()) return api('fiscal/cancelar', contextoApi([empresaId], { id: id, dados: dados }));
      return DB._exigeServidor('Cancelamento fiscal');
    },
    inutilizarNumeracao: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/inutilizar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Inutilizacao de numeracao');
    },
    consultarDocumentoFiscal: function (empresaId, id) {
      if (modoServidor()) return api('fiscal/consultar', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Consulta fiscal');
    },
    baixarXML: function (empresaId, id) {
      if (modoServidor()) return api('fiscal/xml', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Download do XML');
    },
    baixarDANFE: function (empresaId, id) {
      if (modoServidor()) return api('fiscal/danfe', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Download do DANFE');
    },
    enviarDocumentoEmail: function (empresaId, id, dados) {
      if (modoServidor()) return api('fiscal/enviar-email', contextoApi([empresaId], { id: id, dados: dados }));
      return DB._exigeServidor('Envio por e-mail');
    },
    enviarDocumentoWhatsApp: function (empresaId, id, dados) {
      if (modoServidor()) return api('fiscal/enviar-whatsapp', contextoApi([empresaId], { id: id, dados: dados }));
      return DB._exigeServidor('Envio por WhatsApp');
    },
    calcularTributos: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/calcular', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Calculo tributario');
    },
    simularTributos: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/simular', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Simulacao tributaria');
    },
    salvarRegra: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/regra-salvar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Regra tributaria');
    },
    removerRegra: function (empresaId, id) {
      if (modoServidor()) return api('fiscal/regra-remover', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Regra tributaria');
    },
    listarServicosFiscais: function (empresaId) {
      if (modoServidor()) return api('fiscal/servicos', { empresaId: empresaId || EMPRESA_PADRAO });
      return Promise.resolve([]);
    },
    salvarServicoFiscal: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/servico-salvar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Cadastro de servico fiscal');
    },
    listarNaturezas: function (empresaId) {
      if (modoServidor()) return api('fiscal/naturezas', { empresaId: empresaId || EMPRESA_PADRAO });
      return Promise.resolve([]);
    },
    listarVersoesRegras: function () {
      if (modoServidor()) return api('fiscal/regras-versoes', {});
      return Promise.resolve([]);
    },
    importarVersaoRegras: function (empresaId, pacote) {
      if (modoServidor()) return api('fiscal/regras-importar', contextoApi([empresaId], { pacote: pacote }));
      return DB._exigeServidor('Importacao de regras fiscais');
    },
    consultarStatusFiscal: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/status-servico', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Status do servico fiscal');
    },
    definirDocumentoFiscal: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/definir-documento', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Definicao do documento fiscal');
    },
    ativarContingencia: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/contingencia-ativar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Contingencia fiscal');
    },
    encerrarContingencia: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/contingencia-encerrar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Contingencia fiscal');
    },
    reprocessarContingencia: function (empresaId, dados) {
      if (modoServidor()) return api('fiscal/contingencia-reprocessar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Reprocessamento fiscal');
    },

    /* ---------- Produto completo (evolucao do cadastro) ---------- */
    obterProdutoCompleto: function (empresaId, id) {
      if (modoServidor()) return api('produto/obter', contextoApi([empresaId], { id: id }));
      return req(tx('produtos').get(id));
    },
    salvarProdutoCompleto: function (empresaId, dados) {
      if (modoServidor()) return api('produto/salvar-completo', contextoApi([empresaId], { dados: dados }));
      dados = dados || {};
      if (dados.id) {
        return req(tx('produtos').get(dados.id)).then(function (p) {
          if (!p) throw new Error('Produto #' + dados.id + ' nao encontrado.');
          var novo = mergeObj(p, dados);
          return req(tx('produtos', 'readwrite').put(novo)).then(function () {
            DB.notificar('produto', 'editado', { id: dados.id });
            return { id: dados.id, atualizado: true };
          });
        });
      }
      var reg = mergeObj({
        empresaId: empresaId || EMPRESA_PADRAO, ativo: true, criadoEm: new Date().toISOString(),
        estoqueAtual: 0, precoCusto: 0, controlaEstoque: true
      }, dados);
      return req(tx('produtos', 'readwrite').add(reg)).then(function (id) {
        DB.notificar('produto', 'criado', { id: id });
        return { id: id, criado: true };
      });
    },

    /* ---------- PDV VISUAL: cardapio e cupom da conta ----------
     * Estas operacoes sao de LEITURA (montam a visao). Receber/fechar
     * continuam sendo pagarComanda/fecharComanda, sem duplicar caixa. */
    cardapioPdv: function (empresaId, filtro) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('pdv/cardapio', contextoApi([empresaId], filtro || {}));
      // Modo local: monta o cardapio a partir do catalogo do IndexedDB.
      return DB.listarProdutos(empresaId).then(function (arr) {
        var prods = arr.filter(function (p) { return p.ativo !== false && p.produtoVenda !== 0; })
          .map(function (p) {
            return {
              id: p.id, nome: p.nome, descricao: p.descricao || '',
              categoria: p.categoria || 'Geral', subcategoria: p.subcategoria || '',
              preco: Number(p.preco) || 0, unidade: p.unidade || 'UN',
              codigoInterno: p.codigoInterno || '', codigoBarras: p.codigoBarras || '',
              ean: p.ean || '', imagem: p.imagemUrl || null,
              imagemThumb: p.imagemThumbUrl || p.imagemUrl || null,
              disponivel: p.disponivelCardapio !== 0, motivoIndisponivel: '', detalheDisponibilidade: null
            };
          });
        var termo = String((filtro && filtro.busca) || '').trim().toLowerCase();
        var cat = String((filtro && filtro.categoria) || '').trim();
        var lista = prods.filter(function (p) {
          if (cat && cat !== 'TODOS') {
            var c = String(p.categoria || '').toLowerCase();
            var s = String(p.subcategoria || '').toLowerCase();
            if (c !== cat.toLowerCase() && s !== cat.toLowerCase()) return false;
          }
          if (!termo) return true;
          return [p.nome, p.codigoInterno, p.codigoBarras, p.ean, p.categoria]
            .some(function (v) { return String(v == null ? '' : v).toLowerCase().indexOf(termo) !== -1; });
        });
        var setCat = {};
        prods.forEach(function (p) { if (p.categoria) setCat[p.categoria] = true; });
        var cats = Object.keys(setCat).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
        return { produtos: lista, categorias: ['TODOS'].concat(cats), total: lista.length };
      });
    },

    cupomDaComanda: function (empresaId, comandaId, opts) {
      empresaId = empresaId || EMPRESA_PADRAO;
      opts = opts || {};
      if (modoServidor()) return api('pdv/cupom', contextoApi([empresaId], { comandaId: comandaId, parcial: !!opts.parcial, em: opts.em }));
      return DB._exigeServidor('Cupom da conta');
    },

    /* ---------- Foto do produto ---------- */
    salvarImagemProduto: function (empresaId, produtoId, dataUrl, thumb) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) {
        return api('produto/imagem-salvar', contextoApi([empresaId], { produtoId: produtoId, dataUrl: dataUrl, thumb: thumb }));
      }
      return DB._exigeServidor('Foto do produto');
    },
    removerImagemProduto: function (empresaId, produtoId) {
      empresaId = empresaId || EMPRESA_PADRAO;
      if (modoServidor()) return api('produto/imagem-remover', contextoApi([empresaId], { produtoId: produtoId }));
      return DB._exigeServidor('Foto do produto');
    },

    /* ---------- IMPRESSORAS (gerenciamento) ----------
     * As rotas de impressao exigem o servidor: a fila e o log sao
     * compartilhados entre as estacoes (o Print Service le a fila daqui).
     * Sem servidor, a tela avisa em vez de fingir que imprimiu. */
    impressaoCatalogo: function (empresaId) {
      if (modoServidor()) return api('impressao/catalogo', contextoApi([empresaId], {}));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    impressaoEstado: function (empresaId, opts) {
      if (modoServidor()) return api('impressao/estado', contextoApi([empresaId], opts || {}));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    salvarImpressora: function (empresaId, dados) {
      if (modoServidor()) return api('impressao/impressora-salvar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    removerImpressora: function (empresaId, id) {
      if (modoServidor()) return api('impressao/impressora-remover', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    salvarEstacao: function (empresaId, dados) {
      if (modoServidor()) return api('impressao/estacao-salvar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    removerEstacao: function (empresaId, id) {
      if (modoServidor()) return api('impressao/estacao-remover', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    salvarMapeamentoSetor: function (empresaId, dados) {
      if (modoServidor()) return api('impressao/setor-salvar', contextoApi([empresaId], { dados: dados }));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    removerMapeamentoSetor: function (empresaId, id) {
      if (modoServidor()) return api('impressao/setor-remover', contextoApi([empresaId], { id: id }));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    restaurarImpressao: function (empresaId) {
      if (modoServidor()) return api('impressao/restaurar', contextoApi([empresaId], {}));
      return DB._exigeServidor('Gerenciamento de impressoras');
    },
    previsaoConta: function (empresaId, comandaId, opts) {
      if (modoServidor()) return api('impressao/previa-conta', contextoApi([empresaId], { comandaId: comandaId, parcial: !!(opts && opts.parcial), largura: opts && opts.largura }));
      return DB._exigeServidor('Previa de impressao');
    },
    separarComanda: function (empresaId, comandaId, estacaoId) {
      if (modoServidor()) return api('impressao/separar-comanda', contextoApi([empresaId], { comandaId: comandaId, estacaoId: estacaoId }));
      return DB._exigeServidor('Separacao por setor');
    },
    imprimirConta: function (empresaId, comandaId, opts) {
      if (modoServidor()) return api('impressao/conta', contextoApi([empresaId], Object.assign({ comandaId: comandaId }, opts || {})));
      return DB._exigeServidor('Impressao');
    },
    imprimirPedidos: function (empresaId, comandaId, opts) {
      if (modoServidor()) return api('impressao/pedidos', contextoApi([empresaId], Object.assign({ comandaId: comandaId }, opts || {})));
      return DB._exigeServidor('Impressao');
    },
    testarImpressao: function (empresaId, dados) {
      if (modoServidor()) return api('impressao/testar', contextoApi([empresaId], dados || {}));
      return DB._exigeServidor('Teste de impressao');
    },
    filaImpressao: function (empresaId, opts) {
      if (modoServidor()) return api('impressao/fila', contextoApi([empresaId], opts || {}));
      return DB._exigeServidor('Fila de impressao');
    },
    historicoImpressao: function (empresaId, opts) {
      if (modoServidor()) return api('impressao/historico', contextoApi([empresaId], opts || {}));
      return DB._exigeServidor('Historico de impressao');
    },
    reimprimir: function (empresaId, jobId, motivo) {
      if (modoServidor()) return api('impressao/reimprimir', contextoApi([empresaId], { jobId: jobId, motivo: motivo }));
      return DB._exigeServidor('Reimpressao');
    },
    cancelarTrabalhoImpressao: function (empresaId, jobId, motivo) {
      if (modoServidor()) return api('impressao/cancelar', contextoApi([empresaId], { jobId: jobId, motivo: motivo }));
      return DB._exigeServidor('Fila de impressao');
    },
    /* Usados pelo Print Service (via printService.js): buscar o que esta
     * pendente e informar o resultado. */
    impressaoPendentes: function (empresaId, opts) {
      if (modoServidor()) return api('impressao/pendentes', contextoApi([empresaId], opts || {}));
      return DB._exigeServidor('Fila de impressao');
    },
    impressaoResultado: function (empresaId, dados) {
      if (modoServidor()) return api('impressao/resultado', contextoApi([empresaId], dados || {}));
      return DB._exigeServidor('Fila de impressao');
    },

    /* ---------- Auditoria detalhada ---------- */
    listarAuditoriaDetalhada: function (empresaId, filtro) {
      if (modoServidor()) return api('auditoria/detalhada', contextoApi([empresaId], filtro || {}));
      empresaId = empresaId || EMPRESA_PADRAO;
      filtro = filtro || {};
      return req(tx('audit_logs').index('empresaId').getAll(empresaId)).then(function (arr) {
        return arr.filter(function (l) {
          if (filtro.modulo && l.modulo !== filtro.modulo) return false;
          if (filtro.registroId && String(l.registroId) !== String(filtro.registroId)) return false;
          if (filtro.de && l.em < filtro.de) return false;
          if (filtro.ate && l.em > filtro.ate) return false;
          return true;
        }).sort(function (a, b) { return String(b.em).localeCompare(String(a.em)); }).slice(0, Number(filtro.limite) || 300);
      });
    },
    listarModulosAuditoria: function (empresaId) {
      if (modoServidor()) return api('auditoria/modulos', { empresaId: empresaId || EMPRESA_PADRAO });
      return req(tx('audit_logs').index('empresaId').getAll(empresaId || EMPRESA_PADRAO)).then(function (arr) {
        var vistos = {};
        arr.forEach(function (l) { if (l.modulo) vistos[l.modulo] = 1; });
        return Object.keys(vistos).sort();
      });
    },

    /* ---------- Permissoes ---------- */
    catalogoPermissoes: function () {
      if (modoServidor()) return api('permissoes/catalogo', {});
      return Promise.resolve({ permissoes: [], padraoPorPerfil: {} });
    },
    permissoesDoUsuario: function (login) {
      if (modoServidor()) return api('usuarios/permissoes', contextoApi([], { login: login }));
      return DB.buscarUsuario(login).then(function (u) {
        if (!u) throw new Error('Usuario ' + login + ' nao encontrado.');
        var lista = [];
        try { lista = u.permissoes ? JSON.parse(u.permissoes) : []; } catch (e) { lista = []; }
        return { usuario: u.usuario, nome: u.nome, perfil: u.perfil, permissoes: lista, catalogo: [] };
      });
    },
    salvarPermissoesUsuario: function (login, permissoes) {
      if (modoServidor()) return api('usuarios/permissao-salvar', contextoApi([], { login: login, permissoes: permissoes }));
      return DB.buscarUsuario(login).then(function (u) {
        if (!u) throw new Error('Usuario ' + login + ' nao encontrado.');
        return DB.atualizarUsuario(u.id, { permissoes: JSON.stringify(permissoes || []) }).then(function () {
          return { usuario: login, permissoes: permissoes || [] };
        });
      });
    },

    _req: req,
    combineData: combineData,
    hash: hash
  };

  /* ==============================================================
   * PONTE MODO SERVIDOR
   * --------------------------------------------------------------
   * Quando o servidor esta ativo, estas operacoes passam a consultar a
   * API (dados compartilhados entre dispositivos) em vez do IndexedDB.
   * No modo local, as implementacoes originais continuam valendo.
   * ============================================================== */
  var ROTAS = {
    autenticar: 'auth/login',

    listarAptos: 'aptos/listar',
    obterApto: 'aptos/obter',
    criarApto: 'aptos/criar',
    atualizarApto: 'aptos/atualizar',
    removerApto: 'aptos/remover',
    estadoDoApto: 'aptos/estado',

    listarHospedes: 'hospedes/listar',
    obterHospede: 'hospedes/obter',
    criarHospede: 'hospedes/criar',
    atualizarHospede: 'hospedes/atualizar',

    listarReservas: 'reservas/listar',
    obterReserva: 'reservas/obter',
    criarReservaCompleta: 'reservas/criar',
    atualizarReserva: 'reservas/atualizar',
    cancelarReserva: 'reservas/cancelar',

    listarHospedagens: 'hospedagens/listar',
    hospedagemAtivaDoApto: 'hospedagens/ativa',
    criarHospedagem: 'hospedagens/criar',
    fazerCheckout: 'hospedagens/checkout',

    listarConsumosPorHospedagem: 'consumos/listar',
    criarConsumo: 'consumos/criar',
    removerConsumo: 'consumos/remover',

    listarPassantes: 'passantes/listar',
    criarPassante: 'passantes/criar',

    listarMesas: 'mesas/listar',
    obterMesa: 'mesas/obter',
    criarMesa: 'mesas/criar',
    atualizarMesa: 'mesas/atualizar',
    removerMesa: 'mesas/remover',

    listarProdutos: 'produtos/listar',
    criarProduto: 'produtos/criar',
    atualizarProduto: 'produtos/atualizar',
    removerProduto: 'produtos/remover',

    listarComandas: 'comandas/listar',
    comandaAbertaDaMesa: 'comandas/aberta',
    obterComanda: 'comandas/obter',
    listarItensComanda: 'comandas/itens',
    abrirMesa: 'comandas/abrir',
    adicionarItemComanda: 'comandas/adicionar-item',
    atualizarItemComanda: 'comandas/atualizar-item',
    cancelarItemComanda: 'comandas/cancelar-item',
    pagarComanda: 'comandas/pagar',
    solicitarConta: 'comandas/solicitar-conta',
    fecharComanda: 'comandas/fechar',
    historicoDaMesa: 'comandas/historico-mesa',

    listarCalendario: 'calendario/listar',
    listarAuditoria: 'auditoria/listar',

    obterEmpresa: 'empresa/obter',
    atualizarEmpresa: 'empresa/atualizar',

    /* ---------- v6: configuracoes, estoque, fiscal, auditoria ---------- */
    configListar: 'config/listar',
    configPerfil: 'config/perfil',
    configObter: 'config/obter',
    configSalvar: 'config/salvar',
    configEmpresa: 'config/empresa',
    configFiscal: 'config/fiscal',

    listarEstabelecimentos: 'estabelecimentos/listar',
    criarEstabelecimento: 'estabelecimentos/criar',
    atualizarEstabelecimento: 'estabelecimentos/atualizar',
    removerEstabelecimento: 'estabelecimentos/remover',

    listarRegimes: 'fiscal/regimes',
    registrarRegime: 'fiscal/regime-registrar',
    obterCertificado: 'fiscal/certificado',
    salvarCertificado: 'fiscal/certificado-salvar',
    listarSeries: 'fiscal/series',
    configurarSerie: 'fiscal/serie-configurar',
    listarRegras: 'fiscal/regras',
    salvarRegra: 'fiscal/regra-salvar',
    removerRegra: 'fiscal/regra-remover',
    listarVersoesRegras: 'fiscal/regras-versoes',
    importarVersaoRegras: 'fiscal/regras-importar',
    calcularTributos: 'fiscal/calcular',
    simularTributos: 'fiscal/simular',
    listarServicosFiscais: 'fiscal/servicos',
    salvarServicoFiscal: 'fiscal/servico-salvar',
    listarNaturezas: 'fiscal/naturezas',
    validarProntidaoFiscal: 'fiscal/prontidao',
    listarProvedoresFiscais: 'fiscal/provedores',
    consultarStatusFiscal: 'fiscal/status-servico',
    definirDocumentoFiscal: 'fiscal/definir-documento',
    listarDocumentosFiscais: 'fiscal/documentos',
    obterDocumentoFiscal: 'fiscal/documento',
    emitirDocumentoFiscal: 'fiscal/emitir',
    cancelarDocumentoFiscal: 'fiscal/cancelar',
    inutilizarNumeracao: 'fiscal/inutilizar',
    listarInutilizacoes: 'fiscal/inutilizacoes',
    consultarDocumentoFiscal: 'fiscal/consultar',
    baixarXML: 'fiscal/xml',
    baixarDANFE: 'fiscal/danfe',
    enviarDocumentoEmail: 'fiscal/enviar-email',
    enviarDocumentoWhatsApp: 'fiscal/enviar-whatsapp',
    listarLogsFiscais: 'fiscal/logs',
    listarContingencias: 'fiscal/contingencias',
    ativarContingencia: 'fiscal/contingencia-ativar',
    encerrarContingencia: 'fiscal/contingencia-encerrar',
    reprocessarContingencia: 'fiscal/contingencia-reprocessar',

    listarSaldosEstoque: 'estoque/saldos',
    obterSaldoProduto: 'estoque/saldo-produto',
    listarMovimentacoesEstoque: 'estoque/movimentacoes',
    entradaEstoque: 'estoque/entrada',
    saidaEstoque: 'estoque/saida',
    registrarPerdaEstoque: 'estoque/perda',
    transferirEstoque: 'estoque/transferir',
    ajustarEstoque: 'estoque/ajustar',
    listarSetoresEstoque: 'estoque/setores',
    criarSetorEstoque: 'estoque/setor-criar',
    listarLotes: 'estoque/lotes',
    listarAlertasEstoque: 'estoque/alertas',
    indicadoresEstoque: 'estoque/indicadores',
    listarFalhasEstoque: 'estoque/falhas',
    reprocessarFalhaEstoque: 'estoque/falha-reprocessar',
    descartarFalhaEstoque: 'estoque/falha-descartar',
    abrirInventario: 'estoque/inventario-abrir',
    obterInventario: 'estoque/inventario',
    contarItemInventario: 'estoque/inventario-contar',
    fecharInventario: 'estoque/inventario-fechar',
    cancelarInventario: 'estoque/inventario-cancelar',
    listarFichasTecnicas: 'estoque/fichas',
    obterFichaTecnica: 'estoque/ficha',
    salvarFichaTecnica: 'estoque/ficha-salvar',
    removerFichaTecnica: 'estoque/ficha-remover',
    verificarDisponibilidade: 'estoque/disponibilidade',
    listarCardapio: 'cardapio/listar',
    calcularCMV: 'estoque/cmv',
    apurarCMV: 'estoque/cmv-apurar',
    executarRelatorioEstoque: 'estoque/relatorio',
    exportarRelatorioEstoque: 'estoque/exportar',

    obterProdutoCompleto: 'produto/obter',
    salvarProdutoCompleto: 'produto/salvar-completo',

    cardapioPdv: 'pdv/cardapio',
    cupomDaComanda: 'pdv/cupom',
    salvarImagemProduto: 'produto/imagem-salvar',
    removerImagemProduto: 'produto/imagem-remover',

    /* ---------- Impressoras ---------- */
    impressaoCatalogo: 'impressao/catalogo',
    impressaoEstado: 'impressao/estado',
    salvarImpressora: 'impressao/impressora-salvar',
    removerImpressora: 'impressao/impressora-remover',
    salvarEstacao: 'impressao/estacao-salvar',
    removerEstacao: 'impressao/estacao-remover',
    salvarMapeamentoSetor: 'impressao/setor-salvar',
    removerMapeamentoSetor: 'impressao/setor-remover',
    restaurarImpressao: 'impressao/restaurar',
    previsaoConta: 'impressao/previa-conta',
    separarComanda: 'impressao/separar-comanda',
    imprimirConta: 'impressao/conta',
    imprimirPedidos: 'impressao/pedidos',
    testarImpressao: 'impressao/testar',
    filaImpressao: 'impressao/fila',
    historicoImpressao: 'impressao/historico',
    reimprimir: 'impressao/reimprimir',
    cancelarTrabalhoImpressao: 'impressao/cancelar',
    impressaoPendentes: 'impressao/pendentes',
    impressaoResultado: 'impressao/resultado',

    listarAuditoriaDetalhada: 'auditoria/detalhada',
    listarModulosAuditoria: 'auditoria/modulos',
    catalogoPermissoes: 'permissoes/catalogo',
    permissoesDoUsuario: 'usuarios/permissoes',
    salvarPermissoesUsuario: 'usuarios/permissao-salvar'
  };

  // Mapeia os argumentos posicionais de cada operacao para o payload da API.
  var ARGS = {
    autenticar: function (a) { return { usuario: a[0], senha: a[1] }; },
    listarAptos: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    obterApto: function (a) { return { id: a[0] }; },
    criarApto: function (a) { return a[0] || {}; },
    atualizarApto: function (a) { return { id: a[0], dados: a[1] }; },
    removerApto: function (a) { return { id: a[0] }; },
    estadoDoApto: function (a) { return { id: a[0] }; },

    listarHospedes: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    obterHospede: function (a) { return { id: a[0] }; },
    criarHospede: function (a) { return a[0] || {}; },
    atualizarHospede: function (a) { return { id: a[0], dados: a[1] }; },

    listarReservas: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    obterReserva: function (a) { return { id: a[0] }; },
    criarReservaCompleta: function (a) { return { dados: a[0] || {}, opts: a[1] || {} }; },
    atualizarReserva: function (a) { return { id: a[0], dados: a[1] }; },
    cancelarReserva: function (a) { return { id: a[0] }; },

    listarHospedagens: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    hospedagemAtivaDoApto: function (a) { return { aptoId: a[0] }; },
    criarHospedagem: function (a) { return a[0] || {}; },
    fazerCheckout: function (a) { return { id: a[0], formaPagamento: a[1] }; },

    listarConsumosPorHospedagem: function (a) { return { hospedagemId: a[0] }; },
    criarConsumo: function (a) { return a[0] || {}; },
    removerConsumo: function (a) { return { id: a[0], usuario: a[1] }; },

    listarPassantes: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    criarPassante: function (a) { return a[0] || {}; },

    listarMesas: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    obterMesa: function (a) { return { id: a[0] }; },
    criarMesa: function (a) { return a[0] || {}; },
    atualizarMesa: function (a) { return { id: a[0], dados: a[1] }; },
    removerMesa: function (a) { return { id: a[0] }; },

    listarProdutos: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    criarProduto: function (a) { return a[0] || {}; },
    atualizarProduto: function (a) { return { id: a[0], dados: a[1] }; },
    removerProduto: function (a) { return { id: a[0] }; },

    listarComandas: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    comandaAbertaDaMesa: function (a) { return { mesaId: a[0] }; },
    obterComanda: function (a) { return { id: a[0] }; },
    listarItensComanda: function (a) { return { id: a[0] }; },
    abrirMesa: function (a) { return a[0] || {}; },
    adicionarItemComanda: function (a) { return a[0] || {}; },
    atualizarItemComanda: function (a) { return { itemId: a[0], dados: a[1] }; },
    cancelarItemComanda: function (a) { return { itemId: a[0], usuario: a[1], motivo: a[2] }; },
    pagarComanda: function (a) { return { comandaId: a[0], pagamento: a[1] }; },
    solicitarConta: function (a) { return { mesaId: a[0], comandaId: a[1] }; },
    fecharComanda: function (a) { return { comandaId: a[0], dados: a[1] }; },
    historicoDaMesa: function (a) { return { mesaId: a[0] }; },

    listarCalendario: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    listarAuditoria: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO, limite: a[1] }; },

    obterEmpresa: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    atualizarEmpresa: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO, dados: a[1] }; },

    /* ---------- v6 ---------- */
    configListar: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    configPerfil: function (a) { return contextoApi(a); },
    configObter: function (a) { return contextoApi(a, { secao: a[1] }); },
    configSalvar: function (a) { return contextoApi(a, { secao: a[1], dados: a[2] }); },
    configEmpresa: function (a) { return contextoApi(a, { dados: a[1] }); },
    configFiscal: function (a) { return contextoApi(a, { dados: a[1] }); },

    listarEstabelecimentos: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    criarEstabelecimento: function (a) { return contextoApi(a, { dados: a[1] }); },
    atualizarEstabelecimento: function (a) { return contextoApi(a, { id: a[1], dados: a[2] }); },
    removerEstabelecimento: function (a) { return contextoApi(a, { id: a[1] }); },

    listarRegimes: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    registrarRegime: function (a) { return contextoApi(a, { dados: a[1] }); },
    obterCertificado: function (a) { return contextoApi(a, { estabelecimentoId: a[1] }); },
    salvarCertificado: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarSeries: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    configurarSerie: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarRegras: function (a) { return contextoApi(a, { filtro: a[1] }); },
    salvarRegra: function (a) { return contextoApi(a, { dados: a[1] }); },
    removerRegra: function (a) { return contextoApi(a, { id: a[1] }); },
    listarVersoesRegras: function () { return {}; },
    importarVersaoRegras: function (a) { return contextoApi(a, { pacote: a[1] }); },
    calcularTributos: function (a) { return contextoApi(a, { dados: a[1] }); },
    simularTributos: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarServicosFiscais: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    salvarServicoFiscal: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarNaturezas: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    validarProntidaoFiscal: function (a) { return contextoApi(a, { estabelecimentoId: a[1] }); },
    listarProvedoresFiscais: function () { return {}; },
    consultarStatusFiscal: function (a) { return contextoApi(a, { dados: a[1] }); },
    definirDocumentoFiscal: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarDocumentosFiscais: function (a) { return contextoApi(a, { filtro: a[1] }); },
    obterDocumentoFiscal: function (a) { return contextoApi(a, { id: a[1] }); },
    emitirDocumentoFiscal: function (a) { return contextoApi(a, { dados: a[1] }); },
    cancelarDocumentoFiscal: function (a) { return contextoApi(a, { id: a[1], dados: a[2] }); },
    inutilizarNumeracao: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarInutilizacoes: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    consultarDocumentoFiscal: function (a) { return contextoApi(a, { id: a[1] }); },
    baixarXML: function (a) { return contextoApi(a, { id: a[1] }); },
    baixarDANFE: function (a) { return contextoApi(a, { id: a[1] }); },
    enviarDocumentoEmail: function (a) { return contextoApi(a, { id: a[1], dados: a[2] }); },
    enviarDocumentoWhatsApp: function (a) { return contextoApi(a, { id: a[1], dados: a[2] }); },
    listarLogsFiscais: function (a) { return contextoApi(a, { filtro: a[1] }); },
    listarContingencias: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    ativarContingencia: function (a) { return contextoApi(a, { dados: a[1] }); },
    encerrarContingencia: function (a) { return contextoApi(a, { dados: a[1] }); },
    reprocessarContingencia: function (a) { return contextoApi(a, { dados: a[1] }); },

    listarSaldosEstoque: function (a) { return contextoApi(a, a[1] || {}); },
    obterSaldoProduto: function (a) { return contextoApi(a, { produtoId: a[1] }); },
    listarMovimentacoesEstoque: function (a) { return contextoApi(a, { filtro: a[1] }); },
    entradaEstoque: function (a) { return contextoApi(a, { dados: a[1] }); },
    saidaEstoque: function (a) { return contextoApi(a, { dados: a[1] }); },
    registrarPerdaEstoque: function (a) { return contextoApi(a, { dados: a[1] }); },
    transferirEstoque: function (a) { return contextoApi(a, { dados: a[1] }); },
    ajustarEstoque: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarSetoresEstoque: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    criarSetorEstoque: function (a) { return contextoApi(a, { dados: a[1] }); },
    listarLotes: function (a) { return contextoApi(a, a[1] || {}); },
    listarAlertasEstoque: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    indicadoresEstoque: function (a) { return contextoApi(a, a[1] || {}); },
    listarFalhasEstoque: function (a) { return contextoApi(a, { status: a[1] }); },
    reprocessarFalhaEstoque: function (a) { return contextoApi(a, { id: a[1] }); },
    descartarFalhaEstoque: function (a) { return contextoApi(a, { id: a[1], motivo: a[2] }); },
    abrirInventario: function (a) { return contextoApi(a, { dados: a[1] }); },
    obterInventario: function (a) { return contextoApi(a, { id: a[1] }); },
    contarItemInventario: function (a) { return contextoApi(a, { dados: a[1] }); },
    fecharInventario: function (a) { return contextoApi(a, { id: a[1] }); },
    cancelarInventario: function (a) { return contextoApi(a, { id: a[1] }); },
    listarFichasTecnicas: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    obterFichaTecnica: function (a) { return contextoApi(a, { produtoId: a[1] }); },
    salvarFichaTecnica: function (a) { return contextoApi(a, { dados: a[1] }); },
    removerFichaTecnica: function (a) { return contextoApi(a, { produtoId: a[1] }); },
    verificarDisponibilidade: function (a) { return contextoApi(a, { produtoId: a[1] }); },
    listarCardapio: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    calcularCMV: function (a) { return contextoApi(a, { filtro: a[1] }); },
    apurarCMV: function (a) { return contextoApi(a, { dados: a[1] }); },
    executarRelatorioEstoque: function (a) { return contextoApi(a, { nome: a[1], filtro: a[2] }); },
    exportarRelatorioEstoque: function (a) { return contextoApi(a, { nome: a[1], formato: a[2], filtro: a[3] }); },

    obterProdutoCompleto: function (a) { return contextoApi(a, { id: a[1] }); },
    salvarProdutoCompleto: function (a) { return contextoApi(a, { dados: a[1] }); },

    cardapioPdv: function (a) { return contextoApi(a, a[1] || {}); },
    cupomDaComanda: function (a) { return contextoApi(a, { comandaId: a[1], parcial: !!(a[2] && a[2].parcial), em: a[2] && a[2].em }); },
    salvarImagemProduto: function (a) { return contextoApi(a, { produtoId: a[1], dataUrl: a[2], thumb: a[3] }); },
    removerImagemProduto: function (a) { return contextoApi(a, { produtoId: a[1] }); },

    impressaoCatalogo: function (a) { return contextoApi(a, {}); },
    impressaoEstado: function (a) { return contextoApi(a, a[1] || {}); },
    salvarImpressora: function (a) { return contextoApi(a, { dados: a[1] }); },
    removerImpressora: function (a) { return contextoApi(a, { id: a[1] }); },
    salvarEstacao: function (a) { return contextoApi(a, { dados: a[1] }); },
    removerEstacao: function (a) { return contextoApi(a, { id: a[1] }); },
    salvarMapeamentoSetor: function (a) { return contextoApi(a, { dados: a[1] }); },
    removerMapeamentoSetor: function (a) { return contextoApi(a, { id: a[1] }); },
    restaurarImpressao: function (a) { return contextoApi(a, {}); },
    previsaoConta: function (a) { return contextoApi(a, { comandaId: a[1], parcial: !!(a[2] && a[2].parcial), largura: a[2] && a[2].largura }); },
    separarComanda: function (a) { return contextoApi(a, { comandaId: a[1], estacaoId: a[2] }); },
    imprimirConta: function (a) { return contextoApi(a, Object.assign({ comandaId: a[1] }, a[2] || {})); },
    imprimirPedidos: function (a) { return contextoApi(a, Object.assign({ comandaId: a[1] }, a[2] || {})); },
    testarImpressao: function (a) { return contextoApi(a, a[1] || {}); },
    filaImpressao: function (a) { return contextoApi(a, a[1] || {}); },
    historicoImpressao: function (a) { return contextoApi(a, a[1] || {}); },
    reimprimir: function (a) { return contextoApi(a, { jobId: a[1], motivo: a[2] }); },
    cancelarTrabalhoImpressao: function (a) { return contextoApi(a, { jobId: a[1], motivo: a[2] }); },
    impressaoPendentes: function (a) { return contextoApi(a, a[1] || {}); },
    impressaoResultado: function (a) { return contextoApi(a, a[1] || {}); },

    listarAuditoriaDetalhada: function (a) { return contextoApi(a, a[1] || {}); },
    listarModulosAuditoria: function (a) { return { empresaId: a[0] || EMPRESA_PADRAO }; },
    catalogoPermissoes: function () { return {}; },
    permissoesDoUsuario: function (a) { return contextoApi(a, { login: a[1] }); },
    salvarPermissoesUsuario: function (a) { return contextoApi(a, { login: a[1], permissoes: a[2] }); }
  };

  /* Monta o payload das operacoes novas com o contexto da sessao.
   * O SERVIDOR exige perfil/permissoes para conferir a permissao da rota —
   * sem isso toda gravacao voltaria 403 para um admin. */
  function contextoApi(args, extra) {
    var empresaId = EMPRESA_PADRAO;
    var perfil = 'admin', permissoes = null, nome = 'sistema';
    try {
      var s = JSON.parse(localStorage.getItem('turismo_session') || 'null');
      if (s) {
        empresaId = (s.empresaId != null) ? s.empresaId : EMPRESA_PADRAO;
        perfil = s.perfil || 'admin';
        permissoes = s.permissoes || null;
        nome = s.nome || s.usuario || 'sistema';
      }
    } catch (e) { /* sessao indisponivel: mantem o padrao */ }

    var base = { empresaId: empresaId, perfil: perfil, permissoes: permissoes, usuarioNome: nome };
    for (var k in (extra || {})) {
      if (extra[k] !== undefined) base[k] = extra[k];
    }
    // Quando o 1o argumento for um numero, ele e o empresaId explicito.
    if (typeof args[0] === 'number') base.empresaId = args[0];
    return base;
  }

  // Envolve cada operacao: em modo servidor, usa a API; senao, o original.
  Object.keys(ROTAS).forEach(function (nome) {
    var original = DB[nome];
    if (typeof original !== 'function') return;
    DB[nome] = function () {
      var args = arguments;
      if (modoServidor()) {
        var payload = ARGS[nome] ? ARGS[nome](args) : (args[0] || {});
        return api(ROTAS[nome], payload).then(function (dados) {
          // Operacoes que devolvem { id } retornam apenas o id (contrato local).
          if (dados && typeof dados === 'object' && 'id' in dados && Object.keys(dados).length === 1) return dados.id;
          return dados;
        });
      }
      return original.apply(DB, args);
    };
  });

  // Snapshot completo (usado para carregar tudo de uma vez no modo servidor).
  DB.snapshot = function (empresaId) {
    if (modoServidor()) return api('sync/snapshot', { empresaId: empresaId || EMPRESA_PADRAO });
    return Promise.reject(new Error('Snapshot disponivel apenas em modo servidor.'));
  };

  global.DB = DB;
})(window);
