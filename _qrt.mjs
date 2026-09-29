// QA tempo real — duas abas: aba A lanca consumo, aba B deve receber.
export default async function run(page, ui) {
  const snap0 = await ui.snapshot();
  const inputs = [...snap0.matchAll(/@(e\d+) textbox/g)].map((m) => m[1]);
  if (inputs[0]) await ui.fill('@' + inputs[0], 'admin');
  if (inputs[1]) await ui.fill('@' + inputs[1], '123456');
  const btn = snap0.match(/@(e\d+) button[^\n]*[Ee]ntrar/);
  if (btn) await ui.click('@' + btn[1]);
  await page.waitForFunction(() => document.querySelectorAll('#aptGrid .apt').length > 0, { timeout: 15000 }).catch(() => { });

  const url = 'file:///C:/Users/Rog%C3%A9rio%20Herculano/Desktop/PROJETOS/Turismo_OS/dashboard.html';

  // Aba B (outra página) — precisa da sessao no localStorage, que e por origem.
  const pageB = await page.context().newPage();
  await pageB.goto(url);
  await pageB.waitForFunction(() => document.querySelectorAll('#aptGrid .apt').length > 0, { timeout: 15000 }).catch(() => { });

  // Instala um observador na aba B via <script> (mesmo mundo da pagina).
  await pageB.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = "window.__rtRecebido = []; DB.aoAtualizar(function (msg) { window.__rtRecebido.push(msg.entidade + ':' + msg.acao); }); window.__rtPronto = true;";
    document.body.appendChild(s); s.remove();
    const t = setInterval(() => { if (window.__rtPronto) { clearInterval(t); resolve(true); } }, 80);
    setTimeout(() => { clearInterval(t); resolve(false); }, 5000);
  }));

  // Conta quantos consumos o apto 02 tem ANTES (na aba B).
  const antes = await pageB.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = "(async function(){ await DB.init(); var aptos = await DB.listarAptos(1); var a = aptos.filter(function(x){return String(x.numero)==='02';})[0]; var e = await DB.estadoDoApto(a.id); var b=document.createElement('pre'); b.id='__a'; b.textContent=String(e.financeiro.totalConsumo); document.body.appendChild(b); })();";
    document.body.appendChild(s); s.remove();
    const t = setInterval(() => { const o = document.getElementById('__a'); if (o) { clearInterval(t); resolve(Number(o.textContent)); } }, 100);
    setTimeout(() => { clearInterval(t); resolve(-1); }, 8000);
  }));

  // Aba A lanca um consumo.
  await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = "(async function(){ await DB.init(); var aptos = await DB.listarAptos(1); var a = aptos.filter(function(x){return String(x.numero)==='02';})[0]; var e = await DB.estadoDoApto(a.id); await DB.criarConsumo({empresaId:1,hospedagemId:e.hospedagem.id,aptoId:a.id,descricao:'1x TEMPO REAL QA',valor:33.33,itens:1,status:'aberto',usuario:'QA RT'}); var b=document.createElement('pre'); b.id='__b'; b.textContent='ok'; document.body.appendChild(b); })();";
    document.body.appendChild(s); s.remove();
    const t = setInterval(() => { const o = document.getElementById('__b'); if (o) { clearInterval(t); resolve(true); } }, 100);
    setTimeout(() => { clearInterval(t); resolve(false); }, 8000);
  }));

  await pageB.waitForTimeout(2500);

  const recebido = await pageB.evaluate(() => ({ lista: window.__rtRecebido || [], pronto: !!window.__rtPronto }));

  // Total do apto 02 na aba B DEPOIS (recarregando do banco).
  const depois = await pageB.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = "(async function(){ var aptos = await DB.listarAptos(1); var a = aptos.filter(function(x){return String(x.numero)==='02';})[0]; var e = await DB.estadoDoApto(a.id); var b=document.createElement('pre'); b.id='__c'; b.textContent=String(e.financeiro.totalConsumo); document.body.appendChild(b); })();";
    document.body.appendChild(s); s.remove();
    const t = setInterval(() => { const o = document.getElementById('__c'); if (o) { clearInterval(t); resolve(Number(o.textContent)); } }, 100);
    setTimeout(() => { clearInterval(t); resolve(-1); }, 8000);
  }));

  await pageB.close();

  return {
    antes: antes,
    depois: depois,
    diferenca: depois - antes,
    notificacoesRecebidasNaAbaB: recebido.lista,
    observadorInstalado: recebido.pronto,
    tempoRealOK: recebido.lista.length > 0 && depois === antes + 33.33
  };
}
