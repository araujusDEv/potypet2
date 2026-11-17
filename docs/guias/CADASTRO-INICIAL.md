# Cadastro inicial por HTTP

O script `scripts/cadastro-inicial.cjs` lê `fotos-cadastro/dados.json` e as nove fotos dessa pasta. A pasta está no `.gitignore`. O pacote inclui os dados fornecidos e cópias preparadas das fotos, sem senhas. Não envie essa pasta ao repositório ao carregar arquivos manualmente pelo navegador: nesse caso o Git não aplica o `.gitignore`.

`server.js`, todos os arquivos de `lib/` e suas regras permanecem idênticos ao ZIP recebido. O script não abre SQLite, não importa funções internas do servidor, não entra como administrador e não aprova registros. Todas as alterações passam pelo `fetch` do Node e pelos cookies de sessão da API existente.

## Preparação e execução

Use Node.js **24.21.0**, a versão fixada em `.node-version`, e execute `npm ci` na pasta extraída. Inicie o site normalmente com `npm start`, em outro terminal, com a configuração habitual do banco, SMTP e das contas existentes. Nenhuma configuração de segurança precisa ser desativada.

O script precisa de apenas estas variáveis:

| Variável | Uso |
| --- | --- |
| `CADASTRO_INICIAL` | Precisa ser exatamente `1`. Sem isso, não lê os dados nem chama a API. |
| `CADASTRO_URL` | Origem do site. Padrão `http://127.0.0.1:3000`. Para um site remoto, use HTTPS. |
| `DONOR_PASSWORD` | Senha atual de `hypestoreoofc@gmai.com`, a ONG já existente. |
| `USUARIO_SENHA` | Senha de Maria, com 12 a 128 caracteres, letra e número. O mesmo mínimo é conferido para a senha da ONG. |

O domínio `gmai.com` do e-mail da ONG foi mantido exatamente como informado. Confira se corresponde à conta já criada. O script não corrige o endereço nem cria outra ONG se o login falhar.

No PowerShell, com o site já rodando, você pode informar as senhas sem mostrá-las na tela ou gravá-las no histórico:

```powershell
$env:CADASTRO_INICIAL = '1'
$env:CADASTRO_URL = 'http://127.0.0.1:3000'
$env:DONOR_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Senha atual da ONG' -AsSecureString)).Password
$env:USUARIO_SENHA = [System.Net.NetworkCredential]::new('', (Read-Host 'Senha de Maria' -AsSecureString)).Password
npm run cadastro:inicial
```

Também pode executar `node scripts/cadastro-inicial.cjs`. Não informe senhas como argumentos do comando, no JSON ou em mensagens. O script guarda os cookies somente em memória e encerra suas sessões ao terminar. As respostas de erro são filtradas para evitar imprimir as duas senhas.

Para conferir os dados, senhas no ambiente e imagens sem acessar o site:

```powershell
npm run cadastro:inicial -- --validar
```

Antes de qualquer cadastro, o script confere os campos, as autorizações informadas, valores, datas, tipos e conteúdo completo das imagens. Se encontrar problemas, lista todos os itens identificados e não chama a API. A API continua sendo responsável pelas validações finais. As categorias deste conjunto são acolhimento e alimentação; campanhas médicas devem seguir o fluxo habitual com PDF do orçamento.

As sete fotos dos anúncios e desaparecidos foram preparadas como JPEG com até 2048 px no lado maior e menos de 3 MB. As duas imagens de campanha recebidas eram JPEG, mesmo com `.png` no nome: foram convertidas em PNG real com até 1536 px e menos de 4 MB. Orientação e proporções foram preservadas; metadados foram removidos. Os arquivos originais em Downloads não foram alterados.

## O que será cadastrado

- A ONG já existente recebe a apresentação, área, localização e contato autorizados com `PUT /api/organizations/me`. A imagem de perfil atual é preservada. Se o nome da conta divergir de **Associação Poty Amigos dos Bichos**, o script avisa e não altera o nome. Ajuste-o nas configurações da própria conta pela interface.
- Maria Helena Souza é autenticada primeiro. Se ainda não tiver conta, o script solicita o cadastro com os dados e aceite informados. A API não revela se um e-mail existe quando a senha está incorreta; nesse caso, confira a senha ou a recuperação de acesso. A unicidade do e-mail continua sendo garantida pelo servidor.
- Se o servidor exigir confirmação de e-mail para a conta nova, o script informa essa pendência e para antes de criar anúncios, campanhas ou alterar o perfil público da ONG. Maria deve confirmar o link recebido e executar novamente. A confirmação não é forçada pelo script.
- Adoções da ONG: **Pipoca, Fred, Luna e Mel**. Adoção de Maria: **Biscoito**. As cinco ficam disponíveis para adoção e **aguardando análise**; só entram no catálogo após sua aprovação.
- Desaparecidos da ONG: **Bolinha e Tigre**, nas datas informadas. Esses registros seguem a publicação normal do servidor, que não tem etapa de aprovação para desaparecidos. Eles podem ficar públicos imediatamente.
- Campanhas: **Lar temporário e ração para a Pretinha** e **Ração especial para o Mingau**. Cada responsável cria seu rascunho, envia um PNG, seleciona esse arquivo como capa e envia a proposta para análise. Nenhuma campanha é aprovada automaticamente.
- As campanhas usam `target: animal`, sem `animalId`, com os nomes em `beneficiaryName`. A campanha da ONG recebe `organizationId` da própria ONG; a de Maria não recebe vínculo a uma organização. Isso preserva a regra de propriedade do servidor.
- Conforme solicitado, cada PNG de campanha é usado tanto como evidência quanto como capa. O arquivo privado exige autenticação; a cópia selecionada como capa será pública se a campanha for aprovada. Essas duas categorias não exigem orçamento PDF.

## Repetir ou retomar

Antes de criar, o script busca os anúncios e desaparecidos pelo nome, dentro da conta responsável, e as campanhas pelo título na lista privada da conta. Também considera registros arquivados e decisões anteriores. Não troca fotos, reaprova, restaura nem republica itens existentes por conta própria.

Uma campanha ainda em rascunho, com o conteúdo esperado, pode ser retomada depois de uma interrupção. O `clientToken` UUID é estável por origem, responsável e título; o PNG já enviado é reconhecido por nome e hash, evitando outro envio. Todos os comandos usam a revisão atual devolvida pelo servidor. Rascunhos com alterações manuais são preservados e sinalizados para revisão.

Execute uma instância por vez. Há um bloqueio local em `fotos-cadastro/.cadastro.lock` para impedir duas execuções concorrentes da mesma pasta. Ele é removido ao encerrar; não é um marcador de conclusão. O script não faz tentativas repetidas de escrita. São apenas cinco criações de anúncios, abaixo do limite de 30 por 10 minutos; se a API retornar `429`, ele para e informa quando tentar novamente, quando esse prazo estiver disponível.

Não há recibo externo que impeça o cadastro em um banco recriado. Depois que o site reiniciar com o novo banco e as contas esperadas, execute o mesmo comando: ele consulta o novo banco pela API e refaz os itens ausentes. `npm start` e a inicialização do servidor não foram alterados. Para executar em todo início da hospedagem, configure esse comando como uma etapa posterior à disponibilidade da API, preservando a pasta de entrada e as variáveis. Desative essa etapa quando quiser retirar os itens definitivamente.

## Conferir na interface

Use os IDs impressos pelo script e a URL configurada em `CADASTRO_URL`:

| Item | Onde conferir |
| --- | --- |
| ONG e perfil público | Entre como a ONG e abra `/organizacoes.html?editar=1`. Confira a apresentação e o contato. Veja o perfil público em `/organizacoes.html`. |
| Maria | Entre em `/login.html` com `potypett+maria@gmail.com` e confira os dados em `/configuracoes.html`. Confirme o e-mail se solicitado. |
| Cinco adoções pendentes | Em cada conta, `/painel-doador.html`. No administrador, `/admin.html`; confira as fotos e relatos antes de aprovar. |
| Dois desaparecidos | `/desaparecidos.html`; detalhes em `/desaparecido.html?id=ID`. |
| Duas campanhas pendentes | Em cada conta, `/campanhas.html`. Como administrador, `/campanhas.html?admin=1` para conferir finalidade, custos, recebedor e evidências e registrar sua decisão. |
| Catálogo após aprovação manual | Adoções em `/adotar.html`; campanhas em `/doacoes.html` e `/doacoes.html?campanha=ID`. |
| Página da organização após aprovação | `/organizacoes.html?id=ID_DA_ONG` mostrará os animais e a campanha da própria ONG. A campanha de Maria aparece no catálogo de campanhas, sem vínculo ao perfil da ONG. |

## Desfazer

O script termina com as instruções de retirada. Não usa administrador nem executa exclusões automáticas:

1. Nos painéis dos responsáveis, arquive os anúncios de Pipoca, Fred, Luna, Mel e Biscoito que desejar retirar. Preserve as solicitações e o histórico que já existirem.
2. No painel administrativo, oculte Bolinha e Tigre com uma justificativa. Não marque como encontrados somente para retirar um cadastro.
3. Campanhas em análise podem ser recusadas no painel administrativo. Rascunhos podem ser arquivados em Minhas campanhas; campanhas já aprovadas devem ser pausadas ou encerradas pelo fluxo administrativo, preservando evidências e decisões.
4. Se precisar desfazer a alteração do perfil da ONG, restaure os campos anteriores em Meu perfil público. O script não altera nome, senha nem aprovação dessa conta existente.
5. Não execute o cadastro novamente para tentar desfazê-lo. Para voltar exatamente ao estado anterior, restaure um backup anterior com o procedimento habitual do projeto; isso também desfaz outras alterações posteriores àquele backup.

## Validação e alterações

Novos: `scripts/cadastro-inicial.cjs`, `tests/cadastro-inicial.cjs`, este guia e a pasta de entrada com os dados e nove fotos. Alterados: `.gitignore` e `package.json`, para ignorar a pasta, disponibilizar `cadastro:inicial`/`test:cadastro` e incluir os testes novos em `npm test`. O manifesto de hashes do pacote também é atualizado na entrega.

Os testes novos usam um servidor HTTP real com SQLite isolado. Verificam recusa sem opt-in, validação agregada antes das chamadas HTTP, formatos reais das fotos, cookies, nome da ONG preservado, ausência de acesso administrativo, cinco animais e duas campanhas pendentes, duplicação, retomada de rascunho, parada no limite de requisições, recriação do banco e respeito à confirmação por e-mail. Nenhuma aprovação, transferência Pix ou cadastro em um site remoto é realizado pelos testes.

As senhas reais da ONG e de Maria não estavam disponíveis no ambiente de trabalho. Por isso a execução com os dados reais depende de informar essas variáveis na sua instalação. As nove fotos preparadas e os dados fornecidos passaram pela conferência local sem chamadas HTTP.
