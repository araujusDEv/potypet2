// Visibilidade e alteração dos animais: quando um anúncio é público ou está disponível,
// o que cada pessoa pode ver e quem pode mudar o status.
'use strict';
module.exports = function animalPolicy({
  db,
  loadState,
  saveState,
  now,
  addNotification,
  addAdminLog,
  canPublish,
  eventMail,
}) {
  const owner = (a) => db.prepare('SELECT * FROM users WHERE id=?').get(Number(a.ownerId));
  const isPublic = (a) =>
    Boolean(
      a &&
      !a.archivedAt &&
      a.approvalStatus === 'approved' &&
      ['disponivel', 'em_processo', 'adotado'].includes(a.status) &&
      canPublish(owner(a)),
    );
  const isAvailable = (a) => isPublic(a) && a.status === 'disponivel';
  function party(user, a) {
    if (!user || !a) return false;
    if (user.role === 'admin' || Number(a.ownerId) === user.id) return true;
    return (
      loadState('requests').some(
        (r) =>
          Number(r.animalId) === a.id &&
          Number(r.requesterId) === user.id &&
          (r.ownerId !== undefined
            ? Number(r.ownerId) === Number(a.ownerId)
            : Number.isFinite(Date.parse(r.createdAt)) &&
              Date.parse(r.createdAt) >= Date.parse(a.createdAt)),
      ) ||
      loadState('contracts').some(
        (c) =>
          Number(c.animalId) === a.id &&
          Number(c.ownerId) === Number(a.ownerId) &&
          Number(c.adopterId) === user.id,
      )
    );
  }
  function view(a, user) {
    const result = { ...a, publicEligible: isPublic(a) };
    if (!user || (user.role !== 'admin' && Number(a.ownerId) !== user.id)) {
      for (const key of [
        'moderationHistory',
        'moderationReason',
        'reviewedBy',
        'reviewedByName',
        'reviewedAt',
        'archivedBy',
        'archiveReason',
        'availabilityHistory',
        'approvalCriteria',
      ])
        delete result[key];
    }
    return result;
  }
  function change(a, user, action, reason) {
    const at = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const animals = loadState('animals'),
        idx = animals.findIndex((x) => x.id === a.id);
      if (
        idx < 0 ||
        animals[idx].archivedAt ||
        (action !== 'archive' &&
          (animals[idx].status === 'adotado' ||
            loadState('requests').some(
              (r) => Number(r.animalId) === a.id && r.status === 'concluida',
            )))
      )
        throw Object.assign(new Error('O anúncio já foi encerrado ou arquivado.'), { status: 409 });
      if (
        loadState('requests').some(
          (r) => Number(r.animalId) === a.id && r.handoverAt && r.status !== 'concluida',
        )
      )
        throw Object.assign(
          new Error(
            'Há uma entrega registrada aguardando conclusão. Preserve esse pedido e trate o recebimento antes de encerrar o anúncio.',
          ),
          { status: 409 },
        );
      const record = {
        ...animals[idx],
        availabilityHistory: [
          ...(animals[idx].availabilityHistory || []),
          { action, actorId: user.id, actorName: user.name, at, reason },
        ],
      };
      if (action === 'archive') {
        record.archivedAt = at;
        record.archivedBy = user.id;
        record.archiveReason = reason;
      }
      if (action === 'withdraw') {
        record.status = 'indisponivel';
        record.withdrawnAt = at;
        record.withdrawalReason = reason;
      }
      if (action === 'external-adoption') {
        record.status = 'adotado';
        record.adoptionOrigin = 'external';
        record.adoptedAt = at;
      }
      animals[idx] = record;
      saveState('animals', animals);
      const requests = loadState('requests');
      let closed = 0;
      const explanation =
        action === 'archive'
          ? 'O anúncio foi arquivado.'
          : action === 'withdraw'
            ? 'O animal foi retirado de adoção.'
            : 'O responsável informou adoção fora da plataforma.';
      for (let i = 0; i < requests.length; i++)
        if (
          Number(requests[i].animalId) === a.id &&
          ['pendente', 'em_analise', 'aprovada'].includes(requests[i].status)
        ) {
          requests[i] = {
            ...requests[i],
            status: 'cancelada',
            stage: 'encerrada',
            closedAt: at,
            closedBy: user.id,
            cancellationReason: explanation + (reason ? ' ' + reason : ''),
          };
          closed++;
          addNotification(
            requests[i].requesterId,
            `${a.name}: ${explanation} Sua solicitação foi encerrada; o histórico permanece em Minhas Solicitações.`,
          );
          eventMail?.(
            requests[i].requesterId,
            'decision',
            `request:${requests[i].id}:animal-${action}`,
            'minhas-solicitacoes.html',
          );
        }
      saveState('requests', requests);
      addNotification(
        a.ownerId,
        `${a.name}: ${explanation} ${closed} solicitação(ões) encerrada(s).`,
      );
      addAdminLog(user, `${explanation} Animal #${a.id}: ${a.name}. ${reason}`);
      db.exec('COMMIT');
      return { animal: record, closedRequests: closed };
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return { isPublic, isAvailable, party, view, change };
};
