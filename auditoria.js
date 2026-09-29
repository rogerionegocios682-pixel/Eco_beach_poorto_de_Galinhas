/*
 * Turismo OS — Auditoria (auditoria.js)
 * =====================================================================
 * Duas trilhas, porque são coisas diferentes:
 *
 *   • AUDITORIA DETALHADA (`audit_logs`) — tem VALOR ANTERIOR e VALOR NOVO.
 *     É onde se vê exatamente o que mudou: preço de produto, alíquota,
 *     configuração fiscal, ajuste de estoque. É a trilha para "quem mudou
 *     o preço da cerveja de R$ 8 para R$ 12?".
 *
 *   • HISTÓRICO OPERACIONAL (`auditoria`) — registro das operações do dia
 *     a dia (reserva criada, comanda fechada, consumo removido). Não tem
 *     antes/depois porque a operação em si já é o fato.
 *
 * As duas juntas respondem "o que aconteceu neste sistema", mas misturá-las
 * numa lista só esconderia o antes/depois, que é o dado mais valioso.
 */
(function () {
  'use strict';

  var sessao = null;
  try { sessao = JSON.parse(localStorage.getItem('turismo_session') || 'null'); } catch (e) { sessao = null; }
  if (!sessao) { window.location.href = 'login.html'; return; }

  var EMPRESA = (sessao.empresaId != null) ? sessao.empresaId : 1;
  var $ = function (id) { return document.getElementById(id); };

  var PADRAO_PERFIL = {
    admin: ['*'],
    gerente: ['fiscal.visualizar', 'estoque.visualizar'],
    recepcao: ['fiscal.visualizar'],
    garcom: []
  };
  function pode(c) {
    var perfil = String(sessao.perfil || 'admin').toLowerCase();
    if (perfil === 'admin') return true;
    var lista = (sessao.permissoes && sessao.permissoes.length) ? sessao.permissoes : (PADRAO_PERFIL[perfil] || []);
    if (lista.indexOf('*') !== -1) return true;
    var g = String(c).split('.')[0];
    return lista.indexOf(c) !== -1 || lista.indexOf(g + '.*') !== -1;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, tipo) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (tipo ? ' ' + tipo : '');
    setTimeout(function () { t.className = 'toast'; }, tipo === 'err' ? 6000 : 3000);
  }
  function abrirModal(html, largo) {
    $('modalBox').className = 'modal' + (largo ? ' wide' : '');
    $('modalBox').innerHTML = html;
    $('overlay').classList.add('show');
  }
  function fecharModal() { $('overlay').classList.remove('show'); $('modalBox').innerHTML = ''; }
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) fecharModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharModal(); });
  function baixar(nome, conteudo, mime) {
    var blob = new Blob([conteudo], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function debounce(fn, ms) {
    var t = null;
    return function () { if (t) clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* Rótulos legíveis dos módulos da auditoria detalhada. O nome técnico
   * (`config_pdv`) não diz nada a quem audita; o rótulo diz. */
  var MODULO_ROTULO = {
    produto: 'Produto / preço',
    fiscal: 'Configuração fiscal',
    'fiscal.regra': 'Regra tributária',
    'fiscal.documento': 'Documento fiscal',
    permissao: 'Permissão de usuário',
    configuracao: 'Configuração da empresa',
    config_estoque: 'Configuração de estoque',
    config_caixa: 'Configuração de caixa',
    config_seguranca: 'Configuração de segurança',
    estabelecimento: 'Estabelecimento / filial'
  };
  function rotuloModulo(m) { return MODULO_ROTULO[m] || m; }

  var ACAO_ROTULO = {
    INSERIR: 'Criou', ALTERAR: 'Alterou', DESATIVAR: 'Desativou',
    CANCELAR: 'Cancelou', REMOVER: 'Removeu'
  };

  /* ================================================================== */
  /* ABAS                                                               */
  /* ================================================================== */
  var ABAS = [
    { id: 'detalhada', titulo: 'Auditoria detalhada' },
    { id: 'operacional', titulo: 'Histórico operacional' }
  ];
  var SUBS = {
    detalhada: 'Alterações com valor anterior e valor novo — preço, estoque, tributação e permissões',
    operacional: 'Registro das operações do dia a dia: reservas, comandas e consumos'
  };
  var estado = { detalhada: [], operacional: [], modulos: [], aba: 'detalhada' };

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
    if (id === 'detalhada') carregarDetalhada();
    if (id === 'operacional') carregarOperacional();
  }

  /* ================================================================== */
  /* RENDER                                                             */
  /* ================================================================== */
  function renderTudo() {
    $('modoInfo').textContent = DB.modoAtivo() === 'servidor' ? 'Modo servidor' : 'Modo local';
    if (!pode('fiscal.visualizar')) {
      $('avisos').innerHTML = '<div class="erro-box">Seu perfil não tem a permissão <b>fiscal.visualizar</b>, ' +
        'necessária para consultar a auditoria.</div>';
    }

    $('panes').innerHTML = renderDetalhada() + renderOperacional();
    ligarTudo();
    trocar(estado.aba);
  }

  function renderDetalhada() {
    return '<div class="pane" id="pane-detalhada">' +
      '<div class="panel"><div class="panel-head"><div><h2>Auditoria detalhada</h2>' +
      '<div class="desc">Toda alteração sensível guarda o VALOR ANTERIOR e o VALOR NOVO: ' +
      'preço, estoque, tributação, cancelamento, nota fiscal, configuração fiscal e permissões.</div></div>' +
      '<div class="actions">' +
      '<button class="btn btn-ghost-m btn-sm" id="btnFiltrarAud">Filtrar</button>' +
      '<button class="btn btn-ghost-m btn-sm" id="btnExportarAud">Exportar CSV</button>' +
      '</div></div>' +
      '<div class="panel-body">' +
      '<div class="filtros">' +
      '<div class="field"><label for="auModulo">Módulo</label><select id="auModulo"><option value="">Todos</option></select></div>' +
      '<div class="field"><label for="auUsuario">Usuário</label><input id="auUsuario" placeholder="nome ou login" /></div>' +
      '<div class="field"><label for="auRegistro">Registro (ID)</label><input id="auRegistro" placeholder="ex.: 12" /></div>' +
      '<div class="field"><label for="auDe">De</label><input id="auDe" type="date" /></div>' +
      '<div class="field"><label for="auAte">Até</label><input id="auAte" type="date" /></div>' +
      '<div class="field"><label for="auLimite">Limite</label><select id="auLimite">' +
      '<option value="100">100</option><option value="300" selected>300</option>' +
      '<option value="1000">1000</option></select></div>' +
      '</div>' +
      '<div id="listaAud"><div class="muted">Carregando…</div></div>' +
      '</div></div></div>';
  }

  function carregarDetalhada() {
    var el = $('listaAud');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';

    DB.listarAuditoriaDetalhada(EMPRESA, {
      modulo: ($('auModulo') || {}).value || '',
      usuarioFiltro: ($('auUsuario') || {}).value.trim() || '',
      registroId: ($('auRegistro') || {}).value.trim() || '',
      de: ($('auDe') || {}).value || '',
      ate: ($('auAte') || {}).value || '',
      limite: Number(($('auLimite') || {}).value) || 300
    }).then(function (arr) {
      estado.detalhada = arr || [];

      /* Popula o filtro de módulo com o que existe de fato no banco —
       * um select fixo mostraria módulos que esta empresa nunca usou. */
      carregarModulos();

      if (!arr.length) {
        el.innerHTML = '<div class="muted">Nenhum registro de auditoria com estes filtros.<br />' +
          'A trilha cresce conforme o sistema é usado: alterações de preço, estoque, tributação e permissões ' +
          'entram aqui automaticamente.</div>';
        return;
      }

      el.innerHTML = '<div style="overflow-x:auto;max-height:600px"><table><thead><tr>' +
        '<th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Módulo</th><th>Registro</th><th>Valor anterior → novo</th><th></th>' +
        '</tr></thead><tbody>' + arr.map(function (l) {
          var resumo = resumirAlteracao(l.valorAnterior, l.valorNovo);
          return '<tr><td class="muted">' + esc(String(l.em || '').slice(0, 19).replace('T', ' ')) + '</td>' +
            '<td><b>' + esc(l.usuario || '—') + '</b>' + (l.ip ? '<br /><span class="mono muted">' + esc(l.ip) + '</span>' : '') + '</td>' +
            '<td><span class="badge ' + corAcao(l.acao) + '">' + esc(ACAO_ROTULO[l.acao] || l.acao) + '</span></td>' +
            '<td>' + esc(rotuloModulo(l.modulo)) + '</td>' +
            '<td class="mono">' + esc(l.registroId || '—') + '</td>' +
            '<td class="muted" style="max-width:340px">' + resumo + '</td>' +
            '<td class="td-actions"><button class="btn btn-sm btn-ghost-m" data-detalhe-aud="' + l.id + '">Ver</button></td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">' + arr.length + ' registro(s). ' +
        'A auditoria é permanente: o sistema não apaga estas linhas.</div>';

      el.querySelectorAll('[data-detalhe-aud]').forEach(function (b) {
        b.addEventListener('click', function () {
          detalhar(estado.detalhada.filter(function (x) { return x.id === Number(b.dataset.detalheAud); })[0]);
        });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  function corAcao(a) {
    if (a === 'INSERIR') return 'on';
    if (a === 'ALTERAR') return 'info';
    return 'err';
  }

  /* Resumo "campo: antes → depois" direto na linha. Sem isso, o auditor
   * teria de abrir cada registro para saber se a mudança importa. */
  function resumirAlteracao(anteriorTxt, novoTxt) {
    var a = parseJson(anteriorTxt), n = parseJson(novoTxt);
    if (!a && !n) return '—';
    if (!a && n) {
      var chavesNovas = Object.keys(n).slice(0, 3).map(function (k) {
        return esc(k) + ' = ' + esc(String(n[k]).slice(0, 40));
      });
      return 'criado · ' + chavesNovas.join(', ') + (Object.keys(n).length > 3 ? '…' : '');
    }
    var partes = [];
    Object.keys(n || {}).forEach(function (k) {
      var va = a ? a[k] : undefined;
      var vn = n[k];
      if (String(va) === String(vn)) return;
      partes.push('<b>' + esc(k) + '</b>: ' + esc(String(va == null ? '—' : va).slice(0, 30)) +
        ' → <b>' + esc(String(vn == null ? '—' : vn).slice(0, 30)) + '</b>');
    });
    if (!partes.length) return 'sem diferença de campo';
    return partes.slice(0, 3).join('<br />') + (partes.length > 3 ? '<br />… +' + (partes.length - 3) : '');
  }

  function parseJson(s) {
    if (!s) return null;
    if (typeof s === 'object') return s;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function detalhar(l) {
    if (!l) return;
    var a = parseJson(l.valorAnterior), n = parseJson(l.valorNovo);
    var chaves = {};
    Object.keys(a || {}).forEach(function (k) { chaves[k] = 1; });
    Object.keys(n || {}).forEach(function (k) { chaves[k] = 1; });
    var lista = Object.keys(chaves).sort();

    abrirModal('<h3>Alteração registrada</h3>' +
      '<div class="sub">' + esc(String(l.em || '').slice(0, 19).replace('T', ' ')) + ' · ' +
      esc(l.usuario || '—') + ' · ' + esc(rotuloModulo(l.modulo)) + ' #' + esc(l.registroId || '—') + '</div>' +
      '<div class="grid3">' +
      '<div class="field"><label>Ação</label><div><span class="badge ' + corAcao(l.acao) + '">' +
      esc(ACAO_ROTULO[l.acao] || l.acao) + '</span></div></div>' +
      '<div class="field"><label>Módulo</label><div>' + esc(rotuloModulo(l.modulo)) + '</div></div>' +
      '<div class="field"><label>Endereço IP</label><div class="mono">' + esc(l.ip || 'não registrado') + '</div></div>' +
      '</div>' +
      (lista.length
        ? '<div style="overflow-x:auto;margin-top:16px"><table><thead><tr>' +
        '<th>Campo</th><th>Valor anterior</th><th>Valor novo</th></tr></thead><tbody>' +
        lista.map(function (k) {
          var va = a ? a[k] : undefined;
          var vn = n ? n[k] : undefined;
          var mudou = String(va) !== String(vn);
          return '<tr' + (mudou ? ' style="background:#fffbeb"' : '') + '>' +
            '<td><b>' + esc(k) + '</b></td>' +
            '<td class="mono">' + esc(va == null ? '—' : String(va).slice(0, 80)) + '</td>' +
            '<td class="mono">' + esc(vn == null ? '—' : String(vn).slice(0, 80)) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="muted" style="margin-top:14px">Sem detalhe de campos registrado.</div>') +
      '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>', true);
    $('mCancel').addEventListener('click', fecharModal);
  }

  function carregarModulos() {
    DB.listarModulosAuditoria(EMPRESA).then(function (arr) {
      var sel = $('auModulo');
      if (!sel) return;
      var atual = sel.value;
      estado.modulos = arr || [];
      sel.innerHTML = '<option value="">Todos</option>' + estado.modulos.map(function (m) {
        return '<option value="' + esc(m) + '">' + esc(rotuloModulo(m)) + '</option>';
      }).join('');
      sel.value = atual;
    }).catch(function () { /* sem módulos, mantém "Todos" */ });
  }

  /* ---------------- OPERACIONAL ---------------- */
  function renderOperacional() {
    return '<div class="pane" id="pane-operacional">' +
      '<div class="panel"><div class="panel-head"><div><h2>Histórico operacional</h2>' +
      '<div class="desc">Operações do dia a dia registradas pelo sistema: reservas, comandas, consumos e cadastros. ' +
      'Não tem valor anterior/novo porque a operação em si é o fato registrado.</div></div>' +
      '<div class="actions">' +
      '<div class="field"><label for="opLimite">Limite</label><select id="opLimite">' +
      '<option value="100">100</option><option value="300" selected>300</option>' +
      '<option value="1000">1000</option></select></div>' +
      '<button class="btn btn-ghost-m btn-sm" id="btnRecarregarOp" style="margin-bottom:2px">Recarregar</button>' +
      '</div></div>' +
      '<div class="panel-body" id="listaOp"><div class="muted">Carregando…</div></div></div></div>';
  }

  function carregarOperacional() {
    var el = $('listaOp');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarAuditoria(EMPRESA, Number(($('opLimite') || {}).value) || 300).then(function (arr) {
      estado.operacional = arr || [];
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhuma operação registrada ainda.</div>'; return; }

      el.innerHTML = '<div style="overflow-x:auto;max-height:600px"><table><thead><tr>' +
        '<th>Data/hora</th><th>Entidade</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>' +
        arr.map(function (l) {
          return '<tr><td class="muted">' + esc(new Date(l.em).toLocaleString('pt-BR')) + '</td>' +
            '<td><b>' + esc(l.entidade || '—') + '</b> #' + esc(l.entidadeId || '—') + '</td>' +
            '<td><span class="badge info">' + esc(l.acao || '—') + '</span></td>' +
            '<td class="muted mono" style="max-width:420px">' + esc(String(l.detalhe || '').slice(0, 180)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">' + arr.length + ' operação(ões).</div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  /* ---------------- LIGAÇÕES ---------------- */
  function ligarTudo() {
    if ($('btnFiltrarAud')) $('btnFiltrarAud').addEventListener('click', carregarDetalhada);
    ['auModulo', 'auDe', 'auAte', 'auLimite'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', carregarDetalhada);
    });
    ['auUsuario', 'auRegistro'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', debounce(carregarDetalhada, 450));
    });
    if ($('btnRecarregarOp')) $('btnRecarregarOp').addEventListener('click', carregarOperacional);
    if ($('opLimite')) $('opLimite').addEventListener('change', carregarOperacional);

    if ($('btnExportarAud')) $('btnExportarAud').addEventListener('click', function () {
      if (!estado.detalhada.length) return toast('Nada para exportar: carregue a lista primeiro.', 'err');
      var colunas = ['em', 'usuario', 'acao', 'modulo', 'registroId', 'valorAnterior', 'valorNovo', 'ip'];
      var csv = '\ufeff' + colunas.join(';') + '\r\n' + estado.detalhada.map(function (l) {
        return colunas.map(function (c) {
          var v = l[c] == null ? '' : String(l[c]);
          return (v.indexOf(';') !== -1 || v.indexOf('"') !== -1 || v.indexOf('\n') !== -1)
            ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(';');
      }).join('\r\n');
      baixar('auditoria-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv;charset=utf-8');
      toast('CSV de auditoria gerado.', 'ok');
    });
  }

  $('uNome').textContent = sessao.nome || sessao.usuario;
  $('uPerfil').textContent = sessao.perfil || '';
  $('uAvatar').textContent = (sessao.nome || sessao.usuario || '?').trim().charAt(0).toUpperCase();
  $('btnLogout').addEventListener('click', function () {
    if (confirm('Deseja sair do sistema?')) {
      try { localStorage.removeItem('turismo_session'); } catch (e) { }
      window.location.href = 'login.html';
    }
  });
  $('btnMenu').addEventListener('click', function () { $('sidebar').classList.add('open'); $('sidebarBg').classList.add('show'); });
  $('sidebarBg').addEventListener('click', function () { $('sidebar').classList.remove('open'); $('sidebarBg').classList.remove('show'); });
  $('btnRefresh').addEventListener('click', function () {
    carregarDetalhada();
    if (estado.aba === 'operacional') carregarOperacional();
    toast('Auditoria atualizada.', 'ok');
  });

  DB.init().then(renderTudo).catch(function (e) {
    $('avisos').innerHTML = '<div class="erro-box">Falha ao abrir o sistema: ' + esc(e.message) + '</div>';
  });
})();