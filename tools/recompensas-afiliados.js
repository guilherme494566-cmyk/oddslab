'use strict';

// Calcula valores em cêntimos sobre o primeiro pagamento confirmado.
// Os dois lados são arredondados para baixo para não exceder o valor recebido.
function calcularRecompensas({ primeiroPagamento, pago, moeda, recebido, reembolsado = 0 }) {
  if (!Number.isSafeInteger(recebido) || recebido < 0 ||
      !Number.isSafeInteger(reembolsado) || reembolsado < 0 || reembolsado > recebido) {
    throw new RangeError('Montante inválido');
  }

  const elegivel = primeiroPagamento === true && pago === true && moeda === 'eur';
  const metade = elegivel ? Math.floor((recebido - reembolsado) / 2) : 0;
  return { comissaoAfiliado: metade, saldoAmigo: metade };
}

module.exports = { calcularRecompensas };
