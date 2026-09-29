// QA: o que acontece ao clicar em Entrar (mensagem na tela).
export default async function run(page) {
  const out = {};

  // Espelha o console da página para ver o erro real.
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);

  await page.fill('#usuario', 'admin@turismoos.com');
  await page.fill('#senha', '123456');
  await page.click('#btnLogin');
  await page.waitForTimeout(9000);

  out.url = page.url();
  out.mensagem = await page.evaluate(() => {
    const a = document.getElementById('alertErrorText');
    const s = document.getElementById('dbStatus');
    return {
      alerta: a ? a.textContent.trim() : 'ausente',
      alertaVisivel: a && a.closest('#alertError') ? document.getElementById('alertError').className : '?',
      statusBanco: s ? s.textContent.trim() : 'ausente',
      botao: (document.getElementById('btnText') || {}).textContent
    };
  });

  out.fluxo = await page.evaluate(async () => {
    // Reproduz exatamente o que o login faz, passo a passo.
    try {
      const u = await DB.buscarUsuario('admin@turismoos.com');
      const res = await DB.autenticar(u ? u.usuario : 'admin', '123456');
      return {
        achouUsuario: !!u,
        usuario: u ? u.usuario : null,
        authOk: res.ok,
        authErro: res.erro || null,
        temToken: !!res.token,
        usuarioRetornado: res.usuario || null
      };
    } catch (e) { return { erro: e.message }; }
  });

  out.console = logs.slice(-12);
  return out;
}