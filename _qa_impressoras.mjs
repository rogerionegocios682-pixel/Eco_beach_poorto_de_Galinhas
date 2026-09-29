/* QA da aba IMPRESSORAS no navegador (Configuracoes > Impressoras). */
export default async function run(page, ui) {
  const erros = [];
  page.on('pageerror', (e) => erros.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  await page.locator('#usuario').fill('admin@turismoos.com');
  await page.locator('#senha').fill('123456');
  await page.locator('#btnLogin').click();
  await page.waitForTimeout(4000);

  // A tela de Configuracoes e onde vive a aba Impressoras.
  await page.goto('http://localhost:3000/configuracoes.html');
  await page.waitForTimeout(5000);

  const r = { erros, url: page.url() };

  const aba = page.locator('.cfg-tabs button', { hasText: /^Impressoras$/ }).first();
  r.existeAbaImpressoras = await aba.count() > 0;
  if (!r.existeAbaImpressoras) return r;

  await aba.click();
  await page.waitForTimeout(2500);

  r.paneVisivel = await page.locator('#pane-impressoras.on').count() > 0;
  r.subAbas = await page.locator('.imp-subabas button').allInnerTexts().catch(() => []);
  r.temBotaoProcurar = await page.locator('#impProcurar').count() > 0;
  r.temBotaoAtualizar = await page.locator('#impAtualizarLista').count() > 0;
  r.temBotaoProcessarFila = await page.locator('#impProcFila').count() > 0;
  r.temBotaoRestaurar = await page.locator('#impRestaurar').count() > 0;

  // Status do Print Service (deve detectar o servico local rodando).
  r.statusServico = await page.locator('#impServico').innerText().catch(() => '');

  // PROCURAR IMPRESSORAS
  await page.locator('#impProcurar').click();
  await page.waitForTimeout(6000);
  r.cardsEncontrados = await page.locator('.imp-card').count();
  r.primeiroCard = await page.locator('.imp-card .imp-nome').first().innerText().catch(() => '');
  r.temStatusNoCard = await page.locator('.imp-card .imp-linha').count() > 0;
  r.temBotaoTestar = await page.locator('.imp-card [data-testar]').count() > 0;
  r.temBotaoConfigurar = await page.locator('.imp-card [data-config]').count() > 0;
  r.termicas = await page.locator('.imp-card').evaluateAll((cards) => cards
    .filter((c) => /Termica/.test(c.innerText))
    .map((c) => c.querySelector('.imp-nome').innerText)).catch(() => []);

  // CONFIGURAR a primeira impressora encontrada.
  const btnConf = page.locator('.imp-card [data-config]').first();
  if (await btnConf.count()) {
    await btnConf.click();
    await page.waitForTimeout(1800);
    r.modalConfigAberto = await page.locator('#overlay.show').count() > 0;
    r.camposConfig = {
      nome: await page.locator('#ipNome').count() > 0,
      windows: await page.locator('#ipWindows').count() > 0,
      tipo: await page.locator('#ipTipo').count() > 0,
      largura: await page.locator('#ipLargura').count() > 0,
      estacao: await page.locator('#ipEstacao').count() > 0,
      funcao: await page.locator('#ipFuncao').count() > 0,
      endpoint: await page.locator('#ipEndpoint').count() > 0
    };
    r.opcoesFuncao = await page.locator('#ipFuncao option').allInnerTexts().catch(() => []);
    r.opcoesLargura = await page.locator('#ipLargura option').allInnerTexts().catch(() => []);

    // Salva como impressora de CAIXA.
    await page.locator('#ipNome').fill('Caixa principal');
    await page.selectOption('#ipFuncao', 'CAIXA');
    await page.locator('#mOk').click();
    await page.waitForTimeout(2500);
    r.salvou = await page.locator('#overlay.show').count() === 0;
    r.impressorasCadastradas = await page.locator('#impConteudo table tbody tr').count();
  }

  // Sub-aba ESTACOES
  await page.locator('.imp-subabas button', { hasText: /Estacoes/ }).click();
  await page.waitForTimeout(1000);
  r.temBotaoNovaEstacao = await page.locator('#estNova').count() > 0;
  r.temDefinirEstacaoLocal = await page.locator('#estDefinirLocal').count() > 0;

  // Sub-aba SETORES
  await page.locator('.imp-subabas button', { hasText: /Setores/ }).click();
  await page.waitForTimeout(1000);
  r.temCampoCategoria = await page.locator('#mapCategoria').count() > 0;
  r.temCampoImpressora = await page.locator('#mapImpressora').count() > 0;

  // Sub-aba FILA
  await page.locator('.imp-subabas button', { hasText: /Fila/ }).click();
  await page.waitForTimeout(1000);
  r.temBotaoAtualizarFila = await page.locator('#filaAtualizar').count() > 0;

  // Sub-aba HISTORICO
  await page.locator('.imp-subabas button', { hasText: /Historico/ }).click();
  await page.waitForTimeout(1000);
  r.temBotaoAtualizarHist = await page.locator('#histAtualizar').count() > 0;

  return r;
}