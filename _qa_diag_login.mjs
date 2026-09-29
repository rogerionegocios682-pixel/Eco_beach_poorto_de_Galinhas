// QA: verifica por que o login não completa.
export default async function run(page) {
  const out = {};
  await page.goto('http://localhost:3000/login.html');
  await page.waitForSelector('#usuario', { timeout: 40000 });
  await page.waitForTimeout(4000);

  out.statusBanco = await page.evaluate(() => {
    const e = document.getElementById('dbStatus');
    return e ? e.textContent.trim() : 'AUSENTE';
  });

  out.apiSnapshot = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/sync/snapshot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: 1 })
      });
      const j = await r.json();
      return { status: r.status, ok: j.ok, erro: j.erro || null, temDados: !!j.dados };
    } catch (e) { return { erro: e.message }; }
  });

  out.apiLogin = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'admin', senha: '123456' })
      });
      const j = await r.json();
      return { status: r.status, ok: j.ok, erro: j.erro || null, temToken: !!(j.dados && j.dados.token) };
    } catch (e) { return { erro: e.message }; }
  });

  out.apiBuscar = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/usuarios/buscar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'admin' })
      });
      const j = await r.json();
      return { status: r.status, ok: j.ok, dados: j.dados };
    } catch (e) { return { erro: e.message }; }
  });

  out.apiConfig = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/config/listar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: 1, perfil: 'admin' })
      });
      const j = await r.json();
      return { status: r.status, ok: j.ok, erro: j.erro || null, secoes: j.dados ? Object.keys(j.dados.config || {}) : null };
    } catch (e) { return { erro: e.message }; }
  });

  return out;
}