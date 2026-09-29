/*
 * Turismo OS — Configurações: aba DADOS (configuracoes_dados.js)
 * =====================================================================
 * Exportação e importação das CONFIGURAÇÕES da empresa.
 *
 * IMPORTANTE — o que a exportação contém e o que NÃO contém:
 *   ✅ parâmetros das abas PDV, Caixa, Pedidos, Estoque, Integrações,
 *      API, Segurança e Cadastros; dados cadastrais e fiscais da empresa.
 *   ❌ NUNCA a senha do certificado, o conteúdo do certificado, senhas de
 *      usuário nem qualquer token.
 *
 * Esse corte é o ponto central: um backup de configuração não pode virar
 * uma cópia de credenciais.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* Helpers lidos de `window` NO MOMENTO DO USO, e não capturados uma única
   * vez na definição. Capturar na definição faz o módulo depender da ORDEM
   * dos <script> e falhar em SILÊNCIO quando ela muda — sem erro no console,
   * a aba simplesmente não aparece. */
  function esc(s) { return window.cfgEsc(s); }
  function toast(m, t) { return window.cfgToast(m, t); }
  function pode(c) { return window.cfgPode(c); }
  function abrirModal(h) { return window.cfgAbrirModal(h); }
  function fecharModal() { return window.cfgFecharModal(); }
  function soDigitos(v) { return window.cfgSoDigitos(v); }
  function baixarArquivo(nome, conteudo, mime) { return window.baixarArquivo(nome, conteudo, mime); }
  function empresaId() { return window.cfgEmpresa; }

  /* Campos de `empresas` que podem sair no arquivo de configuração.
   * Lista BRANCA: se um campo novo for criado e for sensível, ele não
   * vaza por esquecimento — precisa ser adicionado aqui de propósito. */
  var CAMPOS_EMPRESA_EXPORTAVEIS = [
    'nome', 'razaoSocial', 'nomeFantasia', 'cnpj', 'inscricaoEstadual', 'inscricaoMunicipal',
    'cnaePrincipal', 'cnaesSecundarios', 'regimeTributario', 'crt',
    'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'pais', 'cep',
    'telefone', 'whatsapp', 'email', 'site', 'responsavel', 'logo',
    'registroEmbratur', 'certificadoNome', 'certificadoValidade', 'ambienteFiscal'
  ];

  /* Campos que NUNCA saem, nem que alguém tente incluí-los. */
  var CAMPOS_PROIBIDOS = [
    'certificadoSenhaCifrada', 'certificadoConteudo', 'senhaHash', 'senha',
    'token', 'permissoes', 'secret', 'apiKey'
  ];

  window.renderDadosCompleto = function renderDadosCompleto() {
    var e = window.cfgEstado.empresa || {};
    var ro = !pode('fiscal.configurar');

    return '<div class="cfg-pane" id="pane-dados">' +

      '<div class="panel"><div class="panel-head"><div><h2>Exportar configurações</h2>' +
        '<div class="desc">Gera um arquivo JSON com as configurações desta empresa. ' +
        'A senha do certificado e dados de acesso de usuários NÃO entram no arquivo — um backup de configuração não é uma cópia de credenciais.</div></div></div>' +
        '<div class="panel-body">' +
          '<div class="actions">' +
            '<button class="btn btn-primary" id="btnExportarConfig">Baixar configurações (JSON)</button>' +
            '<button class="btn btn-ghost-m" id="btnExportarResumo">Ver resumo antes de exportar</button>' +
          '</div>' +
          '<div id="previaExport" style="margin-top:16px"></div>' +
        '</div></div>' +

      '<div class="panel"><div class="panel-head"><div><h2>Importar configurações</h2>' +
        '<div class="desc">Aplica um arquivo exportado de outra instalação. Os parâmetros ausentes no arquivo ficam como estão.</div></div></div>' +
        '<div class="panel-body">' +
          (ro
            ? '<div class="aviso-servidor">Seu perfil não pode alterar a configuração, portanto não pode importar.</div>'
            : '<div class="field"><label>Arquivo de configuração (.json)</label><input id="arqImport" type="file" accept=".json" /></div>' +
              '<div class="erro-box" style="margin-top:14px">A importação SUBSTITUI os parâmetros das seções presentes no arquivo. ' +
              'Os dados cadastrais da empresa também são sobrescritos. Confira o arquivo antes de aplicar.</div>' +
              '<div class="actions" style="margin-top:14px">' +
                '<button class="btn btn-ghost-m" id="btnConferirImport">Conferir arquivo</button>' +
                '<button class="btn btn-danger" id="btnImportarConfig" disabled>Aplicar importação</button>' +
              '</div>') +
          '<div id="previaImport" style="margin-top:16px"></div>' +
        '</div></div>' +

      '<div class="panel"><div class="panel-head"><div><h2>Resumo do banco de dados</h2>' +
        '<div class="desc">Contagem dos registros principais desta empresa. Serve para conferir se a migração e os dados estão íntegros.</div></div>' +
        '<button class="btn btn-ghost-m btn-sm" id="btnResumoBanco">Atualizar resumo</button></div>' +
        '<div class="panel-body" id="resumoBanco"><div class="muted">Clique em "Atualizar resumo".</div></div></div>' +

    '</div>';
  };

  window.ligarDados = function () {
    if ($('btnExportarConfig')) $('btnExportarConfig').addEventListener('click', exportar);
    if ($('btnExportarResumo')) $('btnExportarResumo').addEventListener('click', mostrarPreviaExport);
    if ($('btnConferirImport')) $('btnConferirImport').addEventListener('click', conferirImport);
    if ($('btnImportarConfig')) $('btnImportarConfig').addEventListener('click', aplicarImport);
    if ($('btnResumoBanco')) $('btnResumoBanco').addEventListener('click', resumoBanco);
  };

  /* ================================================================== */
  /* EXPORTAÇÃO                                                         */
  /* ================================================================== */

  function montarPacote() {
    var st = window.cfgEstado;
    var emp = {};
    CAMPOS_EMPRESA_EXPORTAVEIS.forEach(function (c) {
      if (CAMPOS_PROIBIDOS.indexOf(c) !== -1) return;
      if (st.empresa && st.empresa[c] !== undefined) emp[c] = st.empresa[c];
    });

    /* As configurações de seção saem SEM nenhuma chave sensível. A limpeza
     * é defensiva: hoje nenhuma seção guarda segredo, mas se alguém criar
     * uma chave `apiToken`, ela não vaza por descuido. */
    var config = {};
    Object.keys(st.config || {}).forEach(function (secao) {
      config[secao] = {};
      Object.keys(st.config[secao] || {}).forEach(function (chave) {
        if (CAMPOS_PROIBIDOS.indexOf(chave) !== -1) return;
        if (/senha|token|secret|chave|password/i.test(chave)) return;
        config[secao][chave] = st.config[secao][chave];
      });
    });

    return {
      _meta: {
        sistema: 'Turismo OS',
        tipo: 'configuracao-empresa',
        versao: 1,
        geradoEm: new Date().toISOString(),
        empresaId: empresa,
        contemSenhaDeCertificado: false,
        contemCredenciaisDeUsuario: false,
        observacao: 'Arquivo de CONFIGURAÇÃO. Nao contem senha de certificado, senha de usuario nem tokens.'
      },
      empresa: emp,
      config: config,
      estabelecimentos: (st.estabelecimentos || []).map(function (f) {
        var limpo = {};
        Object.keys(f).forEach(function (k) {
          if (CAMPOS_PROIBIDOS.indexOf(k) !== -1) return;
          if (/senha|token|secret|password/i.test(k)) return;
          limpo[k] = f[k];
        });
        return limpo;
      }),
      regime: (st.regimes && st.regimes.historico) || []
    };
  }

  function mostrarPreviaExport() {
    var p = montarPacote();
    var secoes = Object.keys(p.config);
    var totalParams = secoes.reduce(function (s, k) { return s + Object.keys(p.config[k]).length; }, 0);

    $('previaExport').innerHTML =
      '<div class="info-box">O arquivo conterá:</div>' +
      '<ul class="checks">' +
        '<li><b>' + Object.keys(p.empresa).length + '</b> campo(s) cadastral(is) e fiscal(is) da empresa</li>' +
        '<li><b>' + secoes.length + '</b> seção(ões) de parâmetros (' + esc(secoes.join(', ')) + ')</li>' +
        '<li><b>' + totalParams + '</b> parâmetro(s) no total</li>' +
        '<li><b>' + p.estabelecimentos.length + '</b> estabelecimento(s)</li>' +
        '<li><b>' + p.regime.length + '</b> registro(s) de regime tributário</li>' +
      '</ul>' +
      '<div class="ok-box" style="margin-top:12px">Nenhuma senha, token ou credencial é exportada. ' +
      'A senha do certificado permanece cifrada e restrita ao servidor.</div>';
  }

  function exportar() {
    var p = montarPacote();
    var nome = 'turismo-os-config-' + new Date().toISOString().slice(0, 10) + '.json';
    baixarArquivo(nome, JSON.stringify(p, null, 2), 'application/json;charset=utf-8');
    toast('Arquivo de configuração gerado.', 'ok');
  }

  /* ================================================================== */
  /* IMPORTAÇÃO                                                         */
  /* ================================================================== */

  var pacotePendente = null;

  function conferirImport() {
    var el = $('arqImport');
    var f = el.files && el.files[0];
    if (!f) return toast('Selecione o arquivo de configuração.', 'err');

    var leitor = new FileReader();
    leitor.onload = function () {
      var dados;
      try { dados = JSON.parse(leitor.result); }
      catch (e) {
        $('previaImport').innerHTML = '<div class="erro-box">O arquivo não é um JSON válido: ' + esc(e.message) + '</div>';
        return;
      }

      /* Reconhece o formato: sem o selo _meta o arquivo pode ser qualquer
       * coisa — e importar "qualquer coisa" corromperia a configuração. */
      if (!dados || dados._meta == null || dados._meta.tipo !== 'configuracao-empresa') {
        $('previaImport').innerHTML = '<div class="erro-box">Este arquivo não é um pacote de configuração do Turismo OS. ' +
          'O campo <span class="mono">_meta.tipo</span> deveria ser <span class="mono">configuracao-empresa</span>.</div>';
        pacotePendente = null;
        if ($('btnImportarConfig')) $('btnImportarConfig').disabled = true;
        return;
      }

      /* Aviso explícito se o arquivo trouxer campo proibido (arquivo
       * adulterado ou de versão antiga): não importamos esses campos. */
      var temProibido = false;
      var texto = JSON.stringify(dados);
      CAMPOS_PROIBIDOS.forEach(function (c) { if (texto.indexOf('"' + c + '"') !== -1) temProibido = true; });

      pacotePendente = {
        empresa: dados.empresa || {},
        config: dados.config || {},
        estabelecimentos: dados.estabelecimentos || [],
        regime: dados.regime || []
      };

      var secoes = Object.keys(pacotePendente.config);
      $('previaImport').innerHTML =
        '<div class="info-box">Arquivo gerado em <b>' + esc(dados._meta.geradoEm || '—') + '</b> ' +
        '(empresa de origem #' + esc(dados._meta.empresaId || '—') + ').</div>' +
        '<div class="erro-box">Ao aplicar, serão substituídos:</div>' +
        '<ul class="checks">' +
          '<li>Dados da empresa: <b>' + Object.keys(pacotePendente.empresa).length + '</b> campo(s) — ' +
            esc(Object.keys(pacotePendente.empresa).slice(0, 8).join(', ')) +
            (Object.keys(pacotePendente.empresa).length > 8 ? '…' : '') + '</li>' +
          '<li>Seções de parâmetros: <b>' + esc(secoes.join(', ') || 'nenhuma') + '</b></li>' +
        '</ul>' +
        (temProibido
          ? '<div class="aviso-servidor">O arquivo cita campos sensíveis. Eles serão IGNORADOS na importação — ' +
            'senha de certificado e credenciais nunca são importadas por arquivo.</div>'
          : '');

      if ($('btnImportarConfig')) $('btnImportarConfig').disabled = false;
    };
    leitor.readAsText(f);
  }

  function aplicarImport() {
    if (!pacotePendente) return toast('Confira o arquivo antes de aplicar.', 'err');
    if (!confirm('Aplicar a importação? Os dados atuais das seções presentes no arquivo serão substituídos.')) return;

    $('btnImportarConfig').disabled = true;
    var secoes = Object.keys(pacotePendente.config);

    /* Aplica seção por seção: se uma falhar, as anteriores já foram salvas
     * e o resultado final lista exatamente o que entrou e o que não entrou.
     * Não se faz "tudo ou nada" aqui porque um parâmetro inválido de uma
     * seção não deve impedir a importação das demais. */
    var resultados = [];
    var cadeia = Promise.resolve();

    // 1) Dados da empresa (sem campos sensíveis).
    if (Object.keys(pacotePendente.empresa).length) {
      var limpo = {};
      Object.keys(pacotePendente.empresa).forEach(function (k) {
        if (CAMPOS_PROIBIDOS.indexOf(k) !== -1) return;
        if (CAMPOS_EMPRESA_EXPORTAVEIS.indexOf(k) === -1) return;
        limpo[k] = pacotePendente.empresa[k];
      });
      cadeia = cadeia.then(function () {
        return DB.configEmpresa(empresaId(), limpo).then(function () {
          resultados.push({ item: 'Dados da empresa', ok: true, detalhe: Object.keys(limpo).length + ' campo(s)' });
        });
      });
    }

    // 2) Seções de parâmetros.
    secoes.forEach(function (secao) {
      cadeia = cadeia.then(function () {
        return DB.configSalvar(empresaId(), secao, pacotePendente.config[secao]).then(function () {
          resultados.push({ item: 'Seção "' + secao + '"', ok: true, detalhe: Object.keys(pacotePendente.config[secao]).length + ' parâmetro(s)' });
        }).catch(function (e) {
          resultados.push({ item: 'Seção "' + secao + '"', ok: false, detalhe: e.message });
        });
      });
    });

    cadeia.then(function () {
      return window.posSettingsService.recarregar();
    }).then(function () {
      return window.cfgCarregar();
    }).then(function () {
      var falhas = resultados.filter(function (r) { return !r.ok; });
      abrirModal('<h3>Importação concluída</h3>' +
        '<div class="' + (falhas.length ? 'erro-box' : 'ok-box') + '">' +
          (resultados.length - falhas.length) + ' de ' + resultados.length + ' item(ns) aplicado(s).' +
        '</div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>Item</th><th>Resultado</th><th>Detalhe</th></tr></thead><tbody>' +
        resultados.map(function (r) {
          return '<tr><td>' + esc(r.item) + '</td>' +
            '<td><span class="badge ' + (r.ok ? 'on' : 'err') + '">' + (r.ok ? 'Aplicado' : 'Recusado') + '</span></td>' +
            '<td class="muted">' + esc(r.detalhe) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
      $('mCancel').addEventListener('click', fecharModal);
      window.cfgRenderTudo();
      toast('Importação finalizada.', falhas.length ? 'err' : 'ok');
    }).catch(function (e) {
      $('btnImportarConfig').disabled = false;
      toast('Falha na importação: ' + e.message, 'err');
    });
  }

  /* ================================================================== */
  /* RESUMO DO BANCO                                                    */
  /* ================================================================== */

  function resumoBanco() {
    var el = $('resumoBanco');
    el.innerHTML = '<div class="muted">Consultando…</div>';

    /* Cada consulta é independente: uma falhar não impede as outras de
     * aparecerem (é um diagnóstico, precisa ser útil mesmo parcial). */
    var fontes = [
      ['Produtos', function () { return DB.listarProdutos(empresaId()); }],
      ['Mesas', function () { return DB.listarMesas(empresaId()); }],
      ['Comandas', function () { return DB.listarComandas(empresaId()); }],
      ['Hóspedes', function () { return DB.listarHospedes(empresaId()); }],
      ['Reservas', function () { return DB.listarReservas(empresaId()); }],
      ['Apartamentos', function () { return DB.listarAptos(empresaId()); }],
      ['Setores de estoque', function () { return DB.listarSetoresEstoque(empresaId()); }],
      ['Saldos por setor', function () { return DB.listarSaldosEstoque(empresaId(), {}); }],
      ['Documentos fiscais', function () { return DB.listarDocumentosFiscais(empresaId(), {}); }],
      ['Regras tributárias', function () { return DB.listarRegras(empresaId(), {}); }],
      ['Séries fiscais', function () { return DB.listarSeries(empresaId()); }],
      ['Estabelecimentos', function () { return DB.listarEstabelecimentos(empresaId()); }],
      ['Usuários', function () { return DB.listarUsuarios(); }]
    ];

    Promise.all(fontes.map(function (f) {
      return f[1]().then(function (r) { return { nome: f[0], qtd: (r || []).length, erro: null }; })
        .catch(function (e) { return { nome: f[0], qtd: null, erro: e.message }; });
    })).then(function (linhas) {
      var total = linhas.reduce(function (s, l) { return s + (l.qtd || 0); }, 0);
      el.innerHTML =
        '<div class="grid3">' +
          '<div class="field"><label>Modo</label><div><b>' + (window.cfgModoServidor() ? 'Servidor' : 'Local (IndexedDB)') + '</b></div></div>' +
          '<div class="field"><label>Total de registros</label><div><b>' + total + '</b></div></div>' +
          '<div class="field"><label>Empresa</label><div>#' + empresa + ' — ' + esc((window.cfgEstado.empresa || {}).nome || '—') + '</div></div>' +
        '</div>' +
        '<div style="overflow-x:auto;margin-top:14px"><table><thead><tr>' +
        '<th>Coleção</th><th>Registros</th><th>Situação</th></tr></thead><tbody>' +
        linhas.map(function (l) {
          return '<tr><td>' + esc(l.nome) + '</td>' +
            '<td>' + (l.qtd == null ? '—' : '<b>' + l.qtd + '</b>') + '</td>' +
            '<td>' + (l.erro
              ? '<span class="badge warn">indisponível neste modo</span>'
              : '<span class="badge on">ok</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="info-box" style="margin-top:12px">Coleções marcadas como "indisponível neste modo" existem apenas com o servidor no ar. ' +
        'É o caso de ficha técnica, inventário, CMV e todo o módulo fiscal.</div>';
    }).catch(function (e) {
      el.innerHTML = '<div class="erro-box">' + esc(e.message) + '</div>';
    });
  }
})();