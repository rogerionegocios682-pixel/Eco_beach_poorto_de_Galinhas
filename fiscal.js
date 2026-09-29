/*
 * Turismo OS — Fiscal (fiscal.js)
 * =====================================================================
 * Telas: Documentos emitidos, Inutilizações, Regras tributárias,
 * Serviços NFS-e, Série/numeração, Contingência e Logs fiscais.
 *
 * IMPORTANTE — o que esta tela NÃO faz:
 *   Não há aqui nenhuma alíquota, CST, CFOP ou regra fiscal em código.
 *   Tudo é lido da tabela `tax_rules` no servidor. Emitir, cancelar e
 *   inutilizar passam pelas rotas do servidor, que conferem PERMISSÃO,
 *   IDEMPOTÊNCIA e PRONTIDÃO do cadastro antes de gravar.
 *
 * Em modo local (sem servidor) as operações fiscais recusam com a razão
 * explícita: dado fiscal não vive no navegador.
 */
(function () {
  'use strict';

  var sessao = null;
  try { sessao = JSON.parse(localStorage.getItem('turismo_session') || 'null'); } catch (e) { sessao = null; }
  if (!sessao) { window.location.href = 'login.html'; return; }

  var EMPRESA = (sessao.empresaId != null) ? sessao.empresaId : 1;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Permissões (mesma regra do servidor) ---------- */
  var PADRAO_PERFIL = {
    admin: ['*'],
    gerente: ['fiscal.visualizar', 'fiscal.configurar', 'fiscal.emitir', 'fiscal.cancelar',
      'fiscal.consultar', 'fiscal.baixar_xml', 'estoque.visualizar'],
    recepcao: ['fiscal.visualizar', 'fiscal.emitir', 'fiscal.consultar', 'estoque.visualizar'],
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
  function toast(msg, tipo) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (tipo ? ' ' + tipo : '');
    setTimeout(function () { t.className = 'toast'; }, tipo === 'err' ? 7000 : 3000);
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
  function baixar(nome, conteudo, mime) {
    var blob = new Blob([conteudo], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  /* Status do documento -> cor do badge. Fonte única para a lista, o
   * detalhe e o dashboard, evitando divergência de cores. */
  function corStatus(s) {
    if (s === 'AUTORIZADA') return 'on';
    if (s === 'CANCELADA') return 'off';
    if (s === 'CONTINGENCIA' || s === 'PROCESSANDO' || s === 'PENDENTE') return 'warn';
    return 'err';
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
  /* ABAS                                                               */
  /* ================================================================== */
  var ABAS = [
    { id: 'painel', titulo: 'Painel' },
    { id: 'documentos', titulo: 'Documentos' },
    { id: 'emitir', titulo: 'Emitir documento' },
    { id: 'inutilizar', titulo: 'Inutilização' },
    { id: 'regras', titulo: 'Regras tributárias' },
    { id: 'servicos', titulo: 'Serviços (NFS-e)' },
    { id: 'contingencia', titulo: 'Contingência' },
    { id: 'logs', titulo: 'Logs fiscais' }
  ];
  var SUBS = {
    painel: 'Situação fiscal: prontidão, certificado, séries e contingência',
    documentos: 'NF-e, NFC-e e NFS-e emitidas, com cancelamento e download',
    emitir: 'Emissão manual e conferência do documento aplicável',
    inutilizar: 'Inutilização de faixa de numeração não utilizada',
    regras: 'Regras de ICMS, PIS, COFINS, IPI, ISS, IBS e CBS',
    servicos: 'Códigos de serviço por município (LC 116 e código municipal)',
    contingencia: 'Ativação, encerramento e reprocessamento seguro',
    logs: 'Registro permanente de cada operação fiscal'
  };
  var estado = { produtos: [], documentos: [], regras: [], servicos: [], categorias: {}, aba: 'painel' };

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
    if (id === 'documentos') carregarDocumentos();
    if (id === 'regras') carregarRegras();
    if (id === 'servicos') carregarServicos();
    if (id === 'contingencia') carregarContingencias();
    if (id === 'logs') carregarLogs();
  }

  /* ================================================================== */
  /* RENDER                                                             */
  /* ================================================================== */
  function renderTudo() {
    $('modoInfo').textContent = modoServidor() ? 'Modo servidor' : 'Modo local';
    $('avisos').innerHTML = modoServidor() ? '' :
      '<div class="aviso-servidor"><b>Modo local:</b> emissão, cancelamento, inutilização e consulta exigem o servidor. ' +
      'O certificado, a assinatura e a transmissão ficam no backend — nada é emitido pelo navegador.</div>';
    if (!pode('fiscal.visualizar')) {
      $('avisos').innerHTML = '<div class="erro-box">Seu perfil não tem a permissão <b>fiscal.visualizar</b>.</div>';
    }

    $('panes').innerHTML = renderPainel() + renderDocumentos() + renderEmitir() +
      renderInutilizar() + renderRegras() + renderServicos() + renderContingencia() + renderLogs();

    ligarTudo();
    DB.listarProdutos(EMPRESA).then(function (arr) {
      estado.produtos = arr || [];
      estado.produtos.forEach(function (p) { estado.categorias[p.id] = p; });
      atualizarSelectProdutos();
    }).catch(function () {});
    trocar(estado.aba);
  }

  /* ---------------- PAINEL ---------------- */
  function renderPainel() {
    return '<div class="pane" id="pane-painel"><div id="painelConteudo"><div class="muted">Carregando…</div></div></div>';
  }

  function carregarPainel() {
    var el = $('painelConteudo');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';

    Promise.all([
      DB.validarProntidaoFiscal(EMPRESA).catch(function (e) { return { pronto: false, motivos: [e.message] }; }),
      DB.listarDocumentosFiscais(EMPRESA, { limite: 500 }).catch(function () { return []; }),
      DB.listarSeries(EMPRESA).catch(function () { return []; }),
      DB.listarContingencias(EMPRESA).catch(function () { return []; }),
      DB.listarRegras(EMPRESA, {}).catch(function () { return []; }),
      DB.obterCertificado(EMPRESA, null).catch(function () { return null; })
    ]).then(function (r) {
      var pronto = r[0], docs = r[1] || [], series = r[2] || [], conts = r[3] || [], regras = r[4] || [];
      var cert = r[5] && r[5].certificado ? r[5].certificado : null;
      estado.documentos = docs;

      /* Contagem por status: a leitura que o gestor precisa para saber se
       * há documento travado (contingência) ou rejeitado sem tratamento. */
      var porStatus = {};
      docs.forEach(function (d) { porStatus[d.status] = (porStatus[d.status] || 0) + 1; });

      var contAtiva = conts.filter(function (c) { return !c.dataFim; })[0];
      var valorPeriodo = docs.filter(function (d) { return d.status === 'AUTORIZADA'; })
        .reduce(function (s, d) { return s + (Number(d.valorTotal) || 0); }, 0);

      el.innerHTML =
        '<div class="kpis">' +
          kpi(pronto.pronto ? 'verde' : 'vermelho', 'Prontidão para emitir', pronto.pronto ? 'Pronto' : 'Pendente',
            '<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>') +
          kpi('azul', 'Documentos', String(docs.length), '<path d="M4 3h11l5 5v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>') +
          kpi('verde', 'Autorizadas', String(porStatus.AUTORIZADA || 0), '<path d="M20 6L9 17l-5-5"/>') +
          kpi('amarelo', 'Em contingência', String(porStatus.CONTINGENCIA || 0), '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>') +
          kpi('vermelho', 'Rejeitadas / erro', String((porStatus.REJEITADA || 0) + (porStatus.ERRO || 0)), '<path d="M18 6L6 18M6 6l12 12"/>') +
          kpi('roxo', 'Valor autorizado', brl(valorPeriodo), '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>') +
        '</div>' +
        (contAtiva
          ? '<div class="erro-box"><b>Contingência ATIVA</b> desde ' + esc(String(contAtiva.dataInicio).slice(0, 16).replace('T', ' ')) +
            ' — ' + esc(contAtiva.tipoContingencia) + ': ' + esc(contAtiva.motivo || '') + '. ' +
            'Os documentos ficam pendentes de transmissão até o encerramento.</div>'
          : '') +
        '<div class="grid2">' +
          '<div class="panel" style="margin:0"><div class="panel-head"><h2>Certificado e séries</h2>' +
            '<span class="badge ' + (cert ? (cert.vencido ? 'err' : 'on') : 'off') + '">' +
            (cert ? (cert.vencido ? 'Certificado vencido' : 'Certificado válido') : 'Sem certificado') + '</span></div>' +
            '<div class="panel-body">' +
            (cert
              ? '<table><tbody>' +
                '<tr><td>Arquivo</td><td class="mono">' + esc(cert.nome) + '</td></tr>' +
                '<tr><td>Validade</td><td>' + esc(cert.validade) + (cert.diasParaVencer != null ? ' (' + cert.diasParaVencer + ' dias)' : '') + '</td></tr>' +
                '</tbody></table>'
              : '<div class="muted">Nenhum certificado cadastrado. Configure em <b>Configurações → Fiscal</b>.</div>') +
            '<div style="margin-top:14px"><b style="font-size:13px">Séries</b>' +
            (series.length
              ? '<table style="margin-top:8px"><tbody>' + series.map(function (s) {
                var nome = s.modelo === '55' ? 'NF-e' : s.modelo === '65' ? 'NFC-e' : s.modelo;
                return '<tr><td>' + nome + ' série ' + esc(s.serie) + '</td>' +
                  '<td><span class="badge ' + (s.ambiente === 'PRODUCAO' ? 'err' : 'info') + '">' + esc(s.ambiente) + '</span></td>' +
                  '<td class="mono">próx. ' + esc(String(s.proximoNumero).padStart(9, '0')) + '</td></tr>';
              }).join('') + '</tbody></table>'
              : '<div class="muted" style="margin-top:6px">Nenhuma série configurada ainda.</div>') +
            '</div></div></div>' +
          '<div class="panel" style="margin:0"><div class="panel-head"><h2>Pendências que impedem a emissão</h2></div>' +
            '<div class="panel-body">' +
            (pronto.pronto
              ? '<div class="ok-box">Nada pendente. O cadastro fiscal está completo.</div>'
              : '<div class="erro-box">Corrija em <b>Configurações → Fiscal</b>:</div><ul class="checks">' +
                (pronto.motivos || []).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>') +
            '<div class="info-box" style="margin-top:12px">' + regras.length + ' regra(s) tributária(s) cadastrada(s). ' +
            'Nenhuma alíquota é fixada no código: todas vêm destas regras.</div>' +
            '</div></div>' +
        '</div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>';
    });
  }

  function kpi(cor, titulo, valor, svg) {
    return '<div class="kpi"><div class="ico ' + cor + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + svg + '</svg></div>' +
      '<div><div class="n">' + valor + '</div><div class="t">' + esc(titulo) + '</div></div></div>';
  }

  /* ---------------- DOCUMENTOS ---------------- */
  function renderDocumentos() {
    return '<div class="pane" id="pane-documentos">' +
      '<div class="panel"><div class="panel-head"><div><h2>Documentos fiscais emitidos</h2>' +
        '<div class="desc">Cada operação tem identificador idempotente: reprocessar NÃO gera documento duplicado.</div></div>' +
        '<div class="actions"><button class="btn btn-ghost-m btn-sm" id="btnFiltrarDocs">Filtrar</button></div></div>' +
        '<div class="panel-body">' +
          '<div class="filtros">' +
            '<div class="field"><label for="dcTipo">Tipo</label><select id="dcTipo">' +
              '<option value="">Todos</option><option value="NFE">NF-e (55)</option>' +
              '<option value="NFCE">NFC-e (65)</option><option value="NFSE">NFS-e</option></select></div>' +
            '<div class="field"><label for="dcStatus">Status</label><select id="dcStatus">' +
              '<option value="">Todos</option>' +
              ['PENDENTE', 'PROCESSANDO', 'AUTORIZADA', 'REJEITADA', 'CANCELADA', 'DENEGADA', 'CONTINGENCIA', 'ERRO']
                .map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label for="dcAmbiente">Ambiente</label><select id="dcAmbiente">' +
              '<option value="">Todos</option><option>HOMOLOGACAO</option><option>PRODUCAO</option></select></div>' +
            '<div class="field"><label for="dcBusca">Busca</label><input id="dcBusca" placeholder="cliente, número ou chave" /></div>' +
          '</div>' +
          '<div id="listaDocs"><div class="muted">Carregando…</div></div>' +
        '</div></div></div>';
  }

  function carregarDocumentos() {
    var el = $('listaDocs');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarDocumentosFiscais(EMPRESA, {
      tipoDocumento: ($('dcTipo') || {}).value || '',
      status: ($('dcStatus') || {}).value || '',
      ambiente: ($('dcAmbiente') || {}).value || '',
      busca: ($('dcBusca') || {}).value || '',
      limite: 300
    }).then(function (arr) {
      estado.documentos = arr || [];
      if (!arr.length) {
        el.innerHTML = '<div class="muted">Nenhum documento fiscal encontrado.' +
          '<br />Os documentos aparecem aqui depois de emitidos pelo PDV, pelo hotel ou pela aba "Emitir documento".</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Nº / Série</th><th>Tipo</th><th>Cliente</th><th>Valor</th><th>Status</th>' +
        '<th>Ambiente</th><th>Emitido</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + arr.map(function (d) {
          return '<tr><td class="mono">' + esc(d.numero || '—') + '/' + esc(d.serie || '—') + '</td>' +
            '<td>' + esc(d.tipoDocumento) + (d.modelo ? ' <span class="muted">(' + esc(d.modelo) + ')</span>' : '') + '</td>' +
            '<td>' + esc(d.clienteNome || '—') + '</td>' +
            '<td>' + brl(d.valorTotal) + '</td>' +
            '<td><span class="badge ' + corStatus(d.status) + '">' + esc(d.status) + '</span></td>' +
            '<td><span class="badge ' + (d.ambiente === 'PRODUCAO' ? 'err' : 'info') + '">' + esc(d.ambiente) + '</span></td>' +
            '<td class="muted">' + esc(String(d.emitidoEm || '').slice(0, 16).replace('T', ' ')) + '</td>' +
            '<td><div class="td-actions">' +
              '<button class="btn btn-sm btn-ghost-m" data-verdoc="' + d.id + '">Detalhes</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">' + arr.length + ' documento(s). ' +
        'A chave de acesso e o XML ficam no detalhe de cada documento.</div>';

      el.querySelectorAll('[data-verdoc]').forEach(function (b) {
        b.addEventListener('click', function () { detalhar(Number(b.dataset.verdoc)); });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  function detalhar(id) {
    DB.obterDocumentoFiscal(EMPRESA, id).then(function (d) {
      var temXml = !!d.xml;
      abrirModal('<h3>' + esc(d.tipoDocumento) + ' nº ' + esc(d.numero || '—') + '/' + esc(d.serie || '—') + '</h3>' +
        '<div class="sub">Emitido em ' + esc(String(d.emitidoEm || '').slice(0, 19).replace('T', ' ')) + '</div>' +
        '<div class="grid4">' +
          campo('Status', '<span class="badge ' + corStatus(d.status) + '">' + esc(d.status) + '</span>') +
          campo('Ambiente', esc(d.ambiente)) +
          campo('Valor total', brl(d.valorTotal)) +
          campo('Protocolo', '<span class="mono">' + esc(d.protocolo || '—') + '</span>') +
        '</div>' +
        '<div class="grid2" style="margin-top:12px">' +
          campo('Cliente', esc(d.clienteNome || '—')) +
          campo('Documento do cliente', '<span class="mono">' + esc(d.clienteDocumento || '—') + '</span>') +
          campo('Natureza da operação', esc(d.naturezaOperacao || '—')) +
          campo('CFOP', esc(d.cfop || '—')) +
          campo('Origem', esc((d.origemTipo || '—') + (d.origemId ? ' #' + d.origemId : ''))) +
          campo('Tipo de emissão', esc(d.tipoEmissao || '—')) +
        '</div>' +
        (d.chave
          ? '<div class="field full" style="margin-top:12px"><label>Chave de acesso</label>' +
            '<div class="mono" style="word-break:break-all">' + esc(d.chave) + '</div></div>'
          : '') +
        (d.mensagem ? '<div class="info-box" style="margin-top:12px">' + esc(d.mensagem) + '</div>' : '') +
        (d.motivoCancelamento
          ? '<div class="erro-box" style="margin-top:12px"><b>Cancelado:</b> ' + esc(d.motivoCancelamento) + '</div>' : '') +
        '<div style="margin-top:16px"><b style="font-size:13px">Itens</b>' +
        '<div style="overflow-x:auto;margin-top:8px"><table><thead><tr>' +
        '<th>Descrição</th><th>Qtd</th><th>Unitário</th><th>Total</th><th>Tributos</th></tr></thead><tbody>' +
        (d.itens || []).map(function (it) {
          var tribs = Object.keys(it.tributos || {}).filter(function (t) {
            return Number((it.tributos[t] || {}).valor) > 0;
          }).map(function (t) {
            var x = it.tributos[t];
            return esc(t) + ' ' + (Number(x.aliquota) || 0) + '% = ' + brl(x.valor);
          }).join('<br />') || '<span class="muted">sem incidência</span>';
          return '<tr><td>' + esc(it.descricao || ('#' + it.produtoId)) + '</td>' +
            '<td>' + (Number(it.quantidade) || 0) + '</td>' +
            '<td>' + brl(it.valorUnitario) + '</td>' +
            '<td><b>' + brl(it.valorTotal) + '</b></td>' +
            '<td class="muted">' + tribs + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' +
        '<div style="margin-top:16px"><b style="font-size:13px">Eventos</b>' +
        '<ul class="checks">' + (d.eventos || []).map(function (ev) {
          return '<li>' + esc(String(ev.em || '').slice(0, 19).replace('T', ' ')) + ' — <b>' + esc(ev.tipo) + '</b>: ' +
            esc(ev.descricao || ev.status || '') + (ev.protocolo ? ' (protocolo ' + esc(ev.protocolo) + ')' : '') + '</li>';
        }).join('') + '</ul></div>' +
        '<div class="modal-foot">' +
          (temXml && pode('fiscal.baixar_xml') ? '<button class="btn btn-ghost-m" id="mXml">Baixar XML</button>' : '') +
          (pode('fiscal.consultar') ? '<button class="btn btn-ghost-m" id="mConsultar">Consultar situação</button>' : '') +
          (pode('fiscal.emitir') ? '<button class="btn btn-ghost-m" id="mEmail">Enviar e-mail</button>' : '') +
          (pode('fiscal.cancelar') && d.status === 'AUTORIZADA'
            ? '<button class="btn btn-danger" id="mCanc">Cancelar</button>' : '') +
          '<button class="btn btn-primary" id="mCancel">Fechar</button></div>', true);

      $('mCancel').addEventListener('click', fecharModal);
      if ($('mXml')) $('mXml').addEventListener('click', function () {
        DB.baixarXML(EMPRESA, id).then(function (r) {
          if (!r.conteudo) return toast(r.mensagem || 'XML indisponível.', 'err');
          baixar(r.nome || ('documento-' + id + '.xml'), r.conteudo, 'application/xml');
          toast('XML gerado.', 'ok');
        }).catch(function (e) { toast(e.message, 'err'); });
      });
      if ($('mConsultar')) $('mConsultar').addEventListener('click', function () {
        toast('Consultando…');
        DB.consultarDocumentoFiscal(EMPRESA, id).then(function (r) {
          toast(r.ok ? ('Situação: ' + (r.status || 'sem mudança')) : ('Falha: ' + r.mensagem), r.ok ? 'ok' : 'err');
          detalhar(id);
        }).catch(function (e) { toast(e.message, 'err'); });
      });
      if ($('mEmail')) $('mEmail').addEventListener('click', function () {
        var email = prompt('E-mail do destinatário:');
        if (!email) return;
        DB.enviarDocumentoEmail(EMPRESA, id, { email: email })
          .then(function (r) { toast(r.mensagem || 'Enviado.', r.ok ? 'ok' : 'err'); })
          .catch(function (e) { toast(e.message, 'err'); });
      });
      if ($('mCanc')) $('mCanc').addEventListener('click', function () { modalCancelar(d); });
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function campo(rotulo, valorHtml) {
    return '<div class="field"><label>' + esc(rotulo) + '</label><div>' + valorHtml + '</div></div>';
  }

  function modalCancelar(d) {
    abrirModal('<h3>Cancelar ' + esc(d.tipoDocumento) + ' nº ' + esc(d.numero) + '</h3>' +
      '<div class="sub">O cancelamento fica registrado na auditoria com o seu usuário.</div>' +
      '<div class="erro-box">O motivo deve ter no mínimo 15 caracteres (exigência fiscal) e é transmitido ao fisco.</div>' +
      '<div class="field"><label>Motivo do cancelamento *</label>' +
      '<textarea id="cancMotivo" placeholder="Descreva o motivo real do cancelamento com detalhe suficiente"></textarea></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Voltar</button>' +
      '<button class="btn btn-danger" id="mOk">Confirmar cancelamento</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var motivo = $('cancMotivo').value.trim();
      if (motivo.length < 15) return toast('O motivo precisa de pelo menos 15 caracteres.', 'err');
      $('mOk').disabled = true;
      DB.cancelarDocumentoFiscal(EMPRESA, d.id, { motivo: motivo }).then(function (r) {
        fecharModal();
        toast(r.cancelado ? 'Documento cancelado.' : ('Não cancelado: ' + r.motivo), r.cancelado ? 'ok' : 'err');
        carregarDocumentos();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }/* ---------------- EMITIR ---------------- */
  function renderEmitir() {
    var podeEmitir = pode('fiscal.emitir');
    return '<div class="pane" id="pane-emitir">' +
      '<div class="panel"><div class="panel-head"><div><h2>Emitir documento fiscal</h2>' +
        '<div class="desc">O sistema confere a PRONTIDÃO do cadastro e a IDEMPOTÊNCIA antes de gravar. ' +
        'Se o serviço estiver indisponível, o documento vai para CONTINGÊNCIA — a operação nunca se perde.</div></div></div>' +
        '<div class="panel-body">' +
          (!podeEmitir ? '<div class="erro-box">Seu perfil não tem a permissão <b>fiscal.emitir</b>.</div>' : '') +
          '<div class="grid3">' +
            '<div class="field"><label for="emTipo">Tipo de documento</label><select id="emTipo">' +
              '<option value="NFCE">NFC-e (modelo 65) — consumidor final no estado</option>' +
              '<option value="NFE">NF-e (modelo 55) — destinatário identificado</option>' +
              '<option value="NFSE">NFS-e — serviço (hospedagem/turismo)</option></select></div>' +
            '<div class="field"><label for="emAmbiente">Ambiente</label><select id="emAmbiente">' +
              '<option value="HOMOLOGACAO">HOMOLOGAÇÃO (sem valor fiscal)</option>' +
              '<option value="PRODUCAO">PRODUÇÃO (documento real)</option></select>' +
              '<span class="hint">Use HOMOLOGAÇÃO para testes.</span></div>' +
            '<div class="field"><label for="emOrigemTipo">Origem da operação</label><select id="emOrigemTipo">' +
              '<option value="VENDA_BALCAO">Venda balcão / PDV</option>' +
              '<option value="COMANDA">Mesa / comanda</option>' +
              '<option value="DELIVERY">Delivery</option>' +
              '<option value="HOSPEDAGEM">Hospedagem (diárias)</option>' +
              '<option value="CONSUMO_APTO">Consumo no apartamento</option>' +
              '<option value="AVULSA">Operação avulsa</option></select></div>' +
            '<div class="field"><label for="emCliente">Cliente / hóspede</label><input id="emCliente" placeholder="nome" /></div>' +
            '<div class="field"><label for="emDoc">CPF / CNPJ do cliente</label><input id="emDoc" placeholder="opcional para consumidor final" /></div>' +
            '<div class="field"><label for="emUf">UF do cliente</label><input id="emUf" maxlength="2" placeholder="ex.: SC" /></div>' +
          '</div>' +
          '<div style="margin-top:18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
            '<b style="font-size:13px">Itens do documento</b>' +
            '<button class="btn btn-sm btn-ghost-m" id="btnAddItem">+ Adicionar item</button>' +
          '</div>' +
          '<div id="emItens" style="margin-top:10px"></div>' +
          '<div class="info-box" style="margin-top:14px">Mercadoria e serviço NÃO podem ir no mesmo documento. ' +
          'Ao separar os itens, o sistema indica os documentos aplicáveis na aba "Emitir" e na função de definição.</div>' +
          '<div class="actions" style="margin-top:16px">' +
            '<button class="btn btn-ghost-m" id="btnDefinirDocumento">Ver documento aplicável</button>' +
            '<button class="btn btn-primary" id="btnEmitir"' + (podeEmitir ? '' : ' disabled') + '>Emitir documento</button>' +
          '</div>' +
          '<div id="resultadoEmitir" style="margin-top:16px"></div>' +
        '</div></div></div>';
  }

  /* Uma linha de item. Os produtos vêm do cadastro real (a mesma tabela
   * usada pelo PDV) — não existe segundo catálogo. */
  function atualizarSelectProdutos() {
    var el = $('emItens');
    if (!el || !el.querySelectorAll('[data-item-produto]').length) {
      if (el && estado.aba === 'emitir') adicionarLinhaItem();
    }
  }

  var itensEmitir = [];

  function renderItens() {
    var el = $('emItens');
    if (!el) return;
    el.innerHTML = itensEmitir.map(function (it, i) {
      return '<div class="filtros" data-linha="' + i + '" style="margin-bottom:8px">' +
        '<div class="field" style="flex:2;min-width:200px"><label>Produto / serviço</label>' +
          '<select data-item-produto="' + i + '"><option value="">— selecione —</option>' +
          estado.produtos.map(function (p) {
            return '<option value="' + p.id + '"' + (p.id === it.produtoId ? ' selected' : '') + '>' + esc(p.nome) + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field" style="min-width:180px"><label>Descrição</label>' +
          '<input data-item-desc="' + i + '" value="' + esc(it.descricao || '') + '" placeholder="descrição no documento" /></div>' +
        '<div class="field" style="min-width:100px"><label>Quantidade</label>' +
          '<input type="number" step="0.001" min="0.001" data-item-qtd="' + i + '" value="' + (it.quantidade || 1) + '" /></div>' +
        '<div class="field" style="min-width:110px"><label>Valor unitário</label>' +
          '<input type="number" step="0.01" min="0" data-item-valor="' + i + '" value="' + (it.valorUnitario || 0) + '" /></div>' +
        '<button class="btn btn-sm btn-danger" data-item-rem="' + i + '" style="margin-bottom:2px">Remover</button>' +
      '</div>';
    }).join('');

    function ler() {
      el.querySelectorAll('[data-item-produto]').forEach(function (s) {
        itensEmitir[Number(s.dataset.itemProduto)].produtoId = s.value ? Number(s.value) : null;
      });
      el.querySelectorAll('[data-item-desc]').forEach(function (s) { itensEmitir[Number(s.dataset.itemDesc)].descricao = s.value; });
      el.querySelectorAll('[data-item-qtd]').forEach(function (s) { itensEmitir[Number(s.dataset.itemQtd)].quantidade = Number(s.value) || 0; });
      el.querySelectorAll('[data-item-valor]').forEach(function (s) { itensEmitir[Number(s.dataset.itemValor)].valorUnitario = Number(s.value) || 0; });
    }
    el._ler = ler;

    el.querySelectorAll('[data-item-produto]').forEach(function (s) {
      s.addEventListener('change', function () {
        ler();
        var p = estado.categorias[Number(s.value)];
        if (p) {
          itensEmitir[Number(s.dataset.itemProduto)].descricao = p.nome;
          itensEmitir[Number(s.dataset.itemProduto)].valorUnitario = Number(p.preco) || 0;
        }
        renderItens();
      });
    });
    el.querySelectorAll('[data-item-rem]').forEach(function (b) {
      b.addEventListener('click', function () {
        ler();
        itensEmitir.splice(Number(b.dataset.itemRem), 1);
        if (!itensEmitir.length) itensEmitir.push({ produtoId: null, descricao: '', quantidade: 1, valorUnitario: 0 });
        renderItens();
      });
    });
  }

  function adicionarLinhaItem() {
    var el = $('emItens');
    if (el && el._ler) el._ler();
    itensEmitir.push({ produtoId: null, descricao: '', quantidade: 1, valorUnitario: 0 });
    renderItens();
  }

  function montarItens() {
    var el = $('emItens');
    if (el && el._ler) el._ler();
    return itensEmitir.filter(function (i) {
      return (i.produtoId || i.descricao) && Number(i.quantidade) > 0;
    });
  }

  /* ---------------- INUTILIZAÇÃO ---------------- */
  function renderInutilizar() {
    return '<div class="pane" id="pane-inutilizar">' +
      '<div class="panel"><div class="panel-head"><div><h2>Inutilizar faixa de numeração</h2>' +
        '<div class="desc">Use quando a numeração foi pulada (falha de impressora, por exemplo). ' +
        'O sistema RECUSA faixa que contenha número já usado por documento emitido.</div></div></div>' +
        '<div class="panel-body">' +
          (!pode('fiscal.inutilizar') ? '<div class="erro-box">Seu perfil não tem a permissão <b>fiscal.inutilizar</b>.</div>' : '') +
          '<div class="grid4">' +
            '<div class="field"><label for="inModelo">Modelo</label><select id="inModelo">' +
              '<option value="65">NFC-e (65)</option><option value="55">NF-e (55)</option></select></div>' +
            '<div class="field"><label for="inSerie">Série</label><input id="inSerie" value="1" /></div>' +
            '<div class="field"><label for="inIni">Número inicial</label><input id="inIni" type="number" min="1" value="1" /></div>' +
            '<div class="field"><label for="inFim">Número final</label><input id="inFim" type="number" min="1" value="1" /></div>' +
            '<div class="field"><label for="inAmbiente">Ambiente</label><select id="inAmbiente">' +
              '<option>HOMOLOGACAO</option><option>PRODUCAO</option></select></div>' +
            '<div class="field full"><label for="inJust">Justificativa *</label>' +
              '<input id="inJust" placeholder="mínimo 15 caracteres — vai para o fisco" /></div>' +
          '</div>' +
          '<div class="actions" style="margin-top:16px">' +
            '<button class="btn btn-warn" id="btnInutilizar"' + (pode('fiscal.inutilizar') ? '' : ' disabled') + '>Inutilizar faixa</button>' +
            '<button class="btn btn-ghost-m" id="btnVerInutilizacoes">Ver histórico</button>' +
          '</div>' +
          '<div id="resultadoInutilizar" style="margin-top:14px"></div>' +
        '</div></div>' +
      '<div class="panel"><div class="panel-head"><h2>Inutilizações registradas</h2></div>' +
        '<div class="panel-body" id="listaInutilizacoes"><div class="muted">Clique em "Ver histórico".</div></div></div>' +
      '</div>';
  }

  /* ---------------- REGRAS ---------------- */
  function renderRegras() {
    return '<div class="pane" id="pane-regras">' +
      '<div class="panel"><div class="panel-head"><div><h2>Regras tributárias</h2>' +
        '<div class="desc">Nenhuma alíquota vive no código. O motor escolhe a regra por empresa, regime, UF de origem e destino, ' +
        'município, tipo de operação, NCM e classificação — sempre respeitando a VIGÊNCIA.</div></div>' +
        '<div class="actions">' +
          '<button class="btn btn-ghost-m btn-sm" id="btnFiltrarRegras">Filtrar</button>' +
          (pode('fiscal.configurar') ? '<button class="btn btn-primary btn-sm" id="btnNovaRegraFiscal">+ Nova regra</button>' : '') +
        '</div></div>' +
        '<div class="panel-body">' +
          '<div class="filtros">' +
            '<div class="field"><label for="rgTributoF">Tributo</label><select id="rgTributoF"><option value="">Todos</option>' +
              ['ICMS', 'PIS', 'COFINS', 'IPI', 'ISS', 'IBS', 'CBS'].map(function (t) { return '<option>' + t + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="rgRegimeF">Regime</label><select id="rgRegimeF"><option value="">Todos</option>' +
              ['MEI', 'SIMPLES NACIONAL', 'LUCRO PRESUMIDO', 'LUCRO REAL'].map(function (t) { return '<option>' + t + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="rgBuscaF">Busca</label><input id="rgBuscaF" placeholder="código ou descrição" /></div>' +
          '</div>' +
          '<div id="listaRegras"><div class="muted">Carregando…</div></div>' +
        '</div></div></div>';
  }

  function carregarRegras() {
    var el = $('listaRegras');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarRegras(EMPRESA, {
      tributo: ($('rgTributoF') || {}).value || '',
      regimeTributario: ($('rgRegimeF') || {}).value || '',
      busca: ($('rgBuscaF') || {}).value || ''
    }).then(function (arr) {
      estado.regras = arr || [];
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhuma regra encontrada.</div>'; return; }

      el.innerHTML = '<div style="overflow-x:auto;max-height:560px"><table><thead><tr>' +
        '<th>Código</th><th>Tributo</th><th>Descrição</th><th>Regime</th><th>UF</th><th>Tipo</th>' +
        '<th>NCM</th><th>CST/CSOSN</th><th>Alíquota</th><th>Vigência</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + arr.map(function (r) {
          var global = r.empresaId == null;
          var temAliquota = (Number(r.aliquota) || 0) > 0;
          return '<tr><td class="mono">' + esc(r.codigo) + (global ? '<br /><span class="badge off">global</span>' : '') + '</td>' +
            '<td><b>' + esc(r.tributo) + '</b></td>' +
            '<td class="muted" style="max-width:220px">' + esc(r.descricao) + '</td>' +
            '<td>' + esc(r.regimeTributario || '—') + '</td>' +
            '<td>' + esc([r.ufOrigem, r.ufDestino].filter(Boolean).join('→') || '—') + '</td>' +
            '<td>' + esc(r.tipoOperacao || '—') + '</td>' +
            '<td class="mono">' + esc(r.ncm || '—') + '</td>' +
            '<td class="mono">' + esc(r.cst || r.csosn || '—') + '</td>' +
            '<td>' + (temAliquota ? ((Number(r.aliquota) || 0) + '%') : '<span class="badge warn">ZERO</span>') + '</td>' +
            '<td class="muted">' + esc(r.vigenciaInicial || '—') + (r.vigenciaFinal ? ' até ' + esc(r.vigenciaFinal) : '') + '</td>' +
            '<td><div class="td-actions">' +
              (global || !pode('fiscal.configurar') ? '' :
                '<button class="btn btn-sm btn-ghost-m" data-edregra="' + r.id + '">Editar</button>' +
                '<button class="btn btn-sm btn-danger" data-delregra="' + r.id + '">Desativar</button>') +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">As regras marcadas como <b>global</b> são o catálogo base ' +
        '(sem alíquota presumida). Cadastre a regra da sua empresa: ela tem prioridade sobre a global. ' +
        'As regras com alíquota <b>ZERO</b> avisam, no cálculo, que falta parametrizar.</div>';

      el.querySelectorAll('[data-edregra]').forEach(function (b) {
        b.addEventListener('click', function () {
          modalRegra(arr.filter(function (x) { return x.id === Number(b.dataset.edregra); })[0]);
        });
      });
      el.querySelectorAll('[data-delregra]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Desativar esta regra? As notas já emitidas continuam válidas.')) return;
          DB.removerRegra(EMPRESA, Number(b.dataset.delregra))
            .then(function () { toast('Regra desativada.', 'ok'); carregarRegras(); })
            .catch(function (e) { toast(e.message, 'err'); });
        });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  function modalRegra(r) {
    var novo = !r;
    r = r || { tributo: 'ICMS', aliquota: 0, prioridade: 0, vigenciaInicial: new Date().toISOString().slice(0, 10) };
    function opcoes(lista, atual) {
      return '<option value="">— qualquer —</option>' + lista.map(function (x) {
        return '<option' + (atual === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('');
    }

    abrirModal('<h3>' + (novo ? 'Nova regra tributária' : 'Editar regra ' + esc(r.codigo)) + '</h3>' +
      '<div class="sub">Campo em branco significa "vale em qualquer situação". Quanto mais específica a regra, maior a prioridade sobre as genéricas.</div>' +
      '<div class="grid4">' +
        '<div class="field"><label>Código *</label><input id="rgCodigo" value="' + esc(r.codigo) + '" /></div>' +
        '<div class="field"><label>Tributo *</label><select id="rgTributo">' +
          ['ICMS', 'PIS', 'COFINS', 'IPI', 'ISS', 'IBS', 'CBS'].map(function (t) {
            return '<option' + (r.tributo === t ? ' selected' : '') + '>' + t + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>Alíquota (%) *</label>' +
          '<input id="rgAliquota" type="number" step="0.0001" min="0" value="' + (Number(r.aliquota) || 0) + '" /></div>' +
        '<div class="field"><label>Prioridade</label><input id="rgPrioridade" type="number" value="' + (Number(r.prioridade) || 0) + '" /></div>' +
        '<div class="field full"><label>Descrição *</label><input id="rgDescricao" value="' + esc(r.descricao) + '" /></div>' +
        '<div class="field"><label>Regime</label><select id="rgRegime">' +
          opcoes(['MEI', 'SIMPLES NACIONAL', 'LUCRO PRESUMIDO', 'LUCRO REAL'], r.regimeTributario) + '</select></div>' +
        '<div class="field"><label>UF origem</label><input id="rgUfOrigem" maxlength="2" value="' + esc(r.ufOrigem || '') + '" /></div>' +
        '<div class="field"><label>UF destino</label><input id="rgUfDestino" maxlength="2" value="' + esc(r.ufDestino || '') + '" /></div>' +
        '<div class="field"><label>Município</label><input id="rgMunicipio" value="' + esc(r.municipio || '') + '" /></div>' +
        '<div class="field"><label>Tipo de operação</label><select id="rgTipo">' +
          opcoes(['VENDA', 'SERVICO', 'DEVOLUCAO', 'COMPRA', 'PERDA', 'TRANSFERENCIA'], r.tipoOperacao) + '</select></div>' +
        '<div class="field"><label>NCM</label><input id="rgNcm" maxlength="8" value="' + esc(r.ncm || '') + '" /></div>' +
        '<div class="field"><label>Classificação tributária</label><input id="rgClassif" value="' + esc(r.classificacaoTributaria || '') + '" /></div>' +
        '<div class="field"><label>CST</label><input id="rgCst" maxlength="3" value="' + esc(r.cst || '') + '" /></div>' +
        '<div class="field"><label>CSOSN</label><input id="rgCsosn" maxlength="3" value="' + esc(r.csosn || '') + '" /></div>' +
        '<div class="field"><label>CFOP</label><input id="rgCfop" maxlength="4" value="' + esc(r.cfop || '') + '" /></div>' +
        '<div class="field"><label>Redução de base (%)</label>' +
          '<input id="rgReducao" type="number" step="0.01" min="0" value="' + (Number(r.reducaoBase) || 0) + '" /></div>' +
        '<div class="field"><label>Diferimento (%)</label>' +
          '<input id="rgDiferimento" type="number" step="0.01" min="0" value="' + (Number(r.diferimento) || 0) + '" /></div>' +
        '<div class="field"><label>Desoneração (%)</label>' +
          '<input id="rgDesoneracao" type="number" step="0.01" min="0" value="' + (Number(r.desoneracao) || 0) + '" /></div>' +
        '<div class="field"><label>Vigência inicial</label>' +
          '<input id="rgVigIni" type="date" value="' + esc(r.vigenciaInicial || '') + '" /></div>' +
        '<div class="field"><label>Vigência final</label>' +
          '<input id="rgVigFim" type="date" value="' + esc(r.vigenciaFinal || '') + '" /></div>' +
      '</div>' +
      '<div class="info-box" style="margin-top:12px">O sistema NÃO presume alíquota: o valor informado aqui é o que será calculado. ' +
      'Para IBS e CBS (Reforma Tributária), cadastre a regra com a vigência aplicável — nada é fixado no código.</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">' + (novo ? 'Cadastrar' : 'Salvar') + '</button></div>', true);

    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var d = {
        id: novo ? undefined : r.id,
        codigo: $('rgCodigo').value.trim(),
        descricao: $('rgDescricao').value.trim(),
        tributo: $('rgTributo').value,
        aliquota: Number($('rgAliquota').value) || 0,
        prioridade: Number($('rgPrioridade').value) || 0,
        regimeTributario: $('rgRegime').value || null,
        ufOrigem: $('rgUfOrigem').value.trim().toUpperCase() || null,
        ufDestino: $('rgUfDestino').value.trim().toUpperCase() || null,
        municipio: $('rgMunicipio').value.trim() || null,
        tipoOperacao: $('rgTipo').value || null,
        ncm: $('rgNcm').value.trim() || null,
        classificacaoTributaria: $('rgClassif').value.trim() || null,
        cst: $('rgCst').value.trim() || null,
        csosn: $('rgCsosn').value.trim() || null,
        cfop: $('rgCfop').value.trim() || null,
        reducaoBase: Number($('rgReducao').value) || 0,
        diferimento: Number($('rgDiferimento').value) || 0,
        desoneracao: Number($('rgDesoneracao').value) || 0,
        vigenciaInicial: $('rgVigIni').value || null,
        vigenciaFinal: $('rgVigFim').value || null
      };
      if (!d.codigo) return toast('Informe o código da regra.', 'err');
      if (!d.descricao) return toast('Informe a descrição da regra.', 'err');
      $('mOk').disabled = true;
      DB.salvarRegra(EMPRESA, d).then(function () {
        fecharModal(); toast('Regra salva.', 'ok'); carregarRegras();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }/* ---------------- SERVIÇOS (NFS-e) ---------------- */
  function renderServicos() {
    return '<div class="pane" id="pane-servicos">' +
      '<div class="panel"><div class="panel-head"><div><h2>Serviços (NFS-e)</h2>' +
        '<div class="desc">O código do serviço, o item da LC 116 e o código tributário MUNICIPAL são POR MUNICÍPIO. ' +
        'A alíquota de um município NÃO vale para outro — por isso o município é obrigatório.</div></div></div>' +
        '<div class="panel-body">' +
          '<div id="listaServicos"><div class="muted">Carregando…</div></div>' +
        '</div></div></div>';
  }

  function carregarServicos() {
    var el = $('listaServicos');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarServicosFiscais(EMPRESA).then(function (arr) {
      estado.servicos = arr || [];
      if (!arr.length) {
        el.innerHTML = '<div class="muted">Nenhum serviço cadastrado.<br />' +
          'Cadastre hospedagem, lavanderia, transfer e demais serviços com o código do SEU município ' +
          '(em <b>Configurações → Fiscal → Serviços</b>).</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Descrição</th><th>Item LC 116</th><th>Cód. municipal</th><th>Município</th><th>ISS</th>' +
        '<th>Retenção</th><th>PIS/COFINS</th><th>IBS/CBS</th></tr></thead><tbody>' +
        arr.map(function (s) {
          return '<tr><td><b>' + esc(s.descricao) + '</b></td>' +
            '<td class="mono">' + esc(s.itemLc116 || '—') + '</td>' +
            '<td class="mono">' + esc(s.codigoTributarioMunicipal || '—') + '</td>' +
            '<td>' + esc(s.municipio) + (s.uf ? '/' + esc(s.uf) : '') + '</td>' +
            '<td>' + (Number(s.aliquotaIss) || 0) + '%</td>' +
            '<td>' + (s.retencaoIss ? '<span class="badge warn">Retém</span>' : '—') + '</td>' +
            '<td class="muted">' + (Number(s.aliquotaPis) || 0) + '% / ' + (Number(s.aliquotaCofins) || 0) + '%</td>' +
            '<td class="muted">' + (Number(s.aliquotaIbs) || 0) + '% / ' + (Number(s.aliquotaCbs) || 0) + '%</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">Para emissão de NFS-e real, configure o provedor em ' +
        '<b>Configurações → Fiscal → Integração fiscal</b>. O sistema separa claramente HOSPEDAGEM/SERVIÇOS de ' +
        'VENDA DE MERCADORIAS: são documentos diferentes.</div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  /* ---------------- CONTINGÊNCIA ---------------- */
  function renderContingencia() {
    return '<div class="pane" id="pane-contingencia">' +
      '<div class="panel"><div class="panel-head"><div><h2>Contingência fiscal</h2>' +
        '<div class="desc">Se o serviço fiscal cair, o documento é registrado e reprocessado depois. ' +
        'A VENDA NUNCA SE PERDE — o sistema não finge que transmitiu.</div></div>' +
        '<span class="badge on" id="badgeContingencia">Verificando…</span></div>' +
        '<div class="panel-body">' +
          '<div class="actions">' +
            (pode('fiscal.configurar') ? '<button class="btn btn-warn" id="btnAtivarContingencia">Ativar contingência</button>' : '') +
            (pode('fiscal.configurar') ? '<button class="btn btn-ok" id="btnEncerrarContingencia">Encerrar e reprocessar</button>' : '') +
            '<button class="btn btn-ghost-m" id="btnRecarregarContingencia">Recarregar</button>' +
          '</div>' +
          '<div class="info-box" style="margin-top:14px">O reprocessamento é IDEMPOTENTE: o mesmo documento não é ' +
          'autorizado duas vezes, e a baixa de estoque não se duplica.</div>' +
        '</div></div>' +
      '<div class="panel"><div class="panel-head"><h2>Histórico de contingências</h2></div>' +
        '<div class="panel-body" id="listaContingencias"><div class="muted">Carregando…</div></div></div>' +
      '</div>';
  }

  function carregarContingencias() {
    var el = $('listaContingencias');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarContingencias(EMPRESA).then(function (arr) {
      arr = arr || [];
      var ativa = arr.filter(function (c) { return !c.dataFim; })[0];
      var b = $('badgeContingencia');
      if (b) {
        b.textContent = ativa ? ('ATIVA — ' + esc(ativa.tipoContingencia)) : 'Normal';
        b.className = 'badge ' + (ativa ? 'err' : 'on');
      }
      if (!arr.length) {
        el.innerHTML = '<div class="ok-box">Nenhuma contingência registrada. O serviço fiscal está em operação normal.</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Tipo</th><th>Motivo</th><th>Início</th><th>Fim</th><th>Reprocessamento</th><th>Documentos</th>' +
        '</tr></thead><tbody>' + arr.map(function (c) {
          var docs = [];
          try { docs = JSON.parse(c.documentosAfetados || '[]'); } catch (e) { docs = []; }
          return '<tr><td><b>' + esc(c.tipoContingencia) + '</b></td>' +
            '<td class="muted" style="max-width:280px">' + esc(c.motivo || '—') + '</td>' +
            '<td class="muted">' + esc(String(c.dataInicio || '').slice(0, 16).replace('T', ' ')) + '</td>' +
            '<td>' + (c.dataFim
              ? esc(String(c.dataFim).slice(0, 16).replace('T', ' '))
              : '<span class="badge err">ATIVA</span>') + '</td>' +
            '<td><span class="badge ' + (c.statusReprocessamento === 'CONCLUIDO' ? 'on' : 'warn') + '">' +
              esc(c.statusReprocessamento || '—') + '</span></td>' +
            '<td>' + (docs.length ? docs.length + ' documento(s)' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  function modalAtivarContingencia() {
    abrirModal('<h3>Ativar contingência fiscal</h3>' +
      '<div class="sub">A partir da ativação, os documentos são registrados e ficam aguardando reprocessamento.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Tipo de contingência</label><select id="ctTipo">' +
          ['SVC_AN', 'SVC_RS', 'EPEC', 'FS_DA', 'AUTOMATICA_OFFLINE'].map(function (t) {
            return '<option>' + t + '</option>';
          }).join('') + '</select><span class="hint">O tipo correto depende da indisponibilidade — confirme com a contabilidade.</span></div>' +
        '<div class="field full"><label>Motivo *</label>' +
          '<input id="ctMotivo" placeholder="ex.: SEFAZ indisponível desde 14h" /></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-warn" id="mOk">Ativar contingência</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      $('mOk').disabled = true;
      DB.ativarContingencia(EMPRESA, {
        tipoContingencia: $('ctTipo').value,
        motivo: $('ctMotivo').value.trim() || 'Serviço fiscal indisponível'
      }).then(function () {
        fecharModal();
        toast('Contingência ativada. Os documentos ficam pendentes de transmissão.', 'ok');
        carregarContingencias();
        carregarPainel();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function encerrarEReprocessar() {
    if (!confirm('Encerrar a contingência e reprocessar os documentos pendentes agora?')) return;
    DB.encerrarContingencia(EMPRESA, {}).then(function (r) {
      toast('Contingência encerrada: ' + r.documentosParaReprocessar.length + ' documento(s).', 'ok');
      return DB.reprocessarContingencia(EMPRESA, {});
    }).then(function (r) {
      if (r && r.reprocessados) {
        abrirModal('<h3>Reprocessamento concluído</h3>' +
          '<div class="' + (r.resultados.every(function (x) { return x.para === 'AUTORIZADA'; }) ? 'ok-box' : 'aviso-servidor') + '">' +
          r.reprocessados + ' documento(s) reprocessado(s).</div>' +
          '<div style="overflow-x:auto"><table><thead><tr>' +
          '<th>Documento</th><th>Número</th><th>Resultado</th><th>Mensagem</th></tr></thead><tbody>' +
          r.resultados.map(function (x) {
            return '<tr><td class="mono">' + x.documentoId + '</td><td>' + esc(x.numero || '—') + '</td>' +
              '<td><span class="badge ' + corStatus(x.para) + '">' + esc(x.para) + '</span></td>' +
              '<td class="muted">' + esc(x.mensagem || '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>', true);
        $('mCancel').addEventListener('click', fecharModal);
      } else {
        toast('Nenhum documento pendente de reprocessamento.', 'ok');
      }
      carregarContingencias();
      carregarPainel();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------------- LOGS ---------------- */
  function renderLogs() {
    return '<div class="pane" id="pane-logs">' +
      '<div class="panel"><div class="panel-head"><div><h2>Logs fiscais</h2>' +
        '<div class="desc">Cada operação fiscal (emissão, consulta, cancelamento, inutilização) fica registrada com ' +
        'requisição, resposta, status e código de retorno. O sistema NÃO apaga estes logs automaticamente: ' +
        'eles são a prova de cada comunicação com o fisco.</div></div>' +
        '<div class="actions">' +
          '<button class="btn btn-ghost-m btn-sm" id="btnFiltrarLogs">Filtrar</button>' +
          '<button class="btn btn-ghost-m btn-sm" id="btnExportarLogs">Exportar CSV</button>' +
        '</div></div>' +
        '<div class="panel-body">' +
          '<div class="filtros">' +
            '<div class="field"><label for="lgOperacao">Operação</label><select id="lgOperacao"><option value="">Todas</option>' +
              ['EMITIR', 'CANCELAR', 'INUTILIZAR', 'CONSULTAR', 'CONSULTAR_STATUS', 'BAIXAR_XML', 'BAIXAR_DANFE',
                'ENVIAR_EMAIL', 'ENVIAR_WHATSAPP', 'REPROCESSAR', 'CONTINGENCIA_ATIVADA', 'CONTINGENCIA_ENCERRADA']
                .map(function (o) { return '<option>' + o + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="lgStatus">Status</label><select id="lgStatus"><option value="">Todos</option>' +
              ['OK', 'AUTORIZADA', 'CONTINGENCIA', 'ERRO', 'REJEITADA'].map(function (s) { return '<option>' + s + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="lgDoc">Documento</label><input id="lgDoc" placeholder="nº do documento" /></div>' +
          '</div>' +
          '<div id="listaLogs"><div class="muted">Carregando…</div></div>' +
        '</div></div></div>';
  }

  function carregarLogs() {
    var el = $('listaLogs');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    var filtro = {
      limite: 300,
      operacao: ($('lgOperacao') || {}).value || '',
      status: ($('lgStatus') || {}).value || '',
      documentoId: ($('lgDoc') || {}).value ? Number($('lgDoc').value) : ''
    };
    DB.listarLogsFiscais(EMPRESA, filtro).then(function (arr) {
      arr = arr || [];
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhum log registrado com estes filtros.</div>'; return; }
      el.innerHTML = '<div style="overflow-x:auto;max-height:560px"><table><thead><tr>' +
        '<th>Data/hora</th><th>Operação</th><th>Documento</th><th>Status</th><th>Retorno</th>' +
        '<th>Mensagem</th><th>Provedor</th><th>Ambiente</th><th>Usuário</th>' +
        '</tr></thead><tbody>' + arr.map(function (l) {
          return '<tr><td class="muted">' + esc(String(l.data_hora || '').slice(0, 19).replace('T', ' ')) + '</td>' +
            '<td><b>' + esc(l.operacao) + '</b></td>' +
            '<td class="mono">' + esc(l.documentoId || '—') + '</td>' +
            '<td><span class="badge ' + (['OK', 'AUTORIZADA'].indexOf(l.status) !== -1 ? 'on' : 'warn') + '">' +
              esc(l.status || '—') + '</span></td>' +
            '<td class="mono">' + esc(l.codigoRetorno || '—') + '</td>' +
            '<td class="muted" style="max-width:300px">' + esc(l.mensagem || '') + '</td>' +
            '<td class="muted">' + esc(l.provedor || '—') + '</td>' +
            '<td class="muted">' + esc(l.ambiente || '—') + '</td>' +
            '<td class="muted">' + esc(l.usuario || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">' + arr.length + ' registro(s) exibido(s).</div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  /* ================================================================== */
  /* EMISSÃO                                                            */
  /* ================================================================== */

  function definirDocumento() {
    var el = $('resultadoEmitir');
    var itens = montarItens();
    if (!itens.length) return toast('Adicione pelo menos um item.', 'err');
    var tipo = $('emTipo').value;

    DB.definirDocumentoFiscal(EMPRESA, {
      ufEmpresa: sessao.uf || null,
      consumidorFinal: !$('emDoc').value.trim(),
      cliente: { uf: $('emUf').value.trim().toUpperCase() || null },
      itens: itens.map(function (i) {
        var p = estado.categorias[i.produtoId] || {};
        return {
          // NFS-e só aceita serviço; NF-e/NFC-e só mercadoria. O usuário
          // escolhe o tipo, mas o sistema avisa quando há mistura.
          tipo: (tipo === 'NFSE' && i.produtoId && p.servico) ? 'SERVICO' : undefined,
          servico: (tipo === 'NFSE') ? { itemLc116: p.itemLc116 } : undefined,
          valor: i.valorUnitario, quantidade: i.quantidade
        };
      })
    }).then(function (r) {
      el.innerHTML = '<div class="info-box"><b>Documento(s) aplicável(is):</b></div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>Tipo</th><th>Itens</th><th>Valor</th><th>Motivo</th></tr></thead><tbody>' +
        r.documentos.map(function (d) {
          return '<tr><td><b>' + esc(d.tipo) + '</b></td><td>' + d.itens + '</td><td>' + brl(d.valor) + '</td>' +
            '<td class="muted">' + esc(d.motivo) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (r.avisos.length
          ? '<div class="aviso-servidor" style="margin-top:12px"><ul class="checks">' +
            r.avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>'
          : '');
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  function emitirDocumento() {
    var el = $('resultadoEmitir');
    var itens = montarItens();
    if (!itens.length) return toast('Adicione pelo menos um item com quantidade maior que zero.', 'err');

    var tipo = $('emTipo').value;
    var ambiente = $('emAmbiente').value;
    if (tipo === 'NFSE') {
      /* NFS-e separa serviço de mercadoria. Avisamos ANTES de tentar, para
       * o operador não descobrir depois de emitir. */
      var temMercadoria = itens.some(function (i) {
        var p = estado.categorias[i.produtoId] || {};
        return !p.servico;
      });
      if (temMercadoria && !confirm(
        'Alguns itens selecionados não estão marcados como SERVIÇO no cadastro do produto.\n\n' +
        'NFS-e é o documento de SERVIÇOS. Se estes itens forem mercadoria, emita NF-e/NFC-e.\n\nContinuar mesmo assim?')) return;
    }
    if (ambiente === 'PRODUCAO' && !confirm(
      'Você está emitindo em PRODUÇÃO. Isso gera documento fiscal REAL.\n\nConfirmar a emissão?')) return;

    $('btnEmitir').disabled = true;
    el.innerHTML = '<div class="muted">Emitindo…</div>';

    DB.emitirDocumentoFiscal(EMPRESA, {
      tipoDocumento: tipo,
      ambiente: ambiente,
      origemTipo: $('emOrigemTipo').value,
      origemId: 'MANUAL-' + Date.now(),
      cliente: {
        nome: $('emCliente').value.trim() || 'CONSUMIDOR FINAL',
        documento: $('emDoc').value.trim() || null,
        uf: $('emUf').value.trim().toUpperCase() || null
      },
      itens: itens.map(function (i) {
        var p = estado.categorias[i.produtoId] || {};
        return {
          produtoId: i.produtoId,
          descricao: i.descricao || p.nome,
          quantidade: i.quantidade,
          valorUnitario: i.valorUnitario,
          unidade: p.unidade,
          ncm: p.ncm,
          servico: tipo === 'NFSE' ? { itemLc116: p.itemLc116, aliquotaIss: p.aliquotaIss } : undefined
        };
      }),
      pagamentos: [{ forma: 'Dinheiro', valor: itens.reduce(function (s, i) { return s + i.quantidade * i.valorUnitario; }, 0) }]
    }).then(function (r) {
      $('btnEmitir').disabled = false;
      var cor = corStatus(r.status);
      el.innerHTML =
        '<div class="' + (r.duplicado ? 'aviso-servidor' : (r.status === 'AUTORIZADA' ? 'ok-box' : 'info-box')) + '">' +
        (r.duplicado
          ? '<b>Documento já existente.</b> ' + esc(r.motivo)
          : '<b>Documento registrado.</b> Status: ' + esc(r.status) +
            (r.numero ? ' — nº ' + esc(r.numero) + '/' + esc(r.serie || '') : '') +
            (r.simulado ? '<br />Emissão SIMULADA: nenhum documento real foi transmitido ao fisco.' : '')) +
        '</div>' +
        '<div class="grid4" style="margin-top:12px">' +
          campo('Status', '<span class="badge ' + cor + '">' + esc(r.status || '—') + '</span>') +
          campo('Número', esc(r.numero || '—')) +
          campo('Série', esc(r.serie || '—')) +
          campo('Protocolo', '<span class="mono">' + esc(r.protocolo || '—') + '</span>') +
          campo('Ambiente', esc(r.ambiente || '—')) +
          campo('Provedor', esc(r.provedor || '—')) +
          campo('Modo', r.simulado ? 'SIMULADO' : 'Transmissão real') +
          campo('Retorno', esc(r.codigoRetorno || '—')) +
        '</div>' +
        (r.mensagem ? '<div class="info-box" style="margin-top:12px">' + esc(r.mensagem) + '</div>' : '') +
        ((r.avisosTributarios || []).length
          ? '<div class="aviso-servidor" style="margin-top:12px"><b>Parametrização pendente — o tributo foi calculado com alíquota ZERO:</b>' +
            '<ul class="checks">' + r.avisosTributarios.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' +
            'Cadastre a regra em <b>Regras tributárias</b> antes de emitir em produção.</div>'
          : '') +
        (r.emContingencia
          ? '<div class="erro-box" style="margin-top:12px">Documento em CONTINGÊNCIA. ' +
            'Ele será reprocessado quando o serviço voltar — nenhuma venda foi perdida.</div>'
          : '') +
        '<div class="actions" style="margin-top:14px">' +
          (r.documentoId ? '<button class="btn btn-ghost-m" id="btnVerDocEmitido">Ver documento</button>' : '') +
        '</div>';

      if ($('btnVerDocEmitido')) {
        $('btnVerDocEmitido').addEventListener('click', function () { detalhar(r.documentoId); });
      }
      toast(r.duplicado ? 'Documento já existia — nada foi duplicado.' : 'Documento registrado.', r.duplicado ? 'ok' : 'ok');
    }).catch(function (e) {
      $('btnEmitir').disabled = false;
      el.innerHTML = '<div class="erro-box"><b>Não foi possível emitir.</b><br />' + esc(e.message) + '</div>';
      toast('Falha na emissão: ' + e.message, 'err');
    });
  }

  /* ================================================================== */
  /* INUTILIZAÇÃO                                                       */
  /* ================================================================== */

  function inutilizar() {
    var el = $('resultadoInutilizar');
    var just = $('inJust').value.trim();
    if (just.length < 15) return toast('A justificativa precisa de pelo menos 15 caracteres.', 'err');
    $('btnInutilizar').disabled = true;
    DB.inutilizarNumeracao(EMPRESA, {
      modelo: $('inModelo').value,
      serie: $('inSerie').value,
      numeroInicial: Number($('inIni').value),
      numeroFinal: Number($('inFim').value),
      justificativa: just,
      ambiente: $('inAmbiente').value
    }).then(function (r) {
      $('btnInutilizar').disabled = false;
      el.innerHTML = '<div class="' + (r.ok ? 'ok-box' : 'erro-box') + '">' +
        (r.ok ? 'Faixa inutilizada. Protocolo: ' + esc(r.protocolo || '—')
          : 'Não inutilizada: ' + esc(r.mensagem || '')) + '</div>';
      toast(r.ok ? 'Faixa inutilizada.' : 'Falha na inutilização.', r.ok ? 'ok' : 'err');
    }).catch(function (e) {
      $('btnInutilizar').disabled = false;
      el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>';
      toast(e.message, 'err');
    });
  }

  function carregarInutilizacoes() {
    var el = $('listaInutilizacoes');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.listarInutilizacoes(EMPRESA).then(function (arr) {
      arr = arr || [];
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhuma inutilização registrada.</div>'; return; }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Modelo</th><th>Série</th><th>Faixa</th><th>Justificativa</th><th>Protocolo</th><th>Status</th><th>Ambiente</th>' +
        '</tr></thead><tbody>' + arr.map(function (i) {
          return '<tr><td>' + esc(i.modelo) + '</td><td class="mono">' + esc(i.serie) + '</td>' +
            '<td class="mono">' + esc(i.numeroInicial) + ' a ' + esc(i.numeroFinal) + '</td>' +
            '<td class="muted" style="max-width:280px">' + esc(i.justificativa) + '</td>' +
            '<td class="mono">' + esc(i.protocolo || '—') + '</td>' +
            '<td><span class="badge ' + (i.status === 'HOMOLOGADA' ? 'on' : 'err') + '">' + esc(i.status) + '</span></td>' +
            '<td>' + esc(i.ambiente) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="aviso-servidor">' + esc(e.message) + '</div>';
    });
  }

  /* ================================================================== */
  /* LIGAÇÕES                                                           */
  /* ================================================================== */

  function ligarTudo() {
    if ($('btnFiltrarDocs')) $('btnFiltrarDocs').addEventListener('click', carregarDocumentos);
    ['dcTipo', 'dcStatus', 'dcAmbiente'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', carregarDocumentos);
    });
    if ($('dcBusca')) $('dcBusca').addEventListener('input', debounce(carregarDocumentos, 400));

    if ($('btnAddItem')) $('btnAddItem').addEventListener('click', adicionarLinhaItem);
    if ($('btnDefinirDocumento')) $('btnDefinirDocumento').addEventListener('click', definirDocumento);
    if ($('btnEmitir')) $('btnEmitir').addEventListener('click', emitirDocumento);
    renderItens();

    if ($('btnFiltrarRegras')) $('btnFiltrarRegras').addEventListener('click', carregarRegras);
    ['rgTributoF', 'rgRegimeF'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', carregarRegras);
    });
    if ($('rgBuscaF')) $('rgBuscaF').addEventListener('input', debounce(carregarRegras, 400));
    if ($('btnNovaRegraFiscal')) $('btnNovaRegraFiscal').addEventListener('click', function () { modalRegra(null); });

    if ($('btnInutilizar')) $('btnInutilizar').addEventListener('click', inutilizar);
    if ($('btnVerInutilizacoes')) $('btnVerInutilizacoes').addEventListener('click', carregarInutilizacoes);

    if ($('btnAtivarContingencia')) $('btnAtivarContingencia').addEventListener('click', modalAtivarContingencia);
    if ($('btnEncerrarContingencia')) $('btnEncerrarContingencia').addEventListener('click', encerrarEReprocessar);
    if ($('btnRecarregarContingencia')) $('btnRecarregarContingencia').addEventListener('click', carregarContingencias);

    if ($('btnFiltrarLogs')) $('btnFiltrarLogs').addEventListener('click', carregarLogs);
    ['lgOperacao', 'lgStatus'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('change', carregarLogs);
    });
    if ($('btnExportarLogs')) $('btnExportarLogs').addEventListener('click', function () {
      DB.listarLogsFiscais(EMPRESA, { limite: 1000 }).then(function (arr) {
        var colunas = ['data_hora', 'operacao', 'documentoId', 'tipoDocumento', 'status', 'codigoRetorno',
          'mensagem', 'ambiente', 'provedor', 'usuario'];
        var csv = '\ufeff' + colunas.join(';') + '\r\n' + arr.map(function (l) {
          return colunas.map(function (c) {
            var v = l[c] == null ? '' : String(l[c]);
            return (v.indexOf(';') !== -1 || v.indexOf('"') !== -1 || v.indexOf('\n') !== -1)
              ? '"' + v.replace(/"/g, '""') + '"' : v;
          }).join(';');
        }).join('\r\n');
        baixar('logs-fiscais-' + new Date().toISOString().slice(0, 10) + '.csv', csv, 'text/csv;charset=utf-8');
        toast('CSV de logs gerado.', 'ok');
      }).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  function debounce(fn, ms) {
    var t = null;
    return function () { if (t) clearTimeout(t); t = setTimeout(fn, ms); };
  }

  $('btnRefresh').addEventListener('click', function () {
    carregarPainel();
    if (estado.aba === 'documentos') carregarDocumentos();
    if (estado.aba === 'regras') carregarRegras();
    if (estado.aba === 'servicos') carregarServicos();
    if (estado.aba === 'contingencia') carregarContingencias();
    if (estado.aba === 'logs') carregarLogs();
    toast('Dados fiscais atualizados.', 'ok');
  });

  DB.aoAtualizar(function (msg) {
    if (msg && (msg.entidade === 'fiscal' || msg.entidade === 'documento')) {
      carregarPainel();
    }
  });

  DB.init().then(renderTudo).catch(function (e) {
    $('avisos').innerHTML = '<div class="erro-box">Falha ao abrir o sistema: ' + esc(e.message) + '</div>';
  });
})();