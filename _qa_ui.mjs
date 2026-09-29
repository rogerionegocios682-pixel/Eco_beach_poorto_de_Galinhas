// QA: abre login, loga, espera a retaguarda e confere modo + telas.
export default async function run(page, ui) {
  const out = {};
  await page.goto('http://localhost:3000/login.html');
  // Espera o formulario ficar interativo (o status vira 'ready').
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(2500);

  out.statusLogin = await page.$eval('#dbStatus', (e) => e.textContent.trim());

  await page.fill('#usuario', 'admin');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');

  // Espera ir para o dashboard e a grade de aptos aparecer.
  await page.waitForURL(/dashboard\.html/, { timeout: 40000 }).catch(() => { });
  await page.waitForTimeout(6000);

  out.url = page.url();
  out.modo = await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = "window.__m = (window.DB && window.DB.modoAtivo) ? window.DB.modoAtivo() : 'sem DB'; window.__ok=1;";
    document.body.appendChild(s); s.remove();
    const it = setInterval(() => { if (window.__ok) { clearInterval(it); resolve(window.__m); } }, 100);
    setTimeout(() => { clearInterval(it); resolve('timeout'); }, 15000);
  }));

  out.aptos = await page.evaluate(() => ({
    cards: document.querySelectorAll('#aptGrid .apt').length,
    numeros: [...document.querySelectorAll('#aptGrid .apt .num')].map((n) => n.textContent.trim()).slice(0, 12)
  }));

  // Vai para MESAS
  await page.evaluate(() => { const a = document.querySelector('#nav a[data-view="mesas"]'); if (a) a.click(); });
  await page.waitForTimeout(4000);
  out.mesas = await page.evaluate(() => ({
    cards: document.querySelectorAll('#mesaGrid .apt').length,
    nomes: [...document.querySelectorAll('#mesaGrid .apt .num')].map((n) => n.textContent.trim()),
    btnConsumoApto: !!document.getElementById('btnConsumoApto')
  }));

  return out;
}
