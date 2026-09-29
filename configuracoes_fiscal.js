/*
 * Turismo OS — Configurações: módulo FISCAL (configuracoes_fiscal.js)
 * =====================================================================
 * Depende de configuracoes.js, que publica os helpers em window.cfg*.
 *
 * Cobre: prontidão, regime (com histórico), certificado digital, série e
 * numeração, regras tributárias, simulador, serviços NFS-e, documentos
 * emitidos, provedores, contingência e logs fiscais.
 *
 * Toda gravação vai para o SERVIDOR, onde ficam a permissão e a validação
 * de verdade. Em modo local as operações fiscais recusam com explicação
 * clara, em vez de fingir que funcionaram.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* Os helpers são lidos de `window` NO MOMENTO DO USO, e não capturados
   * uma única vez na definição. Sem isso, qualquer mudança na ordem dos
   * <script> faz este módulo receber `undefined` e a aba Fiscal some sem
   * erro no console — o pior tipo de falha, silenciosa. */
  function esc(s) { return window.cfgEsc(s); }
  function toast(m, t) { return window.cfgToast(m, t); }
  function pode(c) { return window.cfgPode(c); }
  function abrirModal(h) { return window.cfgAbrirModal(h); }
  function fecharModal() { return window.cfgFecharModal(); }
  function UFS() { return window.cfgUFS; }
  function servidor() { return window.cfgModoServidor(); }
  var empresa = null;
  function empresaId() { return window.cfgEmpresa; }

  function estado() { return window.cfgEstado; }
  function recarregar() { return window.cfgCarregar().then(window.cfgRenderTudo); }

  /* ================================================================== */
  /* RENDER DA ABA FISCAL                                               */
  /* ================================================================== */

  window.renderFiscalCompleto = function renderFiscalCompleto() {
    if (!pode('fiscal.visualizar')) return '';
    var e = estado().empresa || {};
    var cert = estado().certificado;
    var reg = estado().regimes || {};
    var pronto = estado().prontidao || {};
    var ro = !pode('fiscal.configurar');

    return '<div class="cfg-pane" id="pane-fiscal">' +

      /* ---------- Prontidão ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Prontidão para emitir</h2>' +
        '<div class="desc">A emissão só é liberada com os dados mínimos preenchidos — e o sistema aponta exatamente o que corrigir.</div></div>' +
        '<span class="badge ' + (pronto.pronto ? 'on' : 'err') + '">' + (pronto.pronto ? 'Pronto' : 'Pendente') + '</span></div>' +
        '<div class="panel-body">' +
          (!servidor()
            ? '<div class="aviso-servidor">Sem o servidor no ar a emissão fica indisponível: o certificado, a assinatura e a transmissão ficam no backend.</div>'
            : '') +
          (pronto.pronto
            ? '<div class="ok-box">Cadastro fiscal completo e certificado válido. A emissão está liberada.</div>'
            : '<div class="erro-box">Ainda falta configurar:</div><ul class="checks">' +
              (pronto.motivos || []).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>') +
        '</div></div>' +

      /* ---------- Dados fiscais e regime ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Dados fiscais e regime tributário</h2>' +
        '<div class="desc">O histórico de regimes fica registrado: é ele que explica por que uma nota antiga usou outro regime.</div></div>' +
        '<span class="badge info">' + esc((reg.vigente && reg.vigente.regimeTributario) || 'não definido') + '</span></div>' +
        '<div class="panel-body">' +
          '<div class="grid3">' +
            '<div class="field"><label for="fRegimeTrib">Regime tributário</label><select id="fRegimeTrib"' + (ro ? ' disabled' : '') + '>' +
              ['MEI', 'SIMPLES NACIONAL', 'LUCRO PRESUMIDO', 'LUCRO REAL'].map(function (r) {
                return '<option' + (String(e.regimeTributario) === r ? ' selected' : '') + '>' + r + '</option>';
              }).join('') + '</select></div>' +
            '<div class="field"><label for="fCrt">CRT</label><input id="fCrt" value="' + esc(e.crt || '') + '"' + (ro ? ' disabled' : '') + ' />' +
              '<span class="hint">Código de Regime Tributário (1 ou 2 Simples/MEI, 3 Regime Normal).</span></div>' +
            '<div class="field"><label for="fAmbienteFiscal">Ambiente fiscal</label><select id="fAmbienteFiscal"' + (ro ? ' disabled' : '') + '>' +
              ['HOMOLOGACAO', 'PRODUCAO'].map(function (a) {
                return '<option value="' + a + '"' + (String(e.ambienteFiscal || 'HOMOLOGACAO') === a ? ' selected' : '') + '>' + a + '</option>';
              }).join('') + '</select><span class="hint">PRODUCAO emite documento fiscal real. Use HOMOLOGACAO para testes.</span></div>' +
          '</div>' +
          (reg.campos ? '<div class="info-box" style="margin-top:14px"><b>' + esc(reg.campos.regime) + '</b> usa <b>' + esc(reg.campos.usa) + '</b>.<br />' +
            'Campos obrigatórios: ' + esc((reg.campos.camposObrigatorios || []).join(', ')) + '.<br />' + esc(reg.campos.observacao) + '</div>' : '') +
          (ro ? '' : '<div class="actions" style="margin-top:14px">' +
            '<button class="btn btn-primary" id="btnSalvarFiscal">Salvar dados fiscais</button>' +
            '<button class="btn btn-warn" id="btnNovoRegime">Registrar novo regime</button>' +
          '</div>') +
          '<div class="subtitulo">Histórico de regimes</div>' +
          '<div style="overflow-x:auto"><table><thead><tr>' +
            '<th>Regime</th><th>CRT</th><th>Início</th><th>Fim</th><th>Observação</th>' +
          '</tr></thead><tbody>' +
          ((reg.historico || []).length ? reg.historico.map(function (r) {
            return '<tr><td><b>' + esc(r.regimeTributario) + '</b></td><td>' + esc(r.crt || '—') + '</td>' +
              '<td>' + esc(r.dataInicio || '—') + '</td>' +
              '<td>' + (r.dataFim ? esc(r.dataFim) : '<span class="badge on">vigente</span>') + '</td>' +
              '<td class="muted">' + esc(r.observacao || '—') + '</td></tr>';
          }).join('') : '<tr><td colspan="5" class="empty">Nenhum regime no histórico ainda.</td></tr>') +
          '</tbody></table></div>' +
        '</div></div>' +

      /* ---------- Certificado digital ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Certificado digital</h2>' +
        '<div class="desc">A senha é cifrada (AES-256-GCM) no servidor e NUNCA volta para a interface.</div></div>' +
        (cert ? '<span class="badge ' + (cert.vencido ? 'err' : (cert.aviso ? 'warn' : 'on')) + '">' +
          (cert.vencido ? 'Vencido' : (cert.aviso ? 'A vencer' : 'Válido')) + '</span>'
          : '<span class="badge off">Não cadastrado</span>') + '</div>' +
        '<div class="panel-body">' +
          (cert ? '<div class="grid3">' +
            '<div class="field"><label>Arquivo</label><div class="mono">' + esc(cert.nome) + '</div></div>' +
            '<div class="field"><label>Validade</label><div>' + esc(cert.validade) + '</div>' +
              (cert.diasParaVencer != null ? '<span class="hint">' + cert.diasParaVencer + ' dia(s) restantes</span>' : '') + '</div>' +
            '<div class="field"><label>Situação</label><div>' +
              (cert.temArquivo ? 'Arquivo enviado' : 'Sem arquivo') + ' · ' +
              (cert.temSenha ? 'Senha cifrada' : 'Sem senha') + '</div></div>' +
          '</div>' : '<div class="muted">Nenhum certificado cadastrado. Sem ele a emissão fiscal não é liberada.</div>') +
          (ro ? '' : '<div class="actions" style="margin-top:16px">' +
            '<button class="btn btn-primary" id="btnCertificado">' + (cert ? 'Substituir certificado' : 'Cadastrar certificado') + '</button>' +
          '</div>') +
        '</div></div>' +

      /* ---------- Série e numeração ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Série e numeração</h2>' +
        '<div class="desc">A numeração é por empresa, modelo, série e ambiente. Produção e homologação têm sequências separadas.</div></div>' +
        (ro ? '' : '<button class="btn btn-ghost-m btn-sm" id="btnSerie">Configurar série</button>') + '</div>' +
        '<div class="panel-body" id="listaSeries"><div class="muted">Carregando…</div></div></div>' +

      /* ---------- Regras tributárias ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Regras tributárias</h2>' +
        '<div class="desc">Nenhuma alíquota é fixada no código: o motor lê estas regras (vigência, regime, UF, município, NCM e tipo de operação).</div></div>' +
        '<div class="actions">' +
          (ro ? '' : '<button class="btn btn-primary btn-sm" id="btnNovaRegra">+ Nova regra</button>') +
          '<button class="btn btn-ghost-m btn-sm" id="btnAtualizarRegras">Ver regras</button>' +
          (ro ? '' : '<button class="btn btn-ghost-m btn-sm" id="btnImportarRegras">Importar pacote</button>') +
        '</div></div>' +
        '<div class="panel-body" id="listaRegras"><div class="muted">Clique em "Ver regras" para carregar.</div></div></div>' +

      /* ---------- Simulador ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Simulador tributário</h2>' +
        '<div class="desc">Testa o cálculo sem emitir documento. É assim que a contabilidade confere a parametrização.</div></div></div>' +
        '<div class="panel-body">' +
          '<div class="grid3">' +
            '<div class="field"><label for="simProduto">Produto</label><select id="simProduto"></select></div>' +
            '<div class="field"><label for="simTipo">Tipo de operação</label><select id="simTipo">' +
              ['VENDA', 'SERVICO', 'DEVOLUCAO', 'COMPRA'].map(function (t) { return '<option>' + t + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="simValor">Valor unitário (R$)</label><input id="simValor" type="number" step="0.01" value="100" /></div>' +
            '<div class="field"><label for="simQtd">Quantidade</label><input id="simQtd" type="number" step="0.001" value="1" /></div>' +
            '<div class="field"><label for="simUfDest">UF destino</label><select id="simUfDest"><option value="">—</option>' +
              UFS().map(function (u) { return '<option>' + u + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label for="simMunicipio">Município (ISS)</label><input id="simMunicipio" value="' + esc(e.cidade || '') + '" />' +
              '<span class="hint">A alíquota de um município não vale para outro.</span></div>' +
          '</div>' +
          '<div class="actions" style="margin-top:14px"><button class="btn btn-primary" id="btnSimular">Simular cálculo</button></div>' +
          '<div id="simResultado" style="margin-top:16px"></div>' +
        '</div></div>' +

      /* ---------- Serviços NFS-e ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Serviços (NFS-e)</h2>' +
        '<div class="desc">Código do serviço, item da LC 116 e código tributário municipal são POR MUNICÍPIO.</div></div>' +
        (ro ? '' : '<button class="btn btn-primary btn-sm" id="btnNovoServico">+ Novo serviço</button>') + '</div>' +
        '<div class="panel-body" id="listaServicos"><div class="muted">Carregando…</div></div></div>' +

      /* ---------- Documentos e provedores ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Documentos fiscais emitidos</h2>' +
        '<div class="desc">NF-e (55), NFC-e (65) e NFS-e. Cada operação tem identificador idempotente: reprocessar não duplica.</div></div>' +
        '<div class="actions">' +
          '<button class="btn btn-ghost-m btn-sm" id="btnVerDocumentos">Carregar documentos</button>' +
          '<button class="btn btn-ghost-m btn-sm" id="btnVerProvedores">Provedores</button>' +
        '</div></div>' +
        '<div class="panel-body" id="listaDocumentos"><div class="muted">Clique em "Carregar documentos".</div></div></div>' +

      /* ---------- Contingência ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Contingência</h2>' +
        '<div class="desc">Se o serviço fiscal cair, o documento é registrado e reprocessado depois. A operação nunca se perde.</div></div>' +
        '<span class="badge on" id="badgeContingencia">Verificando…</span></div>' +
        '<div class="panel-body">' +
          '<div class="actions">' +
            '<button class="btn btn-warn" id="btnContingenciaOn">Ativar contingência</button>' +
            '<button class="btn btn-ok" id="btnContingenciaOff">Encerrar e reprocessar</button>' +
            '<button class="btn btn-ghost-m" id="btnVerContingencias">Ver histórico</button>' +
          '</div>' +
          '<div id="listaContingencias" style="margin-top:14px"></div>' +
        '</div></div>' +

      /* ---------- Logs fiscais ---------- */
      '<div class="panel"><div class="panel-head"><div><h2>Logs fiscais</h2>' +
        '<div class="desc">Registro de cada operação (requisição, resposta, status e retorno). Estes logs NUNCA são apagados automaticamente.</div></div>' +
        '<button class="btn btn-ghost-m btn-sm" id="btnVerLogs">Carregar logs</button></div>' +
        '<div class="panel-body" id="listaLogs"><div class="muted">Clique em "Carregar logs".</div></div></div>' +

    '</div>';
  };

  /* A aba fiscal usada pelo render principal passa a ser a versão completa. */
  window.renderFiscalCompleto = window.renderFiscalCompleto || null;
  window.renderFiscal = function () { return window.renderFiscalCompleto(); };
  // renderFiscalCompleto é definido logo acima (nome canônico do módulo).

  /* ================================================================== */
  /* LIGAÇÕES                                                           */
  /* ================================================================== */

  window.ligarFiscal = function () {
    if (!pode('fiscal.visualizar')) return;
    var ro = !pode('fiscal.configurar');

    if ($('btnSalvarFiscal')) $('btnSalvarFiscal').addEventListener('click', function () {
      $('btnSalvarFiscal').disabled = true;
      DB.DB.configFiscal(empresaId(), {
        regimeTributario: $('fRegimeTrib').value,
        crt: $('fCrt').value.trim(),
        ambienteFiscal: $('fAmbienteFiscal').value
      }).then(function () {
        toast('Dados fiscais salvos.', 'ok');
        return recarregar();
      }).catch(function (e) { $('btnSalvarFiscal').disabled = false; toast(e.message, 'err'); });
    });

    if ($('btnNovoRegime')) $('btnNovoRegime').addEventListener('click', modalRegime);
    if ($('btnCertificado')) $('btnCertificado').addEventListener('click', modalCertificado);
    if ($('btnSerie')) $('btnSerie').addEventListener('click', modalSerie);
    if ($('btnNovaRegra')) $('btnNovaRegra').addEventListener('click', function () { modalRegra(null); });
    if ($('btnAtualizarRegras')) $('btnAtualizarRegras').addEventListener('click', carregarRegras);
    if ($('btnImportarRegras')) $('btnImportarRegras').addEventListener('click', modalImportarRegras);
    if ($('btnNovoServico')) $('btnNovoServico').addEventListener('click', modalServico);
    if ($('btnSimular')) $('btnSimular').addEventListener('click', simular);
    if ($('btnVerDocumentos')) $('btnVerDocumentos').addEventListener('click', carregarDocumentos);
    if ($('btnVerProvedores')) $('btnVerProvedores').addEventListener('click', carregarProvedores);
    if ($('btnContingenciaOn')) $('btnContingenciaOn').addEventListener('click', modalContingencia);
    if ($('btnContingenciaOff')) $('btnContingenciaOff').addEventListener('click', encerrarContingencia);
    if ($('btnVerContingencias')) $('btnVerContingencias').addEventListener('click', carregarContingencias);
    if ($('btnVerLogs')) $('btnVerLogs').addEventListener('click', carregarLogs);

    carregarSeries();
    carregarServicos();
    carregarProdutosSimulador();
    carregarStatusContingencia();
  };

  /* ================================================================== */
  /* CARREGADORES                                                       */
  /* ================================================================== */

  function carregarStatusContingencia() {
    DB.listarContingencias(empresaId()).then(function (arr) {
      var ativa = (arr || []).filter(function (c) { return !c.dataFim; })[0];
      estado().contingenciaAtiva = ativa || null;
      var b = $('badgeContingencia');
      if (b) {
        b.textContent = ativa ? 'ATIVA desde ' + String(ativa.dataInicio).slice(0, 16).replace('T', ' ') : 'Normal';
        b.className = 'badge ' + (ativa ? 'err' : 'on');
      }
    }).catch(function () { /* sem servidor: mantém "Normal" */ });
  }

  function carregarSeries() {
    var el = $('listaSeries');
    if (!el) return;
    DB.listarSeries(empresaId()).then(function (arr) {
      if (!arr.length) {
        el.innerHTML = '<div class="muted">Nenhuma série configurada. A primeira emissão cria a série automaticamente; ' +
          'use "Configurar série" para definir o próximo número.</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Modelo</th><th>Série</th><th>Ambiente</th><th>Próximo nº</th><th>Situação</th>' +
        '</tr></thead><tbody>' + arr.map(function (s) {
          var nome = s.modelo === '55' ? 'NF-e (55)' : s.modelo === '65' ? 'NFC-e (65)' : esc(s.modelo);
          return '<tr><td>' + nome + '</td><td class="mono">' + esc(s.serie) + '</td>' +
            '<td><span class="badge ' + (s.ambiente === 'PRODUCAO' ? 'err' : 'info') + '">' + esc(s.ambiente) + '</span></td>' +
            '<td class="mono">' + esc(String(s.proximoNumero).padStart(9, '0')) + '</td>' +
            '<td><span class="badge ' + (s.ativo ? 'on' : 'off') + '">' + (s.ativo ? 'Ativa' : 'Inativa') + '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>'; });
  }

  function carregarServicos() {
    var el = $('listaServicos');
    if (!el) return;
    DB.listarServicosFiscais(empresaId()).then(function (arr) {
      if (!arr.length) {
        el.innerHTML = '<div class="muted">Nenhum serviço cadastrado. Cadastre hospedagem, lavanderia, transfer e demais ' +
          'serviços com o código do SEU município.</div>';
        return;
      }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Descrição</th><th>Item LC 116</th><th>Cód. municipal</th><th>Município</th><th>ISS</th><th>Retenção</th>' +
        '</tr></thead><tbody>' + arr.map(function (s) {
          return '<tr><td><b>' + esc(s.descricao) + '</b></td><td class="mono">' + esc(s.itemLc116 || '—') + '</td>' +
            '<td class="mono">' + esc(s.codigoTributarioMunicipal || '—') + '</td>' +
            '<td>' + esc(s.municipio) + (s.uf ? '/' + esc(s.uf) : '') + '</td>' +
            '<td>' + (Number(s.aliquotaIss) || 0) + '%</td>' +
            '<td>' + (s.retencaoIss ? '<span class="badge warn">Retém</span>' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>'; });
  }

  function carregarProdutosSimulador() {
    var sel = $('simProduto');
    if (!sel) return;
    var prods = estado().produtos || [];
    sel.innerHTML = '<option value="">— sem produto (operação avulsa) —</option>' +
      prods.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nome) + '</option>'; }).join('');
  }/* ================================================================== */
  /* REGRAS TRIBUTÁRIAS                                                 */
  /* ================================================================== */

  function carregarRegras() {
    var el = $('listaRegras');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.DB.listarRegras(empresaId(), {}).then(function (arr) {
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhuma regra cadastrada.</div>'; return; }

      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Código</th><th>Tributo</th><th>Regime</th><th>UF</th><th>Tipo</th><th>NCM</th>' +
        '<th>CST/CSOSN</th><th>Alíquota</th><th>Vigência</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + arr.map(function (r) {
          var global = r.empresaId == null;
          return '<tr><td class="mono">' + esc(r.codigo) + (global ? ' <span class="badge off">global</span>' : '') + '</td>' +
            '<td><b>' + esc(r.tributo) + '</b></td>' +
            '<td>' + esc(r.regimeTributario || '—') + '</td>' +
            '<td>' + esc([r.ufOrigem, r.ufDestino].filter(Boolean).join('→') || '—') + '</td>' +
            '<td>' + esc(r.tipoOperacao || '—') + '</td>' +
            '<td class="mono">' + esc(r.ncm || '—') + '</td>' +
            '<td class="mono">' + esc(r.cst || r.csosn || '—') + '</td>' +
            '<td>' + (Number(r.aliquota) || 0) + '%</td>' +
            '<td class="muted">' + esc(r.vigenciaInicial || '—') + (r.vigenciaFinal ? ' até ' + esc(r.vigenciaFinal) : '') + '</td>' +
            '<td><div class="actions" style="justify-content:flex-end">' +
              (global || !pode('fiscal.configurar') ? '' :
                '<button class="btn btn-sm btn-ghost-m" data-edregra="' + r.id + '">Editar</button>' +
                '<button class="btn btn-sm btn-danger" data-delregra="' + r.id + '">Desativar</button>') +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:14px">As regras com o selo <b>global</b> são o catálogo base do sistema ' +
        '(sem alíquota presumida). Cadastre a alíquota efetiva da sua empresa acima delas: a regra da empresa tem prioridade.</div>';

      el.querySelectorAll('[data-edregra]').forEach(function (b) {
        b.addEventListener('click', function () {
          var r = arr.filter(function (x) { return x.id === Number(b.dataset.edregra); })[0];
          modalRegra(r);
        });
      });
      el.querySelectorAll('[data-delregra]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Desativar esta regra? Ela deixa de ser usada em novos cálculos — as notas antigas continuam válidas.')) return;
          DB.DB.removerRegra(empresaId(), Number(b.dataset.delregra))
            .then(function () { toast('Regra desativada.', 'ok'); carregarRegras(); })
            .catch(function (e) { toast(e.message, 'err'); });
        });
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>';
    });
  }

  /* ================================================================== */
  /* DOCUMENTOS FISCAIS                                                 */
  /* ================================================================== */

  function carregarDocumentos() {
    var el = $('listaDocumentos');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.DB.listarDocumentosFiscais(empresaId(), { limite: 100 }).then(function (arr) {
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhum documento fiscal emitido.</div>'; return; }

      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Nº / Série</th><th>Tipo</th><th>Cliente</th><th>Valor</th><th>Status</th><th>Ambiente</th><th>Emitido</th><th style="text-align:right">Ações</th>' +
        '</tr></thead><tbody>' + arr.map(function (d) {
          var cls = d.status === 'AUTORIZADA' ? 'on'
            : d.status === 'CANCELADA' ? 'off'
              : d.status === 'CONTINGENCIA' ? 'warn' : 'err';
          return '<tr><td class="mono">' + esc(d.numero || '—') + '/' + esc(d.serie || '—') + '</td>' +
            '<td>' + esc(d.tipoDocumento) + '</td>' +
            '<td>' + esc(d.clienteNome || '—') + '</td>' +
            '<td>R$ ' + (Number(d.valorTotal) || 0).toFixed(2) + '</td>' +
            '<td><span class="badge ' + cls + '">' + esc(d.status) + '</span></td>' +
            '<td>' + esc(d.ambiente) + '</td>' +
            '<td class="muted">' + esc(String(d.emitidoEm || '').slice(0, 16).replace('T', ' ')) + '</td>' +
            '<td><div class="actions" style="justify-content:flex-end">' +
              '<button class="btn btn-sm btn-ghost-m" data-verdoc="' + d.id + '">Detalhes</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>';

      el.querySelectorAll('[data-verdoc]').forEach(function (b) {
        b.addEventListener('click', function () { detalharDocumento(Number(b.dataset.verdoc)); });
      });
    }).catch(function (e) { el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>'; });
  }

  function detalharDocumento(id) {
    DB.DB.obterDocumentoFiscal(empresaId(), id).then(function (d) {
      var avisos = d.avisosTributarios || [];
      abrirModal('<h3>' + esc(d.tipoDocumento) + ' nº ' + esc(d.numero || '—') + '/' + esc(d.serie || '—') + '</h3>' +
        '<div class="sub">Status <b>' + esc(d.status) + '</b> · Ambiente ' + esc(d.ambiente) + '</div>' +
        '<div class="grid2">' +
          '<div class="field"><label>Cliente</label><div>' + esc(d.clienteNome || '—') + '</div></div>' +
          '<div class="field"><label>Documento</label><div class="mono">' + esc(d.clienteDocumento || '—') + '</div></div>' +
          '<div class="field"><label>Valor total</label><div><b>R$ ' + (Number(d.valorTotal) || 0).toFixed(2) + '</b></div></div>' +
          '<div class="field"><label>Protocolo</label><div class="mono">' + esc(d.protocolo || '—') + '</div></div>' +
          '<div class="field full"><label>Chave de acesso</label><div class="mono">' + esc(d.chave || '—') + '</div></div>' +
        '</div>' +
        (d.mensagem ? '<div class="info-box" style="margin-top:12px">' + esc(d.mensagem) + '</div>' : '') +
        (avisos.length
          ? '<div class="aviso-servidor" style="margin-top:12px"><b>Parametrização pendente:</b><ul class="checks">' +
            avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>'
          : '') +
        '<div class="subtitulo">Itens</div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>Descrição</th><th>Qtd</th><th>Unit.</th><th>Total</th></tr></thead><tbody>' +
        (d.itens || []).map(function (it) {
          return '<tr><td>' + esc(it.descricao || ('#' + it.produtoId)) + '</td><td>' + it.quantidade + '</td>' +
            '<td>R$ ' + Number(it.valorUnitario || 0).toFixed(2) + '</td>' +
            '<td>R$ ' + Number(it.valorTotal || 0).toFixed(2) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="subtitulo">Eventos fiscais</div>' +
        '<ul class="checks">' + (d.eventos || []).map(function (ev) {
          return '<li>' + esc(String(ev.em || '').slice(0, 16).replace('T', ' ')) + ' — <b>' + esc(ev.tipo) + '</b>: ' +
            esc(ev.descricao || ev.status) + '</li>';
        }).join('') + '</ul>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost-m" id="mXml">Baixar XML</button>' +
          (d.status === 'AUTORIZADA' ? '<button class="btn btn-danger" id="mCanc">Cancelar documento</button>' : '') +
          '<button class="btn btn-primary" id="mCancel">Fechar</button></div>');

      $('mCancel').addEventListener('click', fecharModal);

      if ($('mXml')) $('mXml').addEventListener('click', function () {
        DB.DB.baixarXML(empresaId(), id).then(function (r) {
          if (!r.conteudo) return toast(r.mensagem || 'XML indisponível.', 'err');
          baixarArquivo(r.nome || ('documento-' + id + '.xml'), r.conteudo, 'application/xml');
          toast('XML gerado.', 'ok');
        }).catch(function (e) { toast(e.message, 'err'); });
      });
      if ($('mCanc')) $('mCanc').addEventListener('click', function () { modalCancelar(d); });
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function modalCancelar(d) {
    abrirModal('<h3>Cancelar ' + esc(d.tipoDocumento) + ' nº ' + esc(d.numero) + '</h3>' +
      '<div class="sub">O cancelamento fica registrado na auditoria com o seu usuário.</div>' +
      '<div class="erro-box">O motivo deve ter no mínimo 15 caracteres — exigência fiscal. A justificativa é transmitida ao fisco.</div>' +
      '<div class="field"><label>Motivo do cancelamento *</label>' +
      '<textarea id="cancMotivo" placeholder="Descreva o motivo real do cancelamento"></textarea></div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Voltar</button>' +
      '<button class="btn btn-danger" id="mOk">Confirmar cancelamento</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var motivo = $('cancMotivo').value.trim();
      if (motivo.length < 15) return toast('O motivo precisa de pelo menos 15 caracteres.', 'err');
      $('mOk').disabled = true;
      DB.DB.cancelarDocumentoFiscal(empresaId(), d.id, { motivo: motivo }).then(function (r) {
        fecharModal();
        toast(r.cancelado ? 'Documento cancelado.' : ('Não cancelado: ' + r.motivo), r.cancelado ? 'ok' : 'err');
        carregarDocumentos();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function carregarProvedores() {
    DB.listarProvedoresFiscais().then(function (arr) {
      abrirModal('<h3>Provedores fiscais disponíveis</h3>' +
        '<div class="sub">O sistema conversa com uma INTERFACE. Trocar de fornecedor não exige alterar o PDV, o hotel nem o restaurante.</div>' +
        '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Provedor</th><th>Transmite documento real?</th><th>Documentos</th></tr></thead><tbody>' +
        arr.map(function (p) {
          var c = p.capacidades || {};
          return '<tr><td><b>' + esc(p.nome) + '</b><br /><span class="mono muted">' + esc(p.chave) + '</span></td>' +
            '<td>' + (c.transmite
              ? '<span class="badge err">Sim (produção)</span>'
              : '<span class="badge on">Não (simulado)</span>') + '</td>' +
            '<td class="muted">' + ['NFE', 'NFCE', 'NFSE'].filter(function (t) { return c[t]; }).join(', ') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:14px">Provedores reais exigem as variáveis de ambiente ' +
        '<span class="mono">TURISMO_FISCAL_URL</span> e <span class="mono">TURISMO_FISCAL_TOKEN</span>, além da implementação ' +
        'conforme o manual OFICIAL do fornecedor. Sem isso o documento vai para CONTINGÊNCIA — o sistema nunca finge que transmitiu.</div>' +
        '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
      $('mCancel').addEventListener('click', fecharModal);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ================================================================== */
  /* CONTINGÊNCIA E LOGS                                                */
  /* ================================================================== */

  function modalContingencia() {
    abrirModal('<h3>Ativar contingência fiscal</h3>' +
      '<div class="sub">A partir da ativação, os documentos são registrados e ficam aguardando reprocessamento — nenhuma venda é perdida.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Tipo de contingência</label><select id="ctTipo">' +
          ['SVC_AN', 'SVC_RS', 'EPEC', 'FS_DA', 'AUTOMATICA_OFFLINE'].map(function (t) { return '<option>' + t + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field full"><label>Motivo</label><input id="ctMotivo" placeholder="ex.: SEFAZ indisponível desde 14h" /></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-warn" id="mOk">Ativar contingência</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      $('mOk').disabled = true;
      DB.DB.ativarContingencia(empresaId(), {
        tipoContingencia: $('ctTipo').value,
        motivo: $('ctMotivo').value.trim() || 'Serviço fiscal indisponível'
      }).then(function () {
        fecharModal();
        toast('Contingência ativada. Os documentos ficam pendentes de transmissão.', 'ok');
        carregarStatusContingencia();
        carregarContingencias();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function encerrarContingencia() {
    if (!confirm('Encerrar a contingência e reprocessar os documentos pendentes agora?')) return;
    DB.DB.encerrarContingencia(empresaId(), {}).then(function (r) {
      toast('Contingência encerrada. ' + r.documentosParaReprocessar.length + ' documento(s) para reprocessar.', 'ok');
      return DB.DB.reprocessarContingencia(empresaId(), {});
    }).then(function (r) {
      if (r && r.reprocessados) {
        abrirModal('<h3>Reprocessamento concluído</h3>' +
          '<div class="ok-box">' + r.reprocessados + ' documento(s) reprocessado(s).</div>' +
          '<div style="overflow-x:auto"><table><thead><tr><th>Documento</th><th>Nº</th><th>Resultado</th></tr></thead><tbody>' +
          r.resultados.map(function (x) {
            return '<tr><td class="mono">' + x.documentoId + '</td><td>' + esc(x.numero || '—') + '</td>' +
              '<td><span class="badge ' + (x.para === 'AUTORIZADA' ? 'on' : 'warn') + '">' + esc(x.para) + '</span></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
        $('mCancel').addEventListener('click', fecharModal);
      } else {
        toast('Nenhum documento pendente de reprocessamento.', 'ok');
      }
      carregarStatusContingencia();
      carregarContingencias();
      carregarDocumentos();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function carregarContingencias() {
    var el = $('listaContingencias');
    if (!el) return;
    DB.listarContingencias(empresaId()).then(function (arr) {
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhuma contingência registrada.</div>'; return; }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Tipo</th><th>Motivo</th><th>Início</th><th>Fim</th><th>Reprocessamento</th>' +
        '</tr></thead><tbody>' + arr.map(function (c) {
          return '<tr><td><b>' + esc(c.tipoContingencia) + '</b></td>' +
            '<td class="muted">' + esc(c.motivo || '—') + '</td>' +
            '<td class="muted">' + esc(String(c.dataInicio || '').slice(0, 16).replace('T', ' ')) + '</td>' +
            '<td>' + (c.dataFim ? esc(String(c.dataFim).slice(0, 16).replace('T', ' ')) : '<span class="badge err">ATIVA</span>') + '</td>' +
            '<td><span class="badge ' + (c.statusReprocessamento === 'CONCLUIDO' ? 'on' : 'warn') + '">' +
              esc(c.statusReprocessamento || '—') + '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>'; });
  }

  function carregarLogs() {
    var el = $('listaLogs');
    if (!el) return;
    el.innerHTML = '<div class="muted">Carregando…</div>';
    DB.DB.listarLogsFiscais(empresaId(), { limite: 60 }).then(function (arr) {
      if (!arr.length) { el.innerHTML = '<div class="muted">Nenhum log fiscal registrado.</div>'; return; }
      el.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Data</th><th>Operação</th><th>Documento</th><th>Status</th><th>Retorno</th><th>Mensagem</th><th>Provedor</th>' +
        '</tr></thead><tbody>' + arr.map(function (l) {
          return '<tr><td class="muted">' + esc(String(l.data_hora || '').slice(0, 16).replace('T', ' ')) + '</td>' +
            '<td><b>' + esc(l.operacao) + '</b></td>' +
            '<td class="mono">' + esc(l.documentoId || '—') + '</td>' +
            '<td><span class="badge ' + (l.status === 'OK' || l.status === 'AUTORIZADA' ? 'on' : 'warn') + '">' +
              esc(l.status || '—') + '</span></td>' +
            '<td class="mono">' + esc(l.codigoRetorno || '—') + '</td>' +
            '<td class="muted">' + esc(String(l.mensagem || '').slice(0, 90)) + '</td>' +
            '<td class="muted">' + esc(l.provedor || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">Os logs fiscais são permanentes: o sistema não os apaga automaticamente, ' +
        'porque eles são a prova de cada comunicação com o fisco.</div>';
    }).catch(function (e) { el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>'; });
  }

  /* ================================================================== */
  /* MODAIS: REGIME, CERTIFICADO, SÉRIE, REGRA, PACOTE, SERVIÇO         */
  /* ================================================================== */

  function modalRegime() {
    abrirModal('<h3>Registrar novo regime tributário</h3>' +
      '<div class="sub">O regime vigente é encerrado automaticamente no dia anterior ao novo início. O histórico é preservado.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Regime</label><select id="rRegime">' +
          ['MEI', 'SIMPLES NACIONAL', 'LUCRO PRESUMIDO', 'LUCRO REAL'].map(function (r) { return '<option>' + r + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Início da vigência</label>' +
          '<input id="rInicio" type="date" value="' + new Date().toISOString().slice(0, 10) + '" /></div>' +
        '<div class="field"><label>CRT</label><input id="rCrt" placeholder="ex.: 1" /></div>' +
        '<div class="field full"><label>Observação</label><input id="rObs" placeholder="ex.: mudança de porte a partir de 2026" /></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Registrar regime</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      $('mOk').disabled = true;
      DB.DB.registrarRegime(empresaId(), {
        regimeTributario: $('rRegime').value,
        dataInicio: $('rInicio').value,
        crt: $('rCrt').value.trim(),
        observacao: $('rObs').value.trim()
      }).then(function () {
        fecharModal();
        toast('Regime registrado no histórico.', 'ok');
        return recarregar();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function modalCertificado() {
    abrirModal('<h3>Certificado digital A1</h3>' +
      '<div class="sub">O arquivo e a senha são processados e cifrados no servidor. A interface nunca recebe a senha de volta.</div>' +
      '<div class="field"><label>Arquivo do certificado (.pfx / .p12)</label>' +
      '<input id="cArquivo" type="file" accept=".pfx,.p12,.pem" /></div>' +
      '<div class="grid2" style="margin-top:12px">' +
        '<div class="field"><label>Nome / identificação</label><input id="cNome" placeholder="ex.: certificado-empresa-2026.pfx" /></div>' +
        '<div class="field"><label>Validade</label><input id="cValidade" type="date" /></div>' +
        '<div class="field full"><label>Senha do certificado</label>' +
          '<input id="cSenha" type="password" autocomplete="new-password" /></div>' +
      '</div>' +
      '<div class="info-box" style="margin-top:12px">A senha é cifrada com <b>AES-256-GCM</b> e a chave fica no servidor ' +
      '(<span class="mono">TURISMO_CHAVE_FISCAL</span>). Ela nunca é gravada em texto puro: ler o arquivo do banco não revela a senha.</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Salvar certificado</button></div>');

    /* O arquivo é lido no navegador apenas para virar base64 e ser enviado
     * UMA vez. Depois disso, nem a senha nem o conteúdo voltam. */
    $('cArquivo').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (!$('cNome').value) $('cNome').value = f.name;
      var leitor = new FileReader();
      leitor.onload = function () {
        $('cArquivo').dataset.conteudo = String(leitor.result).split(',')[1] || '';
      };
      leitor.readAsDataURL(f);
    });

    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var conteudo = $('cArquivo').dataset.conteudo || '';
      var nome = $('cNome').value.trim();
      if (!nome) return toast('Informe o nome do certificado.', 'err');
      if (!conteudo) return toast('Selecione o arquivo do certificado.', 'err');
      if (!$('cSenha').value) return toast('Informe a senha do certificado.', 'err');
      $('mOk').disabled = true;
      DB.DB.salvarCertificado(empresaId(), {
        nome: nome, validade: $('cValidade').value, conteudo: conteudo, senha: $('cSenha').value
      }).then(function () {
        fecharModal();
        toast('Certificado salvo com a senha cifrada no servidor.', 'ok');
        return recarregar();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function modalSerie() {
    abrirModal('<h3>Configurar série e numeração</h3>' +
      '<div class="sub">Produção e homologação têm sequências próprias — nunca misture as duas.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Modelo</label><select id="sModelo">' +
          '<option value="65">NFC-e (65)</option><option value="55">NF-e (55)</option></select></div>' +
        '<div class="field"><label>Série</label><input id="sSerie" value="1" /></div>' +
        '<div class="field"><label>Ambiente</label><select id="sAmbiente">' +
          '<option>HOMOLOGACAO</option><option>PRODUCAO</option></select></div>' +
        '<div class="field"><label>Próximo número</label><input id="sProximo" type="number" min="1" value="1" /></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Salvar série</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      DB.DB.configurarSerie(empresaId(), {
        modelo: $('sModelo').value,
        serie: $('sSerie').value,
        ambiente: $('sAmbiente').value,
        proximoNumero: Number($('sProximo').value) || 1
      }).then(function () { fecharModal(); toast('Série configurada.', 'ok'); carregarSeries(); })
        .catch(function (e) { toast(e.message, 'err'); });
    });
  }

  function modalRegra(r) {
    var novo = !r;
    r = r || { tributo: 'ICMS', aliquota: 0, prioridade: 0, vigenciaInicial: new Date().toISOString().slice(0, 10) };
    var tributos = ['ICMS', 'PIS', 'COFINS', 'IPI', 'ISS', 'IBS', 'CBS'];

    function opcoes(lista, atual) {
      return '<option value="">— qualquer —</option>' + lista.map(function (x) {
        return '<option' + (atual === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('');
    }

    abrirModal('<h3>' + (novo ? 'Nova regra tributária' : 'Editar regra ' + esc(r.codigo)) + '</h3>' +
      '<div class="sub">Campo em branco significa "vale em qualquer situação". Quanto mais campos preenchidos, mais específica a regra — e ela vence as genéricas.</div>' +
      '<div class="grid3">' +
        '<div class="field"><label>Código *</label><input id="rgCodigo" value="' + esc(r.codigo) + '" /></div>' +
        '<div class="field"><label>Tributo *</label><select id="rgTributo">' +
          tributos.map(function (t) { return '<option' + (r.tributo === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Alíquota (%) *</label>' +
          '<input id="rgAliquota" type="number" step="0.0001" value="' + (Number(r.aliquota) || 0) + '" /></div>' +
        '<div class="field full"><label>Descrição *</label><input id="rgDescricao" value="' + esc(r.descricao) + '" /></div>' +
        '<div class="field"><label>Regime tributário</label><select id="rgRegime">' +
          opcoes(['MEI', 'SIMPLES NACIONAL', 'LUCRO PRESUMIDO', 'LUCRO REAL'], r.regimeTributario) + '</select></div>' +
        '<div class="field"><label>UF origem</label><input id="rgUfOrigem" value="' + esc(r.ufOrigem || '') + '" maxlength="2" /></div>' +
        '<div class="field"><label>UF destino</label><input id="rgUfDestino" value="' + esc(r.ufDestino || '') + '" maxlength="2" /></div>' +
        '<div class="field"><label>Município</label><input id="rgMunicipio" value="' + esc(r.municipio || '') + '" /></div>' +
        '<div class="field"><label>Tipo de operação</label><select id="rgTipo">' +
          opcoes(['VENDA', 'SERVICO', 'DEVOLUCAO', 'COMPRA', 'PERDA', 'TRANSFERENCIA'], r.tipoOperacao) + '</select></div>' +
        '<div class="field"><label>NCM</label><input id="rgNcm" value="' + esc(r.ncm || '') + '" maxlength="8" /></div>' +
        '<div class="field"><label>CST</label><input id="rgCst" value="' + esc(r.cst || '') + '" maxlength="3" /></div>' +
        '<div class="field"><label>CSOSN</label><input id="rgCsosn" value="' + esc(r.csosn || '') + '" maxlength="3" /></div>' +
        '<div class="field"><label>CFOP</label><input id="rgCfop" value="' + esc(r.cfop || '') + '" maxlength="4" /></div>' +
        '<div class="field"><label>Redução de base (%)</label>' +
          '<input id="rgReducao" type="number" step="0.01" value="' + (Number(r.reducaoBase) || 0) + '" /></div>' +
        '<div class="field"><label>Diferimento (%)</label>' +
          '<input id="rgDiferimento" type="number" step="0.01" value="' + (Number(r.diferimento) || 0) + '" /></div>' +
        '<div class="field"><label>Vigência inicial</label>' +
          '<input id="rgVigIni" type="date" value="' + esc(r.vigenciaInicial || '') + '" /></div>' +
        '<div class="field"><label>Vigência final</label>' +
          '<input id="rgVigFim" type="date" value="' + esc(r.vigenciaFinal || '') + '" /></div>' +
        '<div class="field"><label>Prioridade</label>' +
          '<input id="rgPrioridade" type="number" value="' + (Number(r.prioridade) || 0) + '" /></div>' +
      '</div>' +
      '<div class="info-box" style="margin-top:12px">O sistema não presume nenhuma alíquota: o valor informado aqui é o que será calculado.</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">' + (novo ? 'Cadastrar regra' : 'Salvar regra') + '</button></div>');

    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var d = {
        id: novo ? undefined : r.id,
        codigo: $('rgCodigo').value.trim(),
        descricao: $('rgDescricao').value.trim(),
        tributo: $('rgTributo').value,
        aliquota: Number($('rgAliquota').value) || 0,
        regimeTributario: $('rgRegime').value || null,
        ufOrigem: $('rgUfOrigem').value.trim().toUpperCase() || null,
        ufDestino: $('rgUfDestino').value.trim().toUpperCase() || null,
        municipio: $('rgMunicipio').value.trim() || null,
        tipoOperacao: $('rgTipo').value || null,
        ncm: $('rgNcm').value.trim() || null,
        cst: $('rgCst').value.trim() || null,
        csosn: $('rgCsosn').value.trim() || null,
        cfop: $('rgCfop').value.trim() || null,
        reducaoBase: Number($('rgReducao').value) || 0,
        diferimento: Number($('rgDiferimento').value) || 0,
        vigenciaInicial: $('rgVigIni').value || null,
        vigenciaFinal: $('rgVigFim').value || null,
        prioridade: Number($('rgPrioridade').value) || 0
      };
      if (!d.codigo) return toast('Informe o código da regra.', 'err');
      if (!d.descricao) return toast('Informe a descrição da regra.', 'err');
      $('mOk').disabled = true;
      DB.DB.salvarRegra(empresaId(), d).then(function () {
        fecharModal(); toast('Regra salva.', 'ok'); carregarRegras();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function modalImportarRegras() {
    abrirModal('<h3>Importar pacote de regras fiscais</h3>' +
      '<div class="sub">As regras são versionadas por vigência. O pacote entra como VERSÃO nova — nada é sobrescrito sem registro.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Código do pacote *</label><input id="pkCodigo" placeholder="ex.: TABELA-2026-01" /></div>' +
        '<div class="field"><label>Versão *</label><input id="pkVersao" placeholder="ex.: 2026.1" /></div>' +
        '<div class="field"><label>Vigência inicial</label><input id="pkIni" type="date" /></div>' +
        '<div class="field"><label>Vigência final</label><input id="pkFim" type="date" /></div>' +
        '<div class="field full"><label>Fonte</label><input id="pkFonte" placeholder="ex.: contabilidade / SEFAZ / fornecedor" /></div>' +
        '<div class="field full"><label>Descrição</label><input id="pkDescricao" /></div>' +
      '</div>' +
      '<div class="field" style="margin-top:12px"><label>dados_json (lista de regras) *</label>' +
      '<textarea id="pkJson" placeholder="[ { &quot;codigo&quot;: &quot;ICMS-SC&quot;, &quot;descricao&quot;: &quot;ICMS interno&quot;, &quot;tributo&quot;: &quot;ICMS&quot;, &quot;aliquota&quot;: 18, &quot;ufOrigem&quot;: &quot;SC&quot;, &quot;ufDestino&quot;: &quot;SC&quot; } ]"></textarea></div>' +
      '<div class="aviso-servidor" style="margin-top:12px">Regras sem tributo válido são ignoradas e listadas ao final — o sistema não "adivinha" o tributo.</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Importar regras</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var pacote = {
        codigo: $('pkCodigo').value.trim(),
        versao: $('pkVersao').value.trim(),
        descricao: $('pkDescricao').value.trim(),
        fonte: $('pkFonte').value.trim() || 'IMPORTACAO_MANUAL',
        vigenciaInicio: $('pkIni').value || null,
        vigenciaFim: $('pkFim').value || null,
        dados_json: $('pkJson').value.trim()
      };
      if (!pacote.codigo || !pacote.versao) return toast('Informe o código e a versão do pacote.', 'err');
      if (!pacote.dados_json) return toast('Cole o conteúdo de dados_json.', 'err');
      $('mOk').disabled = true;
      DB.DB.importarVersaoRegras(empresaId(), pacote).then(function (r) {
        abrirModal('<h3>Importação concluída</h3>' +
          '<div class="ok-box">' + r.aplicadas.length + ' regra(s) aplicada(s) de ' + r.total + '.</div>' +
          (r.ignoradas.length
            ? '<div class="erro-box">Ignoradas (' + r.ignoradas.length + '):</div><ul class="checks">' +
              r.ignoradas.map(function (x) {
                return '<li><b>' + esc(x.regra) + '</b>: ' + esc(x.motivo) + '</li>';
              }).join('') + '</ul>'
            : '') +
          '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
        $('mCancel').addEventListener('click', fecharModal);
        carregarRegras();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  function modalServico() {
    var e = estado().empresa || {};
    abrirModal('<h3>Novo serviço (NFS-e)</h3>' +
      '<div class="sub">O município é obrigatório: a alíquota de ISS de um município NÃO vale para outro.</div>' +
      '<div class="grid2">' +
        '<div class="field full"><label>Descrição *</label><input id="svDescricao" placeholder="ex.: Hospedagem" /></div>' +
        '<div class="field"><label>Item da LC 116</label><input id="svItem" placeholder="ex.: 09.01" /></div>' +
        '<div class="field"><label>Código tributário municipal</label><input id="svCodMun" placeholder="ex.: 0901" /></div>' +
        '<div class="field"><label>Município *</label><input id="svMunicipio" value="' + esc(e.cidade || '') + '" /></div>' +
        '<div class="field"><label>UF</label><select id="svUf"><option value="">—</option>' +
          UFS().map(function (u) {
            var atual = String(e.estado || '').toUpperCase();
            return '<option' + (atual === u ? ' selected' : '') + '>' + u + '</option>';
          }).join('') + '</select></div>' +
        '<div class="field"><label>Alíquota ISS (%)</label><input id="svIss" type="number" step="0.01" value="0" /></div>' +
        '<div class="field"><label>Retenção de ISS</label><select id="svRetencao">' +
          '<option value="0">Não retém</option><option value="1">Retém</option></select></div>' +
        '<div class="field"><label>Alíquota PIS (%)</label><input id="svPis" type="number" step="0.01" value="0" /></div>' +
        '<div class="field"><label>Alíquota COFINS (%)</label><input id="svCofins" type="number" step="0.01" value="0" /></div>' +
        '<div class="field"><label>Alíquota INSS (%)</label><input id="svInss" type="number" step="0.01" value="0" /></div>' +
        '<div class="field"><label>Alíquota IR (%)</label><input id="svIr" type="number" step="0.01" value="0" /></div>' +
        '<div class="field"><label>Alíquota CSLL (%)</label><input id="svCsll" type="number" step="0.01" value="0" /></div>' +
        '<div class="field"><label>CST IBS</label><input id="svCstIbs" maxlength="3" /></div>' +
        '<div class="field"><label>CST CBS</label><input id="svCstCbs" maxlength="3" /></div>' +
        '<div class="field"><label>Alíquota IBS (%)</label><input id="svIbs" type="number" step="0.01" value="0" /></div>' +
        '<div class="field"><label>Alíquota CBS (%)</label><input id="svCbs" type="number" step="0.01" value="0" /></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
      '<button class="btn btn-primary" id="mOk">Salvar serviço</button></div>');
    $('mCancel').addEventListener('click', fecharModal);
    $('mOk').addEventListener('click', function () {
      var d = {
        descricao: $('svDescricao').value.trim(),
        itemLc116: $('svItem').value.trim(),
        codigoTributarioMunicipal: $('svCodMun').value.trim(),
        municipio: $('svMunicipio').value.trim(),
        uf: $('svUf').value,
        aliquotaIss: Number($('svIss').value) || 0,
        retencaoIss: $('svRetencao').value === '1',
        aliquotaPis: Number($('svPis').value) || 0,
        aliquotaCofins: Number($('svCofins').value) || 0,
        aliquotaInss: Number($('svInss').value) || 0,
        aliquotaIr: Number($('svIr').value) || 0,
        aliquotaCsll: Number($('svCsll').value) || 0,
        cstIbs: $('svCstIbs').value.trim(),
        cstCbs: $('svCstCbs').value.trim(),
        aliquotaIbs: Number($('svIbs').value) || 0,
        aliquotaCbs: Number($('svCbs').value) || 0
      };
      if (!d.descricao) return toast('Informe a descrição do serviço.', 'err');
      if (!d.municipio) return toast('Informe o município. A alíquota de um município não vale para outro.', 'err');
      $('mOk').disabled = true;
      DB.DB.salvarServicoFiscal(empresaId(), d).then(function () {
        fecharModal(); toast('Serviço cadastrado.', 'ok'); carregarServicos();
      }).catch(function (e) { $('mOk').disabled = false; toast(e.message, 'err'); });
    });
  }

  /* ================================================================== */
  /* SIMULADOR E DOWNLOAD                                               */
  /* ================================================================== */

  function simular() {
    var el = $('simResultado');
    el.innerHTML = '<div class="muted">Calculando…</div>';
    var e = estado().empresa || {};
    var dados = {
      produtoId: $('simProduto').value ? Number($('simProduto').value) : null,
      tipoOperacao: $('simTipo').value,
      valorProduto: Number($('simValor').value) || 0,
      quantidade: Number($('simQtd').value) || 1,
      ufOrigem: e.estado,
      ufDestino: $('simUfDest').value || e.estado,
      municipio: $('simMunicipio').value.trim()
    };

    DB.DB.simularTributos(empresaId(), dados).then(function (r) {
      if (!r) { el.innerHTML = '<div class="muted">Sem resultado.</div>'; return; }

      var linhas = (r.resumo || []).map(function (x) {
        return '<tr><td><b>' + esc(x.tributo) + '</b></td>' +
          '<td>R$ ' + Number(x.base || 0).toFixed(2) + '</td>' +
          '<td>' + (Number(x.aliquota) || 0) + '%</td>' +
          '<td>R$ ' + Number(x.valor || 0).toFixed(2) + '</td>' +
          '<td class="mono muted">' + esc(x.origem || '—') + '</td></tr>';
      }).join('');

      el.innerHTML =
        '<div class="grid3">' +
          '<div class="field"><label>Base de cálculo</label><div><b>R$ ' + Number(r.valores.baseCalculo || 0).toFixed(2) + '</b></div></div>' +
          '<div class="field"><label>Tributos por dentro</label><div>R$ ' + Number(r.valores.tributosPorDentro || 0).toFixed(2) + '</div></div>' +
          '<div class="field"><label>Total da operação</label><div><b>R$ ' + Number(r.valores.total || 0).toFixed(2) + '</b></div></div>' +
        '</div>' +
        '<div class="info-box" style="margin-top:12px">Regime usado: <b>' + esc((r.regime && r.regime.regimeTributario) || '—') + '</b> ' +
        '(vigente na data). Os tributos marcados como sem regra são calculados com alíquota ZERO — nenhuma alíquota é inventada.</div>' +
        (linhas
          ? '<div style="overflow-x:auto"><table><thead><tr>' +
            '<th>Tributo</th><th>Base</th><th>Alíquota</th><th>Valor</th><th>Origem da regra</th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>'
          : '<div class="muted">Nenhum tributo incidiu (não há regra aplicável para estas condições).</div>') +
        ((r.avisos || []).length
          ? '<div class="aviso-servidor" style="margin-top:12px"><b>Pontos de atenção:</b><ul class="checks">' +
            r.avisos.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>'
          : '');
    }).catch(function (err) {
      el.innerHTML = '<div class="erro-box">' + esc(err.message) + '</div>';
    });
  }

  /* Gera o download de um texto no navegador (usado no XML e nos relatórios). */
  function baixarArquivo(nome, conteudo, mime) {
    var blob = new Blob([conteudo], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* Expõe para uso em outras telas (fiscal.html usa o mesmo download). */
  window.baixarArquivo = baixarArquivo;
})();