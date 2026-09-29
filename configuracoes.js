/*
 * Turismo OS — Configurações (configuracoes.js)
 * =====================================================================
 * Tela CONFIGURAÇÕES com as abas: Empresa, Fiscal, PDV, Caixa, Pedidos,
 * Estoque, Cadastros, Integrações, Dados, API e Segurança.
 *
 * Como funciona:
 *   • As abas de PARÂMETROS (PDV, Caixa, Pedidos, Estoque, Cadastros,
 *     Integrações, API, Segurança) são MONTADAS a partir da própria
 *     definição do servidor (config/listar). Não existe uma lista de
 *     parâmetros escrita nesta tela — criar um parâmetro no servidor o
 *     faz aparecer aqui automaticamente, sem tocar no frontend.
 *   • Empresa e Fiscal são formulários de campos (colunas de `empresas`).
 *   • Dados: exportação/importação das configurações.
 *
 * Isolamento: TODA leitura/gravação usa o empresaId da sessão.
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
      'fiscal.consultar', 'fiscal.baixar_xml', 'estoque.visualizar', 'estoque.movimentar',
      'estoque.ajustar', 'estoque.inventario', 'estoque.transferir', 'produto.fiscal', 'produto.editar'],
    recepcao: ['fiscal.visualizar', 'fiscal.emitir', 'fiscal.consultar', 'estoque.visualizar'],
    garcom: ['estoque.visualizar']
  };

  function permissoes() {
    var perfil = String(sessao.perfil || 'admin').toLowerCase();
    if (perfil === 'admin') return ['*'];
    if (sessao.permissoes && sessao.permissoes.length) return sessao.permissoes;
    return PADRAO_PERFIL[perfil] || [];
  }
  function pode(chave) {
    var lista = permissoes();
    if (lista.indexOf('*') !== -1) return true;
    var grupo = String(chave).split('.')[0];
    return lista.indexOf(chave) !== -1 || lista.indexOf(grupo + '.*') !== -1;
  }

  /* ---------- Utilidades ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, tipo) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (tipo ? ' ' + tipo : '');
    setTimeout(function () { t.className = 'toast'; }, tipo === 'err' ? 6000 : 2800);
  }
  function abrirModal(html) { $('modalBox').innerHTML = html; $('overlay').classList.add('show'); }
  function fecharModal() { $('overlay').classList.remove('show'); $('modalBox').innerHTML = ''; }
  $('overlay').addEventListener('click', function (e) { if (e.target === $('overlay')) fecharModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharModal(); });
  function modoServidor() { return DB.modoAtivo() === 'servidor'; }

  /* Máscaras APENAS para exibição — o banco guarda o valor limpo.
   * Mesma regra do servidor: CNPJ/CEP são TEXTO, sem máscara no banco. */
  function mascaraCNPJ(v) {
    var d = String(v || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return d.slice(0, 2) + '.' + d.slice(2);
    if (d.length <= 8) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5);
    if (d.length <= 12) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8);
    return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
  }
  function mascaraCEP(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 8);
    return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
  }
  function mascaraTelefone(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  var soDigitos = function (v) { return String(v == null ? '' : v).replace(/\D/g, ''); };
  var UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

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
  /* DEFINIÇÃO DAS ABAS                                                 */
  /* ================================================================== */

  var ABAS = [
    { id: 'empresa', titulo: 'Empresa' },
    { id: 'fiscal', titulo: 'Fiscal', permissao: 'fiscal.visualizar' },
    { id: 'produtos', titulo: 'Produtos', permissao: 'produto.editar' },
    { id: 'pdv', titulo: 'PDV' },
    { id: 'caixa', titulo: 'Caixa' },
    { id: 'pedidos', titulo: 'Pedidos' },
    { id: 'estoque', titulo: 'Estoque' },
    { id: 'cadastros', titulo: 'Cadastros' },
    { id: 'integracoes', titulo: 'Integrações' },
    { id: 'impressoras', titulo: 'Impressoras', permissao: 'impressao.visualizar' },
    { id: 'dados', titulo: 'Dados' },
    { id: 'api', titulo: 'API' },
    { id: 'seguranca', titulo: 'Segurança' }
  ];

  /* Abas montadas automaticamente a partir da definição do servidor. */
  var ABAS_PARAMETRO = ['pdv', 'caixa', 'pedidos', 'estoque', 'cadastros', 'integracoes', 'api', 'seguranca'];

  /* Dicas por parâmetro: o que cada opção faz na prática. Servem para o
   * gestor entender a consequência de ligar/desligar, sem precisar de
   * manual. Parâmetro sem dica aparece apenas com o rótulo. */
  var DICAS = {
    abrirVariasInstancias: 'Permite mais de uma janela do sistema aberta ao mesmo tempo no mesmo computador.',
    escolherGarcomVendaDireta: 'Na venda direta (balcão), abre a seleção de garçom/vendedor antes de concluir.',
    confirmarPagamentoAutomatico: 'Marca o pagamento como confirmado assim que o valor é recebido.',
    finalizarVendaAutomaticamente: 'Finaliza a venda sem pedir confirmação. Agiliza o balcão, mas reduz a conferência.',
    senhaAoMudarTelaComVenda: 'Pede a senha do operador ao trocar de tela com uma venda em andamento.',
    arredondamentoAbnt: 'Aplica o arredondamento ABNT NBR 5891 em quantidade × valor unitário.',
    naoExibirProdutosVendaBalcao: 'Esconde a lista de produtos na venda balcão (útil com leitor de código de barras).',
    naoExibirProdutosPedido: 'Esconde a lista de produtos no pedido de mesa, comanda e delivery.',
    bloquearVendaFracionadaUnidadeInteira: 'Impede vender 0,5 de um item cadastrado como UN, PC, CX e similares.',
    bloquearAlteracaoQtdAposBalanca: 'Trava a quantidade depois de capturada da balança, evitando divergência de peso.',
    bloquearDivisaoValorPelaQuantidade: 'Impede dividir o valor do item pela quantidade (rateio por pessoa).',
    bloquearQuantidadeExorbitante: 'Bloqueia quantidade acima do limite — protege contra digitação errada no PDV.',
    bloquearItemValorZerado: 'Impede fechar a venda com item de valor total igual a zero.',
    limiteQuantidadeExorbitante: 'A partir de qual quantidade a venda é considerada exorbitante.',
    exigeAberturaCaixa: 'Sem caixa aberto o operador não consegue registrar venda.',
    sangriaComAutorizacao: 'Sangria e suprimento exigem senha de autorizador.',
    fechamentoCego: 'No fechamento, o operador informa os valores sem ver o total do sistema.',
    limiteSangria: 'Valor máximo de sangria sem precisar de autorização. Zero significa sem limite.',
    formasPagamento: 'Formas de pagamento disponíveis no PDV e no fechamento de conta.',
    permitirMesmaMesaMultiplasComandas: 'Permite abrir mais de uma comanda na mesma mesa.',
    exigirGarcomAoAbrirMesa: 'Obriga identificar o garçom responsável ao abrir a mesa.',
    taxaServicoPadrao: 'Percentual de taxa de serviço sugerido no fechamento da conta.',
    imprimirCozinhaAutomatico: 'Envia os itens para a cozinha assim que são lançados.',
    permitirDelivery: 'Habilita o fluxo de pedidos para entrega.',
    tempoCancelamentoMin: 'Prazo em minutos para cancelar item sem autorização.',
    ativarControleAutomaticoNovosProdutos: 'Todo produto novo já nasce com controle de estoque ligado.',
    alertarEstoqueMinimo: 'Mostra alerta quando o saldo fica abaixo do mínimo cadastrado.',
    alertarValidadeVencida: 'Mostra alerta de lotes vencidos e próximos do vencimento.',
    alertarFalhaAtualizacao: 'Avisa quando uma baixa de estoque falha — permite reconciliar antes de fechar o dia.',
    atualizarEstoqueTempoReal: 'Outros dispositivos veem o saldo mudar na hora.',
    controlarDisponibilidadeCardapio: 'Produto sem estoque fica INDISPONÍVEL no cardápio digital, e volta quando o saldo retorna.',
    considerarEstoqueIngredientes: 'A disponibilidade do prato passa a depender dos ingredientes da ficha técnica.',
    permitirEstoqueNegativo: 'Permite saldo negativo. Use apenas se a contagem chega depois da venda.',
    diasAlertaValidade: 'Com quantos dias de antecedência avisar sobre o vencimento.',
    metodoBaixaEstoque: 'FEFO baixa o que vence primeiro; FIFO o que entrou primeiro; LOTE MANUAL deixa o operador escolher.',
    exigirLoteEmEntrada: 'Obriga informar o lote ao dar entrada na mercadoria.',
    exigirValidadeEmEntrada: 'Obriga informar a validade ao dar entrada na mercadoria.',
    whatsappAtivo: 'Habilita envio de mensagens por WhatsApp.',
    whatsappNumero: 'Número que aparece como remetente nas mensagens.',
    balancaAtiva: 'Habilita a leitura de peso na venda por balança.',
    balancaProtocolo: 'Protocolo de comunicação da sua balança.',
    cardapioDigitalAtivo: 'Publica o cardápio digital para os clientes.',
    cardapioDigitalUrl: 'Endereço público do cardápio.',
    impressoraAtiva: 'Habilita impressão térmica de comprovantes e fichas.',
    impressoraNome: 'Identificação da impressora no sistema.',
    apiAtiva: 'Permite que sistemas externos acessem os dados.',
    apiSomenteLeitura: 'Novas chaves de API começam sem permissão de escrita.',
    apiUrlsPermitidas: 'Restringe quais endereços podem chamar a API (CORS).',
    webhookUrl: 'Endereço que recebe avisos de eventos do sistema.',
    exigirSenhaAcoesSensiveis: 'Pede senha em cancelamento de nota, ajuste de estoque e mudança de preço.',
    expirarSessaoMin: 'Tempo de inatividade antes de exigir login novamente.',
    logAcessoAtivo: 'Registra quem acessou e quando.',
    bloquearAposTentativas: 'Bloqueia o usuário após N senhas erradas. Zero desativa.',
    ipPermitidos: 'Restringe o acesso a determinados endereços de rede. Vazio libera todos.',
    exigirCpfHospede: 'Obriga o CPF/CNPJ do hóspede no cadastro (exigido pela FNRH).',
    codigoInternoAutomatico: 'Gera o código interno do produto automaticamente.',
    validarNcmObrigatorio: 'Torna o NCM obrigatório no cadastro de produto.',
    permitirExcluirProdutoVendido: 'Permite excluir produto que já foi vendido. Desligado é mais seguro para o histórico.'
  };

  /* Rótulos mais claros que o nome técnico do parâmetro do servidor. */
  var ROTULOS = {
    limiteQuantidadeExorbitante: 'Limite de quantidade exorbitante',
    limiteSangria: 'Limite de sangria sem autorização (R$)',
    formasPagamento: 'Formas de pagamento aceitas',
    taxaServicoPadrao: 'Taxa de serviço padrão (%)',
    tempoCancelamentoMin: 'Prazo para cancelar item (min)',
    diasAlertaValidade: 'Dias de antecedência do alerta de validade',
    metodoBaixaEstoque: 'Método para baixar o estoque',
    whatsappNumero: 'Número de WhatsApp',
    balancaProtocolo: 'Protocolo da balança',
    cardapioDigitalUrl: 'URL do cardápio digital',
    impressoraNome: 'Nome da impressora',
    apiUrlsPermitidas: 'URLs autorizadas (separadas por vírgula)',
    webhookUrl: 'URL de webhook',
    expirarSessaoMin: 'Expirar sessão inativa (min)',
    bloquearAposTentativas: 'Bloquear após N tentativas',
    ipPermitidos: 'IPs permitidos'
  };

  var estado = {
    empresa: null,
    estabelecimentos: [],
    config: {},
    secoes: {},
    certificado: null,
    regimes: null,
    prontidao: null,
    abaAtual: 'empresa',
    produtos: []
  };

  /* ================================================================== */
  /* RENDER                                                             */
  /* ================================================================== */

  function renderTabs() {
    $('tabs').innerHTML = ABAS.filter(function (a) {
      return !a.permissao || pode(a.permissao);
    }).map(function (a) {
      return '<button data-aba="' + a.id + '" class="' + (a.id === estado.abaAtual ? 'on' : '') + '">' +
        esc(a.titulo) + '</button>';
    }).join('');
    $('tabs').querySelectorAll('[data-aba]').forEach(function (b) {
      b.addEventListener('click', function () { trocarAba(b.dataset.aba); });
    });
  }

  var TITULOS_ABA = {
    empresa: 'Dados cadastrais e endereço da empresa',
    fiscal: 'Dados fiscais, regime, certificado, regras e contingência',
    produtos: 'Catálogo do PDV: preço, categoria e foto do produto',
    pdv: 'Parâmetros gerais do PDV e controle de quantidade',
    caixa: 'Abertura, sangria e fechamento de caixa',
    pedidos: 'Mesas, comandas, delivery e cozinha',
    estoque: 'Controle de estoque, lote, validade e cardápio digital',
    cadastros: 'Regras de cadastro de produtos e hóspedes',
    integracoes: 'WhatsApp, balança, impressora e cardápio digital',
    impressoras: 'Impressoras, estações, setores, fila e histórico de impressão',
    dados: 'Exportação e importação das configurações',
    api: 'Acesso por API e webhooks',
    seguranca: 'Sessão, auditoria e restrições de acesso'
  };

  function trocarAba(id) {
    estado.abaAtual = id;
    renderTabs();
    $('panes').querySelectorAll('.cfg-pane').forEach(function (p) {
      p.classList.toggle('on', p.id === 'pane-' + id);
    });
    $('pageSub').textContent = TITULOS_ABA[id] || '';
    if (id === 'dados') renderDadosDinamico();
  }

  /* O HTML das abas Fiscal e Dados é fornecido pelos módulos externos.
   * São resolvidos NO MOMENTO DO USO (e não capturados na definição): a
   * ordem de carga dos <script> não pode decidir se a aba aparece. */
  function renderFiscal() {
    return (typeof window.renderFiscalCompleto === 'function') ? window.renderFiscalCompleto() : '';
  }
  function renderProdutos() {
    return (typeof window.renderProdutosCompleto === 'function') ? window.renderProdutosCompleto() : '';
  }
  function renderImpressoras() {
    return (typeof window.renderImpressorasCompleto === 'function') ? window.renderImpressorasCompleto() : '';
  }
  function renderDados() {
    return (typeof window.renderDadosCompleto === 'function') ? window.renderDadosCompleto() : '';
  }

  function renderTudo() {
    if (!pode('fiscal.configurar')) {
      $('avisos').innerHTML = '<div class="aviso-servidor">Seu perfil permite <b>consultar</b> a configuração, mas não alterá-la. ' +
        'Os campos estão em modo de leitura.</div>';
    } else {
      $('avisos').innerHTML = '';
    }

    var html = '';
    html += renderEmpresa();
    if (pode('fiscal.visualizar')) html += renderFiscal();
    html += renderProdutos();
    ABAS_PARAMETRO.forEach(function (sec) { html += renderSecaoParametros(sec); });
    html += renderImpressoras();
    html += renderDados();

    $('panes').innerHTML = html;

    ligarEmpresa();
    window.ligarFiscal();
    window.ligarProdutos();
    ABAS_PARAMETRO.forEach(function (sec) { ligarSecaoParametros(sec); });
    window.ligarImpressoras();
    window.ligarDados();

    trocarAba(estado.abaAtual);
  }

  /* ================================================================== */
  /* ABA EMPRESA                                                        */
  /* ================================================================== */

  function renderEmpresa() {
    var e = estado.empresa || {};
    var ro = !pode('fiscal.configurar');

    function campo(id, rotulo, valor, hint, tipo, max) {
      return '<div class="field"><label for="' + id + '">' + esc(rotulo) + '</label>' +
        '<input id="' + id + '" type="' + (tipo || 'text') + '" value="' + esc(valor || '') + '"' +
        (max ? ' maxlength="' + max + '"' : '') + (ro ? ' disabled' : '') + ' />' +
        (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
    }

    return '<div class="cfg-pane" id="pane-empresa">' +

      '<div class="panel"><div class="panel-head"><div><h2>Dados da empresa</h2>' +
        '<div class="desc">O CNPJ é gravado como texto: sem máscara e sem perder zeros à esquerda. A máscara é apenas visual.</div></div>' +
        '<span class="badge ' + (e.status === 'ativa' ? 'on' : 'warn') + '">' + esc(e.status || '—') + '</span></div>' +
        '<div class="panel-body">' +
          '<div class="grid2">' +
            campo('eRazaoSocial', 'Razão Social', e.razaoSocial) +
            campo('eNomeFantasia', 'Nome Fantasia', e.nomeFantasia || e.nome) +
            campo('eCnpj', 'CNPJ', mascaraCNPJ(e.cnpj), 'Digite apenas números — a máscara é aplicada automaticamente.', 'text', 18) +
            campo('eInscricaoEstadual', 'Inscrição Estadual', e.inscricaoEstadual, 'Use "ISENTO" quando não houver.') +
            campo('eInscricaoMunicipal', 'Inscrição Municipal', e.inscricaoMunicipal) +
            campo('eCnaePrincipal', 'CNAE principal', e.cnaePrincipal) +
          '</div>' +
          '<div class="grid2" style="margin-top:14px">' +
            campo('eCnaesSecundarios', 'CNAEs secundários', e.cnaesSecundarios, 'Separe por vírgula.') +
            campo('eResponsavel', 'Responsável', e.responsavel) +
          '</div>' +
          '<div class="subtitulo">Endereço</div>' +
          '<div class="grid3">' +
            campo('eCep', 'CEP', mascaraCEP(e.cep), 'Somente números.', 'text', 9) +
            campo('eEndereco', 'Endereço', e.endereco) +
            campo('eNumero', 'Número', e.numero) +
            campo('eComplemento', 'Complemento', e.complemento) +
            campo('eBairro', 'Bairro', e.bairro) +
            campo('eCidade', 'Cidade', e.cidade) +
            '<div class="field"><label for="eEstado">UF</label><select id="eEstado"' + (ro ? ' disabled' : '') + '>' +
              '<option value="">—</option>' +
              UFS.map(function (u) {
                return '<option value="' + u + '"' + (String(e.estado || '').toUpperCase() === u ? ' selected' : '') + '>' + u + '</option>';
              }).join('') + '</select></div>' +
            campo('ePais', 'País', e.pais || 'Brasil') +
          '</div>' +
          '<div class="subtitulo">Contato e imagem</div>' +
          '<div class="grid3">' +
            campo('eTelefone', 'Telefone', e.telefone) +
            campo('eWhatsapp', 'WhatsApp', e.whatsapp) +
            campo('eEmail', 'E-mail', e.email, null, 'email') +
            campo('eSite', 'Site', e.site) +
            campo('eRegistroEmbratur', 'Registro Embratur', e.registroEmbratur) +
            campo('eLogo', 'Logo (URL ou data-URI)', e.logo) +
          '</div>' +
          (ro ? '' : '<div class="actions" style="margin-top:18px">' +
            '<button class="btn btn-primary" id="btnSalvarEmpresa">Salvar dados da empresa</button>' +
            '<button class="btn btn-ghost-m" id="btnValidarEmpresa">Validar CNPJ / CEP / UF</button>' +
          '</div>') +
        '</div></div>' +

      renderEstabelecimentos(ro) +
    '</div>';
  }

  function renderEstabelecimentos(ro) {
    var lista = estado.estabelecimentos || [];
    return '<div class="panel"><div class="panel-head">' +
      '<div><h2>Estabelecimentos / filiais</h2>' +
      '<div class="desc">Cada estabelecimento tem CNPJ e configuração fiscal próprios. ' +
      'Configuração fiscal e de estoque NUNCA são compartilhadas entre empresas diferentes.</div></div>' +
      (ro ? '' : '<button class="btn btn-primary btn-sm" id="btnNovaFilial">+ Nova filial</button>') +
      '</div><div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Razão Social</th><th>CNPJ</th><th>UF</th><th>Cidade</th><th>Regime</th><th>Ambiente</th><th>Situação</th><th style="text-align:right">Ações</th>' +
      '</tr></thead><tbody>' +
      (lista.length ? lista.map(function (f) {
        return '<tr><td><b>' + esc(f.razaoSocial || f.nomeFantasia) + '</b>' +
          (f.matriz ? ' <span class="badge info">matriz</span>' : '') + '</td>' +
          '<td class="mono">' + esc(mascaraCNPJ(f.cnpj) || '—') + '</td>' +
          '<td>' + esc(f.estado || '—') + '</td><td>' + esc(f.cidade || '—') + '</td>' +
          '<td>' + esc(f.regimeTributario || '—') + '</td>' +
          '<td><span class="badge ' + (f.ambienteFiscal === 'PRODUCAO' ? 'err' : 'info') + '">' +
            esc(f.ambienteFiscal || 'HOMOLOGACAO') + '</span></td>' +
          '<td><span class="badge ' + (f.ativo ? 'on' : 'off') + '">' + (f.ativo ? 'Ativo' : 'Inativo') + '</span></td>' +
          '<td><div class="actions" style="justify-content:flex-end">' +
            (ro ? '' : '<button class="btn btn-sm btn-ghost-m" data-edfilial="' + f.id + '">Editar</button>') +
          '</div></td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">Nenhuma filial cadastrada. A empresa matriz é a configuração principal.</td></tr>') +
      '</tbody></table></div></div>';
  }

  function ligarEmpresa() {
    var b = $('btnSalvarEmpresa');
    if (b) b.addEventListener('click', salvarEmpresa);
    var v = $('btnValidarEmpresa');
    if (v) v.addEventListener('click', validarEmpresa);

    var elCnpj = $('eCnpj');
    if (elCnpj) elCnpj.addEventListener('input', function () { elCnpj.value = mascaraCNPJ(elCnpj.value); });
    var elCep = $('eCep');
    if (elCep) elCep.addEventListener('input', function () { elCep.value = mascaraCEP(elCep.value); });
    var elTel = $('eTelefone');
    if (elTel) elTel.addEventListener('input', function () { elTel.value = mascaraTelefone(elTel.value); });

    var nova = $('btnNovaFilial');
    if (nova) nova.addEventListener('click', function () { modalFilial(null); });
    $('panes').querySelectorAll('[data-edfilial]').forEach(function (x) {
      x.addEventListener('click', function () {
        var f = (estado.estabelecimentos || []).filter(function (y) { return y.id === Number(x.dataset.edfilial); })[0];
        modalFilial(f);
      });
    });
  }

  function dadosEmpresaDoForm() {
    return {
      // CNPJ/CEP/telefone vão LIMPOS: a máscara é só visual.
      razaoSocial: $('eRazaoSocial').value.trim(),
      nomeFantasia: $('eNomeFantasia').value.trim(),
      nome: $('eNomeFantasia').value.trim() || $('eRazaoSocial').value.trim(),
      cnpj: soDigitos($('eCnpj').value),
      inscricaoEstadual: $('eInscricaoEstadual').value.trim(),
      inscricaoMunicipal: $('eInscricaoMunicipal').value.trim(),
      cnaePrincipal: $('eCnaePrincipal').value.trim(),
      cnaesSecundarios: $('eCnaesSecundarios').value.trim(),
      responsavel: $('eResponsavel').value.trim(),
      cep: soDigitos($('eCep').value),
      endereco: $('eEndereco').value.trim(),
      numero: $('eNumero').value.trim(),
      complemento: $('eComplemento').value.trim(),
      bairro: $('eBairro').value.trim(),
      cidade: $('eCidade').value.trim(),
      estado: $('eEstado').value,
      pais: $('ePais').value.trim() || 'Brasil',
      telefone: $('eTelefone').value.trim(),
      whatsapp: $('eWhatsapp').value.trim(),
      email: $('eEmail').value.trim(),
      site: $('eSite').value.trim(),
      registroEmbratur: $('eRegistroEmbratur').value.trim(),
      logo: $('eLogo').value.trim()
    };
  }

  function limparInvalidos() {
    $('panes').querySelectorAll('.invalid').forEach(function (el) { el.classList.remove('invalid'); });
  }

  function salvarEmpresa() {
    if (!pode('fiscal.configurar')) return toast('Seu perfil não pode alterar os dados da empresa.', 'err');
    var d = dadosEmpresaDoForm();
    limparInvalidos();
    $('btnSalvarEmpresa').disabled = true;
    DB.configEmpresa(EMPRESA, d).then(function (e) {
      estado.empresa = e;
      toast('Dados da empresa salvos.', 'ok');
      return carregar();
    }).then(renderTudo).catch(function (err) {
      $('btnSalvarEmpresa').disabled = false;
      toast(err.message, 'err');
      marcarInvalidos(err.message);
    });
  }

  /* Validar NÃO grava: só confere e lista o que corrigir. */
  function validarEmpresa() {
    var d = dadosEmpresaDoForm();
    var pedido = modoServidor()
      ? Object.assign({}, d, { validarApenas: true })
      : d;

    DB.configFiscal(EMPRESA, pedido).then(function (r) {
      if (r && r.valido === false && r.erros) {
        abrirModal('<h3>Validação dos dados fiscais</h3>' +
          '<div class="erro-box">Foram encontrados ' + r.erros.length + ' ponto(s) para corrigir antes de emitir:</div>' +
          '<ul class="checks">' + r.erros.map(function (x) {
            return '<li><b>' + esc(x.campo) + '</b>: ' + esc(x.mensagem) + '</li>';
          }).join('') + '</ul>' +
          '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
        $('mCancel').addEventListener('click', fecharModal);
      } else if (modoServidor()) {
        toast('CNPJ, CEP e UF estão válidos.', 'ok');
      } else {
        /* Sem servidor, valida localmente os mesmos dígitos verificadores
         * (a regra é a mesma — muda só onde roda). */
        var p = [];
        var cnpj = soDigitos($('eCnpj').value);
        if (cnpj && !(cnpj.length === 14 && cnpj.slice(12) === dvCNPJ(cnpj.slice(0, 12)))) {
          p.push('CNPJ inválido: dígitos verificadores não conferem.');
        }
        var cep = soDigitos($('eCep').value);
        if (cep && cep.length !== 8) p.push('CEP deve ter 8 dígitos.');
        abrirModal('<h3>Validação (modo local)</h3>' +
          (p.length ? '<div class="erro-box"><ul class="checks">' + p.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>'
            : '<div class="ok-box">CNPJ e CEP conferem. A validação completa (incluindo certificado) roda no servidor.</div>') +
          '<div class="modal-foot"><button class="btn btn-primary" id="mCancel">Fechar</button></div>');
        $('mCancel').addEventListener('click', fecharModal);
      }
    }).catch(function (e) { toast('Não foi possível validar: ' + e.message, 'err'); });
  }

  /* Dígitos verificadores do CNPJ (mesmo algoritmo do servidor). */
  function dvCNPJ(base) {
    var pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    function calc(s) {
      var soma = 0;
      for (var i = 0; i < s.length; i++) soma += Number(s[i]) * pesos[pesos.length - s.length + i];
      var r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    }
    return String(calc(base) + '') + String(calc(base + calc(base)));
  }

  function marcarInvalidos(mensagem) {
    var mapa = {
      cnpj: 'eCnpj', cep: 'eCep', estado: 'eEstado', razaosocial: 'eRazaoSocial',
      nomefantasia: 'eNomeFantasia', inscricaoestadual: 'eInscricaoEstadual',
      endereco: 'eEndereco', cidade: 'eCidade', email: 'eEmail'
    };
    var msg = String(mensagem || '').toLowerCase();
    Object.keys(mapa).forEach(function (campo) {
      if (msg.indexOf(campo) !== -1) {
        var el = $(mapa[campo]);
        if (el) { el.classList.add('invalid'); el.closest('.field').classList.add('invalid'); }
      }
    });
  }

  function modalFilial(f) {
    var novo = !f;
    f = f || { ativo: true, ambienteFiscal: 'HOMOLOGACAO', pais: 'Brasil' };
    abrirModal('<h3>' + (novo ? 'Nova filial' : 'Editar filial') + '</h3>' +
      '<div class="sub">A filial tem CNPJ e configuração fiscal próprios.</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>Razão Social</label><input id="fRazao" value="' + esc(f.razaoSocial) + '" /></div>' +
        '<div class="field"><label>Nome Fantasia</label><input id="fFantasia" value="' + esc(f.nomeFantasia) + '" /></div>' +
        '<div class="field"><label>CNPJ</label><input id="fCnpj" value="' + esc(mascaraCNPJ(f.cnpj)) + '" /></div>' +
        '<div class="field"><label>Inscrição Estadual</label><input id="fIE" value="' + esc(f.inscricaoEstadual) + '" /></div>' +
        '<div class="field"><label>Cidade</label><input id="fCidade" value="' + esc(f.cidade) + '" /></div>' +
        '<div class="field"><label>UF</label><select id="fUf"><option value="">—</option>' +
          UFS.map(function (u) { return '<option value="' + u + '"' + (f.estado === u ? ' selected' : '') + '>' + u + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label>Regime tributário</label><select id="fRegime">' +
          ['', 'MEI', 'SIMPLES NACIONAL', 'LUCRO PRESUMIDO', 'LUCRO REAL'].map(function (r) {
            return '<option value="' + r + '"' + (f.regimeTributario === r ? ' selected' : '') + '>' + (r || '—') + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="field"><label>Ambiente fiscal</label><select id="fAmbiente">' +
          ['HOMOLOGACAO', 'PRODUCAO'].map(function (a) {
            return '<option value="' + a + '"' + (f.ambienteFiscal === a ? ' selected' : '') + '>' + a + '</option>';
          }).join('') +
        '</select><span class="hint">PRODUCAO emite documento com valor fiscal real.</span></div>' +
      '</div>' +
      '<div class="modal-foot">' +
        (novo ? '' : '<button class="btn btn-danger" id="mDel" style="margin-right:auto">Desativar</button>') +
        '<button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="mOk">' + (novo ? 'Cadastrar' : 'Salvar') + '</button>' +
      '</div>');

    var elCnpj = $('fCnpj');
    elCnpj.addEventListener('input', function () { elCnpj.value = mascaraCNPJ(elCnpj.value); });

    $('mCancel').addEventListener('click', fecharModal);
    if ($('mDel')) $('mDel').addEventListener('click', function () {
      if (!confirm('Desativar esta filial?')) return;
      DB.removerEstabelecimento(EMPRESA, f.id)
        .then(function () { fecharModal(); toast('Filial desativada.', 'ok'); return carregar(); })
        .then(renderTudo).catch(function (e) { toast(e.message, 'err'); });
    });
    $('mOk').addEventListener('click', function () {
      var dados = {
        razaoSocial: $('fRazao').value.trim(),
        nomeFantasia: $('fFantasia').value.trim(),
        cnpj: soDigitos($('fCnpj').value),
        inscricaoEstadual: $('fIE').value.trim(),
        cidade: $('fCidade').value.trim(),
        estado: $('fUf').value,
        regimeTributario: $('fRegime').value,
        ambienteFiscal: $('fAmbiente').value
      };
      if (!dados.razaoSocial && !dados.nomeFantasia) return toast('Informe a Razão Social ou o Nome Fantasia.', 'err');
      var p = novo ? DB.criarEstabelecimento(EMPRESA, dados) : DB.atualizarEstabelecimento(EMPRESA, f.id, dados);
      p.then(function () { fecharModal(); toast(novo ? 'Filial cadastrada.' : 'Filial atualizada.', 'ok'); return carregar(); })
        .then(renderTudo).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  /* ================================================================== */
  /* ABAS DE PARÂMETROS (montadas da definição do servidor)             */
  /* ================================================================== */

  /* Constrói a aba a partir de `estado.secoes[secao]` — a MESMA definição
   * que o servidor usa para validar. Parâmetro criado no servidor aparece
   * aqui sozinho, sem alterar esta tela. */
  function renderSecaoParametros(secao) {
    var def = estado.secoes && estado.secoes[secao];
    var valores = (estado.config && estado.config[secao]) || {};
    var ro = !pode('fiscal.configurar');

    var corpo = '';
    if (!def) {
      // Sem a definição (modo local), monta a partir dos valores gravados.
      corpo = renderParamsDeValores(valores, ro);
    } else {
      Object.keys(def.subsecoes || {}).forEach(function (nomeSub) {
        var sub = def.subsecoes[nomeSub];
        corpo += '<div class="subtitulo">' + esc(sub.titulo) + '</div>';
        corpo += renderParamsDeValores(valores, ro, sub.parametros);
      });
    }

    return '<div class="cfg-pane" id="pane-' + secao + '">' +
      '<div class="panel"><div class="panel-head">' +
        '<div><h2>' + esc((def && def.titulo) || secao) + '</h2>' +
        '<div class="desc">Estes parâmetros valem apenas para esta empresa. ' +
        'Nada aqui é fixado no código: o sistema consulta a configuração antes de agir.</div></div>' +
        (ro ? '' : '<button class="btn btn-primary btn-sm" data-salvar-secao="' + secao + '">Salvar ' + esc((def && def.titulo) || secao) + '</button>') +
      '</div><div class="panel-body">' + corpo +
        '<div id="msg-' + secao + '"></div>' +
      '</div></div></div>';
  }

  /* Renderiza os parâmetros. Quando `parametros` não vem (modo local),
   * infere o TIPO pelo valor atual do banco — assim um booleano continua
   * sendo checkbox e um número continua sendo campo numérico. */
  function renderParamsDeValores(valores, ro, parametros) {
    var chaves = parametros ? Object.keys(parametros) : Object.keys(valores || {});
    if (!chaves.length) return '<div class="muted">Nenhum parâmetro nesta seção.</div>';

    var html = '<div class="params">';
    chaves.forEach(function (chave) {
      var def = parametros ? parametros[chave] : null;
      var tipo = def ? def.tipo : tipoInferido(valores[chave]);
      var rotulo = (def && def.rotulo) || ROTULOS[chave] || chave;
      var dica = DICAS[chave] || '';
      var valor = valores[chave];
      var id = 'p_' + chave;

      if (tipo === 'bool') {
        var ligado = valor === true || valor === 1 || valor === '1' || valor === 'true';
        html += '<label class="param' + (ligado ? '' : ' off') + '" data-param="' + chave + '">' +
          '<input type="checkbox" id="' + id + '" data-chave="' + chave + '" data-tipo="bool"' +
            (ligado ? ' checked' : '') + (ro ? ' disabled' : '') + ' />' +
          '<span class="ptxt"><span class="nome">' + esc(rotulo) + '</span>' +
          (dica ? '<span class="dica">' + esc(dica) + '</span>' : '') + '</span>' +
          '<span class="pin">' + (ligado ? 'Ativado' : 'Desativado') + '</span></label>';
        return;
      }

      if (tipo === 'enum') {
        var opcoes = def && def.opcoes ? def.opcoes : (valor === 'DESATIVADO' || valor === 'FIFO' || valor === 'FEFO' || valor === 'LOTE_MANUAL'
          ? ['DESATIVADO', 'FIFO', 'FEFO', 'LOTE_MANUAL'] : []);
        html += '<div class="field" style="margin:8px 0"><label for="' + id + '">' + esc(rotulo) + '</label>' +
          '<select id="' + id + '" data-chave="' + chave + '" data-tipo="enum"' + (ro ? ' disabled' : '') + '>' +
          opcoes.map(function (o) {
            return '<option value="' + esc(o) + '"' + (String(valor) === o ? ' selected' : '') + '>' + esc(traduzOpcao(o)) + '</option>';
          }).join('') + '</select>' +
          (dica ? '<span class="hint">' + esc(dica) + '</span>' : '') + '</div>';
        return;
      }

      if (tipo === 'numero') {
        html += '<div class="field" style="margin:8px 0"><label for="' + id + '">' + esc(rotulo) + '</label>' +
          '<input id="' + id + '" type="number" min="0" step="any" data-chave="' + chave + '" data-tipo="numero"' +
            ' value="' + esc(valor == null ? 0 : valor) + '"' + (ro ? ' disabled' : '') + ' />' +
          (dica ? '<span class="hint">' + esc(dica) + '</span>' : '') + '</div>';
        return;
      }

      if (tipo === 'lista') {
        var texto = Array.isArray(valor) ? valor.join(', ') : String(valor || '');
        html += '<div class="field" style="margin:8px 0"><label for="' + id + '">' + esc(rotulo) + '</label>' +
          '<input id="' + id + '" data-chave="' + chave + '" data-tipo="lista" value="' + esc(texto) + '"' + (ro ? ' disabled' : '') + ' />' +
          '<span class="hint">Separe por vírgula. ' + esc(dica) + '</span></div>';
        return;
      }

      html += '<div class="field" style="margin:8px 0"><label for="' + id + '">' + esc(rotulo) + '</label>' +
        '<input id="' + id + '" data-chave="' + chave + '" data-tipo="texto" value="' + esc(valor == null ? '' : valor) + '"' +
        (ro ? ' disabled' : '') + ' />' +
        (dica ? '<span class="hint">' + esc(dica) + '</span>' : '') + '</div>';
    });
    html += '</div>';
    return html;
  }

  function tipoInferido(v) {
    if (typeof v === 'boolean') return 'bool';
    if (Array.isArray(v)) return 'lista';
    if (typeof v === 'number') return 'numero';
    return 'texto';
  }

  function traduzOpcao(o) {
    var t = {
      DESATIVADO: 'DESATIVADO — não controla lote',
      FIFO: 'FIFO — First In, First Out (primeiro que entra, primeiro que sai)',
      FEFO: 'FEFO — First Expire, First Out (primeiro que vence, primeiro que sai)',
      LOTE_MANUAL: 'LOTE MANUAL — o operador escolhe o lote',
      NENHUM: 'Nenhum',
      TOLEDO: 'Toledo',
      FILIZOLA: 'Filizola',
      URANO: 'Urano'
    };
    return t[o] || o;
  }

  function ligarSecaoParametros(secao) {
    var botao = $('panes').querySelector('[data-salvar-secao="' + secao + '"]');
    if (botao) {
      botao.addEventListener('click', function () { salvarSecao(secao); });
    }
    // Alternar o rótulo Ativado/Desativado ao clicar (feedback imediato).
    $('panes').querySelectorAll('#pane-' + secao + ' .param').forEach(function (label) {
      var cb = label.querySelector('input[type="checkbox"]');
      if (!cb || cb.disabled) return;
      cb.addEventListener('change', function () {
        label.classList.toggle('off', !cb.checked);
        var pin = label.querySelector('.pin');
        if (pin) pin.textContent = cb.checked ? 'Ativado' : 'Desativado';
      });
    });
  }

  /* Lê o formulário de uma seção e envia apenas o que foi definido. */
  function salvarSecao(secao) {
    if (!pode('fiscal.configurar')) return toast('Seu perfil não pode alterar a configuração.', 'err');
    var dados = {};
    var invalidos = [];

    $('panes').querySelectorAll('#pane-' + secao + ' [data-chave]').forEach(function (el) {
      var chave = el.dataset.chave;
      var tipo = el.dataset.tipo;
      el.classList.remove('invalid');

      if (tipo === 'bool') { dados[chave] = !!el.checked; return; }
      if (tipo === 'numero') {
        var n = Number(el.value);
        if (el.value === '' || !isFinite(n) || n < 0) {
          el.classList.add('invalid');
          invalidos.push(chave);
          return;
        }
        dados[chave] = n;
        return;
      }
      if (tipo === 'lista') {
        dados[chave] = String(el.value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        return;
      }
      dados[chave] = String(el.value || '').trim();
    });

    if (invalidos.length) {
      return toast('Corrija os campos destacados: ' + invalidos.join(', ') + '.', 'err');
    }

    var btn = $('panes').querySelector('[data-salvar-secao="' + secao + '"]');
    if (btn) btn.disabled = true;

    DB.configSalvar(EMPRESA, secao, dados).then(function () {
      if (btn) btn.disabled = false;
      toast('Parâmetros salvos. O sistema já usa os novos valores.', 'ok');
      return posSettingsService.recarregar();
    }).then(function () {
      return carregar();
    }).then(function () {
      // Re-renderiza só esta aba (preserva a aba aberta).
      renderTudo();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      toast(e.message, 'err');
    });
  }

  /* ================================================================== */
  /* CARGA DOS DADOS                                                    */
  /* ================================================================== */

  function carregar() {
    $('modoInfo').textContent = modoServidor() ? 'Modo servidor (tempo real)' : 'Modo local (somente leitura parcial)';

    return DB.configListar(EMPRESA).then(function (r) {
      estado.config = (r && r.config) || {};
      estado.secoes = (r && r.secoes) || {};
      return Promise.all([
        DB.obterEmpresa(EMPRESA).catch(function () { return null; }),
        DB.listarEstabelecimentos(EMPRESA).catch(function () { return []; }),
        DB.listarRegimes(EMPRESA).catch(function () { return null; }),
        DB.obterCertificado(EMPRESA, null).catch(function () { return null; }),
        DB.validarProntidaoFiscal(EMPRESA).catch(function () { return null; }),
        DB.listarProdutos(EMPRESA).catch(function () { return []; })
      ]);
    }).then(function (r) {
      estado.empresa = r[0] || {};
      estado.estabelecimentos = r[1] || [];
      estado.regimes = r[2] || null;
      var cert = r[3];
      estado.certificado = (cert && cert.certificado) ? cert.certificado : null;
      estado.prontidao = r[4] || { pronto: false, motivos: ['Não foi possível verificar.'] };
      estado.produtos = r[5] || [];
      return estado;
    }).catch(function (e) {
      $('avisos').innerHTML = '<div class="erro-box">Falha ao carregar a configuração: ' + esc(e.message) + '</div>';
    });
  }

  $('btnRefresh').addEventListener('click', function () {
    carregar().then(function () { posSettingsService.carregar(EMPRESA); }).then(renderTudo)
      .then(function () { toast('Configuração recarregada.', 'ok'); })
      .catch(function (e) { toast(e.message, 'err'); });
  });

  /* Recarrega quando a configuração muda em outra aba/dispositivo. */
  DB.aoAtualizar(function (msg) {
    if (msg && msg.entidade === 'configuracao') {
      carregar().then(function () { posSettingsService.recarregar(); renderTudo(); }).catch(function () {});
    }
  });

  /* ---------- Boot ----------
   *
   * A ORDEM DE CARGA DO <script> NAO BASTA: os modulos fiscal e de dados
   * definem `window.renderFiscal`/`window.renderDados` DEPOIS que este
   * arquivo ja se registrou. Por isso o boot espera o DOM estar pronto e
   * usa um pequeno `setTimeout(0)`: assim os modulos ja foram avaliados e
   * as abas Fiscal e Dados entram na primeira renderizacao. Sem isso as
   * duas abas existem no menu mas aparecem vazias — falha silenciosa, que
   * e o pior tipo de bug de interface. */
  function iniciar() {
    DB.init().then(function () {
      return posSettingsService.carregar(EMPRESA);
    }).then(carregar).then(function () {
      // Garante que os modulos externos foram avaliados antes de pintar.
      return new Promise(function (r) { setTimeout(r, 0); });
    }).then(renderTudo).catch(function (e) {
      $('avisos').innerHTML = '<div class="erro-box">Falha ao abrir o sistema: ' + esc(e.message) + '</div>';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  /* Expõe para o módulo fiscal/dados usarem. */
  window.cfgEstado = estado;
  window.cfgPode = pode;
  window.cfgEsc = esc;
  window.cfgToast = toast;
  window.cfgAbrirModal = abrirModal;
  window.cfgFecharModal = fecharModal;
  window.cfgCarregar = carregar;
  window.cfgRenderTudo = renderTudo;
  window.cfgUFS = UFS;
  window.cfgModoServidor = modoServidor;
  window.cfgSoDigitos = soDigitos;
  window.cfgEmpresa = EMPRESA;
})();