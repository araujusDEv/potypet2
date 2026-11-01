> Entrega intermediária para revisão. Base recebida: PotyPet 4.7.0-rc.4, hash conferido. A versão final 4.7.0 depende da revisão final. Consulte [docs/guias/ORIGEM-E-COMPATIBILIDADE.md](ORIGEM-E-COMPATIBILIDADE.md).

# Recuperar o administrador no Render

Esta correção acrescenta uma operação de recuperação executada somente na inicialização, por configuração de quem administra a hospedagem. Não é recuperação pública por e-mail.

1. Substitua server.js no repositório pelo arquivo deste pacote. Os outros arquivos do site continuam necessários. Não substitua nem apague o banco.
2. No Render, em Environment, configure ADMIN_EMAIL com o e-mail da conta administrativa existente.
3. Defina ADMIN_PASSWORD com uma senha nova, exclusiva, de 12 a 128 caracteres, contendo letras e números e sem espaços no começo/fim. Digite-a diretamente no painel; não coloque a senha no GitHub.
4. Adicione ADMIN_RECOVERY_ID=recuperar-admin-20261003-01. Esse valor identifica esta operação; não é a senha.
5. Salve as variáveis e publique a versão atualizada. O processo precisa iniciar com o novo server.js e as variáveis juntas.
6. Confira nos logs: Recuperacao administrativa concluida. Entre com ADMIN_EMAIL e a nova senha.
7. Remova somente ADMIN_RECOVERY_ID do painel após concluir. Mantenha ADMIN_EMAIL e ADMIN_PASSWORD para eventuais bancos novos.

Cada identificador é consumido uma única vez no banco. Para uma recuperação futura, use outro identificador. Reiniciar com o mesmo identificador não redefine a senha novamente. Se o e-mail não corresponder a um administrador existente ou a senha não cumprir os requisitos, a inicialização informa o erro e não altera a conta. Nenhuma conta comum é promovida a administrador.

A recuperação invalida somente as sessões desse administrador e mantém os demais usuários, animais, campanhas e documentos. Não envia senha por e-mail e não imprime a nova senha nos logs de recuperação. Em um banco novo, o comportamento inicial do servidor continua sendo a criação das contas pelas variáveis.

Validação: node tests/admin-recovery.cjs. Verificados login com nova senha, recusa da senha anterior, revogação das sessões do administrador, preservação da sessão da ONG, preservação dos dados e rejeição de configuração inválida. Não foi executada recuperação no Render; o operador precisa aplicar os passos acima.

O armazenamento gratuito temporário pode recriar o banco em uma nova publicação. Isso é uma característica da hospedagem, não desta recuperação. Preserve backups e use armazenamento persistente para dados reais.

