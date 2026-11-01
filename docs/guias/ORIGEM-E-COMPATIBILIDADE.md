# PotyPet — origem e compatibilidade

**Nome público atual: PotyPet.** A versão de software 4.7.0 resulta da revisão final local da rc.6. Base: PotyPet-documentos-4.7.0-rc.6-2026-10-13.zip, SHA-256 53635e852f48b623603f049def803f8e2d63c8a162ccccf6b5bcb3b121fda089, conferido. Não se voltou à versão original nem a uma prévia visual. Identificadores técnicos e origem histórica Appet permanecem. Não há mudança de schema ou reescrita de dados nesta rodada.


| Referência antiga preservada | Motivo |
|---|---|
| `adotapet.db`, tabelas, IDs, `ADT-...` | Banco, vínculos e códigos de documentos existentes. |
| `petadopt_session`, `petadopt_*`, `appet-auth-return` | Sessões, tema, favoritos/preferências e retorno após login. |
| `adoptionOrigin=appet` | Enum interno usado pelos critérios de adoção da plataforma; não representa uma nova marca pública. |
| `APPET-...` | Identificador técnico de protocolos. Mesmo código nas notificações, resposta da API e administração, preservando referências de atendimento. |
| Pasta/nome interno `appet`, `DATA_DIR=/var/data/appet`, serviço `adotapet` | Caminhos, instalação e infraestrutura; a marca não move dados ou renomeia serviços. |
| `appet-backup-*`, prefixo S3 `appet/`, `APPET-BACKUP-1` | Descoberta/retenção de backups e formato de criptografia compatível com cópias antigas. |
| `APPET_ICONS`, `.appet-write-check-*`, base fictícia `appet.invalid` | Identificadores internos. A base fictícia valida retorno e não altera o domínio do site. |
| Endereços/configurações de contas e fixtures | Contas existentes e configuração de envio são dados; nomes usados em testes não são contatos públicos oficiais. |
| Contratos sem snapshot da marca | Origem Appet do documento anterior; sem migração destrutiva ou alteração de cláusulas/aceites. |
| Mensagens, notificações, fila e auditorias anteriores | Conteúdo e autoria histórica; nunca substituídos pela renomeação. |
| Seed e imagens/fontes | Dados originais e identidade visual. O símbolo do logotipo não contém a palavra; o texto é atualizado na interface. |
| Documentação histórica Appet e políticas arquivadas | Identificação da origem da versão/auditoria. Guias atuais têm precedência operacional. |

Documentação atual: README.md, LEIA-ME-PRIMEIRO.txt, docs/guias/PUBLICAR-HOJE.md, docs/guias/GUIA_PUBLICACAO.md, docs/guias/RECUPERAR_ADMIN.md, docs/guias/VERIFICACAO_PACOTE.md e este registro. Guias/relatórios datados das etapas anteriores, e créditos são históricos e mantêm Appet para identificar sua origem.

As políticas atuais atualizam a identificação da plataforma sem alterar as obrigações dos fluxos anteriores. A versão registrada em aceites novos é `2026-10-13-potypet-rc1`; contas e cadastros pendentes anteriores mantêm `2026-10-12-etapa5`. As políticas antigas não acompanham este repositório.
