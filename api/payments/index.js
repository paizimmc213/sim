/**
 * POST /api/payments
 * Cria uma cobrança PIX encaminhando para o servidor de pagamentos
 * (serverblack-pagamento), que repassa ao gateway ativo (CrazyPay ou
 * Blackcat) e devolve sempre o mesmo formato:
 *
 *   201 { "id": "...", "qrCode": "000201...", "expiresAt": "..." }
 *
 * Por que não chamar o middleware direto do navegador?
 * A URL dele é HTTP e o site roda em HTTPS — o browser bloquearia por
 * conteúdo misto. Este proxy da Vercel resolve isso e ainda repassa o
 * IP real do comprador (o middleware lê X-Forwarded-For).
 */

const MIDDLEWARE_URL =
  'http://6ugawbqcezxwcxhsz4lma6xx.153.75.84.96.sslip.io/api';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const body = req.body || {};

  /* Só repassa os campos oficiais do contrato. */
  const payload = {
    amount: body.amount,
    externalRef: body.externalRef,
    cart: Array.isArray(body.cart) ? body.cart : undefined,
    customer: body.customer,
    utm: body.utm && typeof body.utm === 'object' ? body.utm : undefined,
  };

  Object.keys(payload).forEach(
    (key) => payload[key] === undefined && delete payload[key]
  );

  /* IP real do comprador — sem isso o gateway registraria o IP da Vercel. */
  const clientIp = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();

  try {
    const response = await fetch(`${MIDDLEWARE_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
      },
      body: JSON.stringify(payload),
    });

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
        'Servidor de pagamento erro:',
        response.status,
        JSON.stringify(data)
      );

      /* Mantém o formato oficial de erro: { error, issues? }.
         O pix-modal.js usa `issues` para montar a mensagem do 422. */
      return res.status(response.status === 422 ? 422 : 502).json({
        error: data.error || 'Não foi possível gerar o PIX.',
        ...(Array.isArray(data.issues) ? { issues: data.issues } : {}),
      });
    }

    if (!data.id || !data.qrCode) {
      console.error(
        'Resposta sem id/qrCode:',
        JSON.stringify(data)
      );
      return res
        .status(502)
        .json({ error: 'O servidor não retornou o código PIX.' });
    }

    /*
     * O gateway às vezes devolve a data zero ("0001-01-01...")
     * quando não há expiração — trata como vazio.
     */
    const expiresAt =
      data.expiresAt &&
      !String(data.expiresAt).startsWith('0001-01-01')
        ? data.expiresAt
        : null;

    return res.status(200).json({
      id: String(data.id),
      qrCode: data.qrCode,
      expiresAt,
    });
  } catch (error) {
    console.error('Falha ao chamar o servidor de pagamento:', error);
    return res
      .status(502)
      .json({ error: 'Não foi possível falar com o servidor de pagamento.' });
  }
};
