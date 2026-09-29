// QA — valida o fluxo de NOVO CADASTRO e o login com a conta criada.
export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(400);

  // Abre "Criar novo cadastro"
  await page.click('#signup');
  await page.waitForTimeout(200);
  out.signupAberto = await page.evaluate(() => document.getElementById('paneSignup').classList.contains('active'));

  // E-mail invalido + senhas diferentes -> erros
  await page.fill('#nome', 'Teste Silva');
  await page.fill('#email', 'email-invalido');
  await page.fill('#newPass', 'abc123');
  await page.fill('#confirm', 'xyz999');
  await page.click('#btnSignup');
  await page.waitForTimeout(300);
  out.validacoes = await page.evaluate(() => ({
    email: document.getElementById('fieldEmail').classList.contains('invalid'),
    confirm: document.getElementById('fieldConfirm').classList.contains('invalid')
  }));

  // Cadastro valido
  const email = 'teste.qa' + Date.now() + '@turismoos.com';
  await page.fill('#email', email);
  await page.selectOption('#perfil', 'garcom');
  await page.fill('#newPass', 'senha123');
  await page.fill('#confirm', 'senha123');
  await page.click('#btnSignup');
  await page.waitForSelector('#modal.show', { timeout: 5000 }).catch(() => { });
  out.modalCriado = await page.evaluate(() => ({
    show: document.getElementById('modal').classList.contains('show'),
    titulo: document.getElementById('modalTitle')?.textContent
  }));
  if (out.modalCriado.show) await page.click('#modalOk');
  await page.waitForTimeout(300);

  // Login com a conta recem-criada
  await page.fill('#usuario', email);
  await page.fill('#senha', 'senha123');
  await page.click('#btnLogin');
  await page.waitForFunction(() => location.pathname.endsWith('dashboard.html'), { timeout: 8000 }).catch(() => { });
  out.loginNovaConta = await page.evaluate(() => ({
    url: location.pathname,
    sessao: JSON.parse(localStorage.getItem('turismo_session') || '{}').perfil
  }));

  // Verifica e-mail duplicado (deve acusar erro)
  await page.goto('http://localhost:3000/login.htfml');
  await page.waitForTimeout(400);
  await page.click('#signup');
  await page.fill('#nome', 'Duplicado');
  await page.fill('#email', email);
  await page.fill('#newPass', 'senha123');
  await page.fill('#confirm', 'senha123');
  await page.click('#btnSignup');
  await page.waitForTimeout(900);
  out.duplicado = await page.evaluate(() => document.getElementById('alertErrorText').textContent);

  return out;
}
