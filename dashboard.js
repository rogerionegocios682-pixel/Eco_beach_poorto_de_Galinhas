/*
 * Turismo OS â€” Retaguarda (dashboard.js)
 * --------------------------------------------------
 * Conecta a interface ao banco existente (db.js).
 * NÃƒO cria banco novo, NÃƒO recria autenticaÃ§Ã£o: lÃª a sessÃ£o
 * gravada por login.html (localStorage.turismo_session) e usa DB.*.
 */
(function () {
  'use strict';

  /* ---------- SessÃ£o (reaproveita o que o login jÃ¡ grava) ---------- */
  var sessao = null;
  try { sessao = JSON.parse(localStorage.getItem('turismo_session') || 'null'); } catch (e) { sessao = null; }
  if (!sessao) { window.location.href = 'login.html'; return; }

  var PERMISSOES_POR_PERFIL = {
    admin: {
      views: ['aptos', 'reservas', 'calendario', 'mesas', 'passantes', 'cadastros'],
      acoes: ['usuarios', 'cadastros', 'reservas', 'mesas', 'passantes', 'apto', 'aptoConsumo', 'abrirMesa', 'fecharConta', 'lancarProduto']
    },
    recepcao: {
      views: ['aptos', 'reservas', 'calendario', 'mesas', 'passantes', 'cadastros'],
      acoes: ['cadastros', 'reservas', 'mesas', 'passantes', 'apto', 'aptoConsumo', 'abrirMesa', 'fecharConta', 'lancarProduto']
    },
    garcom: {
      views: ['aptos', 'mesas'],
      acoes: ['apto', 'aptoConsumo', 'abrirMesa', 'fecharConta', 'lancarProduto']
    }
  };

  function perfilAtual() {
    return (sessao && sessao.perfil) || 'admin';
  }

  function permissoesAtuais() {
    return PERMISSOES_POR_PERFIL[perfilAtual()] || PERMISSOES_POR_PERFIL.admin;
  }

  function pode(item) {
    var permissoes = permissoesAtuais();
    return (permissoes.views.indexOf(item) !== -1) || (permissoes.acoes.indexOf(item) !== -1);
  }

  /* O menu "Gestão" aponta para telas que TÊM a sua própria checagem de
   * permissão. Ainda assim, escondemos o link para não levar o usuário a
   * uma tela que dirá "sem permissão": menu que só frustra é ruído. */
  var PERMISSAO_POR_LINK = {
    'configuracoes.html': 'fiscal.configurar',
    'estoque.html': 'estoque.visualizar',
    'fiscal.html': 'fiscal.visualizar',
    'auditoria.html': 'fiscal.visualizar'
  };

  function aplicarPermissoes() {
    var perfil = perfilAtual();
    var permissoes = permissoesAtuais();

    document.querySelectorAll('#nav a[data-view]').forEach(function (a) {
      var ok = permissoes.views.indexOf(a.dataset.view) !== -1;
      a.style.display = ok ? '' : 'none';
    });

    var navUsuarios = document.getElementById('navUsuarios');
    if (navUsuarios) navUsuarios.style.display = pode('usuarios') ? '' : 'none';

    /* Os links de gestão usam a MESMA regra de permissão do servidor.
     * Sem permissão, o link desaparece em vez de dar erro ao clicar. */
    document.querySelectorAll('#nav a[href]').forEach(function (a) {
      var arquivo = a.getAttribute('href');
      var exigida = PERMISSAO_POR_LINK[arquivo];
      if (!exigida) return;
      if (perfil === 'admin') return;
      var lista = permissoes.acoes || [];
      var grupo = String(exigida).split('.')[0];
      var liberado = lista.indexOf(exigida) !== -1 || lista.indexOf(grupo + '.*') !== -1;
      a.style.display = liberado ? '' : 'none';
    });

    var labels = document.querySelectorAll('#nav .label');
    if (perfil === 'garcom' && labels.length > 2) {
      // O garçom não tem acesso às telas de gestão: esconde o bloco inteiro.
      labels[1].style.display = 'none';
      labels[2].style.display = 'none';
    }
  }

  var EMPRESA = (sessao.empresaId != null) ? sessao.empresaId : DB.EMPRESA_PADRAO;
  var ctx = {
    aptos: [], mesas: [], hospedes: [], reservas: [], passantes: [],
    produtos: [], comandas: [], estados: {}, comandasPorMesa: {}
  };

  var $ = function (id) { return document.getElementById(id); };

  var STATUS_LABEL = {
    livre: 'Livre', reservado: 'Reservado', hospedado: 'Hospedado',
    limpeza: 'Limpeza', manutencao: 'ManutenÃ§Ã£o'
  };

  /* ---------- Utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function brl(v) {
    return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dataCurta(iso) {
    if (!iso) return 'â€”';
    var d = new Date(iso);
    if (isNaN(d)) return 'â€”';
    return d.toLocaleDateString('pt-BR');
  }
  function dataHora(ms) {
    if (!ms) return 'â€”';
    var d = new Date(ms);
    return d.toLocaleDateString('pt-BR') + ' Ã s ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function toast(msg, err) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    setTimeout(function () { t.className = 'toast'; }, 2800);
  }
  function abrirModal(html, variante) {
    $('modalBox').innerHTML = html;
    // 'wide' amplia o modal para a grade de cards do PDV (e o cupom).
    $('modalBox').classList.toggle('wide', variante === 'wide');
    $('overlay').classList.add('show');
  }
  function fecharModal() { $('overlay').classList.remove('show'); $('modalBox').innerHTML = ''; $('modalBox').classList.remove('wide'); }

  /* ---------- CabeÃ§alho / usuÃ¡rio ---------- */
  $('uNome').textContent = sessao.nome || sessao.usuario;
  $('uPerfil').textContent = sessao.perfil || '';
  $('uAvatar').textContent = (sessao.nome || sessao.usuario || '?').trim().charAt(0).toUpperCase();

  $('btnLogout').addEventListener('click', function () {
    if (confirm('Deseja sair do sistema?')) {
      try { localStorage.removeItem('turismo_session'); } catch (e) {}
      window.location.href = 'login.html';
    }
  });

  /* ---------- Menu lateral ---------- */
  var TITULOS = {
    aptos: ['Aptos', 'VisÃ£o geral dos apartamentos da empresa'],
    reservas: ['Reservas', 'Reservas e prÃ©-reservas da empresa'],
    cadastros: ['Cadastros', 'HÃ³spedes, apartamentos, usuÃ¡rios e passantes'],
    mesas: ['Mesas', 'Mesas do restaurante'],
    passantes: ['Passantes', 'Clientes sem hospedagem']
  };

  function mostrarView(name) {
    var perfil = permissoesAtuais();
    if (!name || perfil.views.indexOf(name) === -1) {
      name = perfil.views[0] || 'aptos';
    }

    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var v = $('view-' + name);
    if (v) v.classList.add('active');
    document.querySelectorAll('#nav a[data-view]').forEach(function (a) {
      a.classList.toggle('active', a.dataset.view === name);
    });
    var t = TITULOS[name] || ['Retaguarda', ''];
    $('pageTitle').textContent = t[0];
    $('pageSub').textContent = t[1];
    fecharMenu();
    if (name === 'reservas') renderReservas();
    if (name === 'calendario') renderCalendario();
    if (name === 'cadastros') renderCadastros();
    if (name === 'mesas') { carregarTudo().then(renderMesas).catch(function () { renderMesas(); }); }
    if (name === 'passantes') renderPassantes();
  }

  document.querySelectorAll('#nav a[data-view]').forEach(function (a) {
    a.addEventListener('click', function () {
      if (!pode(a.dataset.view)) {
        toast('Seu perfil não permite acessar esta área.', true);
        return;
      }
      mostrarView(a.dataset.view);
    });
  });

  function abrirMenu() { $('sidebar').classList.add('open'); $('sidebarBg').classList.add('show'); }
  function fecharMenu() { $('sidebar').classList.remove('open'); $('sidebarBg').classList.remove('show'); }
  $('btnMenu').addEventListener('click', abrirMenu);
  $('sidebarBg').addEventListener('click', fecharMenu);
  aplicarPermissoes();

  /* ---------- Carregamento de dados (do banco real) ---------- */
  function carregarTudo() {
    return DB.listarAptos(EMPRESA).then(function (aptos) {
      ctx.aptos = aptos;
      // Para cada apto, calcula o estado derivado (reserva/hospedagem/consumo)
      return Promise.all(aptos.map(function (a) {
        return DB.estadoDoApto(a.id).then(function (est) {
          ctx.estados[a.id] = est;
          return est;
        });
      }));
    }).then(function () {
      return Promise.all([
        DB.listarMesas(EMPRESA),
        DB.listarHospedes(EMPRESA),
        DB.listarReservas(EMPRESA),
        DB.listarPassantes(EMPRESA),
        DB.listarProdutos(EMPRESA),
        DB.listarComandas(EMPRESA)
      ]);
    }).then(function (r) {
      ctx.mesas = r[0];
      ctx.hospedes = r[1];
      ctx.reservas = r[2];
      ctx.passantes = r[3];
      ctx.produtos = r[4];
      ctx.comandas = r[5];
      // Mapa: comanda ABERTA por mesa (no máximo uma).
      ctx.comandasPorMesa = {};
      ctx.comandas.forEach(function (c) {
        if (c.status === 'aberta') ctx.comandasPorMesa[c.mesaId] = c;
      });
      renderAptos();
      atualizarContadores();
      if ($('view-mesas').classList.contains('active')) renderMesas();
    });
  }

  /* ---------- Tela inicial: grade de apartamentos ---------- */
  function renderAptos() {
    var filtro = ($('filtroAptos').value || '').trim().toLowerCase();
    var counts = { livre: 0, reservado: 0, hospedado: 0, limpeza: 0, manutencao: 0 };

    var grid = $('aptGrid');
    var html = '';

    ctx.aptos.forEach(function (a) {
      var est = ctx.estados[a.id] || { status: a.status || 'livre', consumos: [] };
      var st = est.status || 'livre';
      if (counts[st] != null) counts[st]++;

      if (filtro && String(a.numero).toLowerCase().indexOf(filtro) === -1) return;

      var temConsumo = est.consumos && est.consumos.length > 0;
      html += '<button class="apt s-' + esc(st) + (a.ativo === false ? ' inativo' : '') + '" data-apto="' + a.id + '">' +
        '<div class="top"></div>' +
        '<div class="body">' +
          '<div class="num">' + esc(a.numero) + '<span class="tag">' + (a.ativo === false ? 'inativo' : '') + '</span></div>' +
          '<div class="tipo">' + esc(a.tipo) + ' Â· ' + esc(a.capacidade) + ' pessoas</div>' +
          '<div class="kinfo">' +
            '<span class="diaria">' + brl(a.diaria) + '</span>' +
            '<span class="st">' + esc(STATUS_LABEL[st] || st) + '</span>' +
          '</div>' +
          (temConsumo ? '<div class="consumo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v4H3z"/><path d="M5 7v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7"/></svg> consumo: ' + brl(est.consumos.reduce(function (s, c) { return s + (Number(c.valor) || 0); }, 0)) + '</div>' : '') +
        '</div>' +
      '</button>';
    });

    if (!ctx.aptos.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/></svg><div>Nenhum apartamento cadastrado.</div><div class="muted" style="margin-top:6px">Cadastre em <b>Cadastros â†’ Apartamentos</b>.</div></div>';
    } else if (html === '') {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Nenhum apartamento encontrado para o filtro.</div>';
    } else {
      grid.innerHTML = html;
    }

    grid.querySelectorAll('[data-apto]').forEach(function (b) {
      b.addEventListener('click', function () { abrirDetalhes(Number(b.dataset.apto)); });
    });

    renderResumo(counts);
  }

  function renderResumo(counts) {
    var defs = [
      ['livre', 'Livre', '<path d="M20 6L9 17l-5-5"/>'],
      ['reservado', 'Reservado', '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'],
      ['hospedado', 'Hospedados', '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'],
      ['limpeza', 'Limpeza', '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>'],
      ['manutencao', 'ManutenÃ§Ã£o', '<path d="M14.7 6.3a4 4 0 0 0 5 5l-8.5 8.5a2.1 2.1 0 0 1-3-3z"/>']
    ];
    $('summary').innerHTML = defs.map(function (d) {
      return '<div class="scard" data-filtro="' + d[0] + '">' +
        '<div class="ico ' + d[0] + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d[2] + '</svg></div>' +
        '<div><div class="n">' + (counts[d[0]] || 0) + '</div><div class="t">' + d[1] + '</div></div>' +
      '</div>';
    }).join('');

    $('summary').querySelectorAll('[data-filtro]').forEach(function (c) {
      c.addEventListener('click', function () {
        var f = c.dataset.filtro;
        var jaOn = c.classList.contains('on');
        $('filtroAptos').value = '';
        if (jaOn) {
          gridFiltroStatus = null;
        } else {
          gridFiltroStatus = f;
          document.querySelectorAll('#summary .scard').forEach(function (x) { x.classList.remove('on'); });
          c.classList.add('on');
        }
        renderAptosComFiltroStatus();
      });
    });
  }

  var gridFiltroStatus = null;

  function renderAptosComFiltroStatus() {
    // Reaplica a renderizaÃ§Ã£o padrÃ£o e, se houver filtro por status, esconde os demais.
    renderAptos();
    if (gridFiltroStatus) {
      $('aptGrid').querySelectorAll('.apt').forEach(function (el) {
        if (!el.classList.contains('s-' + gridFiltroStatus)) el.style.display = 'none';
      });
    }
  }

  $('filtroAptos').addEventListener('input', function () {
    gridFiltroStatus = null;
    document.querySelectorAll('#summary .scard').forEach(function (x) { x.classList.remove('on'); });
    renderAptos();
  });

  /* ---------- Painel de detalhes do apartamento ---------- */
  function abrirDetalhes(aptoId) {
    if (!pode('apto')) {
      toast('Seu perfil não permite ver detalhes do apartamento.', true);
      return;
    }
    DB.estadoDoApto(aptoId).then(function (est) {
      var apto = est.apto;
      var hosp = est.hospedagem;
      var res = est.reserva;
      var fin = est.financeiro;
      var consumos = est.consumos || [];

      $('dAptoBadge').textContent = apto.numero;
      $('dTitulo').textContent = apto.identificacao || ('APT ' + apto.numero);
      $('dSubtitulo').innerHTML = esc(apto.tipo) + ' Â· ' + esc(apto.capacidade) + ' pessoas Â· ' +
        '<span class="badge ' + (est.status === 'hospedado' ? 'recepcao' : est.status === 'livre' ? 'on' : 'off') + '" style="font-size:11px">' +
        esc(STATUS_LABEL[est.status] || est.status) + '</span>';

      var html = '';

      // --- HOSPEDAGEM ---
      html += '<div class="dsec"><h3>Hospedagem</h3>';
      if (hosp || res) {
        var b = hosp || res;
        var ini = hosp ? hosp.checkin : res.entrada;
        var fim = hosp ? (hosp.checkout || hosp.checkoutPrevisto) : res.saida;
        html += '<div class="dtxt">' +
          item('ResponsÃ¡vel', esc(b.hospedeNome || 'â€”')) +
          item('SituaÃ§Ã£o', esc(STATUS_LABEL[est.status] || est.status)) +
          item('Pessoas', esc(b.pessoas || 1)) +
          item('Adultos', esc(b.adultos != null ? b.adultos : b.pessoas)) +
          item('CrianÃ§as', esc(b.criancas != null ? b.criancas : 0)) +
          item('Check-in', dataCurta(ini)) +
          item(hosp ? 'Check-out previsto' : 'Entrada prevista', dataCurta(fim)) +
          item('DiÃ¡rias', (fin.qtdDiarias || 0) + (fin.qtdDiarias === 1 ? ' diÃ¡ria' : ' diÃ¡rias')) +
          item('Valor da diÃ¡ria', brl(fin.diaria)) +
          item('Total das diÃ¡rias', brl(fin.totalDiarias), true) +
          item('Forma de pagamento', esc(b.formaPagamento || 'â€”')) +
          item('ObservaÃ§Ãµes', esc(b.observacoes || 'â€”'), true) +
        '</div>';
      } else {
        html += '<div class="muted">Nenhuma hospedagem ou reserva ativa para este apartamento.</div>';
      }
      html += '</div>';

      // --- CONSUMO DO RESTAURANTE ---
      html += '<div class="dsec"><h3>Consumo do restaurante</h3>';
      if (consumos.length) {
        html += '<div class="cons-box has">' +
          '<div class="cons-stat"><span class="k">Possui consumo</span><span class="v" style="color:#b45309">SIM</span></div>' +
          '<div class="cons-stat"><span class="k">Total consumido</span><span class="v">' + brl(fin.totalConsumo) + '</span></div>' +
          '<div class="cons-stat"><span class="k">Pedidos</span><span class="v">' + String(consumos.length).padStart(2, '0') + '</span></div>' +
          '<div class="cons-list">' + consumos.map(function (c) {
            return '<div class="cons-item">' +
              '<span>' + dataHora(c.em) + (c.comanda ? ' Â· comanda ' + esc(c.comanda) : '') + '<div class="r">' + esc(c.descricao || '') + ' Â· ' + esc(c.status || '') + '</div></span>' +
              '<span style="font-weight:600;white-space:nowrap">' + brl(c.valor) + '</span>' +
            '</div>';
          }).join('') + '</div>' +
        '</div>';
      } else {
        html += '<div class="cons-box"><div class="muted">Nenhum consumo registrado.</div></div>';
      }
      html += '</div>';

      // --- RESUMO FINANCEIRO ---
      html += '<div class="dsec"><h3>Resumo financeiro</h3>' +
        '<div class="resumo-fin">' +
          '<div class="linha"><span class="k">DiÃ¡rias (' + (fin.qtdDiarias || 0) + ')</span><span style="font-weight:600">' + brl(fin.totalDiarias) + '</span></div>' +
          '<div class="linha"><span class="k">Consumo restaurante</span><span style="font-weight:600">' + brl(fin.totalConsumo) + '</span></div>' +
          '<div class="linha total"><span class="k">Total da hospedagem</span><span>' + brl(fin.total) + '</span></div>' +
        '</div>' +
      '</div>';

      // --- SITUAÃ‡ÃƒO / AÃ‡Ã•ES MANUAIS ---
      html += '<div class="dsec"><h3>SituaÃ§Ã£o do apartamento</h3>' +
        '<div class="status-pills" id="statusPills">' +
          ['livre', 'reservado', 'hospedado', 'limpeza', 'manutencao'].map(function (s) {
            return '<button data-st="' + s + '" class="' + (s === est.status ? 'on' : '') + '">' + esc(STATUS_LABEL[s]) + '</button>';
          }).join('') +
        '</div></div>';

      $('dBody').innerHTML = html;

      // Pills de status: gravam no banco e recarregam
      $('statusPills').querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          DB.atualizarApto(aptoId, { status: btn.dataset.st }).then(function () {
            toast('Status atualizado para ' + STATUS_LABEL[btn.dataset.st] + '.');
            carregarTudo().then(function () { abrirDetalhes(aptoId); });
          });
        });
      });

      // RodapÃ©: aÃ§Ãµes conforme o estado
      var foot = '';
      if (hosp) {
        foot += '<button class="btn btn-warn" id="btnConsumo">+ Consumo</button>';
        foot += '<button class="btn btn-primary" id="btnCheckout">Fazer check-out</button>';
      } else if (res) {
        foot += '<button class="btn btn-primary" id="btnCheckin">Fazer check-in</button>';
      } else {
        foot += '<button class="btn btn-primary" id="btnCheckin">Hospedar hÃ³spede</button>';
      }
      $('dFoot').innerHTML = foot;

      if ($('btnConsumo')) $('btnConsumo').addEventListener('click', function () { modalConsumo(aptoId, hosp); });
      if ($('btnCheckout')) $('btnCheckout').addEventListener('click', function () { fazerCheckout(hosp); });
      if ($('btnCheckin')) $('btnCheckin').addEventListener('click', function () { modalCheckin(apto); });

      $('drawer').classList.add('show');
      $('drawerBg').classList.add('show');
    }).catch(function (e) { toast('Erro ao abrir apartamento: ' + e.message, true); });
  }

  function item(k, v, full) {
    return '<div class="ditem' + (full ? ' full' : '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  }

  function fecharDetalhes() {
    $('drawer').classList.remove('show');
    $('drawerBg').classList.remove('show');
  }
  $('btnFecharDrawer').addEventListener('click', fecharDetalhes);
  $('drawerBg').addEventListener('click', fecharDetalhes);

  /* ---------- Check-in / Check-out ---------- */
  function modalCheckin(apto) {
    var hoje = new Date().toISOString().slice(0, 10);
    var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    var opts = ctx.hospedes.map(function (h) { return '<option value="' + h.id + '">' + esc(h.nome) + '</option>'; }).join('');

    abrirModal(
      '<h3>Hospedar no APT ' + esc(apto.numero) + '</h3>' +
      '<div class="field"><label>HÃ³spede</label><select id="ckHospede">' + opts + '<option value="">â€” Novo hÃ³spede (digite abaixo) â€”</option></select></div>' +
      '<div class="field"><label>Nome do responsÃ¡vel</label><input id="ckNome" placeholder="Selecione acima ou digite" /></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Adultos</label><input id="ckAdultos" type="number" min="1" value="1" /></div>' +
        '<div class="field"><label>CrianÃ§as</label><input id="ckCriancas" type="number" min="0" value="0" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Check-in</label><input id="ckIn" type="date" value="' + hoje + '" /></div>' +
        '<div class="field"><label>Check-out previsto</label><input id="ckOut" type="date" value="' + amanha + '" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Valor da diÃ¡ria</label><input id="ckDiaria" type="number" step="0.01" value="' + (apto.diaria || 0) + '" /></div>' +
        '<div class="field"><label>Pagamento</label><select id="ckPag"><option>Dinheiro</option><option>DÃ©bito</option><option>CrÃ©dito</option><option>Pix</option></select></div>' +
      '</div>' +
      '<div class="field"><label>ObservaÃ§Ãµes</label><textarea id="ckObs"></textarea></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">Confirmar check-in</button></div>'
    );

    var sel = $('ckHospede');
    sel.addEventListener('change', function () {
      var o = sel.options[sel.selectedIndex];
      $('ckNome').value = o.value ? o.textContent : '';
    });
    if (sel.value) $('ckNome').value = sel.options[sel.selectedIndex].textContent;

    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var nome = $('ckNome').value.trim();
      if (!nome) { toast('Informe o nome do responsÃ¡vel.', true); return; }
      var adultos = Number($('ckAdultos').value) || 1;
      var criancas = Number($('ckCriancas').value) || 0;
      var hospedeId = sel.value ? Number(sel.value) : null;

      var acao = Promise.resolve(hospedeId);
      if (!hospedeId) {
        acao = DB.criarHospede({ empresaId: EMPRESA, nome: nome });
      }
      acao.then(function (hId) {
        return DB.criarHospedagem({
          empresaId: EMPRESA, aptoId: apto.id, hospedeId: hId, hospedeNome: nome,
          pessoas: adultos + criancas, adultos: adultos, criancas: criancas,
          checkin: $('ckIn').value, checkoutPrevisto: $('ckOut').value,
          diaria: Number($('ckDiaria').value), formaPagamento: $('ckPag').value,
          observacoes: $('ckObs').value
        });
      }).then(function () {
        fecharModal();
        toast('Check-in realizado no APT ' + apto.numero + '.');
        return carregarTudo();
      }).then(function () {
        abrirDetalhes(apto.id);
      }).catch(function (e) { toast('Erro no check-in: ' + e.message, true); });
    });
  }

  function fazerCheckout(hosp) {
    if (!confirm('Confirmar check-out de ' + (hosp.hospedeNome || 'hÃ³spede') + '?')) return;
    DB.fazerCheckout(hosp.id, hosp.formaPagamento).then(function () {
      toast('Check-out realizado. Apartamento liberado para limpeza.');
      return carregarTudo();
    }).then(function () { abrirDetalhes(hosp.aptoId); })
      .catch(function (e) { toast('Erro no check-out: ' + e.message, true); });
  }

  function modalConsumo(aptoId, hosp) {
    abrirModal(
      '<h3>LanÃ§ar consumo â€” ' + esc(hosp.hospedeNome || '') + '</h3>' +
      '<div class="field"><label>DescriÃ§Ã£o</label><input id="cnDesc" placeholder="ex.: Jantar 2 pessoas" /></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Valor (R$)</label><input id="cnValor" type="number" step="0.01" placeholder="0,00" /></div>' +
        '<div class="field"><label>Comanda</label><input id="cnComanda" placeholder="ex.: 120" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Itens</label><input id="cnItens" type="number" min="1" value="1" /></div>' +
        '<div class="field"><label>Status</label><select id="cnStatus"><option value="aberto">Aberto</option><option value="fechado">Fechado</option></select></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">LanÃ§ar consumo</button></div>'
    );
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var v = Number($('cnValor').value);
      if (!v || v <= 0) { toast('Informe um valor vÃ¡lido.', true); return; }
      DB.criarConsumo({
        empresaId: EMPRESA, hospedagemId: hosp.id, aptoId: aptoId,
        comanda: $('cnComanda').value, descricao: $('cnDesc').value,
        valor: v, itens: Number($('cnItens').value) || 1,
        status: $('cnStatus').value, em: Date.now()
      }).then(function () {
        fecharModal();
        toast('Consumo lanÃ§ado e vinculado ao apartamento.');
        return carregarTudo();
      }).then(function () { abrirDetalhes(aptoId); })
        .catch(function (e) { toast('Erro ao lanÃ§ar consumo: ' + e.message, true); });
    });
  }

  /* ---------- Reservas ---------- */
  function numeroApto(aptoId) {
    var a = ctx.aptos.filter(function (x) { return x.id === aptoId; })[0];
    return a ? 'APT ' + a.numero : 'â€”';
  }

  var STATUS_RES = {
    reservado: 'recepcao', confirmado: 'on', hospedado: 'admin',
    cancelado: 'off', finalizado: 'off'
  };

  function renderReservas() {
    var tb = $('tbReservas');
    if (!ctx.reservas.length) {
      tb.innerHTML = vazio(11, 'Nenhuma reserva cadastrada. Use "+ Nova reserva".');
      return;
    }
    tb.innerHTML = ctx.reservas.map(function (r) {
      var cancelada = r.status === 'cancelado';
      return '<tr' + (cancelada ? ' style="opacity:.55"' : '') + '>' +
        '<td><b>' + esc(r.numero || r.id) + '</b></td>' +
        '<td>' + esc(r.hospedeNome) + '</td>' +
        '<td>' + numeroApto(r.aptoId) + '</td>' +
        '<td>' + dataCurta(r.entrada) + (r.horaEntrada ? ' <span class="muted">' + esc(r.horaEntrada) + '</span>' : '') + '</td>' +
        '<td>' + dataCurta(r.saida) + (r.horaSaida ? ' <span class="muted">' + esc(r.horaSaida) + '</span>' : '') + '</td>' +
        '<td>' + esc(r.qtdDiarias != null ? r.qtdDiarias : 'â€”') + '</td>' +
        '<td>' + esc(r.pessoas) + '</td>' +
        '<td><b>' + brl(r.total != null ? r.total : (r.diaria || 0)) + '</b></td>' +
        '<td>' + esc(r.situacaoPagamento || 'â€”') + '</td>' +
        '<td><span class="badge ' + (STATUS_RES[r.status] || 'off') + '">' + esc(r.status) + '</span></td>' +
        '<td><div class="td-actions">' +
          '<button class="btn btn-sm btn-ghost-m" data-fnrh="' + r.id + '">FNRH</button>' +
          (cancelada ? '' :
            '<button class="btn btn-sm btn-warn" data-editres="' + r.id + '">Editar</button>' +
            '<button class="btn btn-sm btn-danger" data-delres="' + r.id + '">Cancelar</button>') +
        '</div></td>' +
      '</tr>';
    }).join('');

    tb.querySelectorAll('[data-fnrh]').forEach(function (b) {
      b.addEventListener('click', function () { abrirFNRH(Number(b.dataset.fnrh)); });
    });
    tb.querySelectorAll('[data-editres]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = ctx.reservas.filter(function (x) { return x.id === Number(b.dataset.editres); })[0];
        if (r) modalReserva(r);
      });
    });
    tb.querySelectorAll('[data-delres]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = Number(b.dataset.delres);
        var r = ctx.reservas.filter(function (x) { return x.id === id; })[0];
        if (!r) return;
        if (!confirm('Cancelar a reserva nÂº ' + (r.numero || r.id) + ' de ' + r.hospedeNome + '?')) return;
        DB.cancelarReserva(id).then(function () {
          toast('Reserva cancelada. Disponibilidade atualizada.');
          return carregarTudo();
        }).then(renderReservas)
          .catch(function (e) { toast('Erro ao cancelar: ' + e.message, true); });
      });
    });
  }

  /* ---------- Ficha de reserva (cadastro FNRH + hospedagem + valores) ---------- */
  var TIPOS_DOC = ['CPF', 'RG', 'Passaporte', 'CNH', 'Outro'];

  function optDoc(sel) {
    return TIPOS_DOC.map(function (t) { return '<option' + (t === sel ? ' selected' : '') + '>' + t + '</option>'; }).join('');
  }

  // Modal reaproveitado por "Nova reserva" e "Editar reserva".
  function modalReserva(reserva) {
    if (!ctx.aptos.length) { toast('Cadastre um apartamento antes.', true); return; }
    var editando = !!reserva;
    var r = reserva || {};

    var aptoOpts = ctx.aptos.map(function (a) {
      return '<option value="' + a.id + '" data-diaria="' + a.diaria + '"' + (r.aptoId === a.id ? ' selected' : '') + '>APT ' + esc(a.numero) + ' â€” ' + esc(a.tipo) + '</option>';
    }).join('');
    var hospOpts = ctx.hospedes.map(function (h) {
      return '<option value="' + h.id + '"' + (r.hospedeId === h.id ? ' selected' : '') + '>' + esc(h.nome) + '</option>';
    }).join('');

    var hoje = new Date().toISOString().slice(0, 10);
    var amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    var dIn = r.entrada ? new Date(r.entrada).toISOString().slice(0, 10) : hoje;
    var dOut = r.saida ? new Date(r.saida).toISOString().slice(0, 10) : amanha;

    abrirModal(
      '<h3>' + (editando ? 'Editar reserva nÂº ' + esc(r.numero || r.id) : 'Nova reserva') + '</h3>' +
      '<div class="msec-title">HÃ³spede / FNRH</div>' +
      '<div class="field"><label>HÃ³spede jÃ¡ cadastrado (localizar)</label><select id="rvHospede"><option value="">â€” Novo hÃ³spede â€”</option>' + hospOpts + '</select></div>' +
      '<div class="field"><label>Nome completo *</label><input id="rvNome" value="' + esc(r.hospedeNome || '') + '" /></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Tipo de documento</label><select id="rvTipoDoc">' + optDoc(r.tipoDocumento) + '</select></div>' +
        '<div class="field"><label>Documento / CPF</label><input id="rvDoc" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Data de nascimento</label><input id="rvNasc" type="date" /></div>' +
        '<div class="field"><label>Sexo</label><select id="rvSexo"><option value="">â€”</option><option value="M">Masculino</option><option value="F">Feminino</option></select></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Nacionalidade</label><input id="rvNac" value="Brasileira" /></div>' +
        '<div class="field"><label>Telefone</label><input id="rvTel" /></div>' +
      '</div>' +
      '<div class="field"><label>E-mail</label><input id="rvEmail" type="email" /></div>' +
      '<div class="field"><label>EndereÃ§o</label><input id="rvEnd" /></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Cidade</label><input id="rvCidade" /></div>' +
        '<div class="field"><label>Estado</label><input id="rvEstado" maxlength="2" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>PaÃ­s</label><input id="rvPais" value="Brasil" /></div>' +
        '<div class="field"><label>CEP</label><input id="rvCep" /></div>' +
      '</div>' +

      '<div class="msec-title">Hospedagem</div>' +
      '<div class="field"><label>Apartamento *</label><select id="rvApto">' + aptoOpts + '</select></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Check-in</label><input id="rvIn" type="date" value="' + dIn + '" /></div>' +
        '<div class="field"><label>Hora check-in</label><input id="rvHoraIn" type="time" value="' + esc(r.horaEntrada || '14:00') + '" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Check-out</label><input id="rvOut" type="date" value="' + dOut + '" /></div>' +
        '<div class="field"><label>Hora check-out</label><input id="rvHoraOut" type="time" value="' + esc(r.horaSaida || '12:00') + '" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Adultos</label><input id="rvAdultos" type="number" min="1" value="' + (r.adultos || 1) + '" /></div>' +
        '<div class="field"><label>CrianÃ§as</label><input id="rvCriancas" type="number" min="0" value="' + (r.criancas || 0) + '" /></div>' +
      '</div>' +

      '<div class="msec-title">Valores</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Valor da diÃ¡ria (R$)</label><input id="rvDiaria" type="number" step="0.01" value="' + (r.diaria || '') + '" /></div>' +
        '<div class="field"><label>Desconto (R$)</label><input id="rvDesc" type="number" step="0.01" value="' + (r.desconto || 0) + '" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Taxas (R$)</label><input id="rvTaxas" type="number" step="0.01" value="' + (r.taxas || 0) + '" /></div>' +
        '<div class="field"><label>Forma de pagamento</label><select id="rvPag">' +
          ['', 'Dinheiro', 'DÃ©bito', 'CrÃ©dito', 'Pix', 'Faturado'].map(function (p) {
            return '<option' + (p === r.formaPagamento ? ' selected' : '') + '>' + p + '</option>';
          }).join('') + '</select></div>' +
      '</div>' +
      '<div class="field"><label>SituaÃ§Ã£o do pagamento</label><select id="rvSitPag">' +
        ['pendente', 'parcial', 'pago'].map(function (s) {
          return '<option value="' + s + '"' + (s === (r.situacaoPagamento || 'pendente') ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></div>' +
      '<div class="field"><label>ObservaÃ§Ãµes</label><textarea id="rvObs">' + esc(r.observacoes || '') + '</textarea></div>' +

      '<div class="rv-total" id="rvTotalBox"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">' + (editando ? 'Salvar alteraÃ§Ãµes' : 'Confirmar reserva') + '</button></div>'
    );

    var selA = $('rvApto'), selH = $('rvHospede');

    function calcTotal() {
      var ini = new Date($('rvIn').value + 'T' + ($('rvHoraIn').value || '14:00') + ':00');
      var fim = new Date($('rvOut').value + 'T' + ($('rvHoraOut').value || '12:00') + ':00');
      var dias = Math.max(1, Math.round((fim - ini) / 86400000));
      if (isNaN(dias)) dias = 1;
      var diaria = Number($('rvDiaria').value) || 0;
      var sub = dias * diaria;
      var total = Math.max(0, sub - (Number($('rvDesc').value) || 0) + (Number($('rvTaxas').value) || 0));
      $('rvTotalBox').innerHTML =
        '<span>' + dias + (dias === 1 ? ' diÃ¡ria' : ' diÃ¡rias') + ' Ã— ' + brl(diaria) + ' = ' + brl(sub) + '</span>' +
        '<b>Total: ' + brl(total) + '</b>';
    }

    function syncDiaria() {
      var o = selA.options[selA.selectedIndex];
      if (o && (!editando || !r.diaria)) $('rvDiaria').value = o.dataset.diaria || 0;
      calcTotal();
    }

    selA.addEventListener('change', syncDiaria);
    ['rvIn', 'rvOut', 'rvHoraIn', 'rvHoraOut', 'rvDiaria', 'rvDesc', 'rvTaxas'].forEach(function (id) {
      $(id).addEventListener('input', calcTotal);
      $(id).addEventListener('change', calcTotal);
    });
    if (!editando) syncDiaria(); else calcTotal();

    // Selecionar hÃ³spede existente preenche a ficha (reaproveita o cadastro).
    selH.addEventListener('change', function () {
      var id = Number(selH.value);
      if (!id) { return; }
      DB.obterHospede(id).then(function (h) {
        if (!h) return;
        $('rvNome').value = h.nome || '';
        $('rvTipoDoc').value = h.tipoDocumento || 'CPF';
        $('rvDoc').value = h.documento || h.cpf || '';
        $('rvNasc').value = h.nascimento || '';
        $('rvSexo').value = h.sexo || '';
        $('rvNac').value = h.nacionalidade || 'Brasileira';
        $('rvTel').value = h.telefone || '';
        $('rvEmail').value = h.email || '';
        $('rvEnd').value = h.endereco || '';
        $('rvCidade').value = h.cidade || '';
        $('rvEstado').value = h.estado || '';
        $('rvPais').value = h.pais || 'Brasil';
        $('rvCep').value = h.cep || '';
      });
    });

    $('mCancel').addEventListener('click', fecharModal);

    $('mOk').addEventListener('click', function () {
      var nome = $('rvNome').value.trim();
      var doc = $('rvDoc').value.trim();
      if (!nome) { toast('Informe o nome completo do hÃ³spede.', true); return; }
      if (!$('rvDiaria').value) { toast('Informe o valor da diÃ¡ria.', true); return; }

      var dadosHospede = {
        empresaId: EMPRESA, nome: nome, tipoDocumento: $('rvTipoDoc').value,
        documento: doc, cpf: $('rvTipoDoc').value === 'CPF' ? doc : '',
        nascimento: $('rvNasc').value, sexo: $('rvSexo').value,
        nacionalidade: $('rvNac').value, telefone: $('rvTel').value,
        email: $('rvEmail').value, endereco: $('rvEnd').value,
        cidade: $('rvCidade').value, estado: $('rvEstado').value,
        pais: $('rvPais').value, cep: $('rvCep').value
      };

      var dadosReserva = {
        empresaId: EMPRESA, aptoId: Number(selA.value), hospedeNome: nome,
        entrada: $('rvIn').value, horaEntrada: $('rvHoraIn').value,
        saida: $('rvOut').value, horaSaida: $('rvHoraOut').value,
        adultos: Number($('rvAdultos').value) || 1,
        criancas: Number($('rvCriancas').value) || 0,
        pessoas: (Number($('rvAdultos').value) || 1) + (Number($('rvCriancas').value) || 0),
        diaria: Number($('rvDiaria').value), desconto: Number($('rvDesc').value) || 0,
        taxas: Number($('rvTaxas').value) || 0,
        formaPagamento: $('rvPag').value, situacaoPagamento: $('rvSitPag').value,
        observacoes: $('rvObs').value
      };

      var hId = selH.value ? Number(selH.value) : null;

      // Resolve o hÃ³spede: existente (atualiza) ou novo (cria).
      var p = Promise.resolve(hId);
      if (hId) {
        p = DB.atualizarHospede(hId, dadosHospede).then(function () { return hId; });
      } else {
        p = DB.buscarHospedePorDocumento(EMPRESA, doc).then(function (achou) {
          if (achou) return DB.atualizarHospede(achou.id, dadosHospede).then(function () { return achou.id; });
          return DB.criarHospede(dadosHospede);
        });
      }

      p.then(function (id) {
        dadosReserva.hospedeId = id;
        if (editando) {
          return DB.atualizarReserva(r.id, dadosReserva).then(function () { return DB.obterReserva(r.id); });
        }
        return DB.criarReservaCompleta(dadosReserva);
      }).then(function (reservaOK) {
        fecharModal();
        toast(editando ? 'Reserva atualizada. CalendÃ¡rio revalidado.' : 'Reserva nÂº ' + (reservaOK.numero || '') + ' confirmada.');
        return carregarTudo();
      }).then(function () {
        renderReservas();
        if ($('view-calendario').classList.contains('active')) renderCalendario();
        // Abre a FNRH da reserva recÃ©m-criada/alterada.
        if (!editando) return abrirFNRH(ultimaReservaId).catch(function () {});
      }).catch(function (e) {
        if (e && e.conflito) {
          var itens = e.conflito.itens.map(function (i) { return '<li>' + esc(i.texto) + '</li>'; }).join('');
          abrirModal('<h3 class="conf-title">Conflito de reserva</h3>' +
            '<p class="conf-msg">NÃ£o foi possÃ­vel confirmar. Verifique:</p><ul class="conf-list">' + itens + '</ul>' +
            '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Entendi</button></div>');
          $('mCancel').addEventListener('click', fecharModal);
          return;
        }
        toast('Erro ao salvar reserva: ' + e.message, true);
      });
    });
  }

  var ultimaReservaId = null;

  // Rastreia a Ãºltima reserva criada para abrir a FNRH automaticamente.
  var _criarReservaCompleta = DB.criarReservaCompleta;
  DB.criarReservaCompleta = function (dados, opts) {
    return _criarReservaCompleta.call(DB, dados, opts).then(function (res) {
      ultimaReservaId = res && res.id;
      return res;
    });
  };

  $('btnNovaReserva').addEventListener('click', function () {
    if (!pode('reservas')) { toast('Seu perfil não pode criar reservas.', true); return; }
    modalReserva(null);
  });

  /* ---------- Cadastros ---------- */
  function renderCadastros() {
    $('cntHospedes').textContent = ctx.hospedes.length;
    $('cntAptosCad').textContent = ctx.aptos.length;
    $('cntPassantesCad').textContent = ctx.passantes.length;
    DB.listarUsuarios().then(function (us) { $('cntUsuarios').textContent = us.length; });

    $('tbHospedes').innerHTML = ctx.hospedes.length
      ? ctx.hospedes.map(function (h) {
          return '<tr><td>' + esc(h.nome) + '</td><td>' + esc(h.telefone || 'â€”') + '</td><td>' + esc(h.documento || 'â€”') + '</td><td class="muted">' + esc(h.email || 'â€”') + '</td>' +
            '<td><div class="td-actions"><button class="btn btn-sm btn-ghost-m" data-hosp="' + h.id + '">Hospedar</button></div></td></tr>';
        }).join('')
      : vazio(5, 'Nenhum hÃ³spede cadastrado.');

    $('tbAptosCad').innerHTML = ctx.aptos.length
      ? ctx.aptos.map(function (a) {
          return '<tr><td><b>APT ' + esc(a.numero) + '</b></td><td>' + esc(a.tipo) + '</td><td>' + esc(a.capacidade) + '</td><td>' + brl(a.diaria) + '</td>' +
            '<td><span class="badge ' + (a.ativo === false ? 'off' : 'on') + '">' + (a.ativo === false ? 'Inativo' : 'Ativo') + '</span></td>' +
            '<td><div class="td-actions">' +
              '<button class="btn btn-sm btn-warn" data-editapt="' + a.id + '">Editar</button>' +
              '<button class="btn btn-sm btn-danger" data-delapt="' + a.id + '">Excluir</button>' +
            '</div></td></tr>';
        }).join('')
      : vazio(6, 'Nenhum apartamento cadastrado.');

    $('tbAptosCad').querySelectorAll('[data-editapt]').forEach(function (b) {
      b.addEventListener('click', function () { modalApto(ctx.aptos.filter(function (a) { return a.id === Number(b.dataset.editapt); })[0]); });
    });
    $('tbAptosCad').querySelectorAll('[data-delapt]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (confirm('Excluir o apartamento ' + b.dataset.delapt + '?')) {
          DB.removerApto(Number(b.dataset.delapt)).then(function () { toast('Apartamento excluÃ­do.'); return carregarTudo(); }).then(renderCadastros);
        }
      });
    });
  }

  function vazio(cols, msg) {
    return '<tr><td colspan="' + cols + '" class="empty">' + msg + '</td></tr>';
  }

  document.querySelectorAll('[data-cad]').forEach(function (c) {
    c.addEventListener('click', function () {
      var t = c.dataset.cad;
      if (t === 'usuarios') {
        if (!pode('usuarios')) { toast('Acesso restrito ao administrador.', true); return; }
        window.location.href = 'usuarios.html';
        return;
      }
      if (t === 'aptos') {
        if (!pode('cadastros')) { toast('Seu perfil não pode alterar cadastros.', true); return; }
        modalApto(null);
        return;
      }
      if (!pode('cadastros')) { toast('Seu perfil não pode alterar cadastros.', true); return; }
      mostrarView(t === 'passantes' ? 'passantes' : 'cadastros');
    });
  });

  function modalApto(a) {
    var novo = !a;
    a = a || { numero: '', tipo: 'Standard', capacidade: 2, diaria: 0, caracteristicas: '', observacoes: '', ativo: true };
    abrirModal(
      '<h3>' + (novo ? 'Novo apartamento' : 'Editar APT ' + esc(a.numero)) + '</h3>' +
      '<div class="row2"><div class="field"><label>NÃºmero</label><input id="apNum" value="' + esc(a.numero) + '" /></div>' +
      '<div class="field"><label>Tipo</label><input id="apTipo" value="' + esc(a.tipo) + '" /></div></div>' +
      '<div class="row2"><div class="field"><label>Capacidade</label><input id="apCap" type="number" min="1" value="' + esc(a.capacidade) + '" /></div>' +
      '<div class="field"><label>DiÃ¡ria (R$)</label><input id="apDiaria" type="number" step="0.01" value="' + esc(a.diaria) + '" /></div></div>' +
      '<div class="field"><label>CaracterÃ­sticas</label><input id="apCarac" value="' + esc(a.caracteristicas) + '" placeholder="ex.: ar-condicionado, TV" /></div>' +
      '<div class="field"><label>ObservaÃ§Ãµes</label><textarea id="apObs">' + esc(a.observacoes) + '</textarea></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">' + (novo ? 'Cadastrar' : 'Salvar') + '</button></div>'
    );
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var dados = {
        empresaId: EMPRESA, numero: $('apNum').value.trim(), tipo: $('apTipo').value.trim() || 'Standard',
        capacidade: Number($('apCap').value) || 1, diaria: Number($('apDiaria').value) || 0,
        caracteristicas: $('apCarac').value, observacoes: $('apObs').value
      };
      if (!dados.numero) { toast('Informe o nÃºmero do apartamento.', true); return; }
      var p = novo ? DB.criarApto(dados) : DB.atualizarApto(a.id, dados);
      p.then(function () {
        fecharModal();
        toast(novo ? 'Apartamento cadastrado e exibido na tela inicial.' : 'Apartamento atualizado.');
        return carregarTudo();
      }).then(function () {
        if ($('view-cadastros').classList.contains('active')) renderCadastros();
      }).catch(function (e) { toast('Erro: ' + e.message, true); });
    });
  }

  $('btnNovoAptoCad').addEventListener('click', function () { modalApto(null); });

  $('btnNovoHospede').addEventListener('click', function () {
    abrirModal(
      '<h3>Novo hÃ³spede</h3>' +
      '<div class="field"><label>Nome</label><input id="hNome" /></div>' +
      '<div class="row2"><div class="field"><label>Telefone</label><input id="hTel" /></div>' +
      '<div class="field"><label>Documento</label><input id="hDoc" /></div></div>' +
      '<div class="field"><label>E-mail</label><input id="hEmail" type="email" /></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">Cadastrar</button></div>'
    );
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var nome = $('hNome').value.trim();
      if (!nome) { toast('Informe o nome.', true); return; }
      DB.criarHospede({ empresaId: EMPRESA, nome: nome, telefone: $('hTel').value, documento: $('hDoc').value, email: $('hEmail').value })
        .then(function () { fecharModal(); toast('HÃ³spede cadastrado.'); return carregarTudo(); })
        .then(renderCadastros)
        .catch(function (e) { toast('Erro: ' + e.message, true); });
    });
  });

  /* ================= MESAS / RESTAURANTE ================= */

  var STATUS_MESA = {
    livre: 'Livre', ocupada: 'Ocupada', aguardando: 'Aguardando conta',
    suja: 'Suja', reservada: 'Reservada'
  };
  var CLASSE_MESA = {
    livre: 'livre', ocupada: 'hospedado', aguardando: 'aguardando',
    suja: 'suja', reservada: 'reservada'
  };
  var filtroMesaStatus = null;
  var mesaAtual = null; // mesa aberta na comanda
  function renderMesas() {
    var g = $('mesaGrid');
    if (!ctx.mesas.length) {
      g.innerHTML = '<div class="empty" style="grid-column:1/-1">Nenhuma mesa cadastrada. Use "+ Nova mesa".</div>';
      return;
    }

    var list = ctx.mesas.filter(function (m) { return !filtroMesaStatus || m.status === filtroMesaStatus; });

    if (!list.length) {
      g.innerHTML = '<div class="empty" style="grid-column:1/-1">Nenhuma mesa neste status.</div>';
      return;
    }

    g.innerHTML = list.map(function (m) {
      var cls = CLASSE_MESA[m.status] || 'livre';
      var com = ctx.comandasPorMesa[m.id];
      return '<button class="apt s-' + cls + (m.ativo === false ? ' inativo' : '') + '" data-mesa="' + m.id + '">' +
        '<div class="top"></div><div class="body">' +
        '<div class="num">' + esc(m.nome || ('Mesa ' + m.numero)) + '</div>' +
        '<div class="tipo">' + esc(m.lugares) + ' lugares' + (m.setor ? ' Â· ' + esc(m.setor) : '') + '</div>' +
        '<div class="kinfo">' +
          '<span class="diaria">' + (com ? 'Comanda ' + esc(com.numero) : '') + '</span>' +
          '<span class="st">' + esc(STATUS_MESA[m.status] || m.status) + '</span>' +
        '</div>' +
        (com ? '<div class="mtop"><span>' + esc(com.pessoas) + ' pessoas</span><b>' + brl(com.total) + '</b></div>' : '') +
      '</button>';
    }).join('');

    g.querySelectorAll('[data-mesa]').forEach(function (el) {
      el.addEventListener('click', function () { abrirMesaFlow(Number(el.dataset.mesa)); });
    });
  }

  // Legenda clicÃ¡vel filtra por status.
  document.querySelectorAll('.mesa-legend span').forEach(function (sp) {
    sp.addEventListener('click', function () {
      var f = sp.dataset.f;
      if (filtroMesaStatus === f) { filtroMesaStatus = null; sp.classList.remove('on'); }
      else {
        filtroMesaStatus = f;
        document.querySelectorAll('.mesa-legend span').forEach(function (x) { x.classList.remove('on'); });
        sp.classList.add('on');
      }
      renderMesas();
    });
  });

  // Fluxo ao clicar na mesa, conforme o status.
  function abrirMesaFlow(mesaId) {
    var m = ctx.mesas.filter(function (x) { return x.id === mesaId; })[0];
    if (!m) return;
    var com = ctx.comandasPorMesa[mesaId];

    if (com) return abrirComanda(m, com);

    if (m.status === 'suja') {
      abrirModal('<h3>' + esc(m.nome) + '</h3><p class="muted">Mesa aguardando limpeza.</p>' +
        '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="mLimpar">Marcar como livre</button></div>');
      $('mCancel').addEventListener('click', fecharModal);
      $('mLimpar').addEventListener('click', function () {
        DB.atualizarMesa(mesaId, { status: 'livre' }).then(function () {
          fecharModal(); toast('Mesa liberada.'); return carregarTudo();
        }).then(renderMesas);
      });
      return;
    }

    modalAbrirMesa(m);
  }

  function modalAbrirMesa(m) {
    abrirModal(
      '<h3>Abrir ' + esc(m.nome || ('Mesa ' + m.numero)) + '</h3>' +
      '<div class="row2"><div class="field"><label>Quantidade de pessoas</label><input id="abPessoas" type="number" min="1" value="2" /></div>' +
      '<div class="field"><label>ResponsÃ¡vel / garÃ§om</label><input id="abGarcom" value="' + esc(sessao.nome || '') + '" /></div></div>' +
      '<div class="field"><label>ObservaÃ§Ãµes</label><textarea id="abObs"></textarea></div>' +
      '<p class="muted">A abertura cria uma comanda digital e marca a mesa como <b>Ocupada</b>.</p>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Abrir mesa</button></div>'
    );
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      DB.abrirMesa({
        empresaId: EMPRESA, mesaId: m.id,
        pessoas: Number($('abPessoas').value) || 1,
        garcom: $('abGarcom').value.trim(), garcomId: sessao.id || null,
        observacoes: $('abObs').value
      }).then(function () {
        fecharModal(); toast('Mesa aberta. Comanda criada.');
        return carregarTudo();
      }).then(function () {
        var c = ctx.comandasPorMesa[m.id];
        if (c) abrirComanda(ctx.mesas.filter(function (x) { return x.id === m.id; })[0], c);
      }).catch(function (e) { toast('Erro ao abrir mesa: ' + e.message, true); });
    });
  }

  /* ---------- Comanda digital ---------- */
  function abrirComanda(mesa, comanda) {
    mesaAtual = mesa;
    $('comBadge').textContent = String(mesa.numero);
    $('comTitulo').textContent = mesa.nome || ('Mesa ' + mesa.numero);
    $('comSub').innerHTML = 'Comanda <b>#' + esc(comanda.numero) + '</b> Â· ' + esc(comanda.pessoas) + ' pessoas' +
      (comanda.garcom ? ' Â· ' + esc(comanda.garcom) : '');

    DB.listarItensComanda(comanda.id).then(function (itens) {
      var ativos = itens.filter(function (i) { return i.status !== 'cancelado'; });
      var cancelados = itens.filter(function (i) { return i.status === 'cancelado'; });

      var atras = function (i) {
        return '<div class="com-item' + (i.status === 'cancelado' ? ' canc' : '') + '" data-item="' + i.id + '">' +
          '<span class="q">' + esc(i.quantidade) + 'x</span>' +
          '<span class="nm">' + esc(i.nome) + '<small>' + dataHora(i.em) + (i.usuario ? ' Â· ' + esc(i.usuario) : '') +
            (i.observacao ? ' Â· ' + esc(i.observacao) : '') +
            (i.status === 'cancelado' ? ' Â· cancelado' : '') + '</small></span>' +
          '<span class="vl">' + brl(i.valor) + '</span>' +
          (i.status === 'cancelado' ? '' :
            '<span class="acts">' +
              '<button data-mais="' + i.id + '" title="+1">+</button>' +
              '<button data-menos="' + i.id + '" title="-1">âˆ’</button>' +
              '<button class="del" data-canc="' + i.id + '" title="Cancelar item">Ã—</button>' +
            '</span>') +
        '</div>';
      };

      var html = '';
      html += '<div class="dsec"><h3>Produtos na comanda</h3>';
      html += ativos.length
        ? ativos.map(atras).join('')
        : '<div class="muted">Nenhum produto lanÃ§ado ainda.</div>';
      if (cancelados.length) {
        html += '<div class="muted" style="margin-top:10px">Itens cancelados (' + cancelados.length + ')</div>' + cancelados.map(atras).join('');
      }
      html += '</div>';

      html += '<div class="dsec"><h3>Total</h3><div class="com-tot">' +
        '<div class="l"><span>Subtotal</span><b>' + brl(comanda.subtotal) + '</b></div>' +
        '<div class="l"><span>Desconto</span><b>' + brl(comanda.desconto) + '</b></div>' +
        '<div class="l"><span>Taxas</span><b>' + brl(comanda.taxas) + '</b></div>' +
        '<div class="tt"><span>Total da comanda</span><span>' + brl(comanda.total) + '</span></div>' +
      '</div></div>';

      if (comanda.pagamentos && comanda.pagamentos.length) {
        var pago = comanda.pagamentos.reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
        html += '<div class="dsec"><h3>Pagamentos</h3><div class="com-tot">' +
          comanda.pagamentos.map(function (p) {
            return '<div class="l"><span>' + esc(p.forma) + ' Â· ' + dataHora(p.em) + '</span><b>' + brl(p.valor) + '</b></div>';
          }).join('') +
          '<div class="l"><span>Restante</span><b>' + brl(Math.max(0, comanda.total - pago)) + '</b></div>' +
        '</div></div>';
      }

      html += '<div class="dsec"><h3>HistÃ³rico da mesa</h3><div id="comHist"><span class="muted">Carregandoâ€¦</span></div></div>';

      $('comBody').innerHTML = html;

      // AÃ§Ãµes dos itens
      $('comBody').querySelectorAll('[data-mais]').forEach(function (b) {
        b.addEventListener('click', function () { mudarQtd(Number(b.dataset.mais), 1, comanda); });
      });
      $('comBody').querySelectorAll('[data-menos]').forEach(function (b) {
        b.addEventListener('click', function () { mudarQtd(Number(b.dataset.menos), -1, comanda); });
      });
      $('comBody').querySelectorAll('[data-canc]').forEach(function (b) {
        b.addEventListener('click', function () { cancelarItem(Number(b.dataset.canc), comanda); });
      });

      // RodapÃ© de aÃ§Ãµes
      $('comFoot').innerHTML =
        '<button class="btn btn-primary" id="comAdd">+ LanÃ§ar produto</button>' +
        '<button class="btn btn-ghost-m" id="comConta">Solicitar conta</button>' +
        '<button class="btn btn-ok" id="comFecharConta">Fechar conta</button>';
      $('comAdd').addEventListener('click', function () { modalLancarProduto(comanda, mesa); });
      $('comConta').addEventListener('click', function () {
        DB.solicitarConta(mesa.id, comanda.id).then(function () {
          toast('Conta solicitada para ' + (mesa.nome || 'mesa') + '.');
          return carregarTudo();
        });
      });
      $('comFecharConta').addEventListener('click', function () { modalFecharConta(mesa, comanda); });

      renderHistoricoMesa(mesa.id);
      $('comDrawer').classList.add('show');
      $('comBg').classList.add('show');
    });
  }

  function mudarQtd(itemId, delta, comanda) {
    DB.listarItensComanda(comanda.id).then(function (itens) {
      var it = itens.filter(function (x) { return x.id === itemId; })[0];
      if (!it) return;
      var nova = Math.max(1, Number(it.quantidade) + delta);
      DB.atualizarItemComanda(itemId, { quantidade: nova }).then(function () {
        return carregarTudo();
      }).then(function () { abrirComanda(mesaAtual, ctx.comandasPorMesa[mesaAtual.id] || comanda); });
    });
  }

  function cancelarItem(itemId, comanda) {
    DB.listarItensComanda(comanda.id).then(function (itens) {
      var it = itens.filter(function (x) { return x.id === itemId; })[0];
      if (!it) return;
      abrirModal('<h3>Cancelar item</h3>' +
        '<p class="muted">' + esc(it.nome) + ' â€” ' + brl(it.valor) + '</p>' +
        '<div class="field"><label>Motivo do cancelamento *</label><input id="cMotivo" placeholder="ex.: pedido errado" /></div>' +
        '<p class="muted">O cancelamento ser registrado na auditoria com o seu usuÃ¡rio.</p>' +
        '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Voltar</button>' +
        '<button class="btn btn-danger" id="mOk">Confirmar cancelamento</button></div>');
      $('mCancel').addEventListener('click', fecharModal);
      $('mOk').addEventListener('click', function () {
        var motivo = $('cMotivo').value.trim();
        if (!motivo) { toast('Informe o motivo do cancelamento.', true); return; }
        DB.cancelarItemComanda(itemId, sessao.nome || sessao.usuario, motivo).then(function () {
          fecharModal(); toast('Item cancelado.');
          return carregarTudo();
        }).then(function () { abrirComanda(mesaAtual, ctx.comandasPorMesa[mesaAtual.id] || comanda); })
          .catch(function (e) { toast('Erro: ' + e.message, true); });
      });
    });
  }

  function fecharComandaDrawer() {
    $('comDrawer').classList.remove('show');
    $('comBg').classList.remove('show');
    mesaAtual = null;
  }
  $('comFechar').addEventListener('click', fecharComandaDrawer);
  $('comBg').addEventListener('click', fecharComandaDrawer);

  // HistÃ³rico de comandas da mesa (dentro do drawer)
  function renderHistoricoMesa(mesaId) {
    DB.historicoDaMesa(mesaId).then(function (arr) {
      var el = $('comHist');
      if (!el) return;
      if (!arr.length) { el.innerHTML = '<span class="muted">Sem histÃ³rico.</span>'; return; }
      el.innerHTML = arr.map(function (c) {
        return '<div class="hist-item"><div class="hh"><span>Comanda #' + esc(c.numero) + '</span>' +
          '<span>' + brl(c.total) + '</span></div>' +
          '<div class="hd">Aberta: ' + dataHora(c.abertaEm) + (c.fechadaEm ? ' Â· Fechada: ' + dataHora(c.fechadaEm) : '') +
          '<br />GarÃ§om: ' + esc(c.garcom || 'â€”') + ' Â· ' + esc(c.pessoas) + ' pessoas Â· ' + esc(c.status) +
          (c.pagamentos && c.pagamentos.length ? '<br />Pagamento: ' + c.pagamentos.map(function (p) { return esc(p.forma) + ' - ' + brl(p.valor); }).join(' / ') : '') +
          '</div>' +
          /* REIMPRIMIR: enfileira de novo o cupom desta comanda. Fica no
           * histórico da mesa para o operador poder tirar uma 2ª via sem
           * reabrir a conta. A permissão é conferida aqui E no servidor. */
          (pode('fecharConta')
            ? '<div class="hist-acts"><button data-reimprimir="' + c.id + '" data-numero="' + esc(c.numero) + '">Reimprimir conta</button></div>'
            : '') +
          '</div>';
      }).join('');

      el.querySelectorAll('[data-reimprimir]').forEach(function (b) {
        b.addEventListener('click', function () {
          reimprimirConta(Number(b.dataset.reimprimir), b.dataset.numero);
        });
      });
    });
  }

  /* Reimpressão da conta de uma comanda (2ª via). Registra usuário e data
   * no histórico de impressão do servidor. Não encerra nada. */
  function reimprimirConta(comandaId, numero) {
    if (!pode('fecharConta')) { toast('Seu perfil não pode reimprimir contas.', true); return; }

    var svc = window.PrintService;
    var enviar = function (modo) {
      return DB.imprimirConta(EMPRESA, comandaId, { largura: '80mm' }).then(function (r) {
        if (!svc) { toast('Impressão enviada para a fila (#' + (r && r.id) + ').'); return; }
        return svc.processarFila(EMPRESA, { limite: 5 }).then(function (res) {
          if (res && res.impressos > 0) toast('2ª via da comanda #' + numero + ' impressa.');
          else if (res && res.indisponivel) toast('Serviço de impressão local indisponível.', true);
          else toast('2ª via enviada para a fila de impressão.');
        });
      });
    };

    if (svc) {
      svc.verificar(true).then(function (st) {
        if (!st.ok) {
          toast('Serviço de impressão local não encontrado.', true);
          return null;
        }
        return enviar();
      }).catch(function (e) { toast('Erro ao reimprimir: ' + e.message, true); });
    } else {
      enviar().catch(function (e) { toast('Erro ao reimprimir: ' + e.message, true); });
    }
  }

  /* ---------- Lançar produto na comanda (GRADE VISUAL DE CARDS) ----------
   * Os produtos vêm de DB.cardapioPdv(), que devolve foto, categoria e
   * disponibilidade já calculada pelo motor de estoque. A lista textual
   * antiga foi SUBSTITUÍDA (não existe uma segunda tela de venda). */
  function modalLancarProduto(comanda, mesa) {
    if (!pode('lancarProduto')) {
      toast('Seu perfil não pode lançar produtos.', true);
      return;
    }
    DB.cardapioPdv(EMPRESA, {}).then(function (cardapio) {
      var produtos = (cardapio && cardapio.produtos) || [];
      var categorias = (cardapio && cardapio.categorias) || ['TODOS'];
      var carrinho = [];
      var categoriaAtual = 'TODOS';
      var buscaAtual = '';

      function totalCarrinho() {
        return carrinho.reduce(function (s, c) { return s + c.qtd * c.preco; }, 0);
      }

      function renderCarrinho() {
        var el = $('carrinho');
        if (!el) return;
        if (!carrinho.length) { el.innerHTML = '<div class="muted">Nenhum item selecionado. Toque nos cards acima.</div>'; return; }
        el.innerHTML = carrinho.map(function (c, i) {
          return '<div class="ci"><span>' + c.qtd + 'x ' + esc(c.nome) + '</span>' +
            '<span class="ci-act"><b>' + brl(c.qtd * c.preco) + '</b>' +
            '<button data-mais="' + i + '" title="+1">+</button>' +
            '<button data-menos="' + i + '" title="-1">−</button></span></div>';
        }).join('') + '<div class="ct"><span>Total do lançamento</span><span>' + brl(totalCarrinho()) + '</span></div>';

        el.querySelectorAll('[data-mais]').forEach(function (b) {
          b.addEventListener('click', function () { carrinho[Number(b.dataset.mais)].qtd++; renderCarrinho(); });
        });
        el.querySelectorAll('[data-menos]').forEach(function (b) {
          b.addEventListener('click', function () {
            var i = Number(b.dataset.menos);
            carrinho[i].qtd--;
            if (carrinho[i].qtd <= 0) carrinho.splice(i, 1);
            renderCarrinho();
          });
        });
      }

      /* Um card. Produto indisponível NÃO entra na venda quando a
       * configuração da empresa bloqueia venda sem estoque — a decisão
       * vem pronta do servidor (`disponivel`), sem regra duplicada aqui. */
      function cardHtml(p) {
        var foto = p.imagemThumb || p.imagem;
        return '<button class="pdcard' + (p.disponivel ? '' : ' indisponivel') + '" data-prod="' + p.id + '"' +
          (p.disponivel ? '' : ' data-bloqueado="1"') + '>' +
          '<span class="pdcard-foto">' + (foto
            ? '<img src="' + esc(foto) + '" alt="' + esc(p.nome) + '" loading="lazy" decoding="async" />'
            : '<span class="sfoto">SEM FOTO</span>') +
            (p.disponivel ? '' : '<span class="pdcard-ind">INDISPONÍVEL</span>') +
          '</span>' +
          '<span class="pdcard-info">' +
            '<span class="pdcard-nome">' + esc(p.nome) + '</span>' +
            '<span class="pdcard-cat">' + esc(p.categoria || '') + '</span>' +
            '<span class="pdcard-preco">' + brl(p.preco) + '</span>' +
          '</span>' +
        '</button>';
      }

      function renderProdutos() {
        var f = buscaAtual.trim().toLowerCase();
        var list = produtos.filter(function (p) {
          if (categoriaAtual !== 'TODOS') {
            var c = String(p.categoria || '').toLowerCase();
            var s = String(p.subcategoria || '').toLowerCase();
            if (c !== categoriaAtual.toLowerCase() && s !== categoriaAtual.toLowerCase()) return false;
          }
          if (!f) return true;
          // Pesquisa por nome, código interno e código de barras/EAN.
          return [p.nome, p.codigoInterno, p.codigoBarras, p.ean]
            .some(function (v) { return String(v == null ? '' : v).toLowerCase().indexOf(f) !== -1; });
        });

        var el = $('prodList');
        el.innerHTML = list.length
          ? list.map(cardHtml).join('')
          : '<div class="muted" style="padding:22px;text-align:center">Nenhum produto encontrado.</div>';

        el.querySelectorAll('[data-prod]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = produtos.filter(function (x) { return x.id === Number(b.dataset.prod); })[0];
            if (!p) return;
            if (!p.disponivel) {
              toast((p.motivoIndisponivel || 'Produto indisponível.') + ' Venda bloqueada pela configuração de estoque.', true);
              return;
            }
            var jaTem = carrinho.filter(function (c) { return c.produtoId === p.id; })[0];
            if (jaTem) jaTem.qtd++;
            else carrinho.push({ produtoId: p.id, nome: p.nome, categoria: p.categoria, preco: p.preco, qtd: 1 });
            // Feedback visual imediato no próprio card.
            b.classList.add('add');
            setTimeout(function () { b.classList.remove('add'); }, 220);
            renderCarrinho();
          });
        });
      }

      function renderCategorias() {
        $('pdvCats').innerHTML = categorias.map(function (c) {
          return '<button data-cat="' + esc(c) + '" class="' + (c === categoriaAtual ? 'on' : '') + '">' + esc(c) + '</button>';
        }).join('');
        $('pdvCats').querySelectorAll('[data-cat]').forEach(function (b) {
          b.addEventListener('click', function () {
            categoriaAtual = b.dataset.cat;
            renderCategorias();
            renderProdutos();
          });
        });
      }

      abrirModal(
        '<h3>Lançar produto — ' + esc(mesa.nome || ('Mesa ' + mesa.numero)) + '</h3>' +
        '<div class="pdv-busca"><input id="prodBusca" placeholder="Pesquisar por nome, código ou código de barras…" autocomplete="off" /></div>' +
        '<div class="pdv-cats" id="pdvCats"></div>' +
        '<div class="pdv-grid" id="prodList"></div>' +
        '<div class="carrinho" id="carrinho"></div>' +
        '<div class="field" style="margin-top:12px"><label>Observação (opcional)</label><input id="prodObs" /></div>' +
        '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="mOk">Adicionar à comanda</button></div>',
        'wide'
      );

      renderCategorias();
      renderProdutos();
      renderCarrinho();
      $('prodBusca').addEventListener('input', function () { buscaAtual = $('prodBusca').value; renderProdutos(); });
      $('mCancel').addEventListener('click', fecharModal);

      /* IDEMPOTÊNCIA: o botão é desabilitado no primeiro clique e o texto
       * vira PROCESSANDO…, impedindo duplo clique gerar item duplicado. */
      $('mOk').addEventListener('click', function () {
        if (!carrinho.length) { toast('Selecione ao menos um produto.', true); return; }
        var btn = $('mOk');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = 'PROCESSANDO…';

        var obs = $('prodObs').value;
        var seq = Promise.resolve();
        carrinho.forEach(function (c) {
          seq = seq.then(function () {
            return DB.adicionarItemComanda({
              empresaId: EMPRESA, comandaId: comanda.id, produtoId: c.produtoId,
              nome: c.nome, categoria: c.categoria, quantidade: c.qtd, preco: c.preco,
              observacao: obs, usuario: sessao.nome || sessao.usuario
            });
          });
        });
        seq.then(function () {
          fecharModal(); toast('Produtos lançados na comanda.');
          return carregarTudo();
        }).then(function () { abrirComanda(mesa, ctx.comandasPorMesa[mesa.id] || comanda); })
          .catch(function (e) {
            btn.disabled = false;
            btn.textContent = 'Adicionar à comanda';
            toast('Erro ao lançar: ' + e.message, true);
          });
      });
    }).catch(function (e) {
      toast('Erro ao carregar o cardápio: ' + e.message, true);
    });
  }

  /* ---------- FECHAMENTO DE CONTA (com cupom visual) ----------
   *
   * NÃO fecha a conta direto. Abre a janela profissional de fechamento
   * com o CUPOM VISUAL gerado a partir dos dados reais da venda
   * (ReceiptPreview) e as ações:
   *   IMPRIMIR CONTA · IMPRIMIR PARCIAL · RECEBER CONTA · CANCELAR
   *
   * Imprimir parcial NÃO encerra a mesa. O estoque só é baixado no
   * fechamento definitivo, pela regra que JÁ existe (op.fecharComanda). */
  function modalFecharConta(mesa, comanda) {
    if (!pode('fecharConta')) {
      toast('Seu perfil não pode fechar conta.', true);
      return;
    }

    var jaRecebendo = false;   // trava de duplo clique no recebimento

    function desenhar() {
      DB.cupomDaComanda(EMPRESA, comanda.id, { parcial: false }).then(function (cupom) {
        abrirModal(
          '<h3>Fechamento da conta</h3>' +
          '<div class="fc-wrap">' +
            '<div class="fc-lado">' +
              '<div class="fc-info">' +
                '<div class="l"><span>Mesa</span><b>' + esc(mesa.numero != null ? mesa.numero : (mesa.nome || '—')) + '</b></div>' +
                '<div class="l"><span>Comanda</span><b>#' + esc(cupom.comanda.numero) + '</b></div>' +
                '<div class="l"><span>Pessoas</span><b>' + esc(cupom.comanda.pessoas) + '</b></div>' +
                '<div class="l"><span>Garçom</span><b>' + esc(cupom.comanda.garcom || '—') + '</b></div>' +
                '<div class="tt"><span>Total</span><span>' + brl(cupom.total) + '</span></div>' +
              '</div>' +
              '<div class="fc-acoes">' +
                '<button class="btn btn-ghost-m" id="fcParcial">IMPRIMIR PARCIAL</button>' +
                '<button class="btn btn-ghost-m" id="fcImprimir">IMPRIMIR CONTA</button>' +
                '<button class="btn btn-ok" id="fcReceber">RECEBER CONTA</button>' +
                '<button class="btn btn-ghost-m" id="fcCancel">CANCELAR</button>' +
              '</div>' +
              '<div class="hint" style="margin-top:10px">A mesa continua aberta até a confirmação do pagamento. ' +
              'Imprimir a parcial não encerra a conta nem baixa estoque.</div>' +
            '</div>' +
            '<div class="fc-cupom">' + cupomHtml(cupom) + '</div>' +
          '</div>',
          'wide'
        );

        $('fcCancel').addEventListener('click', fecharModal);
        /* IMPRIMIR CONTA / PARCIAL
         * Caminho preferido: Print Service local (impressão silenciosa, na
         * impressora configurada para a função CONTAS). Se o serviço não
         * estiver instalado, cai para window.print() — o sistema nunca
         * deixa o operador sem imprimir (regra 27/28).
         * Nenhum dos dois encerra a mesa: só o pagamento confirmado faz isso. */
        $('fcImprimir').addEventListener('click', function () {
          imprimirViaServicoOuNavegador(comanda.id, false, cupom, '80mm');
        });
        $('fcParcial').addEventListener('click', function () {
          DB.cupomDaComanda(EMPRESA, comanda.id, { parcial: true }).then(function (parcial) {
            imprimirViaServicoOuNavegador(comanda.id, true, parcial, '80mm');
          }).catch(function (e) { toast('Erro ao gerar a parcial: ' + e.message, true); });
        });

        $('fcReceber').addEventListener('click', function () {
          var btn = $('fcReceber');
          if (jaRecebendo) return;          // IDEMPOTÊNCIA: duplo clique ignorado
          jaRecebendo = true;
          btn.disabled = true;
          btn.textContent = 'PROCESSANDO…';
          receberConta(mesa, comanda, cupom, function () { jaRecebendo = false; btn.disabled = false; btn.textContent = 'RECEBER CONTA'; });
        });
      }).catch(function (e) {
        toast('Erro ao montar a conta: ' + e.message, true);
      });
    }

    desenhar();
  }

  /* Recebimento: reutiliza o fluxo de caixa que JÁ existe
   * (pagarComanda + fecharComanda). Não cria um segundo caixa. */
  function receberConta(mesa, comanda, cupom, onFalha) {
    modalFormaPagamento(cupom.total, function (forma, valor, acrescimo) {
      // Confirmação final antes de fechar (nunca fecha sem confirmar).
      var btnOk = $('mOk');
      if (btnOk && btnOk.disabled) return;
      if (btnOk) { btnOk.disabled = true; btnOk.textContent = 'PROCESSANDO…'; }

      DB.pagarComanda(comanda.id, { forma: forma, valor: valor, usuario: sessao.nome || sessao.usuario })
        .then(function () {
          return DB.fecharComanda(comanda.id, {
            usuario: sessao.nome || sessao.usuario,
            divisao: { modo: 'total', pessoas: Number(comanda.pessoas) || 1, valorRecebido: valor, acrescimo: acrescimo || 0 },
            deixarSuja: true
          });
        })
        .then(function () {
          fecharModal();
          toast('Conta recebida. Mesa liberada para limpeza.');
          return carregarTudo();
        })
        .then(function () {
          fecharComandaDrawer();
          renderMesas();
        })
        .catch(function (e) {
          toast('Erro ao fechar: ' + e.message, true);
          if (onFalha) onFalha();
        });
    });
  }

  /* ================================================================== */
  /* CUPOM VISUAL (ReceiptPreview)                                      */
  /* Gerado SEMPRE a partir dos dados reais da venda.                   */
  /* ================================================================== */

  function cupomHtml(c) {
    var e = c.empresa || {};
    var largura = '80mm';
    var linhas = c.itens.map(function (i) {
      return '<div class="cup-item">' +
        '<div class="cup-nome">' + esc(i.nome) + (i.observacao ? ' <small>(' + esc(i.observacao) + ')</small>' : '') + '</div>' +
        '<div class="cup-calc"><span>' + fmtQtd(i.quantidade) + ' x ' + brl(i.precoUnitario) + '</span><b>' + brl(i.valor) + '</b></div>' +
      '</div>';
    }).join('');

    return '<div class="cupom" data-largura="' + largura + '">' +
      '<div class="cup-logo">' + (e.logo ? '<img src="' + esc(e.logo) + '" alt="" />' : '<span class="cup-logo-ph">' + esc((e.nomeFantasia || 'LOGO').charAt(0)) + '</span>') + '</div>' +
      '<div class="cup-emp">' +
        '<b>' + esc(e.nomeFantasia || '') + '</b>' +
        (e.razaoSocial && e.razaoSocial !== e.nomeFantasia ? '<span>' + esc(e.razaoSocial) + '</span>' : '') +
        (e.cnpj ? '<span>CNPJ: ' + esc(e.cnpj) + '</span>' : '') +
        (e.endereco ? '<span>' + esc(e.endereco) + '</span>' : '') +
        (e.telefone ? '<span>Tel: ' + esc(e.telefone) + '</span>' : '') +
      '</div>' +
      '<div class="cup-sep"></div>' +
      '<div class="cup-meta">' +
        '<div><span>' + (c.tipo === 'PARCIAL' ? 'CONTA PARCIAL' : 'MESA / COMANDA') + '</span><b>' + esc(c.mesa ? (c.mesa.numero || c.mesa.nome) : (c.apartamento || '')) + '</b></div>' +
        '<div><span>NÚMERO</span><b>#' + esc(c.comanda.numero) + '</b></div>' +
        '<div><span>DATA / HORA</span><b>' + esc(c.dataHora) + '</b></div>' +
        '<div><span>GARÇOM</span><b>' + esc(c.comanda.garcom || '—') + '</b></div>' +
      '<div class="cup-sep"></div>' +
      '<div class="cup-itens">' + linhas + '</div>' +
      '<div class="cup-sep"></div>' +
      '<div class="cup-tot">' +
        '<div><span>SUBTOTAL</span><b>' + brl(c.subtotal) + '</b></div>' +
        '<div><span>DESCONTO</span><b>' + brl(c.desconto) + '</b></div>' +
        (c.taxas ? '<div><span>TAXAS</span><b>' + brl(c.taxas) + '</b></div>' : '') +
        '<div class="cup-tt"><span>TOTAL</span><span>' + brl(c.total) + '</span></div>' +
      '</div>' +
      (c.pagamentos.length
        ? '<div class="cup-sep"></div><div class="cup-pg">' + c.pagamentos.map(function (p) {
            return '<div><span>' + esc(p.forma) + '</span><b>' + brl(p.valor) + '</b></div>';
          }).join('') + '</div>'
        : '') +
      (c.ehParcial ? '<div class="cup-aviso">' + esc(c.aviso) + '</div>' : '') +
      '<div class="cup-sep"></div>' +
      '<div class="cup-rodape">' + esc(c.rodape || 'Obrigado pela preferência!') + '</div>' +
    '</div>';
  }

  function fmtQtd(q) {
    var n = Number(q) || 0;
    return (Math.abs(n - Math.round(n)) < 0.0001) ? String(Math.round(n)) : n.toFixed(3).replace(/0+$/, '');
  }

  /* Impressão por CUPOM TÉRMICO.
   * O conteúdo do cupom é movido para uma área exclusiva (#cupomPrint) e o
   * CSS @media print esconde todo o resto da interface — só o cupom sai na
   * impressora. A largura (58mm/80mm) é aplicada na própria área. */
  function imprimirCupom(cupom, largura) {
    largura = largura || '80mm';
    var area = $('cupomPrint');
    if (!area) { toast('Área de impressão indisponível.', true); return; }
    area.setAttribute('data-largura', largura);
    area.innerHTML = cupomHtml(cupom);
    // Deixa o navegador aplicar o layout antes de abrir a caixa de impressão.
    setTimeout(function () {
      window.print();
    }, 60);
  }

  /* Tenta o PRINT SERVICE LOCAL primeiro (impressão silenciosa na impressora
   * configurada). Sem o serviço, usa window.print() — o operador nunca fica
   * sem imprimir. Em ambos os casos a conta NÃO é encerrada. */
  function imprimirViaServicoOuNavegador(comandaId, parcial, cupom, largura) {
    var svc = window.PrintService;
    if (!svc) { imprimirCupom(cupom, largura); return; }

    svc.verificar(true).then(function (st) {
      if (!st.ok) {
        // Serviço local ausente: impressão pelo navegador, avisando o porquê.
        toast('Serviço de impressão local não encontrado. Abrindo a impressão do navegador…');
        imprimirCupom(cupom, largura);
        return null;
      }
      // Enfileira no servidor (idempotente por comanda+parcial) e manda
      // o Print Service processar a fila.
      return DB.imprimirConta(EMPRESA, comandaId, { parcial: !!parcial, largura: largura })
        .then(function (r) {
          if (r && r.duplicado) {
            toast('Esta impressão já foi enviada. Use Reimprimir se precisar de outra via.');
            return null;
          }
          if (r && r.semImpressora) {
            toast('Nenhuma impressora configurada para contas. Abrindo a impressão do navegador…');
            imprimirCupom(cupom, largura);
            return null;
          }
          return svc.processarFila(EMPRESA, { limite: 5 }).then(function (res) {
            if (res && res.ok && res.impressos > 0) {
              toast(parcial ? 'Parcial impressa. A mesa continua aberta.' : 'Conta enviada para impressão.');
            } else if (res && res.erros > 0) {
              toast('Não foi possível imprimir na impressora. Abrindo a impressão do navegador…', true);
              imprimirCupom(cupom, largura);
            } else {
              toast(parcial ? 'Parcial na fila de impressão.' : 'Conta na fila de impressão.');
            }
          });
        });
    }).catch(function () {
      imprimirCupom(cupom, largura);
    });
  }

  /* ================================================================== */
  /* RECEBIMENTO                                                        */
  /* Reutiliza o caixa que JÁ existe: só coleta os dados e confirma.    */
  /* ================================================================== */

  /* Formas de pagamento: vêm da configuração da empresa quando
   * carregada (posSettingsService), caindo nas padrão. */
  function formasPagamento() {
    var lista = null;
    try {
      if (window.posSettingsService) lista = window.posSettingsService.get('formasPagamento');
    } catch (e) { lista = null; }
    if (!Array.isArray(lista) || !lista.length) lista = ['Dinheiro', 'Pix', 'Débito', 'Crédito', 'Faturado'];
    return lista;
  }

  function modalFormaPagamento(total, onConfirm) {
    abrirModal(
      '<h3>Recebimento</h3>' +
      '<div class="com-tot" style="margin-bottom:14px"><div class="tt"><span>Total da conta</span><span>' + brl(total) + '</span></div></div>' +
      '<div class="row2">' +
        '<div class="field"><label>Forma de pagamento</label><select id="pgForma">' +
          formasPagamento().map(function (f) { return '<option>' + esc(f) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Valor recebido (R$)</label><input id="pgValor" type="number" step="0.01" value="' + total.toFixed(2) + '" /></div>' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label>Desconto (R$)</label><input id="pgDesc" type="number" step="0.01" value="0.00" /></div>' +
        '<div class="field"><label>Acréscimo / taxa (R$)</label><input id="pgAcres" type="number" step="0.01" value="0.00" /></div>' +
      '</div>' +
      '<div class="com-tot" id="pgResumo"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Voltar</button>' +
      '<button class="btn btn-ok" id="mOk">CONFIRMAR RECEBIMENTO</button></div>'
    );

    function calc() {
      var recebido = Number($('pgValor').value) || 0;
      var desc = Number($('pgDesc').value) || 0;
      var acres = Number($('pgAcres').value) || 0;
      var liquido = Math.max(0, Number((total - desc + acres).toFixed(2)));
      var troco = Math.max(0, Number((recebido - liquido).toFixed(2)));
      $('pgResumo').innerHTML =
        '<div class="l"><span>Desconto</span><b>' + brl(desc) + '</b></div>' +
        '<div class="l"><span>Acréscimo</span><b>' + brl(acres) + '</b></div>' +
        '<div class="l"><span>Valor a receber</span><b>' + brl(liquido) + '</b></div>' +
        '<div class="tt"><span>Troco</span><span>' + brl(troco) + '</span></div>';
      return { liquido: liquido, troco: troco, acrescimo: acres };
    }

    ['pgValor', 'pgDesc', 'pgAcres'].forEach(function (id) {
      $(id).addEventListener('input', calc);
    });
    calc();

    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var r = calc();
      if (r.liquido <= 0) { toast('O valor a receber precisa ser maior que zero.', true); return; }
      onConfirm($('pgForma').value, r.liquido, r.acrescimo);
    });
  }

  /* ---------- Cadastro/ediÃ§Ã£o de mesa ---------- */
  function modalMesa(m) {
    var novo = !m;
    m = m || { numero: '', nome: '', lugares: 4, setor: 'SalÃ£o', observacoes: '', ativo: true };
    abrirModal(
      '<h3>' + (novo ? 'Nova mesa' : 'Editar ' + esc(m.nome || ('Mesa ' + m.numero))) + '</h3>' +
      '<div class="row2"><div class="field"><label>NÃºmero</label><input id="msNum" type="number" min="1" value="' + esc(m.numero) + '" /></div>' +
      '<div class="field"><label>Lugares</label><input id="msLug" type="number" min="1" value="' + esc(m.lugares) + '" /></div></div>' +
      '<div class="row2"><div class="field"><label>Nome / identificaÃ§Ã£o</label><input id="msNome" value="' + esc(m.nome || '') + '" /></div>' +
      '<div class="field"><label>Setor / localizaÃ§Ã£o</label><input id="msSetor" value="' + esc(m.setor || 'SalÃ£o') + '" /></div></div>' +
      (novo ? '' : '<div class="field"><label>Status</label><select id="msStatus">' +
        Object.keys(STATUS_MESA).map(function (s) { return '<option value="' + s + '"' + (s === m.status ? ' selected' : '') + '>' + STATUS_MESA[s] + '</option>'; }).join('') +
        '</select></div>') +
      '<div class="field"><label>ObservaÃ§Ãµes</label><textarea id="msObs">' + esc(m.observacoes || '') + '</textarea></div>' +
      '<div class="modal-foot">' +
        (novo ? '' : '<button class="btn btn-danger" id="mDel" style="margin-right:auto">Excluir</button>') +
        '<button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="mOk">' + (novo ? 'Cadastrar' : 'Salvar') + '</button></div>'
    );
    $('mCancel').addEventListener('click', fecharModal);
    if ($('mDel')) $('mDel').addEventListener('click', function () {
      if (!confirm('Excluir ' + (m.nome || 'mesa') + '?')) return;
      DB.removerMesa(m.id).then(function () { fecharModal(); toast('Mesa excluÃ­da.'); return carregarTudo(); }).then(renderMesas);
    });
    $('mOk').addEventListener('click', function () {
      var dados = {
        empresaId: EMPRESA, numero: Number($('msNum').value),
        nome: $('msNome').value.trim(), lugares: Number($('msLug').value) || 2,
        setor: $('msSetor').value.trim() || 'SalÃ£o', observacoes: $('msObs').value
      };
      if (!dados.numero) { toast('Informe o nÃºmero da mesa.', true); return; }
      if (!novo) dados.status = $('msStatus').value;
      var p = novo ? DB.criarMesa(dados) : DB.atualizarMesa(m.id, dados);
      p.then(function () { fecharModal(); toast(novo ? 'Mesa cadastrada.' : 'Mesa atualizada.'); return carregarTudo(); })
        .then(renderMesas)
        .catch(function (e) { toast('Erro: ' + e.message, true); });
    });
  }

  $('btnNovaMesa').addEventListener('click', function () { modalMesa(null); });

  /* ---------- CatÃ¡logo de produtos (administraÃ§Ã£o) ---------- */
  function modalProdutos() {
    DB.listarProdutos(EMPRESA).then(function (produtos) {
      function area() {
        if (!produtos.length) return '<div class="muted">Nenhum produto cadastrado.</div>';
        return produtos.map(function (p) {
          return '<div class="pag-linha"><span style="flex:1;font-size:13.5px"><b>' + esc(p.nome) + '</b><br /><span class="muted">' + esc(p.categoria) + '</span></span>' +
            '<b style="font-size:13.5px">' + brl(p.preco) + '</b>' +
            '<button class="btn btn-sm btn-warn" data-ed="' + p.id + '">Editar</button></div>';
        }).join('');
      }
      abrirModal('<h3>CatÃ¡logo de produtos</h3>' +
        '<p class="muted">Usado no restaurante (mesa) e no consumo do apartamento.</p>' +
        '<div id="prodAdm">' + area() + '</div>' +
        '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Fechar</button>' +
        '<button class="btn btn-primary" id="mNovo">+ Novo produto</button></div>');
      $('mCancel').addEventListener('click', fecharModal);
      $('mNovo').addEventListener('click', function () { modalProduto(null, modalProdutos); });
      $('prodAdm').querySelectorAll('[data-ed]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = produtos.filter(function (x) { return x.id === Number(b.dataset.ed); })[0];
          modalProduto(p, modalProdutos);
        });
      });
    });
  }
  $('btnProdutos').addEventListener('click', modalProdutos);

  function modalProduto(p, onDone) {
    var novo = !p;
    p = p || { nome: '', categoria: 'Pratos', preco: '' };
    abrirModal('<h3>' + (novo ? 'Novo produto' : 'Editar produto') + '</h3>' +
      '<div class="field"><label>Nome</label><input id="pdNome" value="' + esc(p.nome) + '" /></div>' +
      '<div class="row2"><div class="field"><label>Categoria</label><input id="pdCat" value="' + esc(p.categoria) + '" /></div>' +
      '<div class="field"><label>PreÃ§o (R$)</label><input id="pdPreco" type="number" step="0.01" value="' + esc(p.preco) + '" /></div></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">' + (novo ? 'Cadastrar' : 'Salvar') + '</button></div>');
    $('mCancel').addEventListener('click', onDone);
    $('mOk').addEventListener('click', function () {
      var nome = $('pdNome').value.trim();
      if (!nome) { toast('Informe o nome do produto.', true); return; }
      var dados = { empresaId: EMPRESA, nome: nome, categoria: $('pdCat').value.trim() || 'Geral', preco: Number($('pdPreco').value) || 0 };
      var pr = novo ? DB.criarProduto(dados) : DB.atualizarProduto(p.id, dados);
      pr.then(function () { toast(novo ? 'Produto cadastrado.' : 'Produto atualizado.'); onDone(); })
        .catch(function (e) { toast('Erro: ' + e.message, true); });
    });
  }

  /* ---------- Passantes ---------- */
  function renderPassantes() {
    var tb = $('tbPassantes');
    if (!ctx.passantes.length) { tb.innerHTML = vazio(6, 'Nenhum passante registrado.'); return; }
    tb.innerHTML = ctx.passantes.map(function (p) {
      return '<tr><td>' + esc(p.nome) + '</td><td>' + esc(p.telefone || 'â€”') + '</td><td>' + esc(p.origem || 'â€”') + '</td>' +
        '<td>' + dataHora(p.em) + '</td><td><b>' + brl(p.valor) + '</b></td>' +
        '<td><div class="td-actions"><button class="btn btn-sm btn-ghost-m" data-pas="' + p.id + '">Detalhes</button></div></td></tr>';
    }).join('');
    tb.querySelectorAll('[data-pas]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = ctx.passantes.filter(function (x) { return x.id === Number(b.dataset.pas); })[0];
        abrirModal('<h3>' + esc(p.nome) + '</h3>' +
          '<div class="dtxt"><div class="ditem"><div class="k">Telefone</div><div class="v">' + esc(p.telefone || 'â€”') + '</div></div>' +
          '<div class="ditem"><div class="k">Documento</div><div class="v">' + esc(p.documento || 'â€”') + '</div></div>' +
          '<div class="ditem"><div class="k">Origem</div><div class="v">' + esc(p.origem) + '</div></div>' +
          '<div class="ditem"><div class="k">Data</div><div class="v">' + dataHora(p.em) + '</div></div>' +
          '<div class="ditem full"><div class="k">Valor</div><div class="v big">' + brl(p.valor) + '</div></div>' +
          '<div class="ditem full"><div class="k">ObservaÃ§Ãµes</div><div class="v">' + esc(p.observacoes || 'â€”') + '</div></div></div>' +
          '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
        $('mCancel').addEventListener('click', fecharModal);
      });
    });
  }

  $('btnNovoPassante').addEventListener('click', function () {
    abrirModal(
      '<h3>Novo passante</h3>' +
      '<div class="field"><label>Nome</label><input id="pNome" /></div>' +
      '<div class="row2"><div class="field"><label>Telefone</label><input id="pTel" /></div>' +
      '<div class="field"><label>Documento</label><input id="pDoc" /></div></div>' +
      '<div class="row2"><div class="field"><label>Origem</label><input id="pOrigem" value="Restaurante" /></div>' +
      '<div class="field"><label>Valor (R$)</label><input id="pValor" type="number" step="0.01" value="0" /></div></div>' +
      '<div class="field"><label>ObservaÃ§Ãµes</label><textarea id="pObs"></textarea></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button><button class="btn btn-primary" id="mOk">Registrar</button></div>'
    );
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var nome = $('pNome').value.trim();
      if (!nome) { toast('Informe o nome.', true); return; }
      DB.criarPassante({
        empresaId: EMPRESA, nome: nome, telefone: $('pTel').value, documento: $('pDoc').value,
        origem: $('pOrigem').value, valor: Number($('pValor').value) || 0, observacoes: $('pObs').value
      }).then(function () { fecharModal(); toast('Passante registrado.'); return carregarTudo(); })
        .then(renderPassantes).catch(function (e) { toast('Erro: ' + e.message, true); });
    });
  });

  /* ---------- Contadores e tempo real ---------- */
  function atualizarContadores() {
    $('cntAptos').textContent = ctx.aptos.length;
    $('cntReservas').textContent = ctx.reservas.length;
    $('cntMesas').textContent = ctx.mesas.length;
    $('cntPassantes').textContent = ctx.passantes.length;
  }

  $('btnRefresh').addEventListener('click', function () {
    carregarTudo().then(function () {
      toast('Dados atualizados do banco.');
      if ($('view-cadastros').classList.contains('active')) renderCadastros();
      if ($('view-reservas').classList.contains('active')) renderReservas();
      if ($('view-calendario').classList.contains('active')) renderCalendario();
      if ($('view-mesas').classList.contains('active')) renderMesas();
      if ($('view-passantes').classList.contains('active')) renderPassantes();
    }).catch(function (e) { toast('Erro ao atualizar: ' + e.message, true); });
  });

  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) fecharModal(); });

  // Tecla ESC fecha painÃ©is
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { fecharDetalhes(); fecharModal(); }
  });

  /* ================= TEMPO REAL (BroadcastChannel) ================= */
  // Recebe mudanças persistidas por outra aba/dispositivo e recarrega.
  var _rtTimer = null;
  function recarregarTempoReal(msg) {
    // Evita tempestade de recargas: agrupa notificações próximas.
    if (_rtTimer) clearTimeout(_rtTimer);
    _rtTimer = setTimeout(function () {
      carregarTudo().then(function () {
        if ($('view-mesas') && $('view-mesas').classList.contains('active')) renderMesas();
        if ($('view-reservas').classList.contains('active')) renderReservas();
        if ($('view-calendario').classList.contains('active')) renderCalendario();
        if ($('view-passantes').classList.contains('active')) renderPassantes();
        // Se a comanda aberta mudou, atualiza o painel.
        if (mesaAtual && ctx.comandasPorMesa[mesaAtual.id]) {
          abrirComanda(mesaAtual, ctx.comandasPorMesa[mesaAtual.id]);
        }
        if (msg) toast('Atualização recebida: ' + rotuloRt(msg) + '.');
      }).catch(function () {});
    }, 250);
  }

  function rotuloRt(msg) {
    var t = { consumo: 'consumo no apto', comanda: 'comanda', mesa: 'mesa', reserva: 'reserva', produto: 'produto' };
    return (t[msg.entidade] || 'dados') + (msg.acao ? ' (' + msg.acao.replace(/_/g, ' ') + ')' : '');
  }

  DB.aoAtualizar(function (msg) { recarregarTempoReal(msg); });

  /* ================= CONSUMO NO APARTAMENTO ================= */
  // Lista apenas apartamentos COM hospedagem ativa (regra 18).
  function modalConsumoApto() {
    if (!pode('aptoConsumo')) {
      toast('Seu perfil não pode lançar consumo em apartamentos.', true);
      return;
    }
    var ativos = ctx.aptos.filter(function (a) {
      var est = ctx.estados[a.id];
      return est && est.hospedagem;
    });

    if (!ativos.length) {
      abrirModal('<h3>Lançar consumo no APTO</h3>' +
        '<div class="empty">Nenhum apartamento com hospedagem ativa no momento.</div>' +
        '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
      $('mCancel').addEventListener('click', fecharModal);
      return;
    }

    var opts = ativos.map(function (a) {
      var h = ctx.estados[a.id].hospedagem;
      return '<option value="' + a.id + '">APT ' + esc(a.numero) + ' — ' + esc(h.hospedeNome || 'hóspede') + '</option>';
    }).join('');

    abrirModal('<h3>Lançar consumo no apartamento</h3>' +
      '<p class="muted">Somente apartamentos com hóspede hospedado aparecem aqui.</p>' +
      '<div class="field"><label>Apartamento / hóspede</label><select id="caApto">' + opts + '</select></div>' +
      '<div id="caInfo"></div>' +
      '<div class="prod-search" style="margin-top:12px"><input id="caBusca" placeholder="Pesquisar produto ou categoria…" /></div>' +
      '<div class="prod-list" id="caProdList"></div>' +
      '<div class="carrinho" id="caCarrinho"></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Lançar consumo</button></div>');

    var carrinho = [];
    var produtos = ctx.produtos;

    function infoApto() {
      var a = ativos.filter(function (x) { return x.id === Number($('caApto').value); })[0];
      var est = ctx.estados[a.id];
      var h = est.hospedagem;
      var r = h.hospedeId;
      $('caInfo').innerHTML = '<div class="com-tot" style="margin-top:12px">' +
        '<div class="l"><span>Hóspede</span><b>' + esc(h.hospedeNome || '—') + '</b></div>' +
        '<div class="l"><span>Hospedagem</span><b>#' + esc(String(h.id).padStart(6, '0')) + '</b></div>' +
        '<div class="l"><span>Check-in / Check-out</span><b>' + dataCurta(h.checkin) + ' → ' + dataCurta(h.checkoutPrevisto) + '</b></div>' +
        '<div class="l"><span>Consumo já lançado</span><b>' + brl(est.financeiro.totalConsumo) + '</b></div>' +
      '</div>';
      carrinho = [];
      renderCarrinho();
    }

    function renderCarrinho() {
      if (!carrinho.length) { $('caCarrinho').innerHTML = '<div class="muted">Nenhum item selecionado.</div>'; return; }
      var total = carrinho.reduce(function (s, c) { return s + c.qtd * c.preco; }, 0);
      $('caCarrinho').innerHTML = carrinho.map(function (c) {
        return '<div class="ci"><span>' + c.qtd + 'x ' + esc(c.nome) + '</span><span>' + brl(c.qtd * c.preco) + '</span></div>';
      }).join('') + '<div class="ct"><span>Total do novo lançamento</span><span>' + brl(total) + '</span></div>';
    }

    function renderProdutos(f) {
      f = (f || '').toLowerCase();
      var list = produtos.filter(function (p) {
        return p.ativo !== false && (!f || p.nome.toLowerCase().indexOf(f) !== -1 || (p.categoria || '').toLowerCase().indexOf(f) !== -1);
      });
      $('caProdList').innerHTML = list.length
        ? list.map(function (p) {
            return '<div class="prod-line" data-prod="' + p.id + '"><span class="pn">' + esc(p.nome) +
              '<span class="pc"> ' + esc(p.categoria) + '</span></span><span class="pv">' + brl(p.preco) + '</span></div>';
          }).join('')
        : '<div class="muted">Nenhum produto encontrado.</div>';
      $('caProdList').querySelectorAll('[data-prod]').forEach(function (el) {
        el.addEventListener('click', function () {
          var p = produtos.filter(function (x) { return x.id === Number(el.dataset.prod); })[0];
          var ja = carrinho.filter(function (c) { return c.produtoId === p.id; })[0];
          if (ja) ja.qtd++; else carrinho.push({ produtoId: p.id, nome: p.nome, categoria: p.categoria, preco: p.preco, qtd: 1 });
          renderCarrinho();
        });
      });
    }

    infoApto();
    renderProdutos('');
    $('caApto').addEventListener('change', infoApto);
    $('caBusca').addEventListener('input', function () { renderProdutos($('caBusca').value); });

    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      if (!carrinho.length) { toast('Selecione ao menos um produto.', true); return; }
      var aptoId = Number($('caApto').value);
      var est = ctx.estados[aptoId];
      var hosp = est.hospedagem;
      var seq = Promise.resolve();
      carrinho.forEach(function (c) {
        seq = seq.then(function () {
          return DB.criarConsumo({
            empresaId: EMPRESA, hospedagemId: hosp.id, aptoId: aptoId,
            produtoId: c.produtoId, categoria: c.categoria,
            descricao: c.qtd + 'x ' + c.nome, valor: Number((c.qtd * c.preco).toFixed(2)),
            itens: c.qtd, status: 'aberto', usuario: sessao.nome || sessao.usuario, em: Date.now()
          });
        });
      });
      seq.then(function () {
        fecharModal();
        toast('Consumo lançado no APTO ' + est.apto.numero + ' e vinculado à hospedagem.');
        return carregarTudo();
      }).catch(function (e) { toast('Erro ao lançar consumo: ' + e.message, true); });
    });
  }
  $('btnConsumoApto') && $('btnConsumoApto').addEventListener('click', modalConsumoApto);

  /* ================= CALENDARIO DE OCUPACAO ================= */
  var calRef = new Date();
  calRef.setDate(1);
  calRef.setHours(0, 0, 0, 0);

  function inicioDoDia(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function mesmoDia(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function eventoNoDia(ev, dia) {
    var ini = inicioDoDia(new Date(ev.entrada));
    var fim = inicioDoDia(new Date(ev.saida || ev.entrada));
    return dia >= ini && dia <= fim;
  }

  function renderCalendario() {
    var wrap = $('calWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="empty">Carregando...</div>';

    DB.listarCalendario(EMPRESA).then(function (data) {
      var aptos = data.aptos;
      var eventos = data.eventos;
      var modo = $('calModo').value;

      var ano = calRef.getFullYear(), mes = calRef.getMonth();
      var nomes = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      $('calPeriodo').textContent = nomes[mes] + ' de ' + ano;

      var diasNoMes = new Date(ano, mes + 1, 0).getDate();
      var dias = [];
      for (var d = 1; d <= diasNoMes; d++) dias.push(new Date(ano, mes, d));

      if (modo === 'dia') {
        var html = '';
        dias.forEach(function (dia) {
          var doDia = eventos.filter(function (ev) { return eventoNoDia(ev, dia); });
          var head = dia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
          html += '<div class="cal-aptcard"><div class="h">' + esc(head) + '<span class="muted">' + doDia.length + ' ocupacao(oes)</span></div><div class="b">';
          if (!doDia.length) {
            html += '<div class="muted">Todos os apartamentos livres.</div>';
          } else {
            doDia.forEach(function (ev) {
              var cls = ev.tipo === 'hospedagem' ? 'oc' : 'rs';
              html += '<div class="linha ' + cls + '"><span><b>' + numeroApto(ev.aptoId) + '</b> - ' + esc(ev.hospedeNome) + '</span>' +
                '<span class="muted">' + dataCurta(ev.entrada) + ' -> ' + dataCurta(ev.saida) + '</span></div>';
            });
          }
          html += '</div></div>';
        });
        wrap.innerHTML = html;
        return;
      }

      var head = '<tr><th class="apt-col">Apartamento</th>';
      dias.forEach(function (dia) {
        var hoje = mesmoDia(dia, new Date());
        head += '<th' + (hoje ? ' class="cal-hoje"' : '') + '>' + dia.getDate() + '</th>';
      });
      head += '</tr>';

      var linhas = aptos.map(function (a) {
        var tv = '<tr><td class="apt-col">APT ' + esc(a.numero) + '</td>';
        dias.forEach(function (dia) {
          var evs = eventos.filter(function (ev) { return ev.aptoId === a.id && eventoNoDia(ev, dia); });
          var hoje = mesmoDia(dia, new Date());
          tv += '<td class="cal-cell' + (hoje ? ' cal-hoje' : '') + '">';
          if (!evs.length) {
            tv += '<span class="cal-free">-</span>';
          } else {
            evs.forEach(function (ev) {
              var cls = ev.tipo === 'hospedagem' ? 'ev-hospedagem' : 'ev-reserva';
              tv += '<div class="cal-ev ' + cls + '" data-ev="' + ev.tipo + ':' + ev.id + '" title="' + esc(ev.hospedeNome) + '">' +
                '<span class="who">' + esc(ev.hospedeNome) + '</span>' +
                '<span class="dt">' + dataCurta(ev.entrada) + ' -> ' + dataCurta(ev.saida) + '</span>' +
              '</div>';
            });
          }
          tv += '</td>';
        });
        tv += '</tr>';
        return tv;
      }).join('');

      wrap.innerHTML = '<table class="cal-table"><thead>' + head + '</thead><tbody>' + linhas + '</tbody></table>';

      wrap.querySelectorAll('[data-ev]').forEach(function (el) {
        el.addEventListener('click', function () {
          var p = el.dataset.ev.split(':');
          if (p[0] === 'reserva') {
            var r = eventos.filter(function (x) { return x.tipo === 'reserva' && String(x.id) === p[1]; })[0];
            if (r) abrirDetalhes(r.aptoId);
          } else {
            var h = eventos.filter(function (x) { return x.tipo === 'hospedagem' && String(x.id) === p[1]; })[0];
            if (h) abrirDetalhes(h.aptoId);
          }
        });
      });
    }).catch(function (e) { wrap.innerHTML = '<div class="empty">Erro ao carregar calendario: ' + esc(e.message) + '</div>'; });
  }

  $('calPrev').addEventListener('click', function () { calRef.setMonth(calRef.getMonth() - 1); renderCalendario(); });
  $('calNext').addEventListener('click', function () { calRef.setMonth(calRef.getMonth() + 1); renderCalendario(); });
  $('calHoje').addEventListener('click', function () { calRef = new Date(); calRef.setDate(1); calRef.setHours(0, 0, 0, 0); renderCalendario(); });
  $('calModo').addEventListener('change', renderCalendario);

  /* ================= FNRH (2 vias) ================= */
  function abrirFNRH(reservaId) {
    return DB.obterReserva(reservaId).then(function (r) {
      if (!r) throw new Error('Reserva nao encontrada.');
      return Promise.all([
        DB.obterEmpresa(r.empresaId || EMPRESA),
        r.aptoId ? DB.obterApto(r.aptoId) : Promise.resolve(null),
        r.hospedeId ? DB.obterHospede(r.hospedeId) : Promise.resolve(null)
      ]).then(function (res) {
        var pacote = { reserva: r, empresa: res[0], apto: res[1], hospede: res[2] };
        try { sessionStorage.setItem('fnrh_pacote', JSON.stringify(pacote)); } catch (e) {}
        window.open('fnrh.html#' + r.id, '_blank');
        return pacote;
      });
    });
  }

  /* ---------- Boot ---------- */
  DB.init().then(carregarTudo).catch(function (e) {
    toast('Falha ao abrir o banco: ' + e.message, true);
  });
})();

