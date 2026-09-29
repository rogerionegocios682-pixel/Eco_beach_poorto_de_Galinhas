/**
 * Turismo OS — printService.js
 * =====================================================================
 * Cliente do PRINT SERVICE LOCAL.
 *
 * O QUE ELE FAZ:
 *   - descobre se o Print Service esta rodando na maquina do PDV;
 *   - lista as impressoras instaladas NO COMPUTADOR (via servico local);
 *   - envia o texto do cupom para o servico local imprimir;
 *   - informa ao servidor do sistema o resultado (IMPRESSO / ERRO).
 *
 * O QUE ELE NAO FAZ (importante):
 *   - nao acessa impressora pelo navegador (isso nao e possivel);
 *   - nao decide O QUE imprimir (o texto vem pronto do servidor);
 *   - nao envia comando de shell, caminho de arquivo ou nome de
 *     impressora fora da lista detectada.
 *
 * FALLBACK (regra 27 e 28): se o servico nao estiver instalado, o sistema
 * CONTINUA funcionando. A tela de conta/pedido cai para `window.print()`
 * e a tela de impressoras mostra "Servico de impressao local nao
 * encontrado." com instrucoes de instalacao.
 *
 * PORTA: lida da configuracao da empresa (padrao 3210). Nao ha porta
 * fixa no codigo: `PrintService.definirPorta()` permite trocar.
 */
(function (global) {
  'use strict';

  var PORTA_PADRAO = 3210;
  var HOST_PADRAO = '127.0.0.1';

  var _porta = PORTA_PADRAO;
  var _host = HOST_PADRAO;
  var _token = null;
  var _statusCache = null;      // { ok, em, info }
  var _impressorasCache = null; // { ok, em, lista }
  var VALIDADE_CACHE = 8000;    // 8s: evita bater no servico a cada clique

  function base() { return 'http://' + _host + ':' + _porta; }

  function definirPorta(p) {
    var n = Number(p);
    if (Number.isFinite(n) && n > 0 && n < 65536) _porta = n;
    _statusCache = null;
    _impressorasCache = null;
  }

  function definirHost(h) {
    // Somente localhost: aceitar um host remoto daqui seria abrir a
    // impressora do PDV para a rede sem o administrador saber.
    var s = String(h || '').trim();
    if (s === 'localhost' || s === '127.0.0.1' || s === '::1') _host = s;
  }

  function definirToken(t) { _token = t || null; }

  /* ------------------------------------------------------------------ */
  /* COMUNICACAO                                                        */
  /* ------------------------------------------------------------------ */

  function requisitar(caminho, opcoes) {
    opcoes = opcoes || {};
    var controle = ('AbortController' in global) ? new AbortController() : null;
    var timer = setTimeout(function () { if (controle) controle.abort(); }, opcoes.timeout || 4000);

    var cabecalhos = { 'Content-Type': 'application/json' };
    if (_token) cabecalhos['X-Print-Token'] = _token;

    return fetch(base() + caminho, {
      method: opcoes.metodo || 'GET',
      headers: cabecalhos,
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      signal: controle ? controle.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      return r.json().catch(function () { return { ok: false, erro: 'Resposta invalida do Print Service.' }; });
    }).catch(function (e) {
      clearTimeout(timer);
      // Servico desligado e o caso mais comum — a mensagem tem que ser clara.
      var erro = (e && e.name === 'AbortError')
        ? 'O Print Service nao respondeu a tempo.'
        : 'Servico de impressao local nao encontrado.';
      return { ok: false, erro: erro, indisponivel: true };
    });
  }

  /* Verifica se o servico local esta no ar (com cache curto). */
  function verificar(forcar) {
    var agora = Date.now();
    if (!forcar && _statusCache && (agora - _statusCache.em) < VALIDADE_CACHE) {
      return Promise.resolve(_statusCache);
    }
    return requisitar('/status', { timeout: 2500 }).then(function (r) {
      _statusCache = {
        ok: !!r.ok,
        em: agora,
        indisponivel: !!r.indisponivel,
        erro: r.erro || null,
        info: r.ok ? r : null
      };
      return _statusCache;
    });
  }

  /* Lista as impressoras INSTALADAS no computador (spooler do Windows). */
  function listarImpressoras(forcar) {
    var agora = Date.now();
    if (!forcar && _impressorasCache && (agora - _impressorasCache.em) < VALIDADE_CACHE) {
      return Promise.resolve(_impressorasCache);
    }
    return requisitar('/impressoras', { timeout: 20000 }).then(function (r) {
      _impressorasCache = {
        ok: !!r.ok,
        em: agora,
        indisponivel: !!r.indisponivel,
        erro: r.erro || null,
        plataforma: r.plataforma || null,
        hostname: r.hostname || null,
        impressoras: Array.isArray(r.impressoras) ? r.impressoras : []
      };
      return _impressorasCache;
    });
  }

  /* Teste de impressao direto pelo servico local (usado na tela). */
  function testar(nomeImpressora, modo) {
    return requisitar('/testar', {
      metodo: 'POST',
      timeout: 30000,
      corpo: { impressora: nomeImpressora, modo: modo || 'auto' }
    });
  }

  /* Envia um trabalho JA RENDERIZADO pelo servidor do sistema. */
  function imprimir(trabalho) {
    return requisitar('/imprimir', {
      metodo: 'POST',
      timeout: 30000,
      corpo: {
        impressora: trabalho.impressora,
        texto: trabalho.texto,
        modo: trabalho.modo || 'auto',
        endpoint: trabalho.endpoint || undefined,
        tipo: trabalho.tipo || 'DOC'
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* FLUXO COMPLETO: buscar da fila -> imprimir -> reportar             */
  /* ------------------------------------------------------------------ */

  /**
   * Processa a fila de impressao da empresa.
   *
   * 1. pergunta ao servico local se esta no ar;
   * 2. busca os trabalhos PENDENTE no servidor do sistema;
   * 3. envia cada um ao servico local;
   * 4. reporta o resultado (IMPRESSO ou ERRO) de volta ao servidor.
   *
   * A idempotencia esta no SERVIDOR: o trabalho tem `chave` unica e a
   * fila nao aceita o mesmo documento duas vezes.
   */
  function processarFila(empresaId, opts) {
    opts = opts || {};
    return verificar(true).then(function (st) {
      if (!st.ok) {
        return { ok: false, indisponivel: true, erro: st.erro || 'Servico de impressao local indisponivel.', impressos: 0, erros: 0 };
      }
      return DB.impressaoPendentes
        ? DB.impressaoPendentes(empresaId, { limite: opts.limite || 10 })
        : Promise.reject(new Error('Rotas de impressao indisponiveis.'));
    }).then(function (pendentes) {
      if (!pendentes || !pendentes.length) return { ok: true, impressos: 0, erros: 0, vazio: true };

      var impressos = 0, erros = 0;
      var seq = Promise.resolve();

      pendentes.forEach(function (t) {
        seq = seq.then(function () {
          return imprimir({
            impressora: t.impressoraNome,
            texto: t.conteudo,
            modo: t.modo || 'auto',
            endpoint: t.endpoint,
            tipo: t.tipo
          }).then(function (r) {
            var status = r.ok ? 'IMPRESSO' : 'ERRO';
            if (r.ok) impressos++; else erros++;
            return DB.impressaoResultado(empresaId, {
              jobId: t.id,
              status: status,
              erro: r.ok ? null : (r.erro || 'Falha na impressao'),
              detalhe: r.simulado ? 'Simulado em arquivo' : null
            }).catch(function () { /* reportar falhou: a fila tenta de novo */ });
          });
        });
      });

      return seq.then(function () {
        return { ok: true, impressos: impressos, erros: erros, total: pendentes.length };
      });
    }).catch(function (e) {
      return { ok: false, erro: e.message, impressos: 0, erros: 0 };
    });
  }

  /* ------------------------------------------------------------------ */
  /* FALLBACK: window.print()                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Imprime o texto do cupom usando o navegador.
   * Usado quando o Print Service nao esta instalado (regra 28). Nao e
   * impressao silenciosa: abre a caixa de impressao do navegador.
   * O texto vai para a area #cupomPrint, que o @media print isola.
   */
  function imprimirPeloNavegador(texto, largura) {
    var area = document.getElementById('cupomPrint');
    if (!area) return false;
    area.setAttribute('data-largura', largura || '80mm');
    // <pre> preserva o alinhamento do cupom (colunas monoespacadas).
    area.innerHTML = '<pre class="cupom-texto">' + escapar(texto) + '</pre>';
    setTimeout(function () { global.print(); }, 60);
    return true;
  }

  function escapar(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------------------------ */
  /* IDENTIDADE DA ESTACAO (regra 23)                                   */
  /* ------------------------------------------------------------------ */

  var CHAVE_ESTACAO = 'turismo_os_estacao';

  /* Identificador local da estacao (persiste entre sessoes). Sem ele, o
   * sistema usa a estacao padrao da empresa. */
  function estacaoLocal() {
    try {
      var v = localStorage.getItem(CHAVE_ESTACAO);
      if (v) return JSON.parse(v);
    } catch (e) { /* sem storage */ }
    return null;
  }

  function definirEstacaoLocal(dados) {
    try {
      if (dados) localStorage.setItem(CHAVE_ESTACAO, JSON.stringify(dados));
      else localStorage.removeItem(CHAVE_ESTACAO);
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ */
  /* API PUBLICA                                                        */
  /* ------------------------------------------------------------------ */

  global.PrintService = {
    PORTA_PADRAO: PORTA_PADRAO,
    definirPorta: definirPorta,
    definirHost: definirHost,
    definirToken: definirToken,
    porta: function () { return _porta; },
    base: base,
    verificar: verificar,
    listarImpressoras: listarImpressoras,
    testar: testar,
    imprimir: imprimir,
    processarFila: processarFila,
    imprimirPeloNavegador: imprimirPeloNavegador,
    estacaoLocal: estacaoLocal,
    definirEstacaoLocal: definirEstacaoLocal
  };
})(typeof window !== 'undefined' ? window : globalThis);