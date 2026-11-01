> Registro histórico. Para esta entrega, use Node 24.21.0 LTS e siga [docs/guias/PUBLICAR-HOJE.md](PUBLICAR-HOJE.md). Resultados abaixo pertencem à etapa indicada, não à conferência atual.

# Correções de segurança

- `server.js`: lista branca das 13 extensões solicitadas, bloqueio de dotfiles e `data/`, publicação restrita às páginas HTML e pastas do front-end (impede exposição de `server.js` e `package.json`). Headers de segurança em JSON, arquivos e erros; HSTS somente com `COOKIE_SECURE=1`. `/api/users` exige autenticação de administrador e mantém o formato de array para o administrador. Novo `/api/animals/:id/public-name` retorna somente `{name}` e respeita a visibilidade do animal. Estatísticas públicas retornam contagens de usuários e ONGs. Fotos limitadas a 3 MiB de texto por item em POST/PATCH, mantendo até três fotos. Cinco rotas recebem limite independente de 30 chamadas por IP em 10 minutos. Entradas expiradas são removidas a cada 15 minutos, com timer `unref()`.
- `js/store.js`: consulta específica do nome do responsável e despacho de ações por eventos externos, sem `eval` ou scripts inline.
- `js/pages/home.js`: contagens públicas substituem o download dos usuários.
- `js/pages/animal-detail.js`: consulta do nome por animal e galeria compatível com CSP.
- `js/pages/admin.js`: reutiliza a lista autenticada nas estatísticas e adapta botões à CSP.
- `js/cards.js`: favoritos usam eventos externos.
- `js/pages/contrato.js`: impressão usa eventos externos.
- `js/pages/desaparecido-detail.js`: compartilhamento usa eventos externos.
- `js/pages/minhas-solicitacoes.js`: histórias, cancelamentos e acompanhamentos usam eventos externos.
- `js/pages/painel-doador.js`: ações de animais e solicitações usam eventos externos.
- `painel-doador.html`: fechamento do diálogo sem `onclick` inline.
- `cartaz.html`: impressão sem `onclick` e QRCode carregado localmente.
- `js/vendor/qrcode.min.js`: cópia local da mesma biblioteca QRCode 1.0.0 anteriormente carregada pelo CDN.
- `js/vendor/LICENSE-qrcodejs.txt`: licença da biblioteca.
- `tests/start-check.cjs`: inicia `node server.js`, verifica saúde e encerra o processo, usando banco temporário.
- `tests/security.cjs`: testes HTTP de headers, HSTS, arquivos privados, usuários, fotos, rate limits e limpeza do Map; executa também o teste de adoção existente.

## Validação

O servidor foi iniciado com sucesso após cada etapa de correção e cada adaptação de CSP. A suíte existente passou por autenticação, aprovação de ONG, publicação, permissões, análise, aprovação/reprovação, conclusão e contrato. Os testes de segurança passaram; todos os arquivos JavaScript passaram na verificação de sintaxe. As 27 ações de clique foram verificadas por despacho em ambiente JavaScript simulado; não foi realizada uma revisão visual completa em navegador.

Para repetir os testes: `node tests/security.cjs` (porta 3170 disponível, Node.js 22.5 ou superior). Os testes usam um banco temporário e não modificam `data/seed.json`.

O limite de fotos usa truncamento, conforme solicitado; imagens acima do limite podem ficar inválidas.


## Reforço adicional de 23/09/2026

- **server.js — IDs persistentes:** cada coleção utiliza um contador no SQLite. A atualização captura IDs existentes e referências antigas antes de permitir exclusões. Excluir o maior registro ou reiniciar o processo não permite reaproveitar seu ID. Os registros atuais conservam seus identificadores.
- **server.js — solicitações:** novas solicitações registram o responsável original. A autorização confere esse vínculo. Para registros antigos sem o campo, solicitações anteriores à criação do animal não concedem acesso ao responsável atual.
- **server.js — entradas inválidas:** a leitura da URL ocorre dentro do tratamento de erros; Host e URL malformados recebem HTTP 400. Cookies inválidos não autenticam; corpos JSON nulos, arrays ou valores primitivos são rejeitados. Falhas na leitura de arquivos estáticos têm tratamento próprio.
- **server.js — dados dos usuários:** a listagem completa exige administrador. Páginas públicas continuam recebendo somente o nome do responsável por animal e estatísticas agregadas.
- **tests/security-regressions.cjs:** reproduz exclusão/recriação de anúncio, reinício, atualização de banco legado, troca indevida de responsável, acesso e alteração de solicitações por terceiros, e entradas malformadas. Todos os cenários passaram.

Validação executada diretamente na pasta local indicada pelo usuário: inicialização após cada etapa, testes novos e a suíte anterior, incluindo o fluxo completo de adoção. Foram usados bancos temporários; a pasta de dados original foi preservada. Para repetir: node tests/security-regressions.cjs e node tests/security.cjs (portas 3171 e 3170 livres).

Limites da avaliação: não houve auditoria completa, teste de carga ou validação da configuração do Render. Os limites de imagens e a proteção por IP atrás de proxy ainda merecem revisão adicional. A correção impede novas associações indevidas; ela não reconstrói automaticamente dados que já tenham sido alterados por exploração anterior. GitHub e Render não foram atualizados nesta tarefa.

