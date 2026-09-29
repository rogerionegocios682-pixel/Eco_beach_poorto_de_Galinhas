/*
 * Turismo OS — FNRH (Ficha Nacional de Registro de Hóspedes)
 * ----------------------------------------------------------
 * Renderiza DUAS VIAS (empresa e hóspede) a partir dos dados REAIS
 * do banco (db.js). Não possui banco próprio nem dados fixos.
 *
 * Os campos abaixo reproduzem a estrutura da FNRH prevista na
 * regulamentação federal de registro de hóspedes (Lei 11.771/2008 e
 * adoção do sistema FNRH pela EMBRATUR/MTur). A composição exata pode
 * variar conforme a versão vigente — a estrutura fica pronta para
 * adequação, sem inventar exigências.
 */
(function () {
  'use strict';

  var area = document.getElementById('area');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function v(x) { return (x == null || x === '') ? '—' : esc(x); }
  function brl(n) {
    return 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function data(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('pt-BR');
  }
  function hora(iso, h) {
    if (h) return h;
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function celula(k, valor, span, extra) {
    return '<div class="cell' + (span ? ' c' + span : '') + (extra || '') + '"><div class="k">' + k + '</div><div class="v">' + valor + '</div></div>';
  }

  function montarVia(p, via) {
    var r = p.reserva, e = p.empresa || {}, a = p.apto || {}, h = p.hospede || {};
    var titulo = via === 'empresa' ? 'VIA DA EMPRESA' : 'VIA DO HÓSPEDE';

    var logoHtml = e.logo
      ? '<img src="' + esc(e.logo) + '" alt="logo" />'
      : esc((e.nome || 'T').trim().charAt(0).toUpperCase());

    var endEmp = [e.endereco, e.cidade, e.estado, e.pais].filter(Boolean).join(', ');

    var html = '';
    html += '<div class="via-tag">' + titulo + '</div>';

    html += '<div class="via-head">';
    html += '<div class="logo">' + logoHtml + '</div>';
    html += '<div class="emp">';
    html += '<div class="nome">' + v(e.nome) + '</div>';
    html += '<div class="dados">' +
      'CNPJ: ' + v(e.cnpj) + ' &nbsp;•&nbsp; ' + v(endEmp) + '<br />' +
      'Fone: ' + v(e.telefone) + ' &nbsp;•&nbsp; ' + v(e.email) +
      (e.registroEmbratur ? '<br />Registro: ' + v(e.registroEmbratur) : '') +
    '</div>';
    html += '</div>';
    html += '<div class="titulo"><div class="t">FICHA NACIONAL DE REGISTRO DE HÓSPEDES</div>' +
      '<div class="n">Reserva nº <b>' + v(r.numero || r.id) + '</b><br />Emitida em ' + data(new Date().toISOString()) + '</div></div>';
    html += '</div>';

    // --- DADOS DO HÓSPEDE ---
    html += '<div class="sec"><h4>Dados do hóspede</h4><div class="grid">';
    html += celula('Nome completo', v(h.nome || r.hospedeNome), 3);
    html += celula((h.tipoDocumento || 'CPF') + ' / Documento', v(h.documento || h.cpf));
    html += celula('Data de nascimento', data(h.nascimento));
    html += celula('Nacionalidade', v(h.nacionalidade || 'Brasileira'));
    html += celula('Sexo', h.sexo === 'M' ? 'Masculino' : (h.sexo === 'F' ? 'Feminino' : '—'));
    html += celula('Telefone', v(h.telefone));
    html += celula('Endereço', v(h.endereco), 2);
    html += celula('Cidade', v(h.cidade));
    html += celula('Estado', v(h.estado));
    html += celula('País', v(h.pais || 'Brasil'));
    html += celula('CEP', v(h.cep));
    html += celula('E-mail', v(h.email), 2);
    html += '</div></div>';

    // --- DADOS DA HOSPEDAGEM ---
    html += '<div class="sec"><h4>Dados da hospedagem</h4><div class="grid">';
    html += celula('Apartamento', 'APT ' + v(a.numero) + ' — ' + v(a.tipo), 2);
    html += celula('Nº da reserva', v(r.numero || r.id));
    html += celula('Situação', v(r.status));
    html += celula('Check-in', data(r.entrada));
    html += celula('Hora check-in', hora(r.entrada, r.horaEntrada));
    html += celula('Check-out', data(r.saida));
    html += celula('Hora check-out', hora(r.saida, r.horaSaida));
    html += celula('Nº de diárias', String(r.qtdDiarias != null ? r.qtdDiarias : '—'));
    html += celula('Hóspedes', String(r.pessoas || '—') + ' (' + (r.adultos || 0) + ' ad. / ' + (r.criancas || 0) + ' cr.)');
    html += celula('Procedência / origem', v(r.origem));
    html += celula('Observações', v(r.observacoes), 3);
    html += '</div></div>';

    // --- DADOS FINANCEIROS ---
    var sub = r.subtotal != null ? r.subtotal : ((r.qtdDiarias || 0) * (r.diaria || 0));
    var tot = r.total != null ? r.total : sub;
    html += '<div class="sec"><h4>Dados financeiros</h4><div class="grid fin">';
    html += celula('Valor da diária', brl(r.diaria));
    html += celula('Quantidade de diárias', String(r.qtdDiarias != null ? r.qtdDiarias : '—'));
    html += celula('Subtotal', brl(sub));
    html += celula('Desconto', brl(r.desconto || 0));
    html += celula('Taxas', brl(r.taxas || 0));
    html += celula('Forma de pagamento', v(r.formaPagamento || '—'));
    html += celula('Situação do pagamento', v(r.situacaoPagamento || '—'));
    html += celula('Valor total da hospedagem', '<span class="big">' + brl(tot) + '</span>', 2, ' nr');
    html += '</div></div>';

    // --- ASSINATURAS ---
    html += '<div class="fim-linha">';
    html += '<div class="assin">Assinatura do hóspede</div>';
    html += '<div class="assin">Assinatura / carimbo do estabelecimento</div>';
    html += '</div>';

    html += '<div class="via-foot">';
    html += '<span>FNRH — ' + v(e.nome) + ' — Reserva nº ' + v(r.numero || r.id) + '</span>';
    html += '<span>' + titulo + '</span>';
    html += '</div>';

    return '<div class="via">' + html + '</div>';
  }

  function render(p) {
    area.innerHTML = montarVia(p, 'empresa') + montarVia(p, 'hospede');
  }

  function recarregarDoBanco(id) {
    return DB.init().then(function () {
      return DB.obterReserva(Number(id));
    }).then(function (r) {
      if (!r) throw new Error('Reserva nº ' + id + ' não encontrada.');
      return Promise.all([
        DB.obterEmpresa(r.empresaId || DB.EMPRESA_PADRAO),
        r.aptoId ? DB.obterApto(r.aptoId) : Promise.resolve(null),
        r.hospedeId ? DB.obterHospede(r.hospedeId) : Promise.resolve(null)
      ]).then(function (res) {
        return { reserva: r, empresa: res[0], apto: res[1], hospede: res[2] };
      });
    });
  }

  // 1) tenta o pacote entregue pelo dashboard; 2) recarrega do banco pelo hash.
  var pacote = null;
  try { pacote = JSON.parse(sessionStorage.getItem('fnrh_pacote') || 'null'); } catch (e) { pacote = null; }

  var idHash = (location.hash || '').replace('#', '');

  if (pacote && pacote.reserva && String(pacote.reserva.id) === idHash) {
    render(pacote);
  } else if (idHash) {
    recarregarDoBanco(idHash).then(render).catch(function (e) {
      area.innerHTML = '<div class="empty">Erro ao carregar a ficha: ' + esc(e.message) + '</div>';
    });
  } else if (pacote && pacote.reserva) {
    render(pacote);
  } else {
    area.innerHTML = '<div class="empty">Nenhuma reserva informada para gerar a FNRH.</div>';
  }
})();

