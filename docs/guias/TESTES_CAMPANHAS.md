> Registro histórico. Para esta entrega, use Node 24.21.0 LTS e siga [docs/guias/PUBLICAR-HOJE.md](PUBLICAR-HOJE.md). Resultados abaixo pertencem à etapa indicada, não à conferência atual.

# Resultado da validação — 30/09/2026

Executado com Node.js 22.23.1. Comando npm test finalizado com código 0.

- Pix: CRC16, tipos de chave, valores e limites aprovados.
- Campanhas: pessoas, organizações aprovadas/pendentes, visitante e administrador; rascunhos, análise, ajustes, rejeição, aprovação, pausa, retomada e encerramento aprovados.
- Revisões: nova chave, beneficiário, meta e total não alteram a versão pública antes da aprovação.
- Evidências: acesso de terceiros bloqueado, documentos privados, formato e tamanho validados, capa pública apenas após aprovação.
- Regressões: autenticação, segurança HTTP, IDs, privacidade e adoção até emissão do termo aprovadas.
- Migração: contas, senhas, coleções, vínculos, Pix e totais preservados; reinicialização idempotente.
- Todos os arquivos JavaScript passaram em node --check.
- Servidores iniciados por node server.js sem erro nas verificações. Node emite aviso ExperimentalWarning para SQLite, sem falha de execução.
- Interface: solicitação por pessoa, upload de PNG/PDF, envio, análise e aprovação administrativa; perfil de grupo independente; apoio contínuo sem meta/animal; geração de QR Code e Copia e Cola com R$ 25,00. Login com retorno ao fluxo conferido.
- Layout: desktop, celular 390/320 px, modo escuro e navegação móvel conferidos.

Dados originais de seed.json preservados (SHA256 29348BE1B9095707C5CEA925705F93CFA3A6BD3F4A51EA469077CB436B60AB8E). Campanhas e documentos fictícios foram usados apenas em bancos temporários fora do pacote.

Limitações: não houve transferência bancária, confirmação de clínica, validação de documentos reais, teste de carga, auditoria independente ou publicação no GitHub/Render. Não há confirmação automática de recebimento nem garantia de veracidade de campanhas.

