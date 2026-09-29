// QA temporário — dirige o login e inspeciona a retaguarda.
export default async function run(page, ui) {
  const log = [];

  // 1) Tela de login: preenche e envia
  const snap0 = await ui.snapshot();
  const userRef = snap0.match(/@(e\d+) textbox[^\n]*[Uu]suário/)?.[1]
    || snap0.match(/@(e\d+) textbox/)?.[1];
  const passRef = snap0.match(/@(e\d+) textbox[^\n]*[Ss]enha/)?.[1]
    || (await ui.snapshot()).match(/@(e\d+) textbox[^\n]*/g)?.[1]?.match(/@(e\d+)/)?.[1];

  if (!userRef) return { error: 'nao achou campo usuario', snap0 };

  await ui.fill('@' + userRef, 'admin');
  // segundo textbox = senha
  const all = [...snap0.matchAll(/@(e\d+) textbox/g)].map(m => m[1]);
  if (all[1]) await ui.fill('@' + all[1], '123456');

  const btn = snap0.match(/@(e\d+) button[^\n]*[Ee]ntrar/)?.[1];
  if (btn) await ui.click('@' + btn);

  // 2) Espera o painel carregar (summary renderizado)
  await page.waitForFunction(
    () => document.querySelectorAll('#aptGrid .apt').length > 0,
    { timeout: 15000 }
  ).catch(() => { });

  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    apts: document.querySelectorAll('#aptGrid .apt').length,
    aptsList: [...document.querySelectorAll('#aptGrid .apt .num')].map(n => n.textContent.trim()).slice(0, 15),
    summary: [...document.querySelectorAll('#summary .scard')].map(c => c.textContent.replace(/\s+/g, ').trim()),
    nav: [...document.querySelectorAll('#nav a[data-view]')].map(a => a.textContent.replace(/\s+/g, ').trim()),
    session: !!localStorage.getItem('turismo_session')
  }));

  // 3) Clica no APT hospedado (status hospedado) e lê o painel
  const hospIdx = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#aptGrid .apt')];
    return els.findIndex(e => e.classList.contains('s-hospedado'));
  });
  if (hospIdx >= 0) {
    await page.evaluate((i) => document.querySelectorAll('#aptGrid .apt')[i].click(), hospIdx);
    await page.waitForTimeout(600);
    info.drawer = await page.evaluate(() => {
      const d = document.getElementById('drawer');
      return {
        open: d.classList.contains('show'),
        titulo: document.getElementById('dTitulo')?.textContent,
        sub: document.getElementById('dSubtitulo')?.textContent,
        consumo: document.querySelector('.cons-box')?.textContent.replace(/\s+/g, ').trim(),
        financeiro: [...document.querySelectorAll('.resumo-fin .linha')].map(l => l.textContent.replace(/\s+/g, ').trim()),
        secoes: [...document.querySelectorAll('.dsec h3')].map(h => h.textContent.trim())
      };
    });
  }

  return info;
}
