/**
 * GET /api/payments/:id/status
 * Encaminha a consulta para o servidor de pagamentos (serverblack-pagamento)
 * e devolve o formato oficial:
 *
 *   { "paid": true, "status": "PAID", "raw": { } }
 *
 * Status possíveis (sempre maiúsculos):
 *   PENDING — aguardando pagamento; continue consultando
 *   PAID — pago; libere o pedido
 *   EXPIRED — PIX venceu; gere uma nova cobrança
 *   REFUSED, FAILED, ERROR — não processado; ofereça uma nova cobrança
 *   REFUNDED, CHARGEBACK — dinheiro devolvido; revogue o acesso
 */

const MIDDLEWARE_URL =
  'http://6ugawbqcezxwcxhsz4lma6xx.153.75.84.96.sslip.io/api';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: 'ID da transação não informado.' });
  }

  try {
    const response = await fetch(
      `${MIDDLEWARE_URL}/payments/${encodeURIComponent(id)}/status`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }
    );

    let data;
    try {
      data = await response.json();
    } catch {
      console.error(
        'Servidor de pagamento respondeu algo que não é JSON. HTTP',
        response.status
      );
      return res
        .status(502)
        .json({ error: 'Resposta inválida do servidor de pagamento.' });
    }

    if (!response.ok) {
      console.error(
        'Servidor de pagamento status erro:',
        response.status,
        JSON.stringify(data)
      );
      return res.status(response.status === 404 ? 404 : 502).json({
        error: data.error || 'Erro ao consultar pagamento.',
      });
    }

    return res.status(200).json({
      paid: data.paid === true,
      status: String(data.status || 'PENDING').toUpperCase(),
      raw: data.raw,
    });
  } catch (error) {
    console.error('Falha ao consultar o servidor de pagamento:', error);
    return res
      .status(502)
      .json({ error: 'Não foi possível falar com o servidor de pagamento.' });
  }
};
