// QA tempo real — espera a pagina carregar de fato antes de agir.
export default async function run(page, ui) {
  // Espera o formulario de login ficar interativo (JS pronto).
  await page.waitForSelector('#dbStatus.ready', { timeout: 60000 }).catch(() => { });
  await page.waitForFunction(() => window.DB && window.DB.isReady && window.DB.isReady(), { timeout: 60000 });

  // Preenche por DOM direto (imune a refs numeradas desatualizadas).
  await page.fill('#usuario', 'admin');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');

  await page.waitForURL(/dashboard\.html/, { timeout: 60000 });
  await page.waitForFunction(() => window.DB && window.DB.isReady && window.DB.isReady(), { timeout: 60000 });

  const dash = 'file:///C:/Users/Rog%C3%A9rio%20Herculano/Desktop/PROJETOS/Turismo_OS/dashboard.html';

  const pageB = await page.context().newPage();
  await pageB.goto(dash);
  await pageB.waitForFunction(() => window.DB && window.DB.isReady && window.DB.isReady(), { timeout: 60000 });

  const obs = await pageB.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = "window.__rt=[]; window.DB.aoAtualizar(function(m){ window.__rt.push(m.entidade+':'+m.acao); }); window.__rtOk=1;";
    document.body.appendChild(s); s.remove();
    const t = setInterval(() => { if (window.__rtOk) { clearInterval(t); resolve(true); } }, 50);
    setTimeout(() => { clearInterval(t); resolve(false); }, 5000);
  }));

  const lancou = await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = "(async function(){ var aptos=await DB.listarAptos(1); var a=aptos.filter(function(x){return String(x.numero)==='02';})[0]; var e=await DB.estadoDoApto(a.id); await DB.criarConsumo({empresaId:1,hospedagemId:e.hospedagem.id,aptoId:a.id,descricao:'RT final',valor:44.44,itens:1,status:'aberto',usuario:'QA'}); window.__okA=1; })();";
    document.body.appendChild(s); s.remove();
    const t = setInterval(() => { if (window.__okA) { clearInterval(t); resolve(true); } }, 50);
    setTimeout(() => { clearInterval(t); resolve('timeout'); }, 10000);
  }));

  await pageB.waitForTimeout(5000);
  const rt = await pageB.evaluate(() => window.__rt || []);
  await pageB.close();

  return { observadorInstalado: obs, lancouNaAbaA: lancou, notificacoesNaAbaB: rt, tempoRealOK: rt.length > 0 };
}
