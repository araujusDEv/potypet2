# Hospedagem independente de provedor — PotyPet 4.7.0

Guia para revisão, 13/10/2026. Não contrata, publica, migra dados ou configura um provedor. Leia [docs/guias/PENDENCIAS-OPERACIONAIS.md](PENDENCIAS-OPERACIONAIS.md). O provedor/serviço/plano está **[A DEFINIR: escolha e capacidade comprovada]**.

## Arquitetura e runtime

O projeto é uma aplicação HTTP Node.js com SQLite local, fila de e-mail e rotinas de backup. O processo `node server.js` serve páginas e API; `npm start` executa esse processo. Usa `node:sqlite`, WAL e dependências nativas, inclusive Sharp. Não basta subir somente HTML/JS numa hospedagem estática. Serverless com disco temporário também não é solução completa para esta arquitetura.

`package.json` exige `>=24.21.0 <25`. Esta entrega foi testada com **Node 24.21.0**, também fixado em `.node-version` e CI. A série 24 consta como LTS e a publicação 24.21.0 foi conferida em fontes oficiais em **13/10/2026 (America/Sao_Paulo)**: [releases Node](https://nodejs.org/en/about/previous-releases), [Node 24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0). A conferência final manteve runtime e dependências; apenas a versão do projeto foi atualizada no lock. A instalação e os testes locais usaram Node 24.21.0. CI/Linux e o provedor ainda não foram executados nesta entrega. Ao escolher o provedor, conferir versão/atualizações mantidas da série 24 e repetir testes; não adotar outra série sem revisar a compatibilidade.

Instale com `npm ci` no SO/arquitetura do destino. Não copie node_modules Windows para Linux. Confirme dependências nativas e o processo de build/start, porta de entrada e encerramento/restart. A aplicação lê PORT e HOST. Em proxy local controlado, restrinja o backend à interface interna; em serviço com proxy gerenciado, confira como bind/rede são exigidos e impeça acesso direto inseguro. **[A DEFINIR: comandos/configuração exatos após escolha do produto]**.

## Uma instância e dados fora do código

Use **uma única instância e um único worker da aplicação**, sem cluster ou réplicas escrevendo no mesmo banco. Leituras e gravações de coleções JSON dependem da coordenação do processo atual. SQLite WAL precisa de acesso ao mesmo armazenamento local; WAL não opera sobre filesystem de rede compartilhado como substituto da coordenação entre máquinas. [Documentação SQLite WAL](https://www.sqlite.org/wal.html), consultada em 13/10/2026.

Defina `DATA_DIR` como caminho absoluto no volume local persistente, **fora da pasta de código e fora de temporários**. `PERSISTENT_DISK_PATH` pode declarar a raiz do volume e permite conferir que DATA_DIR está dentro dela; não monta um disco por si só e não comprova persistência. O volume precisa existir e ser gravável no processo de execução, não apenas no build. O servidor recusa dados de produção na pasta de código/temporários e confere gravação/permissões; isso não substitui teste de restart/redeploy do provedor.

Banco `adotapet.db`, WAL/SHM ativos, documentos/arquivos da instalação e caches ficam no contexto dos dados. Muitas fotos/evidências estão no SQLite; referências a imagens empacotadas também precisam do código/arquivos originais. Preserve **todo DATA_DIR**, arquivos personalizados fora dele, configurações e imagens originais ao atualizar. Código pode ser substituído sem copiar seed sobre o banco. Não faça build/importação de amostras no volume ativo. Produção: `SEED_DEMO_ACCOUNTS=0`, `SEED_SAMPLE_DATA=0` e credenciais iniciais exclusivas quando a instalação for nova; não recrie contas existentes.

**[A DEFINIR: volume, caminho real, permissões, usuário do processo, espaço/limites e confirmação de persistência do produto]**. Faça ensaio com conta/foto fictícias ou autorizadas e confira após restart/redeploy; volume temporário não atende.

## HTTPS, origem e e-mail

Produção exige `NODE_ENV=production`, `COOKIE_SECURE=1`, HTTPS e `EMAIL_TRANSPORT=smtp`. Defina **PUBLIC_BASE_URL explicitamente** como a origem HTTPS oficial, sem caminho, parâmetros ou credenciais. Isso define links de confirmação/recuperação/eventos e compartilhamento, sem confiar no Host de um visitante. Nenhum domínio foi alterado. O fallback legado RENDER_EXTERNAL_URL existe apenas por compatibilidade opcional; é dispensável quando PUBLIC_BASE_URL está definido.

Defina MAIL_FROM com remetente real autorizado e SMTP_HOST/USER/PASSWORD/PORT no ambiente seguro. O código admite 465 com TLS ou 587 com STARTTLS obrigatório, valida certificado e exige TLS mínimo configurado. O destino precisa permitir essa saída e o remetente precisa cumprir os requisitos do serviço escolhido. Não use conta pessoal como canal oficial sem decisão expressa. **[A DEFINIR: serviço, remetente, canal oficial, portas/limites, requisitos DNS e responsáveis]**.

`MAIL_QUEUE_KEY` é uma chave de 32 bytes em base64: em atualização/recuperação, mantenha a chave existente para ler a fila criptografada. Não a coloque no ZIP ou em logs. Instalação nova deve gerar e guardar chave de forma segura. Confirmação é obrigatória no fluxo de produção; recuperação não cria sessão automática. `npm run check:email` confere configuração/conexão, sem provar entrega na caixa postal. `EMAIL_TRANSPORT=file` é para testes/homologação, recusado em produção.

Distinga: notificação interna registrada, mensagem na fila, tentativa de chamada ao transporte, aceitação por transporte/SMTP e entrega na caixa postal. `mail_outbox.delivered_at` é um identificador legado para sucesso do transporte: não comprova inbox; `inboxDeliveryVerified` continua false. No modo file, sucesso produz arquivo local, sem enviar e-mail real. Conferir recebimento, spam, links e tentativa/reenvio com contas autorizadas antes da abertura.

## Proxy e abuso

Mantenha `TRUST_PROXY=0` até mapear a entrada e os headers. Atrás de proxy isso pode agrupar visitantes no mesmo limite; não resolva confiando em qualquer header. Só habilite `TRUST_PROXY=1` com `TRUSTED_PROXY_IPS` de IPs/CIDRs **de entrada** comprovados e restritos. O código rejeita `/0` e termina a cadeia no primeiro salto não confiável. IP de saída do provedor não identifica automaticamente os proxies de entrada.

`proxy.nginx.example.conf` é exemplo para proxy próprio que sobrescreve headers; não foi aplicado. Confirmar topologia/certificados/rede/headers no produto escolhido. Testar dois clientes e X-Forwarded-For falsificado, logout/acesso anônimo e respostas 429/Retry-After. Limites por IP são proteção do fluxo, não identificação absoluta da pessoa; reiniciar o processo reinicia limitadores em memória. **[A DEFINIR: topologia, lista confiável, políticas e alertas do ambiente]**.

## Backup externo e restauração em destino novo

O backup local usa snapshot SQLite consistente com teste de integridade. `BACKUP_AUTO`, `BACKUP_KEEP`, `BACKUP_MAX_MB` e `BACKUP_MIN_FREE_MB` controlam rotina/cópias/espaço. Valores do exemplo são parâmetros técnicos de referência, **não política de retenção confirmada**. Cópias pendentes de exportação são preservadas e pode haver pendência quando espaço não permite nova cópia. **[A DEFINIR: capacidade, critérios de retenção local/externa, alertas, responsável e objetivo de recuperação]**.

Cópia no mesmo disco não protege contra perda do disco/serviço. A infraestrutura existente pode exportar para bucket privado S3 compatível, com variáveis BACKUP_S3_* e BACKUP_ENCRYPTION_KEY independente de 32 bytes em base64. Não apaga automaticamente objetos remotos; o operador precisa definir retenção/lifecycle e acesso de recuperação no serviço externo. Upload registrado também não prova restauração possível: baixe e ensaie. Nenhum bucket foi criado ou configurado nesta etapa.

Guarde `MAIL_QUEUE_KEY` e `BACKUP_ENCRYPTION_KEY` e demais configurações/credenciais em local seguro independente do volume e do bucket; preserve as chaves correspondentes às cópias antigas. O snapshot inclui SQLite/fotos/evidências/termos/históricos ali guardados. Configuração, segredos, código/imagens empacotadas e arquivos personalizados fora do banco exigem cópia própria. Cache derivado pode ser reconstruído; e-mail file de testes não deve virar dado de produção.

Após escolher destino e com dados **fictícios isolados**, execute somente como ensaio/revisão:

```text
node scripts/decrypt-backup.cjs ARQUIVO.enc NOVO_BACKUP.db
node scripts/restore-check.cjs NOVO_BACKUP.db NOVO_DATA_DIR_VAZIO
```

O primeiro usa a chave do backup; o segundo verifica integridade e copia para diretório vazio, sem substituir o banco ativo. Em recuperação real, pare o serviço e não sobrescreva a fonte/destino existente. Inicie uma aplicação isolada com o DATA_DIR restaurado, mesmo código/arquivos necessários e **chaves corretas**, sem enviar notificações reais pelo ensaio. Confira contas/senhas/aceites, fotos, pedidos, contratos, conversas, suspensões e fila. Só decida a troca após conferência humana/autorização; esta etapa não realiza migração.

## Escolha do produto e Render opcional

Na preparação de 18/10/2026 para GitHub/Render, `render.yaml` e `render.demo.yaml` passaram a configurar a demonstração no plano Free, com dados temporários e sem envio de e-mail. A configuração persistente anterior foi preservada em `docs/render.persistente.original.yaml`. Consulte o README da raiz para publicar a demonstração. Ela não atende produção; não deduza persistência pela simples inicialização.

Use a matriz em [docs/guias/PENDENCIAS-OPERACIONAIS.md](PENDENCIAS-OPERACIONAIS.md). Registrar, para o serviço/plano escolhido, URL oficial, data da consulta, limitações e ensaio correspondente. Sem provedor escolhido, as capacidades operacionais ficam **pendentes**, não aprovadas. Nenhum preço/gratuidade foi afirmado. As fontes de Node/SQLite acima sustentam requisitos do projeto, não capacidades de um serviço comercial.
