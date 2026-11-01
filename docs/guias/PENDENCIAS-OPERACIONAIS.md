# PotyPet — informações necessárias antes de usuários reais

Software 4.7.0 após revisão local, 13/10/2026. Termos, privacidade e atendimento permanecem em revisão. Não houve contratação, publicação, migração de dados ou configuração de provedor. Campos `[A DEFINIR: ...]` dos documentos não são dados oficiais: precisam ser preenchidos e conferidos antes de abrir cadastro ou aceitar dados reais.

## Informações já fornecidas pela equipe

- Desenvolvimento e operação pelos próprios alunos da escola Antônio Dantas. Esse crédito não atribui operação institucional à escola nem confirma uma empresa formal.
- Responsável principal e responsável pelas decisões sobre dados: **ainda precisam definir**, conforme resposta do usuário. Não foi usado automaticamente o nome do usuário como responsável legal.
- E-mail informado para atendimento: **Potypett@gmail.com**, exatamente como fornecido. Acesso, acompanhamento, configuração SMTP e recebimento real não foram verificados. O endereço recebido é uma informação para concluir a revisão; as páginas públicas mantêm a pendência do canal oficial até sua conferência.
- Revisão e atendimento inicialmente pelo usuário, com disponibilidade informada de **sexta a domingo**. Horários, substituto, triagem fora desses dias e prazo aplicável continuam a definir; não há promessa automática de resposta nesse período.
- Orçamento confirmado: **R$ 150 no total para cinco a sete meses**, incluindo hospedagem, e-mail e backup. A referência matemática é R$ 30/mês em cinco meses ou aproximadamente R$ 21,43/mês em sete; não é cotação ou prova de compatibilidade. Nenhum serviço/plano foi escolhido.

Essas informações foram registradas a partir das respostas da conversa. Não resolvem, sozinhas, as pendências abaixo. Combinar funções reais, substituir os campos de revisão, identificar uma versão dos documentos finais e conferir operação no destino são necessários antes da abertura para usuários reais.

## O que você precisa fornecer

| Informação | Pendência |
|---|---|
| Operador | [A DEFINIR: nome/razão social, identificação aplicável e responsabilidade pela instalação]. Os créditos acadêmicos não identificam automaticamente o operador. |
| Atendimento oficial | [A DEFINIR: canal acessível ao público, endereço oficial real, quem responde, horários, prazos aplicáveis e canal alternativo]. O Gmail pessoal já mencionado não foi adotado como contato oficial. |
| Moderação | [A DEFINIR: administradores responsáveis, revisão humana dos anúncios/campanhas, triagem de denúncias e abuso em mensagens, critérios e escalonamento]. |
| Contestação | [A DEFINIR: responsável, canal acessível, verificação de identidade, reconsideração de decisões/suspensões e prazos aplicáveis]. Enviar manifestação não reativa conta. |
| Ajuda pós-adoção | [A DEFINIR: equipe/canal, encaminhamento quando o responsável não responde e procedimento para urgências]. Etapas 7/30/90 dias não garantem socorro. |
| Privacidade | [A DEFINIR: responsável/controlador, canal de direitos, encarregado quando aplicável, finalidades/bases legais, acessos administrativos e resposta a incidentes]. |
| Conservação | [A DEFINIR: critérios/períodos e aplicação para contas, anúncios, pedidos, termos, mensagens, acompanhamentos, evidências, manifestações, auditoria e backups]. Arquivamento não é eliminação. |
| Documentos finais | [A DEFINIR: revisão dos textos, comunicação das mudanças e obtenção de novo aceite explícito quando aplicável]. Aceites antigos devem permanecer separados. |
| Provedor e produto | [A DEFINIR: provedor, serviço/plano exato, região/local dos dados e links oficiais]. Preço não demonstra compatibilidade. |
| Endereço público | [A DEFINIR: origem HTTPS oficial para PUBLIC_BASE_URL, domínio/endereços autorizados]. Nenhum domínio foi alterado nesta etapa. |
| E-mail | [A DEFINIR: serviço de envio, remetente autorizado, configurações SMTP, responsável por falhas e autenticação do domínio/remetente quando exigida]. Configure senhas/chaves no ambiente seguro, sem colocá-las no ZIP. |
| Backup externo | [A DEFINIR: destino privado separado, responsáveis/acessos, retenção externa, orçamento de espaço, cópia das chaves e objetivo de recuperação]. |

## Capacidade do provedor escolhido — ainda não verificada

Nenhum provedor foi escolhido nesta etapa. Informe o **serviço/plano exato**, não somente o nome da empresa. Para cada item, registre `[A DEFINIR: URL oficial, data da consulta, restrições do produto e evidência do ensaio]`. Não deduza capacidades pelo preço; não há afirmação de preço ou gratuidade nesta entrega.

| Capacidade a confirmar | Situação/evidência necessária |
|---|---|
| Node 24 compatível, processo HTTP contínuo e dependências nativas | Pendente: versão instalada, SO/arquitetura, npm ci, scripts/testes no ambiente isolado. |
| Volume local persistente gravável, fora do código, com semântica adequada ao SQLite WAL | Pendente: documentação do produto, caminho montado, permissões, espaço e sobrevivência a restart/redeploy. |
| Uma única instância/worker da aplicação, sem réplicas concorrendo no banco | Pendente: configuração e confirmação de política de escalabilidade/redeploy. |
| HTTPS, rede de entrada e cookies Secure | Pendente: certificado, redirects/cookies, endereço oficial e impedimento de acesso direto inseguro ao backend. |
| SMTP de saída 465/587 e remetente autorizado | Pendente: portas/limites documentados, configuração segura, envio/recebimento reais em contas de teste consentidas. |
| Proxy de entrada e IP de cliente | Pendente: topologia, IPs/CIDRs confiáveis restritos e teste de header falsificado/dois clientes. |
| Backup separado do volume/serviço | Pendente: upload/download reais, chave preservada, restauração em destino novo e conferência dos registros. |
| Recursos e limites operacionais | Pendente: memória/CPU/disco/egress, pausas e limites do produto, alertas e capacidade com dados reais autorizados. |

Hospedagem somente estática e disco temporário não executam de forma completa este backend. Arquivos do Render ficam como opção histórica; não foram aplicados e não certificam capacidades de outro provedor.

## Evidências antes da abertura

1. Responsáveis/canais/práticas definidos e campos `[A DEFINIR: ...]` resolvidos nos textos finais. Conferir funcionamento e acesso do canal, inclusive para conta suspensa.
2. Versão final dos documentos identificada; plano de comunicação/aceite definido sem reescrever registros anteriores.
3. Fluxos de confirmação e recuperação recebidos em caixa postal real, links corretos e sessão criada apenas com autenticação explícita.
4. Dados/fotos de teste autorizados sobrevivendo a reinício e redeploy no volume escolhido; sem importação automática de amostras.
5. IP correto/proxy confiável/limites, HTTPS/cookies seguros e acesso privado conferidos no endereço real.
6. Backup externo recuperado em pasta/volume novo, usando as chaves corretas e conferindo contas, fotos, vínculos/históricos. Nunca sobrescrever banco ativo no ensaio.
7. Nomeação de quem revisa filas, atende ajuda/denúncia/contestação e verifica falhas de e-mail, espaço e backup.

Status desta entrega: **revisão local com dados fictícios; abertura para usuários reais pendente das definições e provas acima**. A versão final 4.7.0 depende da revisão final solicitada. A documentação prepara a escolha, sem contratar ou configurar serviços.
