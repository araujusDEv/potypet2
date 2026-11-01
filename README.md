# PotyPet — GitHub e Render gratuito

Este pacote contém a aplicação original PotyPet 4.7.0, em Node.js e SQLite. A identidade visual, as páginas, as rotas e as regras do sistema foram preservadas. A configuração padrão deste pacote é uma **demonstração no Render Free**, sem disco pago e sem anúncios de exemplo importados.

**O armazenamento é temporário.** Novas contas, anúncios, fotos, solicitações e demais alterações podem ser perdidos quando o Render suspender, reiniciar ou atualizar o serviço. Use somente dados fictícios. O pacote não contém banco operacional, senhas reais, backups ou exportação do site antigo. Publicar este código não transfere os dados de outra hospedagem.

## 1. Colocar no GitHub

1. Extraia este ZIP no computador.
2. Crie um repositório no GitHub. Ele pode ser privado; conecte a mesma conta no Render.
3. Envie **os arquivos e as pastas extraídos**, incluindo `.github`, `.gitignore` e `.node-version`. Não envie apenas o ZIP. `package.json`, `package-lock.json`, `server.js` e `render.yaml` devem aparecer na raiz do repositório, junto de `index.html`, `css`, `js`, `img`, `lib` e demais pastas.
4. Não envie `node_modules`, `.env`, banco de dados, uploads, backups ou chaves. A lista `.gitignore` é usada pelo Git; no envio pelo navegador, confira manualmente os arquivos selecionados.

Se usar o terminal, execute na pasta extraída, depois de criar um repositório vazio:

```bash
git init
git add .
git commit -m "Preparar PotyPet para demonstracao no Render"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

Substitua `URL_DO_SEU_REPOSITORIO` pela URL fornecida pelo GitHub. Se o Git solicitar nome/e-mail de autor ou autenticação, use sua própria conta. Não coloque token ou senha dentro dos arquivos.

## 2. Publicar no Render — caminho recomendado: Blueprint

1. Acesse https://dashboard.render.com/ e conecte o GitHub.
2. Crie um **Blueprint** e selecione o repositório. O Render deve detectar o `render.yaml` da raiz.
3. Confira que o serviço é **Web Service**, runtime **Node**, plano **Free**, sem disco ou banco adicional. Este pacote não exige serviço pago.
4. Preencha os quatro campos de credenciais pedidos pelo Blueprint:
   - `ADMIN_EMAIL`: endereço válido que você escolherá para entrar como administrador.
   - `ADMIN_PASSWORD`: senha exclusiva com pelo menos 12 caracteres, letras e números.
   - `DONOR_EMAIL`: outro endereço válido, diferente do administrador, para o perfil responsável de demonstração.
   - `DONOR_PASSWORD`: outra senha forte, diferente da senha administrativa.
5. Inicie o deploy. Depois de concluído, abra o endereço HTTPS fornecido pelo Render.
6. Acesse `/login.html` e entre com o `ADMIN_EMAIL` e a `ADMIN_PASSWORD` definidos no painel. A conta inicial é criada no primeiro banco vazio. Não existe senha fixa embutida no ZIP.

O nome `potypet-demo` identifica um novo serviço de demonstração. Não selecione um serviço antigo com dados reais para substituí-lo automaticamente. A publicação automática por novos commits está desligada no Blueprint; futuras atualizações devem ser iniciadas manualmente no Render.

## Alternativa: criar um Web Service manualmente

Se não usar Blueprint, copie também as variáveis; o Render não aplica `render.yaml` automaticamente a um Web Service criado manualmente.

| Campo | Valor |
| --- | --- |
| Tipo | Web Service, não Static Site |
| Runtime | Node |
| Plano | Free |
| Root Directory | Deixe vazio se os arquivos estão na raiz |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Em Environment, configure:

| Variável | Valor |
| --- | --- |
| `NODE_VERSION` | `24.21.0` |
| `NODE_ENV` | `development` |
| `HOST` | `0.0.0.0` |
| `DATA_DIR` | `/tmp/potypet-demo` |
| `EMAIL_TRANSPORT` | `disabled` |
| `SEED_DEMO_ACCOUNTS` | `0` |
| `SEED_SAMPLE_DATA` | `0` |
| `BACKUP_AUTO` | `0` |
| `COOKIE_SECURE` | `1` |
| `TRUST_PROXY` | `0` |
| `DONOR_NAME` | `Perfil de demonstração` |
| `ADMIN_EMAIL` | Seu e-mail de administrador |
| `ADMIN_PASSWORD` | Sua senha forte |
| `DONOR_EMAIL` | Outro e-mail, distinto do administrador |
| `DONOR_PASSWORD` | Outra senha forte |

Não fixe `PORT`: o servidor lê a porta fornecida pelo Render. Não defina `PERSISTENT_DISK_PATH` neste plano. Se estiver reutilizando configurações de outro serviço, prefira criar um serviço novo; variáveis antigas podem exigir SMTP, backup ou disco inexistentes.

## 3. Conferir após o deploy

- Abra `/api/health`: deve responder JSON com `ok: true`.
- Abra a página inicial, o catálogo e o login.
- Entre como administrador usando as credenciais do painel.
- Em sessão separada, cadastre uma conta **fictícia** e faça login.
- Cadastre um animal fictício e confira a análise administrativa antes de aparecer no catálogo. Use uma imagem autorizada para teste.
- Teste a solicitação com outra conta. Nunca simule interesse em um caso real ou transfira dinheiro durante a demonstração.

O catálogo começa sem animais importados. Os módulos existentes continuam no código. Neste modo, cadastro e login não confirmam o endereço de e-mail; recuperação registra um pedido interno, sem enviar link por e-mail. Pix gerado não comprova recebimento bancário.

## Limites do modo gratuito

- O serviço suspende após cerca de 15 minutos sem acessos e pode levar cerca de um minuto para reativar.
- Não existe disco persistente no Free: o banco SQLite e os arquivos criados em execução são temporários. Guardar o código no GitHub não guarda esses dados.
- SMTP nas portas 25, 465 e 587 é bloqueado no serviço Free. Por isso, a demonstração usa `EMAIL_TRANSPORT=disabled`; ela não envia confirmação, recuperação ou avisos reais por e-mail.
- Há cotas de uso do provedor. Não foi contratado nem publicado nenhum serviço nesta preparação.

Para uso real, será necessário escolher armazenamento persistente ou adaptar a aplicação para serviços externos, configurar envio real de e-mail e concluir as pendências operacionais. A referência anterior de hospedagem persistente está preservada em `docs/render.persistente.original.yaml` e **não** é a configuração padrão deste ZIP.

## Como o código está organizado

```
server.js          servidor: banco SQLite, sessão, rotas da API (/api) e entrega dos arquivos do site
lib/               regras que ficam fora do server.js (validação, adoção, campanhas, e-mail, backup)
*.html             uma página por arquivo, na raiz
js/                scripts do navegador; js/pages/ tem um arquivo por página
css/  img/  fonts/ estilos, imagens e fonte
data/seed.json     dados de exemplo da demonstração
scripts/           comandos de apoio: backup, conferência do pacote e teste de e-mail
tests/             testes automatizados (npm test)
docs/guias/        guias de publicação e operação
```

Cada arquivo de `lib/` e `scripts/` começa com um comentário dizendo para que serve, e o
`server.js` tem comentários marcando onde começa cada grupo de rotas.

## Rodar localmente e testar

Use Node.js `24.21.0` ou atualização posterior da série 24. Execute `npm ci` e `npm start`; abra http://127.0.0.1:3000. O Node não carrega arquivos `.env` automaticamente neste projeto. Fora do Render, se não definir credenciais, o servidor gera senhas aleatórias e mostra o primeiro acesso no terminal local.

`npm test` executa as suítes existentes com bases fictícias isoladas. `npm run check:package` procura dados operacionais e padrões de segredos. O relatório desta preparação está em `docs/guias/VALIDACAO-RENDER.md`.

## Documentação oficial consultada em 18/10/2026

- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://render.com/docs/node-version
- https://nodejs.org/en/blog/release/v24.21.0
