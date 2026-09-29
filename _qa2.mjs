// QA 2 — testa menu, telas, check-in, criacao de apto e responsividade.
const clean = (s) => (s || '').replace(/[ ]+/g, ').replace(/\s*\n\s*/g, ').trim();

export default async function run(page, ui) {
  const out = { steps: [] };

  // Login
  const snap0 = await ui.snapshot();
  const inputs = [...snap0.matchAll(/@(e\d+) textbox/g)].map((m) => m[1]);
  if (inputs[0]) await ui.fill('@' + inputs[0], 'admin');
  if (inputs[1]) await ui.fill('@' + inputs[1], '123456');
  const btn = snap0.match(/@(e\d+) button[^\n]*[Ee]ntrar/);
  if (btn) await ui.click('@' + btn[1]);

  await page.waitForFunction(() => document.querySelectorAll('#aptGrid .apt').length > 0, { timeout: 15000 }).catch(() => { });

  // Navega por cada item do menu
  for (const v of ['reservas', 'mesas', 'passantes', 'cadastros', 'aptos']) {
    await page.evaluate((name) => {
      const a = document.querySelector('#nav a[data-view="' + name + '"]');
      if (a) a.click();
    }, v);
    await page.waitForTimeout(400);
    out.steps.push(await page.evaluate((name) => {
      const view = document.getElementById('view-' + name);
      const active = view && view.classList.contains('active');
      let rows = 0, cards = 0;
      if (view) { rows = view.querySelectorAll('tbody tr').length; cards = view.querySelectorAll('.apt').length; }
      return { view: name, active, title: document.getElementById('pageTitle').textContent, rows, cards };
    }, v));
  }

  // Criar um apartamento novo (deve aparecer na tela inicial automaticamente)
  await page.evaluate(() => document.querySelector('#nav a[data-view="cadastros"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('btnNovoAptoCad').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.getElementById('apNum').value = '77';
    document.getElementById('apTipo').value = 'Suíte';
    document.getElementById('apCap').value = '4';
    document.getElementById('apDiaria').value = '500';
  });
  await page.evaluate(() => document.getElementById('mOk').click());
  await page.waitForTimeout(900);

  await page.evaluate(() => document.querySelector('#nav a[data-view="aptos"]').click());
  await page.waitForTimeout(500);
  out.novoApto = await page.evaluate(() => ({
    total: document.querySelectorAll('#aptGrid .apt').length,
    tem77: [...document.querySelectorAll('#aptGrid .apt .num')].some((n) => n.textContent.trim().indexOf('77') === 0)
  }));

  // Check-in num apto livre (APT 01)
  const livreIdx = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#aptGrid .apt')];
    return els.findIndex((e) => e.classList.contains('s-livre'));
  });
  if (livreIdx >= 0) {
    await page.evaluate((i) => document.querySelectorAll('#aptGrid .apt')[i].click(), livreIdx);
    await page.waitForTimeout(500);
    out.checkinDisponivel = await page.evaluate(() => {
      const b = document.getElementById('btnCheckin');
      return { existe: !!b, texto: b ? b.textContent.trim() : null };
    });

    if (out.checkinDisponivel.existe) {
      await page.evaluate(() => document.getElementById('btnCheckin').click());
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        document.getElementById('ckNome').value = 'Teste QA Silva';
        document.getElementById('ckAdultos').value = '2';
        document.getElementById('ckCriancas').value = '1';
        document.getElementById('ckDiaria').value = '250';
      });
      await page.evaluate(() => document.getElementById('mOk').click());
      await page.waitForTimeout(1200);
      out.aposCheckin = await page.evaluate(() => {
        const c = (s) => (s || '').replace(/[ ]+/g, ').replace(/\s*\n\s*/g, ').trim();
        return {
          drawerAberto: document.getElementById('drawer').classList.contains('show'),
          secoes: [...document.querySelectorAll('.dsec h3')].map((h) => c(h.textContent)),
          financeiro: [...document.querySelectorAll('.resumo-fin .linha')].map((l) => c(l.textContent)),
          temCheckout: !!document.getElementById('btnCheckout')
        };
      });
    }
  }

  // Responsividade: viewport de celular
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  out.mobile = await page.evaluate(() => {
    const sb = document.getElementById('sidebar');
    const ham = document.getElementById('btnMenu');
    return {
      largura: window.innerWidth,
      hamburgerVisivel: getComputedStyle(ham).display !== 'none',
      sidebarForaDaTela: getComputedStyle(sb).transform !== 'none',
      colunasGrid: getComputedStyle(document.getElementById('aptGrid')).gridTemplateColumns.split(' ').length
    };
  });

  return out;
}
