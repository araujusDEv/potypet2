// Testa a configuração de e-mail SMTP (npm run check:email).
'use strict';
const nodemailer = require('nodemailer'),
  { settings } = require('../lib/mail-service.cjs');
(async () => {
  const config = settings(process.env);
  if (config.mode !== 'smtp')
    throw Error('Configure EMAIL_TRANSPORT=smtp e as variáveis descritas em docs/guias/PUBLICAR-HOJE.md.');
  const transport = nodemailer.createTransport(config.smtp);
  try {
    await transport.verify();
    console.log(
      'Conexão, TLS e autenticação SMTP verificados. O remetente e a entrega precisam ser conferidos com um cadastro real. Nenhuma mensagem foi enviada por este comando.',
    );
  } finally {
    transport.close();
  }
})().catch(() => {
  console.error(
    'Não foi possível verificar o SMTP. Confira servidor, porta, usuário, senha de app e acesso de saída da hospedagem. Credenciais não são exibidas.',
  );
  process.exitCode = 1;
});
