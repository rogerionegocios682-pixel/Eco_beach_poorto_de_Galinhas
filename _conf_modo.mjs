// Confirma o modo servidor e o tempo real, usando o mundo da pagina.
export default async function run(page, ui) {
  await page.goto('http://localhost:3000/login.html');
  await page.waitForTimeout(9000);

  return await page.evaluate(() => new Promise((resolve) => {
    const s = document.createElement('script');
    s.textContent = `
      (function(){
        var n = 0;
        function t() {
          n++;
          if (typeof window.DB === 'undefined') { if (n > 200) return fim({ erro: 'DB nao carregou' }); return setTimeout(t, 100); }
          window.DB.listarAptos(1).then(function (aptos) {
            fim({
              modo: window.DB.modoAtivo(),
              servidor: window.DB.servidorURL(),
              aptosDoServidor: aptos.length,
              primeiros: aptos.slice(0, 5).map(function (a) { return a.numero; })
            });
          }).catch(function (e) { fim({ erro: String(e.message) }); });
        }
        function fim(v) { var p = document.createElement('pre'); p.id = '__f'; p.textContent = JSON.stringify(v); document.body.appendChild(p); }
        t();
      })();
    `;
    document.body.appendChild(s); s.remove();
    const it = setInterval(() => {
      const o = document.getElementById('__f');
      if (o) { clearInterval(it); resolve(JSON.parse(o.textContent)); }
    }, 150);
    setTimeout(() => { clearInterval(it); resolve({ erro: 'timeout' }); }, 30000);
  }));
}
