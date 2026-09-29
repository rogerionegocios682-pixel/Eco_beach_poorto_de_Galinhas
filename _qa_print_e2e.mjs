/* QA end-to-end: lanca produto, abre o fechamento, imprime a conta pelo
 * Print Service e confere que a mesa continua ABERTA (regra 13). */
export default async function run(page, ui) {
  const erros = [];
  page.on('pageerror', (e) => erros.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  await page.locator('#usuario').fill('admin@turismoos.com');
  await page.locator('#senha').fill('123456');
  await page.locator('#btnLogin').click();
  await page.waitForTimeout(4000);

  const r = { erros, url: page.url() };
  r.printServiceDisponivel = await page.evaluate(() => typeof window.PrintService);

  // Vai para Mesas e abre uma comanda.
  await page.locator('#nav a[data-view="mesas"]').first().click();
  await page.waitForTimeout(2000);

  const mesa = page.locator('#mesaGrid .apt, #mesaGrid [data-mesa]').first();
  if (!(await mesa.count())) { r.erro = 'sem mesas'; return r; }
  await mesa.click();
  await page.waitForTimeout(1500);
  const btnAbrir = page.locator('#mOk');
  if (await btnAbrir.count()) { await btnAbrir.click(); await page.waitForTimeout(2500); }

  // Lanca produtos pela grade de cards.
  const btnAdd = page.locator('#comAdd');
  if (await btnAdd.count()) {
    await btnAdd.click();
    await page.waitForTimeout(2500);
    const cards = page.locator('#prodList .pdcard:not(.indisponivel)');
    const n = Math.min(await cards.count(), 2);
    for (let i = 0; i < n; i++) { await cards.nth(i).click(); await page.waitForTimeout(300); }
    r.itensNoCarrinho = await page.locator('#carrinho .ci').count();
    await page.locator('#mOk').click();
    await page.waitForTimeout(3000);
  }

  // Abre o fechamento de conta.
  const btnFechar = page.locator('#comFecharConta');
  if (!(await btnFechar.count())) { r.erro = 'sem botao fechar conta'; return r; }
  await btnFechar.click();
  await page.waitForTimeout(2500);

  r.cupomTemItens = await page.locator('.cupom .cup-item').count();
  r.cupomTotal = await page.locator('.cupom .cup-tt').innerText().catch(() => '');

  // Bloqueia a caixa de impressao do navegador (nao deve ser usada: o
  // Print Service local esta ativo).
  await page.evaluate(() => { window.__printNavegador = 0; window.print = () => { window.__printNavegador++; }; });

  // IMPRIMIR CONTA -> deve ir pelo Print Service.
  await page.locator('#fcImprimir').click();
  await page.waitForTimeout(7000);
  r.toastImpressao = await page.locator('#toast').innerText().catch(() => '');
  r.usouImpressoraNavegador = await page.evaluate(() => window.__printNavegador);

  // A mesa/comanda NAO podem ter sido encerradas.
  r.mesaContinuaAberta = await page.locator('#comFecharConta').count() > 0;
  r.drawerAindaAberto = await page.locator('#comDrawer.show').count() > 0;

  // Confere no servidor que o trabalho foi para a fila.
  r.fila = await page.evaluate(async () => {
    try {
      const r = await DB.filaImpressao(1, { limite: 5 });
      return r.map((t) => ({ id: t.id, tipo: t.tipo, status: t.status, impressora: t.impressoraNome }));
    } catch (e) { return 'erro: ' + e.message; }
  });

  // IMPRIMIR PARCIAL
  const btnParcial = page.locator('#fcParcial');
  if (await btnParcial.count()) {
    await btnParcial.click();
    await page.waitForTimeout(6000);
    r.toastParcial = await page.locator('#toast').innerText().catch(() => '');
  }

  return r;
}