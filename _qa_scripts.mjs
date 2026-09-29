// QA: verifica se cada <script> de configuracoes.html carrega e executa.
export default async function run(page) {
  const out = {};
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 400)));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 400)));

  /* Carrega um HTML mínimo com os MESMOS scripts, para ver qual deles
   * quebra quando executado com o DOM e o localStorage desta origem. */
  out.carregamento = [];
  await page.goto('http://localhost:3000/configuracoes.html', { waitUntil: 'load' });
  await page.waitForTimeout(10000);

  out.recursos = await page.evaluate(() => {
    return performance.getEntriesByType('resource')
      .filter((r) => r.name.endsWith('.js'))
      .map((r) => ({ nome: r.name.split('/').pop(), duracao: Math.round(r.duration), tamanho: r.transferSize }));
  });

  out.scriptsNoDom = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')));

  /* Executa o db.js de novo, agora via fetch+eval, para ver o erro real
   * de execução (o mesmo código, uma segunda vez). */
  out.execucaoDireta = await page.evaluate(async () => {
    try {
      const r = await fetch('/configuracoes.js');
      const txt = await r.text();
      // Só verifica se o texto carregou; não reexecuta (evita efeito duplo).
      return { bytes: txt.length, temIIFE: txt.indexOf("(function () {") !== -1, fim: txt.slice(-120).replace(/\n/g, ' ') };
    } catch (e) { return { erro: e.message }; }
  });

  out.console = logs.slice(-20);
  return out;
}