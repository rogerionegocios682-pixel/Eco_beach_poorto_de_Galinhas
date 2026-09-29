/**
 * Turismo OS — configuracoes_impressoras.js
 * =====================================================================
 * Aba IMPRESSORAS (Configuracoes > Impressoras).
 *
 * Sub-abas:
 *   1. Impressoras instaladas  — descoberta automatica + cadastro
 *   2. Estacoes                — configuracao por computador
 *   3. Setores                 — categoria -> impressora
 *   4. Fila de impressao       — trabalhos e reimpressao
 *   5. Historico               — log de impressao
 *
 * QUEM IMPRIME O QUE:
 *   Este arquivo NAO fala com a impressora. Ele enfileira no servidor e,
 *   quando o Print Service local esta no ar, pede a ele que processe a
 *   fila (printService.js). Sem o servico, o sistema continua normal e a
 *   tela explica o que instalar.
 *
 * SEPARACAO FISCAL: nada aqui emite NFC-e/NF-e/NFS-e. Cupom termico e
 * documento NAO fiscal; a emissao fiscal continua no modulo Fiscal.
 */
(function (global) {
  'use strict';

  if (typeof window === 'undefined' || typeof window.cfgEstado === 'undefined') return;

  var esc = window.cfgEsc;
  var toast = window.cfgToast;
  var abrirModal = window.cfgAbrirModal;
  var fecharModal = window.cfgFecharModal;
  var EMPRESA = window.cfgEmpresa;
  var estado = window.cfgEstado;

  estado.impressao = estado.impressao || {
    carregado: false, subAba: 'instaladas', catalogo: null,
    impressoras: [], estacoes: [], mapeamentos: [], fila: [], log: [],
    encontradas: null, servico: null, categorias: []
  };

  function pode(chave) {
    try { return window.cfgPode ? window.cfgPode(chave) : false; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------------ */
  /* CARREGAMENTO                                                        */
  /* ------------------------------------------------------------------ */

  function carregar() {
    var ip = estado.impressao;
    var tarefas = [
      DB.impressaoCatalogo(EMPRESA).catch(function () { return null; }),
      DB.impressaoEstado(EMPRESA, { limiteFila: 40, limiteLog: 40 }).catch(function () { return null; })
    ];
    // As categorias do catalogo alimentam o mapeamento de setores.
    if (typeof DB.cardapioPdv === 'function') {
      tarefas.push(DB.cardapioPdv(EMPRESA, {}).catch(function () { return null; }));
    }
    return Promise.all(tarefas).then(function (r) {
      ip.catalogo = r[0] || ip.catalogo;
      var est = r[1] || {};
      ip.impressoras = est.impressoras || [];
      ip.estacoes = est.estacoes || [];
      ip.mapeamentos = est.mapeamentos || [];
      ip.fila = est.fila || [];
      ip.log = est.log || [];
      var cardapio = r[2];
      if (cardapio && cardapio.categorias) {
        ip.categorias = cardapio.categorias.filter(function (c) { return c !== 'TODOS'; });
      }
      // Porta do servico local vem da configuracao da empresa.
      var porta = ip.catalogo && ip.catalogo.portaServicoLocal;
      if (porta && global.PrintService) global.PrintService.definirPorta(porta);
      ip.carregado = true;
      return ip;
    });
  }

  /* ------------------------------------------------------------------ */
  /* RENDER                                                              */
  /* ------------------------------------------------------------------ */

  var SUB_ABAS = [
    { id: 'instaladas', titulo: 'Impressoras instaladas' },
    { id: 'estacoes', titulo: 'Estacoes' },
    { id: 'setores', titulo: 'Setores' },
    { id: 'fila', titulo: 'Fila de impressao' },
    { id: 'historico', titulo: 'Historico' }
  ];

  window.renderImpressorasCompleto = function renderImpressorasCompleto() {
    var ip = estado.impressao;
    var podeConfig = pode('impressao.configurar');

    var html = '<div class="cfg-pane" id="pane-impressoras">' +
      '<div class="panel"><div class="panel-head">' +
        '<div><h2>Impressoras</h2>' +
        '<div class="desc">Cada estacao (caixa, cozinha, bar) usa as impressoras instaladas ' +
        'no proprio computador. O <b>Print Service local</b> faz a ponte entre o sistema e o ' +
        'spooler do Windows — o navegador nao acessa o hardware diretamente.</div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-ghost-m btn-sm" id="impProcFila">Processar fila</button>' +
          (podeConfig ? '<button class="btn btn-ghost-m btn-sm" id="impRestaurar">Restaurar configuracao</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="panel-body">' +
        '<div id="impServico"></div>' +
        '<div class="imp-subabas">' + SUB_ABAS.map(function (s) {
          return '<button data-sub="' + s.id + '" class="' + (ip.subAba === s.id ? 'on' : '') + '">' + esc(s.titulo) + '</button>';
        }).join('') + '</div>' +
        '<div id="impConteudo"></div>' +
      '</div></div></div>';
    return html;
  };

  window.ligarImpressoras = function ligarImpressoras() {
    var ip = estado.impressao;
    document.querySelectorAll('.imp-subabas [data-sub]').forEach(function (b) {
      b.addEventListener('click', function () {
        ip.subAba = b.dataset.sub;
        pintar();
      });
    });

    var btnProc = document.getElementById('impProcFila');
    if (btnProc) btnProc.addEventListener('click', function () {
      if (!global.PrintService) { toast('Print Service indisponivel nesta pagina.', true); return; }
      btnProc.disabled = true; btnProc.textContent = 'PROCESSANDO...';
      global.PrintService.processarFila(EMPRESA, { limite: 10 }).then(function (r) {
        btnProc.disabled = false; btnProc.textContent = 'Processar fila';
        if (r.indisponivel) { toast(r.erro, true); return; }
        toast('Fila processada: ' + r.impressos + ' impresso(s), ' + r.erros + ' erro(s).');
        return carregar().then(pintar);
      }).catch(function (e) {
        btnProc.disabled = false; btnProc.textContent = 'Processar fila';
        toast('Erro ao processar a fila: ' + e.message, true);
      });
    });

    var btnR = document.getElementById('impRestaurar');
    if (btnR) btnR.addEventListener('click', function () {
      if (!confirm('Restaurar a configuracao de impressoras?\n\nAs impressoras, estacoes e setores desta empresa serao removidos. O historico e a fila NAO sao apagados.')) return;
      DB.restaurarImpressao(EMPRESA).then(function () {
        toast('Configuracao de impressao restaurada.');
        return carregar();
      }).then(pintar).catch(function (e) { toast('Erro: ' + e.message, true); });
    });

    if (!ip.carregado) {
      carregar().then(pintar).catch(function (e) {
        document.getElementById('impConteudo').innerHTML =
          '<div class="erro-box">Nao foi possivel carregar as impressoras: ' + esc(e.message) +
          '<br />O gerenciamento de impressoras exige o servidor do sistema.</div>';
      });
    } else {
      pintar();
    }
  };

  function pintar() {
    var ip = estado.impressao;
    document.querySelectorAll('.imp-subabas [data-sub]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.sub === ip.subAba);
    });
    pintarServico();
    var el = document.getElementById('impConteudo');
    if (!el) return;
    if (ip.subAba === 'instaladas') el.innerHTML = htmlInstaladas();
    else if (ip.subAba === 'estacoes') el.innerHTML = htmlEstacoes();
    else if (ip.subAba === 'setores') el.innerHTML = htmlSetores();
    else if (ip.subAba === 'fila') el.innerHTML = htmlFila();
    else el.innerHTML = htmlHistorico();
    ligarConteudo();
  }

  /* ---------------- Status do Print Service ---------------- */

  function pintarServico() {
    var el = document.getElementById('impServico');
    if (!el || !global.PrintService) return;
    el.innerHTML = '<div class="info-box">Verificando o Print Service local...</div>';

    global.PrintService.verificar(true).then(function (st) {
      estado.impressao.servico = st;
      if (st.ok) {
        var i = st.info || {};
        el.innerHTML = '<div class="ok-box"><b>Print Service local ativo</b> — ' +
          esc(i.hostname || '') + ' (' + esc(i.plataforma || '') + ') em ' +
          esc(global.PrintService.base()) + '</div>';
      } else {
        el.innerHTML = '<div class="erro-box"><b>Servico de impressao local nao encontrado.</b><br />' +
          'Para imprimir automaticamente, instale o Print Service neste computador:<br />' +
          '<span class="mono">node servidor/print_service.mjs</span> ' +
          '(ou duplo-clique em <span class="mono">iniciar-print-service.cmd</span>)<br />' +
          'Enquanto o servico nao estiver ativo, o sistema continua funcionando e a impressao ' +
          'pode ser feita pela janela do navegador.</div>';
      }
    });
  }

  /* ---------------- 1. Impressoras instaladas ---------------- */

  function htmlInstaladas() {
    var ip = estado.impressao;
    var podeConfig = pode('impressao.configurar');

    var html = '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px">' +
      '<button class="btn btn-primary btn-sm" id="impProcurar">PROCURAR IMPRESSORAS</button>' +
      '<button class="btn btn-ghost-m btn-sm" id="impAtualizarLista">ATUALIZAR LISTA</button>' +
      (podeConfig ? '<button class="btn btn-primary btn-sm" id="impNova">+ Cadastrar impressora</button>' : '') +
      '</div>';

    html += '<h3 class="imp-h">Impressoras encontradas no computador</h3>';
    if (!ip.encontradas) {
      html += '<div class="muted">Clique em <b>PROCURAR IMPRESSORAS</b> para consultar o computador.</div>';
    } else if (!ip.encontradas.ok) {
      html += '<div class="erro-box">' + esc(ip.encontradas.erro || 'Nao foi possivel listar as impressoras.') + '</div>';
    } else if (!ip.encontradas.impressoras.length) {
      html += '<div class="info-box">Nenhuma impressora encontrada no computador.</div>';
    } else {
      html += '<div class="imp-grid">' + ip.encontradas.impressoras.map(function (p, i) {
        return '<div class="imp-card">' +
          '<div class="imp-nome">' + esc(p.nome) + '</div>' +
          '<div class="imp-linha"><span>Status</span><b class="st-' + esc(String(p.status).toLowerCase()) + '">' + esc(rotuloStatus(p.status)) + '</b></div>' +
          '<div class="imp-linha"><span>Tipo</span><b>' + esc(rotuloTipo(p.tipo)) + '</b></div>' +
          '<div class="imp-linha"><span>Padrao</span><b>' + (p.padrao ? 'Sim' : 'Nao') + '</b></div>' +
          (p.fabricante ? '<div class="imp-linha"><span>Fabricante</span><b>' + esc(p.fabricante) + '</b></div>' : '') +
          (p.modelo ? '<div class="imp-linha"><span>Modelo</span><b>' + esc(p.modelo) + '</b></div>' : '') +
          (p.porta ? '<div class="imp-linha"><span>Porta</span><b>' + esc(p.porta) + '</b></div>' : '') +
          (p.dispositivo && p.dispositivo !== p.porta ? '<div class="imp-linha"><span>Dispositivo</span><b>' + esc(p.dispositivo) + '</b></div>' : '') +
          '<div class="imp-acoes">' +
            '<button class="btn btn-ghost-m btn-sm" data-testar="' + i + '">TESTAR</button>' +
            (podeConfig ? '<button class="btn btn-primary btn-sm" data-config="' + i + '">CONFIGURAR</button>' : '') +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    html += '<h3 class="imp-h" style="margin-top:22px">Impressoras cadastradas</h3>';
    if (!ip.impressoras.length) {
      html += '<div class="muted">Nenhuma impressora cadastrada. Use <b>PROCURAR IMPRESSORAS</b> e depois <b>CONFIGURAR</b>.</div>';
    } else {
      html += '<table><thead><tr><th>Nome</th><th>Windows</th><th>Tipo</th><th>Largura</th><th>Funcao</th><th>Estacao</th><th>Padrao</th><th style="text-align:right">Acoes</th></tr></thead><tbody>' +
        ip.impressoras.map(function (p) {
          var est = ip.estacoes.filter(function (e) { return e.id === p.estacaoId; })[0];
          return '<tr>' +
            '<td><b>' + esc(p.nome) + '</b>' + (p.ativa ? '' : ' <span class="tag-off">inativa</span>') + '</td>' +
            '<td class="mono">' + esc(p.nomeWindows) + '</td>' +
            '<td>' + esc(rotuloTipo(p.tipo)) + '</td>' +
            '<td>' + esc(p.largura) + '</td>' +
            '<td>' + esc(p.funcao || '—') + '</td>' +
            '<td>' + esc(est ? est.nome : 'todas') + '</td>' +
            '<td>' + (p.padrao ? 'Sim' : 'Nao') + '</td>' +
            '<td style="text-align:right;white-space:nowrap">' +
              '<button class="btn btn-ghost-m btn-sm" data-imp-testar="' + p.id + '">Testar</button> ' +
              (podeConfig ? '<button class="btn btn-ghost-m btn-sm" data-imp-editar="' + p.id + '">Editar</button> ' +
              '<button class="btn btn-danger btn-sm" data-imp-remover="' + p.id + '">Remover</button>' : '') +
            '</td>' +
          '</tr>';
        }).join('') + '</tbody></table>';
    }
    return html;
  }

  function rotuloStatus(s) {
    var mapa = {
      PRONTA: 'Pronta', OFFLINE: 'Offline', SEM_PAPEL: 'Sem papel',
      PAUSADA: 'Pausada', ERRO: 'Erro', PROCESSANDO: 'Imprimindo', DESCONHECIDA: 'Status nao informado'
    };
    return mapa[String(s || '').toUpperCase()] || 'Status nao informado';
  }

  function rotuloTipo(t) {
    var mapa = { TERMICA: 'Termica', A4: 'A4', FISCAL: 'Fiscal/Integrada', OUTRA: 'Outra', VIRTUAL: 'Virtual', DESCONHECIDO: 'Nao identificado' };
    return mapa[String(t || '').toUpperCase()] || 'Nao identificado';
  }

  /* ---------------- 2. Estacoes ---------------- */

  function htmlEstacoes() {
    var ip = estado.impressao;
    var podeConfig = pode('impressao.configurar');
    var local = global.PrintService ? global.PrintService.estacaoLocal() : null;

    var html = '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px;align-items:center">' +
      (podeConfig ? '<button class="btn btn-primary btn-sm" id="estNova">+ Nova estacao</button>' : '') +
      '<span class="muted">Estacao deste computador: <b>' + esc(local ? local.nome : 'nao definida') + '</b></span>' +
      '<button class="btn btn-ghost-m btn-sm" id="estDefinirLocal">Definir como estacao deste PC</button>' +
      '</div>';

    if (!ip.estacoes.length) {
      return html + '<div class="muted">Nenhuma estacao cadastrada. Crie uma por computador (CAIXA 01, COZINHA, BAR...).</div>';
    }

    html += '<table><thead><tr><th>Nome</th><th>Codigo</th><th>Padrao</th><th>Impressoras</th><th style="text-align:right">Acoes</th></tr></thead><tbody>' +
      ip.estacoes.map(function (e) {
        var qtd = ip.impressoras.filter(function (p) { return p.estacaoId === e.id; }).length;
        return '<tr><td><b>' + esc(e.nome) + '</b></td><td class="mono">' + esc(e.codigo) + '</td>' +
          '<td>' + (e.padrao ? 'Sim' : 'Nao') + '</td><td>' + qtd + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
          (podeConfig ? '<button class="btn btn-ghost-m btn-sm" data-est-editar="' + e.id + '">Editar</button> ' +
            '<button class="btn btn-danger btn-sm" data-est-remover="' + e.id + '">Remover</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  }

  /* ---------------- 3. Setores ---------------- */

  function htmlSetores() {
    var ip = estado.impressao;
    var podeConfig = pode('impressao.configurar');

    var html = '<div class="info-box">Mapeie a <b>categoria</b> do produto para a impressora do setor. ' +
      'Ao enviar um pedido, cada parte vai para a impressora correspondente — a cozinha nao recebe o pedido do bar.</div>';

    if (podeConfig) {
      html += '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end">' +
        '<div class="field"><label>Categoria</label><input id="mapCategoria" list="mapCats" placeholder="ex.: Bebidas" />' +
        '<datalist id="mapCats">' + ip.categorias.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('') + '</datalist></div>' +
        '<div class="field"><label>Setor (opcional)</label><input id="mapSetor" placeholder="ex.: BAR" /></div>' +
        '<div class="field"><label>Impressora</label><select id="mapImpressora">' +
          ip.impressoras.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nome) + (p.funcao ? ' (' + esc(p.funcao) + ')' : '') + '</option>'; }).join('') +
        '</select></div>' +
        '<button class="btn btn-primary btn-sm" id="mapSalvar">Adicionar</button>' +
      '</div>';
    }

    if (!ip.mapeamentos.length) {
      return html + '<div class="muted">Nenhum setor mapeado.</div>';
    }
    html += '<table><thead><tr><th>Categoria</th><th>Setor</th><th>Impressora</th><th style="text-align:right">Acoes</th></tr></thead><tbody>' +
      ip.mapeamentos.map(function (m) {
        return '<tr><td><b>' + esc(m.categoria) + '</b></td><td>' + esc(m.setor || '—') + '</td>' +
          '<td>' + esc(m.impressoraNome || '(removida)') + '</td>' +
          '<td style="text-align:right">' + (podeConfig ? '<button class="btn btn-danger btn-sm" data-map-remover="' + m.id + '">Remover</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  }

  /* ---------------- 4. Fila ---------------- */

  function htmlFila() {
    var ip = estado.impressao;
    var podeRe = pode('impressao.reimprimir');

    var html = '<div style="display:flex;gap:9px;margin-bottom:14px">' +
      '<button class="btn btn-ghost-m btn-sm" id="filaAtualizar">ATUALIZAR</button>' +
      '<span class="muted" style="align-self:center">Trabalhos enviados para as impressoras. ' +
      'A mesma chave nao entra duas vezes (sem impressao duplicada).</span></div>';

    if (!ip.fila.length) return html + '<div class="muted">Fila vazia.</div>';

    html += '<table><thead><tr><th>#</th><th>Tipo</th><th>Setor</th><th>Referencia</th><th>Impressora</th><th>Status</th><th>Erro</th><th style="text-align:right">Acoes</th></tr></thead><tbody>' +
      ip.fila.map(function (t) {
        return '<tr><td class="mono">' + t.id + '</td><td>' + esc(t.tipo) + '</td>' +
          '<td>' + esc(t.setor || '—') + '</td><td>' + esc(t.referencia || '—') + '</td>' +
          '<td>' + esc(t.impressoraNome || '—') + '</td>' +
          '<td><span class="st-fila st-' + esc(String(t.status).toLowerCase()) + '">' + esc(t.status) + '</span></td>' +
          '<td class="imp-erro">' + esc(t.erro || '') + '</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
            '<button class="btn btn-ghost-m btn-sm" data-job-ver="' + t.id + '">Ver</button> ' +
            (podeRe ? '<button class="btn btn-ghost-m btn-sm" data-job-reimprimir="' + t.id + '">Reimprimir</button> ' : '') +
            (pode('impressao.configurar') && t.status !== 'IMPRESSO' ? '<button class="btn btn-danger btn-sm" data-job-cancelar="' + t.id + '">Cancelar</button>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  }

  /* ---------------- 5. Historico ---------------- */

  function htmlHistorico() {
    var ip = estado.impressao;
    var html = '<div style="display:flex;gap:9px;margin-bottom:14px">' +
      '<button class="btn btn-ghost-m btn-sm" id="histAtualizar">ATUALIZAR</button>' +
      '<span class="muted" style="align-self:center">Quem imprimiu, quando e o que (inclui reimpressoes).</span></div>';

    if (!ip.log.length) return html + '<div class="muted">Nenhum registro de impressao.</div>';

    html += '<table><thead><tr><th>Data/hora</th><th>Usuario</th><th>Tipo</th><th>Referencia</th><th>Impressora</th><th>Status</th><th>Motivo/Erro</th></tr></thead><tbody>' +
      ip.log.map(function (l) {
        return '<tr><td class="mono">' + esc(formatarData(l.em)) + '</td><td>' + esc(l.usuario || '—') + '</td>' +
          '<td>' + esc(l.tipo || '—') + '</td><td>' + esc(l.pedidoRef || '—') + '</td>' +
          '<td>' + esc(l.impressoraNome || '—') + '</td>' +
          '<td><span class="st-fila st-' + esc(String(l.status || '').toLowerCase()) + '">' + esc(l.status || '—') + '</span></td>' +
          '<td class="imp-erro">' + esc(l.motivo || l.erro || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  }

  function formatarData(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ------------------------------------------------------------------ */
  /* EVENTOS                                                            */
  /* ------------------------------------------------------------------ */

  function ligarConteudo() {
    var ip = estado.impressao;

    /* --- Impressoras instaladas --- */
    var bProc = document.getElementById('impProcurar');
    if (bProc) bProc.addEventListener('click', function () { procurarImpressoras(true); });
    var bAtual = document.getElementById('impAtualizarLista');
    if (bAtual) bAtual.addEventListener('click', function () { procurarImpressoras(true); });
    var bNova = document.getElementById('impNova');
    if (bNova) bNova.addEventListener('click', function () { modalImpressora(null); });

    document.querySelectorAll('[data-testar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = ip.encontradas.impressoras[Number(b.dataset.testar)];
        testarImpressora(p.nome, null);
      });
    });

    document.querySelectorAll('[data-config]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = ip.encontradas.impressoras[Number(b.dataset.config)];
        modalImpressora(null, p);
      });
    });

    document.querySelectorAll('[data-imp-editar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = ip.impressoras.filter(function (x) { return x.id === Number(b.dataset.impEditar); })[0];
        modalImpressora(p);
      });
    });

    document.querySelectorAll('[data-imp-testar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = ip.impressoras.filter(function (x) { return x.id === Number(b.dataset.impTestar); })[0];
        testarImpressora(p.nomeWindows, p.id);
      });
    });

    document.querySelectorAll('[data-imp-remover]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Remover esta impressora do cadastro?')) return;
        DB.removerImpressora(EMPRESA, Number(b.dataset.impRemover)).then(function () {
          toast('Impressora removida.'); return recarregar();
        }).catch(function (e) { toast('Erro: ' + e.message, true); });
      });
    });

    /* --- Estacoes --- */
    var bEstNova = document.getElementById('estNova');
    if (bEstNova) bEstNova.addEventListener('click', function () { modalEstacao(null); });
    document.querySelectorAll('[data-est-editar]').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = ip.estacoes.filter(function (x) { return x.id === Number(b.dataset.estEditar); })[0];
        modalEstacao(e);
      });
    });
    document.querySelectorAll('[data-est-remover]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Remover esta estacao? As impressoras dela ficam sem estacao.')) return;
        DB.removerEstacao(EMPRESA, Number(b.dataset.estRemover)).then(function () {
          toast('Estacao removida.'); return recarregar();
        }).catch(function (e) { toast('Erro: ' + e.message, true); });
      });
    });
    var bDef = document.getElementById('estDefinirLocal');
    if (bDef) bDef.addEventListener('click', function () {
      if (!ip.estacoes.length) { toast('Cadastre uma estacao primeiro.', true); return; }
      abrirModal('<h3>Estacao deste computador</h3>' +
        '<p class="muted">Escolha qual estacao representa ESTE computador. ' +
        'As configuracoes dela passam a valer para as impressoes feitas aqui.</p>' +
        '<div class="field"><label>Estacao</label><select id="estLocal">' +
        ip.estacoes.map(function (e) { return '<option value="' + e.id + '">' + esc(e.nome) + '</option>'; }).join('') +
        '</select></div><div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="mOk">Definir</button></div>');
      document.getElementById('mCancel').addEventListener('click', fecharModal);
      document.getElementById('mOk').addEventListener('click', function () {
        var id = Number(document.getElementById('estLocal').value);
        var e = ip.estacoes.filter(function (x) { return x.id === id; })[0];
        global.PrintService.definirEstacaoLocal({ id: e.id, codigo: e.codigo, nome: e.nome });
        toast('Este computador agora e a estacao ' + e.nome + '.');
        fecharModal(); pintar();
      });
    });

    /* --- Setores --- */
    var bMap = document.getElementById('mapSalvar');
    if (bMap) bMap.addEventListener('click', function () {
      var categoria = document.getElementById('mapCategoria').value.trim();
      var setor = document.getElementById('mapSetor').value.trim();
      var impressoraId = Number(document.getElementById('mapImpressora').value);
      if (!categoria) { toast('Informe a categoria.', true); return; }
      if (!impressoraId) { toast('Cadastre uma impressora primeiro.', true); return; }
      DB.salvarMapeamentoSetor(EMPRESA, { categoria: categoria, setor: setor, impressoraId: impressoraId })
        .then(function () { toast('Setor mapeado.'); return recarregar(); })
        .catch(function (e) { toast('Erro: ' + e.message, true); });
    });
    document.querySelectorAll('[data-map-remover]').forEach(function (b) {
      b.addEventListener('click', function () {
        DB.removerMapeamentoSetor(EMPRESA, Number(b.dataset.mapRemover)).then(function () {
          toast('Mapeamento removido.'); return recarregar();
        }).catch(function (e) { toast('Erro: ' + e.message, true); });
      });
    });

    /* --- Fila --- */
    var bFila = document.getElementById('filaAtualizar');
    if (bFila) bFila.addEventListener('click', function () { recarregar(); });
    document.querySelectorAll('[data-job-ver]').forEach(function (b) {
      b.addEventListener('click', function () { verTrabalho(Number(b.dataset.jobVer)); });
    });
    document.querySelectorAll('[data-job-reimprimir]').forEach(function (b) {
      b.addEventListener('click', function () { modalReimprimir(Number(b.dataset.jobReimprimir)); });
    });
    document.querySelectorAll('[data-job-cancelar]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Cancelar este trabalho de impressao?')) return;
        DB.cancelarTrabalhoImpressao(EMPRESA, Number(b.dataset.jobCancelar), 'Cancelado na tela de impressoras')
          .then(function () { toast('Trabalho cancelado.'); return recarregar(); })
          .catch(function (e) { toast('Erro: ' + e.message, true); });
      });
    });

    /* --- Historico --- */
    var bHist = document.getElementById('histAtualizar');
    if (bHist) bHist.addEventListener('click', function () { recarregar(); });
  }

  function recarregar() {
    return carregar().then(pintar);
  }

  /* ------------------------------------------------------------------ */
  /* ACOES                                                              */
  /* ------------------------------------------------------------------ */

  function procurarImpressoras(mostrarErro) {
    var ip = estado.impressao;
    var b = document.getElementById('impProcurar');
    if (b) { b.disabled = true; b.textContent = 'PROCURANDO...'; }

    if (!global.PrintService) {
      if (b) { b.disabled = false; b.textContent = 'PROCURAR IMPRESSORAS'; }
      toast('Print Service indisponivel.', true);
      return;
    }

    global.PrintService.listarImpressoras(true).then(function (r) {
      ip.encontradas = r;
      if (b) { b.disabled = false; b.textContent = 'PROCURAR IMPRESSORAS'; }
      if (!r.ok) {
        if (mostrarErro) toast(r.erro || 'Nao foi possivel listar as impressoras.', true);
      } else {
        toast(r.impressoras.length + ' impressora(s) encontrada(s).');
      }
      pintar();
    });
  }

  function testarImpressora(nomeWindows, impressoraId) {
    if (!global.PrintService) { toast('Print Service indisponivel.', true); return; }
    toast('Enviando teste para ' + nomeWindows + '...');

    // O teste passa pelo cadastro do sistema quando ha impressora
    // cadastrada (fica no historico); senao, vai direto ao servico local.
    var chamada = impressoraId
      ? DB.testarImpressao(EMPRESA, { impressoraId: impressoraId })
        .then(function (job) { return global.PrintService.imprimir({ impressora: nomeWindows, texto: job.texto, modo: 'auto', tipo: 'TESTE' }); })
      : global.PrintService.testar(nomeWindows, 'auto');

    chamada.then(function (r) {
      if (r.ok) {
        toast('Teste de impressao realizado com sucesso.');
      } else {
        toast(mensagemAmigavel(r.erro), true);
        console.warn('[impressao] erro tecnico do teste:', r.erro);
      }
      return recarregar();
    }).catch(function (e) {
      toast(mensagemAmigavel(e.message), true);
    });
  }

  /* Mesma regra de mensagem amigavel do backend (o operador ve o mesmo
   * texto nos dois lados). */
  function mensagemAmigavel(erro) {
    var t = String(erro || '').toLowerCase();
    if (!t) return 'Nao foi possivel imprimir. Tente novamente.';
    if (t.indexOf('nao encontrado') !== -1 || t.indexOf('indispon') !== -1) {
      return 'Servico de impressao local indisponivel. Verifique se o Print Service esta rodando.';
    }
    if (t.indexOf('sem papel') !== -1) return 'Impressora sem papel.';
    if (t.indexOf('offline') !== -1) return 'Impressora offline.';
    if (t.indexOf('pausad') !== -1) return 'Impressora pausada.';
    if (t.indexOf('nao encontrada') !== -1) return 'Impressora configurada nao encontrada.';
    if (t.indexOf('timeout') !== -1 || t.indexOf('tempo') !== -1) return 'A impressora demorou demais para responder.';
    return 'Nao foi possivel imprimir. Verifique a impressora e tente novamente.';
  }

  function verTrabalho(id) {
    var t = estado.impressao.fila.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    abrirModal('<h3>Trabalho #' + t.id + '</h3>' +
      '<div class="muted">' + esc(t.tipo) + (t.setor ? ' · setor ' + esc(t.setor) : '') +
      ' · ' + esc(t.status) + (t.impressoraNome ? ' · ' + esc(t.impressoraNome) : '') + '</div>' +
      (t.erro ? '<div class="erro-box" style="margin-top:10px">' + esc(t.erro) + '</div>' : '') +
      '<pre class="imp-previa">' + esc(t.conteudo || '(sem conteudo)') + '</pre>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Fechar</button></div>');
    document.getElementById('mCancel').addEventListener('click', fecharModal);
  }

  function modalReimprimir(jobId) {
    var t = estado.impressao.fila.filter(function (x) { return x.id === jobId; })[0];
    abrirModal('<h3>Reimprimir</h3>' +
      '<p class="muted">' + esc(t ? (t.tipo + ' · ' + (t.referencia || '')) : '') + '</p>' +
      '<div class="field"><label>Motivo (opcional)</label><input id="reMotivo" placeholder="ex.: cupom ilegivel" /></div>' +
      '<p class="muted">A reimpressao fica registrada no historico com o seu usuario e a data/hora.</p>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">REIMPRIMIR</button></div>');
    document.getElementById('mCancel').addEventListener('click', fecharModal);
    document.getElementById('mOk').addEventListener('click', function () {
      var motivo = document.getElementById('reMotivo').value.trim();
      var btn = document.getElementById('mOk');
      if (btn.disabled) return;              // idempotencia: duplo clique
      btn.disabled = true; btn.textContent = 'PROCESSANDO...';
      DB.reimprimir(EMPRESA, jobId, motivo).then(function (r) {
        toast('Reimpressao enviada para a fila (#' + r.id + ').');
        fecharModal();
        // Tenta imprimir na hora, se o servico local estiver no ar.
        if (global.PrintService) {
          return global.PrintService.processarFila(EMPRESA, { limite: 5 }).then(recarregar);
        }
        return recarregar();
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'REIMPRIMIR';
        toast('Erro: ' + e.message, true);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* MODAIS DE CADASTRO                                                 */
  /* ------------------------------------------------------------------ */

  function modalImpressora(p, daDetectada) {
    var nova = !p;
    p = p || {};
    var base = daDetectada || {};
    var ip = estado.impressao;
    var cat = ip.catalogo || { funcoes: [], tipos: [], larguras: ['58mm', '80mm'] };

    abrirModal(
      '<h3>' + (nova ? 'Cadastrar impressora' : 'Editar impressora') + '</h3>' +
      '<div class="grid2">' +
        '<div class="field"><label>Nome *</label><input id="ipNome" value="' + esc(p.nome || base.nome || '') + '" placeholder="ex.: Caixa principal" /></div>' +
        '<div class="field"><label>Impressora do Windows *</label><input id="ipWindows" value="' + esc(p.nomeWindows || base.nome || '') + '" placeholder="ex.: EPSON TM-T20X" />' +
          '<span class="hint">Nome exato como aparece no Windows. Use "Procurar impressoras".</span></div>' +
        '<div class="field"><label>Tipo</label><select id="ipTipo">' +
          (cat.tipos || []).map(function (t) {
            var sel = (p.tipo || base.tipo || 'TERMICA') === t.chave ? ' selected' : '';
            return '<option value="' + t.chave + '"' + sel + '>' + esc(t.rotulo) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>Largura</label><select id="ipLargura">' +
          (cat.larguras || ['58mm', '80mm']).map(function (l) {
            var sel = (p.largura || base.larguraSugerida || '80mm') === l ? ' selected' : '';
            return '<option value="' + l + '"' + sel + '>' + esc(l) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>Estacao</label><select id="ipEstacao"><option value="">Todas as estacoes</option>' +
          ip.estacoes.map(function (e) {
            return '<option value="' + e.id + '"' + (p.estacaoId === e.id ? ' selected' : '') + '>' + esc(e.nome) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>Funcao</label><select id="ipFuncao"><option value="">Nenhuma</option>' +
          (cat.funcoes || []).map(function (f) {
            return '<option value="' + f.chave + '"' + (p.funcao === f.chave ? ' selected' : '') + '>' + esc(f.rotulo) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>Endpoint ESC/POS (opcional)</label><input id="ipEndpoint" value="' + esc(p.endpoint || '') + '" placeholder="ex.: 192.168.0.50:9100" />' +
          '<span class="hint">Para impressora de rede. Em branco usa o spooler do Windows.</span></div>' +
        '<div class="field"><label>Observacoes</label><input id="ipObs" value="' + esc(p.observacoes || '') + '" /></div>' +
      '</div>' +
      '<div class="imp-checks">' +
        check('ipAtiva', 'Ativa', p.ativa !== 0) +
        check('ipPadrao', 'Impressora padrao da empresa', p.padrao === 1 || (nova && !ip.impressoras.length)) +
        check('ipAuto', 'Impressao automatica', p.impressaoAutomatica === 1) +
        check('ipCorte', 'Corte automatico', p.corteAutomatico !== 0) +
        check('ipGuilhotina', 'Guilhotina completa', p.guilhotina === 1) +
        check('ipGaveta', 'Gaveta de dinheiro (se a impressora suportar)', p.gavetaDinheiro === 1) +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Salvar</button></div>'
    );

    document.getElementById('mCancel').addEventListener('click', fecharModal);
    document.getElementById('mOk').addEventListener('click', function () {
      var nome = document.getElementById('ipNome').value.trim();
      var nomeWindows = document.getElementById('ipWindows').value.trim();
      if (!nome) { toast('Informe o nome da impressora.', true); return; }
      if (!nomeWindows) { toast('Informe a impressora do Windows.', true); return; }

      var dados = {
        id: p.id || null,
        nome: nome,
        nomeWindows: nomeWindows,
        tipo: document.getElementById('ipTipo').value,
        largura: document.getElementById('ipLargura').value,
        estacaoId: document.getElementById('ipEstacao').value || null,
        funcao: document.getElementById('ipFuncao').value || null,
        endpoint: document.getElementById('ipEndpoint').value.trim(),
        observacoes: document.getElementById('ipObs').value.trim(),
        ativa: document.getElementById('ipAtiva').checked,
        padrao: document.getElementById('ipPadrao').checked,
        impressaoAutomatica: document.getElementById('ipAuto').checked,
        corteAutomatico: document.getElementById('ipCorte').checked,
        guilhotina: document.getElementById('ipGuilhotina').checked,
        gavetaDinheiro: document.getElementById('ipGaveta').checked
      };

      var btn = document.getElementById('mOk');
      btn.disabled = true; btn.textContent = 'SALVANDO...';
      DB.salvarImpressora(EMPRESA, dados).then(function () {
        toast('Impressora salva.');
        fecharModal();
        return recarregar();
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Salvar';
        toast('Erro: ' + e.message, true);
      });
    });
  }

  function check(id, rotulo, marcado) {
    return '<label class="prod-check"><input type="checkbox" id="' + id + '" ' + (marcado ? 'checked' : '') + ' /> ' + esc(rotulo) + '</label>';
  }

  function modalEstacao(e) {
    var nova = !e;
    e = e || {};
    abrirModal('<h3>' + (nova ? 'Nova estacao' : 'Editar estacao') + '</h3>' +
      '<div class="grid2">' +
        '<div class="field"><label>Nome *</label><input id="esNome" value="' + esc(e.nome || '') + '" placeholder="ex.: CAIXA 01" /></div>' +
        '<div class="field"><label>Codigo</label><input id="esCodigo" value="' + esc(e.codigo || '') + '" placeholder="ex.: CAIXA-01" /></div>' +
      '</div>' +
      '<div class="field"><label>Observacoes</label><input id="esObs" value="' + esc(e.observacoes || '') + '" /></div>' +
      '<div class="imp-checks">' + check('esPadrao', 'Estacao padrao da empresa', e.padrao === 1 || nova) +
      check('esAtiva', 'Ativa', e.ativo !== 0) + '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Salvar</button></div>');

    document.getElementById('mCancel').addEventListener('click', fecharModal);
    document.getElementById('mOk').addEventListener('click', function () {
      var nome = document.getElementById('esNome').value.trim();
      if (!nome) { toast('Informe o nome da estacao.', true); return; }
      var dados = {
        id: e.id || null,
        nome: nome,
        codigo: document.getElementById('esCodigo').value.trim() || nome,
        observacoes: document.getElementById('esObs').value.trim(),
        padrao: document.getElementById('esPadrao').checked,
        ativo: document.getElementById('esAtiva').checked
      };
      var btn = document.getElementById('mOk');
      btn.disabled = true; btn.textContent = 'SALVANDO...';
      DB.salvarEstacao(EMPRESA, dados).then(function () {
        toast('Estacao salva.'); fecharModal(); return recarregar();
      }).catch(function (er) {
        btn.disabled = false; btn.textContent = 'Salvar';
        toast('Erro: ' + er.message, true);
      });
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);