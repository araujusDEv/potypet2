// Regras do fluxo do pedido de adoção: etapas, mensagens e quem pode agir em cada uma.
// As rotas HTTP ficam no server.js.
'use strict';
const validate = require('./input-validation.cjs');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
module.exports = function ({
  db,
  loadState,
  saveState,
  newId,
  now,
  getAnimal,
  canReadRequest,
  canManageRequest,
  recalcAnimalProcessStatus,
  addNotification,
  eventMail,
}) {
  return function act(user, id, action, body) {
    // No asynchronous work inside this transaction: state and queued notices commit together.
    db.exec('BEGIN IMMEDIATE');
    try {
      const list = loadState('requests'),
        index = list.findIndex((r) => r.id === id),
        r = list[index];
      if (!r) fail(404, 'Solicitação não encontrada.');
      if (!canReadRequest(user, r)) fail(403, 'Você não pode acessar esta solicitação.');
      const applicant = Number(r.requesterId) === user.id,
        animal = getAnimal(r.animalId);
      const ownerId = Number(r.ownerId ?? animal?.ownerId);
      const notice = (recipient, message, kind = 'decision') => {
        addNotification(recipient, message);
        eventMail(
          recipient,
          kind,
          `request:${id}:${action}:${recipient}`,
          recipient === r.requesterId
            ? 'minhas-solicitacoes.html'
            : 'painel-doador.html?tab=solicitacoes',
        );
      };
      if (action === 'story') {
        if (!applicant || r.status !== 'concluida')
          fail(403, 'Você não pode editar esta história.');
        Object.assign(r, {
          story: validate.optionalText(body.story, 3000),
          storyPublic: validate.boolean(body.publish),
          storyDisplayName: validate.optionalText(body.displayName, 80) || 'Família adotante',
          storyUpdatedAt: now(),
        });
      } else if (action === 'share-contact') {
        if (!applicant && user.id !== ownerId)
          fail(403, 'Somente as partes podem compartilhar seus contatos.');
        r[applicant ? 'requesterContactConsent' : 'ownerContactConsent'] = validate.boolean(
          body.share,
        );
        r[applicant ? 'requesterContactConsentAt' : 'ownerContactConsentAt'] = now();
      } else if (action === 'message') {
        if (!['pendente', 'em_analise', 'aprovada', 'concluida'].includes(r.status))
          fail(409, 'Esta solicitação está encerrada.');
        const text = validate.text(body.text, 1500, 'a mensagem'),
          token = validate.text(body.clientToken, 80, 'o identificador da mensagem');
        r.messages ||= [];
        const existing = r.messages.find((m) => m.senderId === user.id && m.clientToken === token);
        if (existing) {
          if (existing.text !== text) fail(409, 'Identificador já usado para outra mensagem.');
        } else {
          if (r.messages.length >= 200)
            fail(
              409,
              'Limite de mensagens deste pedido atingido. Use o atendimento para continuar.',
            );
          r.messages.push({
            id: r.messages.length + 1,
            senderId: user.id,
            senderName: user.name,
            text,
            clientToken: token,
            createdAt: now(),
          });
          addNotification(
            applicant ? ownerId : r.requesterId,
            `Há uma nova mensagem privada na solicitação de ${r.animalName || 'adoção'}.`,
          );
          eventMail(
            applicant ? ownerId : r.requesterId,
            'message',
            `request:${id}:message:${user.id}:${token}`,
            applicant ? 'painel-doador.html?tab=solicitacoes' : 'minhas-solicitacoes.html',
          );
        }
      } else if (action === 'confirm-receipt') {
        if (!applicant) fail(403, 'Somente o interessado pode confirmar o recebimento.');
        if (r.status !== 'aprovada' || !r.handoverAt)
          fail(409, 'Aguarde o responsável registrar a entrega.');
        if (body.confirmed !== true) fail(400, 'Confirme que recebeu o animal.');
        if (!r.receiptConfirmedAt) {
          r.receiptConfirmedAt = now();
          r.receiptConfirmedBy = user.id;
          notice(
            ownerId,
            'O interessado confirmou o recebimento. Revise o pedido e conclua a adoção.',
          );
        }
      } else if (action === 'cancel') {
        if (!applicant) fail(403, 'Somente o interessado pode cancelar esta solicitação.');
        if (!['pendente', 'em_analise', 'aprovada'].includes(r.status) || r.handoverAt)
          fail(
            409,
            'O pedido não pode ser cancelado nesta etapa. Após a entrega, procure o responsável pelo contato privado ou atendimento.',
          );
        Object.assign(r, {
          status: 'cancelada',
          stage: 'encerrada',
          canceledAt: now(),
          cancellationReason: validate.optionalText(body.reason, 1000),
        });
        notice(ownerId, 'O interessado cancelou a solicitação.');
      } else {
        if (!canManageRequest(user, r)) fail(403, 'Você não pode responder a esta solicitação.');
        if (!animal) fail(404, 'Animal não encontrado.');
        if (
          ['approve', 'accept', 'interview', 'handover', 'complete'].includes(action) &&
          (animal.archivedAt ||
            animal.approvalStatus !== 'approved' ||
            !['disponivel', 'em_processo'].includes(animal.status))
        )
          fail(409, 'Este anúncio não permite avançar a adoção.');
        if (action === 'analyze') {
          if (r.status !== 'pendente') fail(409, 'Esta solicitação já saiu da etapa pendente.');
          Object.assign(r, {
            status: 'em_analise',
            stage: 'em_analise',
            analyzedAt: now(),
            reviewedBy: user.id,
            reviewedAt: now(),
          });
          notice(
            r.requesterId,
            'O responsável iniciou a análise. Aguarde a decisão ou responda ao contato privado.',
          );
        } else if (action === 'approve' || action === 'accept') {
          if (!['pendente', 'em_analise'].includes(r.status))
            fail(409, 'Esta solicitação não pode mais ser aprovada.');
          if (
            list.some(
              (other) =>
                other.id !== id &&
                other.animalId === r.animalId &&
                ['aprovada', 'concluida'].includes(other.status),
            )
          )
            fail(
              409,
              'Já existe um interessado aprovado para este animal. Encerre esse pedido antes de escolher outro.',
            );
          Object.assign(r, {
            status: 'aprovada',
            stage: 'aprovada',
            reviewedBy: user.id,
            reviewedAt: now(),
            approvedBy: user.id,
            approvedAt: now(),
          });
          notice(
            r.requesterId,
            'Sua solicitação foi aprovada. Combine o contato e a entrega com o responsável na área autenticada. A adoção ainda não está concluída.',
          );
        } else if (action === 'interview') {
          if (r.status !== 'aprovada' || r.handoverAt || r.interviewAt)
            fail(409, 'O contato já foi registrado ou esta etapa foi encerrada.');
          r.stage = 'entrevista';
          r.interviewAt = now();
          notice(
            r.requesterId,
            'O responsável registrou a entrevista ou contato. Combinem a entrega antes de avançar.',
          );
        } else if (action === 'handover') {
          if (r.status !== 'aprovada' || r.handoverAt)
            fail(409, 'A entrega já foi registrada ou o pedido não está aprovado.');
          if (body.confirmed !== true) fail(400, 'Confirme que a entrega aconteceu.');
          if (
            list.some(
              (other) =>
                other.id !== id &&
                other.animalId === r.animalId &&
                (other.handoverAt || other.status === 'concluida'),
            )
          )
            fail(409, 'Já existe entrega registrada para outro pedido deste animal.');
          Object.assign(r, { stage: 'entregue', handoverAt: now(), handoverBy: user.id });
          notice(
            r.requesterId,
            'O responsável registrou a entrega. Confirme o recebimento do animal em Minhas Solicitações.',
          );
        } else if (action === 'complete') {
          if (r.status !== 'aprovada' || !r.handoverAt || !r.receiptConfirmedAt)
            fail(
              409,
              'Registre a entrega e aguarde o interessado confirmar o recebimento antes de concluir.',
            );
          const completedAt = now();
          Object.assign(r, {
            status: 'concluida',
            stage: 'concluida',
            completedAt,
            acceptedAt: completedAt,
            completedBy: user.id,
            workflowVersion: 3,
          });
          for (const other of list)
            if (
              other.id !== id &&
              other.animalId === r.animalId &&
              ['pendente', 'em_analise', 'aprovada'].includes(other.status)
            ) {
              Object.assign(other, {
                status: 'cancelada',
                stage: 'encerrada',
                closedAt: completedAt,
                cancellationReason: 'Animal adotado por outro interessado.',
              });
              addNotification(
                other.requesterId,
                'O animal foi adotado por outro interessado. Seu pedido foi encerrado.',
              );
              eventMail(
                other.requesterId,
                'decision',
                `request:${other.id}:closed-by:${id}`,
                'minhas-solicitacoes.html',
              );
            }
          const animals = loadState('animals'),
            ai = animals.findIndex((a) => a.id === animal.id);
          Object.assign(animals[ai], {
            status: 'adotado',
            adoptionOrigin: 'appet',
            adoptedAt: completedAt,
          });
          saveState('animals', animals);
          const contracts = loadState('contracts');
          if (contracts.some((c) => c.requestId === id))
            fail(409, 'Este pedido já possui um termo.');
          const adopter = db.prepare('SELECT * FROM users WHERE id=?').get(r.requesterId),
            owner = db.prepare('SELECT * FROM users WHERE id=?').get(ownerId);
          contracts.push({
            id: newId('contracts'),
            requestId: id,
            code: `ADT-${id}-${Date.now().toString(36).toUpperCase()}`,
            animalId: animal.id,
            animalName: animal.name,
            species: animal.species,
            breed: animal.breed || '',
            adopterId: r.requesterId,
            adopterName: adopter?.name || r.full_name,
            adopterCity: adopter?.city || r.city || '',
            ownerId,
            ownerName: owner?.name || 'Responsável',
            ownerCity: owner?.city || animal.city || '',
            acceptedAt: completedAt,
            createdAt: completedAt,
            handoverAt: r.handoverAt,
            receiptConfirmedAt: r.receiptConfirmedAt,
            workflowVersion: 3,
            brandName: 'PotyPet',
            legalNote:
              'Estas são declarações registradas pelas contas autenticadas no PotyPet. Não constituem assinatura certificada nem comprovação independente da entrega. A confirmação do termo é separada da conclusão e não altera o indicador de adoções. Para necessidades jurídicas específicas, procure orientação profissional.',
            ownerAcknowledgedAt: null,
            adopterAcknowledgedAt: null,
            clauses: [
              'Garantir alimentação, abrigo, cuidados veterinários e tratamento sem maus-tratos.',
              'Manter vacinação e medidas preventivas de saúde adequadas.',
              'Não abandonar, vender ou transferir o animal sem comunicar o responsável pela adoção.',
              'Procurar apoio e organizar devolução responsável caso a adaptação não seja possível.',
            ],
          });
          saveState('contracts', contracts);
          notice(
            r.requesterId,
            'A adoção foi concluída pelo responsável. Leia e confirme o termo; os acompanhamentos abrem em 7, 30 e 90 dias.',
          );
          notice(
            ownerId,
            'Adoção concluída. Leia e confirme o termo e acompanhe os pedidos de ajuda.',
          );
          for (const f of loadState('favorites').filter(
            (f) => f.animalId === animal.id && f.userId !== r.requesterId,
          ))
            addNotification(f.userId, `Um animal que você favoritou (${animal.name}) foi adotado.`);
        } else if (action === 'reject') {
          if (!['pendente', 'em_analise', 'aprovada'].includes(r.status) || r.handoverAt)
            fail(409, 'Este pedido não pode ser reprovado nesta etapa.');
          Object.assign(r, {
            status: 'reprovada',
            stage: 'encerrada',
            reviewedBy: user.id,
            reviewedAt: now(),
            rejectedBy: user.id,
            rejectedAt: now(),
            rejectionReason: validate.optionalText(body.reason, 1000),
          });
          notice(
            r.requesterId,
            'Sua solicitação não foi aprovada. Consulte o motivo na área autenticada. Você pode conhecer outros animais.',
          );
        } else fail(400, 'Ação inválida.');
      }
      saveState('requests', list);
      if (['approve', 'accept', 'reject', 'cancel'].includes(action))
        recalcAnimalProcessStatus(r.animalId);
      db.exec('COMMIT');
      return r;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};
