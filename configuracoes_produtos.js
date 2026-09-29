/**
 * Turismo OS — configuracoes_produtos.js
 * =====================================================================
 * Aba PRODUTOS (cadastro com FOTO) e a ponte de dados do PDV visual.
 *
 * O QUE ESTE ARQUIVO ACRESCENTA (sem duplicar nada):
 *   1. Uma aba "Produtos" na tela de Configurações, que lista o catalogo
 *      com miniatura e abre o cadastro completo (rota que JA existia:
 *      `produto/salvar-completo`).
 *   2. A gestao da FOTO do produto: enviar, alterar, excluir e visualizar.
 *      A foto e comprimida no NAVEGADOR (canvas) antes de subir — assim o
 *      PDV nunca carrega imagem gigante e o upload e rapido no celular.
 *      O binario vai para o disco do servidor (/midia/produtos/...); no
 *      banco ficam apenas as URLs (`produtos.imagemUrl` / `imagemThumbUrl`).
 *   3. O helper puro `window.PdvImagem.comprimir()` — usado tambem pelos
 *      testes unitarios, sem depender do DOM.
 *
 * NAO existe um segundo cadastro de produto: esta aba usa as MESMAS rotas
 * do cadastro existente (produtos/listar, produto/obter, produto/salvar-completo).
 */
(function (global) {
  'use strict';

  /* ================================================================== */
  /* COMPRESSAO DE IMAGEM (logica pura + canvas)                        */
  /* ================================================================== */

  var LADO_GRANDE = 800;   // imagem da visualizacao ampliada
  var LADO_THUMB = 320;    // miniatura carregada nos cards do PDV
  var QUALIDADE = 0.82;

  /* Calcula as dimensoes de saida mantendo a proporcao.
   * PURA: recebe numeros, devolve numeros — testavel sem canvas. */
  function calcularDimensoes(largura, altura, ladoMaximo) {
    var l = Number(largura) || 0;
    var a = Number(altura) || 0;
    var max = Number(ladoMaximo) || 0;
    if (l <= 0 || a <= 0 || max <= 0) return { largura: 0, altura: 0, redimensionada: false };
    var maior = Math.max(l, a);
    if (maior <= max) return { largura: Math.round(l), altura: Math.round(a), redimensionada: false };
    var fator = max / maior;
    return { largura: Math.max(1, Math.round(l * fator)), altura: Math.max(1, Math.round(a * fator)), redimensionada: true };
  }

  /* Extensao de saida. O canvas do navegador so exporta JPEG, PNG e WEBP;
   * enviamos sempre JPEG (menor) exceto quando a origem tem transparencia
   * (PNG), que precisa continuar PNG. PURA. */
  function extensaoDeSaida(tipoOrigem) {
    var t = String(tipoOrigem || '').toLowerCase();
    if (t === 'image/png' || t === 'image/webp') return t;
    return 'image/jpeg';
  }

  /* Le a imagem do input e devolve { dataUrl, thumb, largura, altura }.
   * Usa canvas (navegador). Em ambiente sem DOM (testes), o helper puro
   * `calcularDimensoes` continua disponivel separadamente. */
  function comprimir(arquivo, opts) {
    opts = opts || {};
    var ladoGrande = opts.ladoGrande || LADO_GRANDE;
    var ladoThumb = opts.ladoThumb || LADO_THUMB;
    var qualidade = opts.qualidade || QUALIDADE;

    return new Promise(function (resolve, reject) {
      if (!arquivo) { reject(new Error('Nenhum arquivo selecionado.')); return; }
      var tipo = String(arquivo.type || '').toLowerCase();
      var aceitos = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (aceitos.indexOf(tipo) === -1) {
        reject(new Error('Formato não aceito. Envie JPG, JPEG, PNG ou WEBP.'));
        return;
      }
      if (arquivo.size > 20 * 1024 * 1024) {
        reject(new Error('Arquivo muito grande (limite 20 MB antes da compressão).'));
        return;
      }

      var leitor = new FileReader();
      leitor.onerror = function () { reject(new Error('Não foi possível ler o arquivo.')); };
      leitor.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('O arquivo não é uma imagem válida.')); };
        img.onload = function () {
          var saida = extensaoDeSaida(tipo);
          var grande = calcularDimensoes(img.width, img.height, ladoGrande);
          var thumb = calcularDimensoes(img.width, img.height, ladoThumb);
          try {
            resolve({
              dataUrl: desenhar(img, grande, saida, qualidade),
              thumb: desenhar(img, thumb, saida, Math.min(qualidade, 0.75)),
              largura: img.width,
              altura: img.height,
              larguraFinal: grande.largura,
              alturaFinal: grande.altura
            });
          } catch (e) { reject(e); }
        };
        img.src = leitor.result;
      };
      leitor.readAsDataURL(arquivo);
    });
  }

  function desenhar(img, dim, tipo, qualidade) {
    var canvas = document.createElement('canvas');
    canvas.width = dim.largura;
    canvas.height = dim.altura;
    var ctx = canvas.getContext('2d');
    // Fundo branco: JPEG não tem transparência (evita fundo preto).
    if (tipo === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, dim.largura, dim.altura);
    return canvas.toDataURL(tipo, qualidade);
  }

  global.PdvImagem = {
    calcularDimensoes: calcularDimensoes,
    extensaoDeSaida: extensaoDeSaida,
    comprimir: comprimir,
    LADO_GRANDE: LADO_GRANDE,
    LADO_THUMB: LADO_THUMB
  };

  /* ================================================================== */
  /* ABA PRODUTOS                                                       */
  /* ================================================================== */

  if (typeof window === 'undefined' || typeof window.cfgEstado === 'undefined') {
    // Carregado fora da tela de Configurações (ex.: em testes): só expõe
    // os helpers puros acima e encerra.
    return;
  }

  var esc = window.cfgEsc;
  var toast = window.cfgToast;
  var abrirModal = window.cfgAbrirModal;
  var fecharModal = window.cfgFecharModal;
  var EMPRESA = window.cfgEmpresa;

  var estado = window.cfgEstado;
  estado.produtos = estado.produtos || [];
  estado.filtroProdutos = '';

  /* ---- Render da aba ------------------------------------------------ */

  window.renderProdutosCompleto = function renderProdutosCompleto() {
    var lista = filtrar(estado.produtos, estado.filtroProdutos);

    return '<div class="cfg-pane" id="pane-produtos">' +
      '<div class="panel"><div class="panel-head">' +
        '<div><h2>Produtos do PDV</h2>' +
        '<div class="desc">Cadastro do catálogo, preço e foto. A mesma foto aparece nos cards do PDV ' +
        'e no cardápio digital — não existe um segundo cadastro.</div></div>' +
        '<button class="btn btn-primary btn-sm" id="btnNovoProduto">+ Novo produto</button>' +
      '</div><div class="panel-body">' +
        '<div class="prod-toolbar">' +
          '<input id="prodFiltro" placeholder="Pesquisar por nome, código ou código de barras…" value="' + esc(estado.filtroProdutos) + '" />' +
          '<span class="prod-cont" id="prodCont">' + lista.length + ' produto(s)</span>' +
        '</div>' +
        '<div class="prod-grid" id="prodGrid"></div>' +
        '<div id="msg-produtos"></div>' +
      '</div></div></div>';
  };

  window.ligarProdutos = function ligarProdutos() {
    var btn = document.getElementById('btnNovoProduto');
    if (btn) btn.addEventListener('click', function () { abrirCadastro(null); });

    var filtro = document.getElementById('prodFiltro');
    if (filtro) {
      filtro.addEventListener('input', function () {
        estado.filtroProdutos = filtro.value;
        pintarGrid();
      });
    }
    pintarGrid();
  };

  function filtrar(lista, termo) {
    var f = String(termo || '').trim().toLowerCase();
    if (!f) return lista;
    return lista.filter(function (p) {
      return [p.nome, p.codigoInterno, p.codigoBarras, p.ean, p.categoria, p.subcategoria]
        .some(function (c) { return String(c == null ? '' : c).toLowerCase().indexOf(f) !== -1; });
    });
  }

  function pintarGrid() {
    var grid = document.getElementById('prodGrid');
    if (!grid) return;
    var lista = filtrar(estado.produtos, estado.filtroProdutos);
    var cont = document.getElementById('prodCont');
    if (cont) cont.textContent = lista.length + ' produto(s)';

    if (!lista.length) {
      grid.innerHTML = '<div class="empty">Nenhum produto encontrado.</div>';
      return;
    }

    grid.innerHTML = lista.map(function (p) {
      var foto = p.imagemThumbUrl || p.imagemUrl;
      return '<div class="pcard" data-prod="' + p.id + '">' +
        '<div class="pfoto">' + (foto
          ? '<img src="' + esc(foto) + '" alt="' + esc(p.nome) + '" loading="lazy" />'
          : '<span class="sfoto">SEM FOTO</span>') + '</div>' +
        '<div class="pinfo">' +
          '<div class="pnome">' + esc(p.nome) + '</div>' +
          '<div class="pcat">' + esc(p.categoria || 'Geral') + '</div>' +
          '<div class="ppreco">' + moeda(p.preco) + '</div>' +
          (p.ativo === 0 ? '<div class="pinativo">INATIVO</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('[data-prod]').forEach(function (el) {
      el.addEventListener('click', function () { abrirCadastro(Number(el.dataset.prod)); });
    });
  }

  function moeda(v) {
    return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ---- Cadastro (usa a rota que JA existe) -------------------------- */

  function abrirCadastro(id) {
    var base = { nome: '', categoria: 'Geral', preco: 0, ativo: true };
    var carregar = id
      ? DB.obterProdutoCompleto(EMPRESA, id).catch(function () { return null; })
      : Promise.resolve(base);

    carregar.then(function (p) {
      p = p || base;
      abrirModal(
        '<h3>' + (id ? 'Editar produto' : 'Novo produto') + '</h3>' +
        '<div class="prod-foto-area">' +
          '<div class="prod-foto-box" id="pFotoBox">' + fotoPreviewHtml(p) + '</div>' +
          '<div class="prod-foto-acoes">' +
            '<input type="file" id="pFotoArquivo" accept="image/jpeg,image/jpg,image/png,image/webp" style="display:none" />' +
            '<button class="btn btn-ghost-m btn-sm" id="pFotoEnviar">' + (p.imagemUrl ? 'Alterar foto' : 'Enviar foto') + '</button>' +
            (p.imagemUrl ? '<button class="btn btn-ghost-m btn-sm" id="pFotoVer">Visualizar</button>' : '') +
            (p.imagemUrl ? '<button class="btn btn-danger btn-sm" id="pFotoExcluir">Excluir foto</button>' : '') +
            '<div class="hint">JPG, PNG ou WEBP. A imagem é redimensionada automaticamente (máx. 800px).</div>' +
          '</div>' +
        '</div>' +
        '<div class="grid2">' +
          '<div class="field"><label>Nome *</label><input id="pNome" value="' + esc(p.nome || '') + '" /></div>' +
          '<div class="field"><label>Categoria</label><input id="pCategoria" value="' + esc(p.categoria || 'Geral') + '" /></div>' +
          '<div class="field"><label>Preço (R$)</label><input id="pPreco" type="number" step="0.01" value="' + (Number(p.preco) || 0).toFixed(2) + '" /></div>' +
          '<div class="field"><label>Código interno</label><input id="pCodigo" value="' + esc(p.codigoInterno || '') + '" /></div>' +
          '<div class="field"><label>Código de barras</label><input id="pBarras" value="' + esc(p.codigoBarras || '') + '" /></div>' +
          '<div class="field"><label>Unidade</label><input id="pUnidade" value="' + esc(p.unidade || 'UN') + '" /></div>' +
        '</div>' +
        '<label class="prod-check"><input type="checkbox" id="pAtivo" ' + (p.ativo !== 0 ? 'checked' : '') + ' /> Produto ativo</label>' +
        '<div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Cancelar</button>' +
        '<button class="btn btn-primary" id="mOk">Salvar produto</button></div>'
      );

      var arquivoPendente = null;
      var produtoId = id || null;

      document.getElementById('mCancel').addEventListener('click', fecharModal);

      document.getElementById('pFotoEnviar').addEventListener('click', function () {
        document.getElementById('pFotoArquivo').click();
      });

      document.getElementById('pFotoArquivo').addEventListener('change', function (ev) {
        var f = ev.target.files && ev.target.files[0];
        if (!f) return;
        global.PdvImagem.comprimir(f).then(function (r) {
          arquivoPendente = r;
          document.getElementById('pFotoBox').innerHTML =
            '<img src="' + r.thumb + '" alt="Pré-visualização" />' +
            '<span class="badge-foto">pronta para salvar · ' + r.larguraFinal + '×' + r.alturaFinal + 'px</span>';
          toast('Foto pronta. Salve o produto para gravar.');
        }).catch(function (e) { toast(e.message, true); });
      });

      var btnVer = document.getElementById('pFotoVer');
      if (btnVer) btnVer.addEventListener('click', function () { abrirModal('<h3>Foto do produto</h3><img class="prod-foto-grande" src="' + esc(p.imagemUrl) + '" alt="' + esc(p.nome) + '" /><div class="modal-foot"><button class="btn btn-ghost-m" id="mCancel">Fechar</button></div>'); document.getElementById('mCancel').addEventListener('click', fecharModal); });

      var btnExcluir = document.getElementById('pFotoExcluir');
      if (btnExcluir) btnExcluir.addEventListener('click', function () {
        if (!produtoId) { toast('Salve o produto antes de excluir a foto.', true); return; }
        if (!confirm('Excluir a foto deste produto?')) return;
        DB.removerImagemProduto(EMPRESA, produtoId).then(function () {
          toast('Foto excluída.'); fecharModal(); return window.cfgCarregar();
        }).then(function () { window.cfgRenderTudo(); })
          .catch(function (e) { toast('Erro ao excluir a foto: ' + e.message, true); });
      });

      document.getElementById('mOk').addEventListener('click', function () {
        var nome = document.getElementById('pNome').value.trim();
        if (!nome) { toast('Informe o nome do produto.', true); return; }

        var dados = {
          id: produtoId,
          nome: nome,
          categoria: document.getElementById('pCategoria').value.trim() || 'Geral',
          preco: Number(document.getElementById('pPreco').value) || 0,
          codigoInterno: document.getElementById('pCodigo').value.trim(),
          codigoBarras: document.getElementById('pBarras').value.trim(),
          unidade: document.getElementById('pUnidade').value.trim() || 'UN',
          ativo: document.getElementById('pAtivo').checked,
          produtoVenda: 1
        };

        var btn = document.getElementById('mOk');
        btn.disabled = true;
        btn.textContent = 'SALVANDO…';

        DB.salvarProdutoCompleto(EMPRESA, dados).then(function (r) {
          produtoId = (r && r.id) ? r.id : produtoId;
          if (!arquivoPendente || !produtoId) return null;
          return DB.salvarImagemProduto(EMPRESA, produtoId, arquivoPendente.dataUrl, arquivoPendente.thumb);
        }).then(function () {
          toast('Produto salvo.');
          fecharModal();
          return window.cfgCarregar();
        }).then(function () { window.cfgRenderTudo(); })
          .catch(function (e) {
            btn.disabled = false;
            btn.textContent = 'Salvar produto';
            toast('Erro ao salvar: ' + e.message, true);
          });
      });
    });
  }

  function fotoPreviewHtml(p) {
    var foto = p.imagemThumbUrl || p.imagemUrl;
    return foto
      ? '<img src="' + esc(foto) + '" alt="' + esc(p.nome) + '" />'
      : '<span class="sfoto">SEM FOTO</span>';
  }
})(typeof window !== 'undefined' ? window : globalThis);