// Situação da conta (usuário, ONG ou admin) e o que ela permite: se está suspensa ou restrita, a mensagem a mostrar e o histórico.
'use strict';
const type = (user) =>
  user?.account_type ||
  (user?.role === 'admin' ? 'admin' : user?.role === 'doador' ? 'ong' : 'usuario');
const suspended = (user) => Boolean(user?.account_suspended_at);
const restricted = (user) =>
  Boolean(
    user && (suspended(user) || (type(user) === 'ong' && user.approval_status !== 'aprovado')),
  );
const message = (user) =>
  suspended(user)
    ? 'Sua conta está suspensa. Consulte o histórico autorizado; novas ações estão bloqueadas.'
    : 'Esta conta de ONG está em acesso restrito ao histórico. Novas publicações e solicitações estão bloqueadas.';
const history = (user) => {
  try {
    const value = JSON.parse(user?.account_moderation_history || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};
module.exports = { type, suspended, restricted, message, history };
