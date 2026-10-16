const PIX_MODAL_HTML = `
  <div class="duttyfy-pix-modal-overlay" id="duttyfyPixModal">
    <div class="duttyfy-pix-modal">

      <button
        class="duttyfy-pix-close"
        id="duttyfyPixClose"
        onclick="closePixModal()"
        aria-label="Fechar pagamento PIX"
      >
        <svg
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
          style="width:16px;height:16px;"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M6 18L18 6M6 6l12 12"
          ></path>
        </svg>
      </button>

      <div class="duttyfy-pix-header">
        <h3 class="duttyfy-pix-title">
          Pagamento via PIX
        </h3>

        <p
          class="duttyfy-pix-subtitle"
          id="duttyfyPixItemTitle"
        >
          Finalize o pagamento para confirmar seu pedido
        </p>
      </div>

      <div
        class="duttyfy-pix-qr-container"
        id="duttyfyPixQrContainer"
      >
        <div
          class="duttyfy-pix-loader"
          id="duttyfyPixLoader"
        ></div>

        <div
          id="duttyfyPixQrCode"
          class="duttyfy-pix-qr-code"
          style="display:none;"
        ></div>

        <div
          class="duttyfy-pix-error"
          id="duttyfyPixError"
          style="display:none;"
        >
          <span id="duttyfyPixErrorText">
            Erro ao gerar PIX. Tente novamente.
          </span>

          <button
            type="button"
            class="duttyfy-pix-retry-btn"
            id="duttyfyPixRetryBtn"
            onclick="retryPixModal()"
            style="display:none;"
          >
            Gerar novo PIX
          </button>
        </div>
      </div>

      <div
        class="duttyfy-pix-copy-section"
        id="duttyfyPixCopySection"
        style="display:none;"
      >
        <label class="duttyfy-pix-copy-label">
          PIX Copia e Cola:
        </label>

        <div class="duttyfy-pix-copy-box">
          <input
            type="text"
            class="duttyfy-pix-copy-input"
            id="duttyfyPixCodeInput"
            readonly
          >

          <button
            class="duttyfy-pix-copy-btn"
            id="duttyfyPixCopyBtn"
            onclick="copyPixCode()"
          >
            <svg
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
              style="width:16px;height:16px;"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
              ></path>
            </svg>
            Copiar
          </button>
        </div>
      </div>

      <div
        id="duttyfyPixStatus"
        style="
          display:none;
          text-align:center;
          margin-top:16px;
          font-size:14px;
        "
      >
        Aguardando confirmação do pagamento...
      </div>

    </div>
  </div>
`;


/* =========================================================
   CONFIGURAÇÃO

   Estratégia de chamada:
   1. Primeiro tenta os proxies locais (/api/*) — usados
      em produção (Vercel), onde a página é HTTPS e o
      browser bloquearia chamada direta para http://.
   2. Se o proxy não existir (ex.: teste local no Live
      Server), cai automaticamente na URL direta do
      servidor de pagamentos (serverblack-pagamento),
      que libera CORS.

   O middleware devolve sempre o mesmo formato, não
   importa qual gateway está ativo (CrazyPay ou Blackcat).
========================================================= */

const PIX_API_BASE =
  '/api';

const PIX_DIRECT_API =
  'http://6ugawbqcezxwcxhsz4lma6xx.153.75.84.96.sslip.io/api';


/*
 * Dados usados quando o funil não tem a informação
 * do cliente salva no localStorage — evita que o
 * modal trave pedindo e-mail/telefone/CPF.
 *
 * Ajuste aqui se quiser trocar os valores padrão.
 */
const PIX_FALLBACK_CUSTOMER = {

  firstName:
    'Cliente',

  /*
   * O middleware exige ao menos 1 caractere
   * no sobrenome — não deixe vazio.
   */
  lastName:
    'Silva',

  email:
    'cliente@duttyfy.com',

  phone:
    '11999999999',

  cpf:
    '52998224725'
};


/* =========================================================
   ESTADO
========================================================= */

let pixPollingInterval = null;
let pixPollingTimeout = null;

let currentSuccessUrl = '';
let currentTransactionId = '';

/*
 * Guarda a última chamada para o botão
 * "Gerar novo PIX" repetir sem perder dados.
 */
let lastPixRequest = null;

/*
 * Define qual base de API foi usada com sucesso
 * por último: false = proxy local, true = direta.
 * O polling de status segue a mesma base da criação.
 */
let pixDirectMode = false;


/*
 * Status finais do gateway conforme a documentação
 * do servidor de pagamentos.
 */
const PIX_FAILED_STATUSES =
  ['REFUSED', 'FAILED', 'ERROR', 'CANCELLED'];

const PIX_EXPIRED_STATUS =
  'EXPIRED';

const PIX_REVOKED_STATUSES =
  ['REFUNDED', 'CHARGEBACK'];


/* =========================================================
   CHAMADA À API (proxy primeiro, direta como fallback)
========================================================= */

/**
 * Tenta o proxy local (/api) e, se ele não responder
 * como esperado (Live Server, 404, HTML, sem CORS),
 * cai na URL direta do middleware.
 *
 * Devolve { response, data } ou lança o erro de negócio.
 */
async function requestPixApi(
  path,
  fetchOptions = {}
) {

  const bases =
    [
      { url: PIX_API_BASE, direct: false },
      { url: PIX_DIRECT_API, direct: true }
    ];


  let lastInfraError =
    null;


  for (const base of bases) {

    try {

      const response =
        await fetch(
          `${base.url}${path}`,
          fetchOptions
        );


      let data;

      try {

        data =
          await response.json();

      } catch {

        /*
         * Resposta não-JSON (página HTML de 404/405,
         * servidor estático etc.) = infraestrutura.
         */
        throw Object.assign(
          new Error(
            `O servidor respondeu em formato inesperado (HTTP ${response.status}).`
          ),
          { pixInfra: true }
        );
      }


      /*
       * Erro de negócio (4xx/5xx em JSON).
       *
       * 5xx do proxy local = infraestrutura — tenta
       * a URL direta. 4xx = problema real do payload
       * (422) ou do gateway — repassa sem fallback.
       */
      if (
        !response.ok
      ) {

        if (
          response.status >= 500 &&
          !base.direct
        ) {

          lastInfraError =
            new Error(
              data.error ||
              'O proxy local falhou.'
            );

          lastInfraError.pixInfra =
            true;

          continue;
        }


        const error =
          new Error(
            data.error ||
            'Erro na API de pagamento.'
          );

        error.status =
          response.status;

        error.data =
          data;


        throw error;
      }


      /*
       * Sucesso — fixa a base usada para o polling.
       */
      pixDirectMode =
        base.direct;


      return {
        response,
        data
      };

    } catch (error) {

      /*
       * Erro de rede (conexão recusada, CORS,
       * conteúdo misto bloqueado) também é infra.
       */
      if (
        error.pixInfra ||
        error instanceof TypeError
      ) {

        lastInfraError =
          error;

        continue;
      }


      throw error;
    }
  }


  throw (
    lastInfraError ||
    new Error(
      'Não foi possível falar com o servidor de pagamento.'
    )
  );
}


/* =========================================================
   INJETAR MODAL + QR CODE
========================================================= */

function injectPixModalDependencies() {

  /*
   * CSS
   */
  if (!document.getElementById('duttyfyPixModalStyle')) {

    const link =
      document.createElement('link');

    link.id =
      'duttyfyPixModalStyle';

    link.rel =
      'stylesheet';

    const pathPrefix =
      window.location.pathname.includes('/up') ||
      window.location.pathname.includes('/9/')
        ? '../'
        : './';

    link.href =
      `${pathPrefix}css/pix-modal.css`;

    document.head.appendChild(link);
  }


  /*
   * QRCode.js
   */
  if (!document.getElementById('duttyfyPixModalScript')) {

    const script =
      document.createElement('script');

    script.id =
      'duttyfyPixModalScript';

    script.src =
      'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

    document.head.appendChild(script);
  }


  /*
   * Modal
   */
  if (!document.getElementById('duttyfyPixModal')) {

    document.body.insertAdjacentHTML(
      'beforeend',
      PIX_MODAL_HTML
    );
  }
}


/* =========================================================
   ABRIR / GERAR PIX
========================================================= */

/**
 * Uso simples:
 *
 * openPixModal(
 *   4990,
 *   'Pedido de pneus',
 *   '/sucesso'
 * );
 *
 *
 * Uso recomendado para seu ecommerce:
 *
 * openPixModal(
 *   54990,
 *   'Pedido #123',
 *   '/pedido-confirmado',
 *   {
 *      externalRef: 'PEDIDO-123',
 *
 *      cart: [
 *        {
 *          nome: 'Pneu 175/70 R14',
 *          unitPrice: 250.00,
 *          quantity: 2
 *        }
 *      ],
 *
 *      customer: {
 *        firstName: 'João',
 *        lastName: 'Silva',
 *        email: 'joao@email.com',
 *        phone: '11999999999',
 *        cpf: '12345678901'
 *      }
 *   }
 * );
 */
async function openPixModal(
  amountCents,
  itemTitle,
  successUrl,
  options = {}
) {

  injectPixModalDependencies();

  /*
   * Salva os dados da chamada para o retry
   * poder gerar uma nova cobrança idêntica.
   */
  lastPixRequest = {
    amountCents,
    itemTitle,
    successUrl,
    options
  };

  currentSuccessUrl =
    successUrl || '/';

  const modal =
    document.getElementById(
      'duttyfyPixModal'
    );

  const loader =
    document.getElementById(
      'duttyfyPixLoader'
    );

  const qrContainer =
    document.getElementById(
      'duttyfyPixQrCode'
    );

  const copySection =
    document.getElementById(
      'duttyfyPixCopySection'
    );

  const errorMsg =
    document.getElementById(
      'duttyfyPixError'
    );

  const titleEl =
    document.getElementById(
      'duttyfyPixItemTitle'
    );

  const statusEl =
    document.getElementById(
      'duttyfyPixStatus'
    );


  /*
   * Abre modal
   */
  modal.classList.add('show');


  /*
   * Estado inicial
   */
  loader.style.display =
    'block';

  qrContainer.style.display =
    'none';

  qrContainer.innerHTML =
    '';

  copySection.style.display =
    'none';

  errorMsg.style.display =
    'none';

  statusEl.style.display =
    'none';


  if (itemTitle) {

    titleEl.innerText =
      itemTitle;
  }


  /* =======================================================
     DADOS DO CLIENTE
  ======================================================= */

  const rawCpf =
    options.customer?.cpf ||
    localStorage.getItem('cpf') ||
    PIX_FALLBACK_CUSTOMER.cpf;

  const cpf =
    String(rawCpf)
      .replace(/\D/g, '');


  const rawPhone =
    options.customer?.phone ||
    localStorage.getItem('telephone') ||
    localStorage.getItem('telefone') ||
    PIX_FALLBACK_CUSTOMER.phone;

  const phone =
    String(rawPhone)
      .replace(/\D/g, '');


  const storedName =
    localStorage.getItem('nome') ||
    localStorage.getItem('name') ||
    '';


  const email =
    options.customer?.email ||
    localStorage.getItem('email') ||
    PIX_FALLBACK_CUSTOMER.email;


  /*
   * Nome completo
   */
  let firstName =
    options.customer?.firstName ||
    storedName.trim().split(/\s+/)[0] ||
    'Cliente';


  let lastName =
    options.customer?.lastName ||
    storedName
      .trim()
      .split(/\s+/)
      .slice(1)
      .join(' ') ||
    PIX_FALLBACK_CUSTOMER.lastName;


  /* =======================================================
     CARRINHO
  ======================================================= */

  let cart =
    Array.isArray(options.cart)
      ? options.cart
      : null;


  /*
   * Compatibilidade com chamada antiga.
   *
   * Se nenhum carrinho for informado,
   * cria um item usando o valor total.
   */
  if (!cart || cart.length === 0) {

    cart = [
      {
        nome:
          itemTitle ||
          'Pedido',

        /*
         * ATENÇÃO:
         * Nova API exige unitPrice em REAIS.
         *
         * amountCents é centavos.
         */
        unitPrice:
          Number(amountCents) / 100,

        quantity:
          1
      }
    ];
  }


  /*
   * Normaliza o carrinho.
   */
  cart =
    cart.map(item => ({

      nome:
        String(
          item.nome ||
          item.title ||
          'Produto'
        ),

      unitPrice:
        Number(
          item.unitPrice ??
          item.price ??
          0
        ),

      quantity:
        Number(
          item.quantity || 1
        )

    }));


  /* =======================================================
     VALIDAR CARRINHO
  ======================================================= */

  if (
    !cart.length
  ) {

    mostrarErroPix(
      'Não foi possível identificar os produtos do pedido.'
    );

    return;
  }


  for (const item of cart) {

    if (
      !item.nome ||
      !Number.isFinite(item.unitPrice) ||
      item.unitPrice <= 0 ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0
    ) {

      mostrarErroPix(
        'Um dos produtos do pedido possui dados inválidos.'
      );

      return;
    }
  }


  /* =======================================================
     CLIENTE

     Não valida mais nome/e-mail/telefone/CPF:
     o que não vier do funil é preenchido com
     PIX_FALLBACK_CUSTOMER (seção CONFIGURAÇÃO).
  ======================================================= */

  if (
    !firstName.trim()
  ) {

    firstName =
      PIX_FALLBACK_CUSTOMER.firstName;
  }


  if (
    !lastName.trim()
  ) {

    lastName =
      PIX_FALLBACK_CUSTOMER.lastName;
  }


  /* =======================================================
     EXTERNAL REF
  ======================================================= */

  const externalRef =
    options.externalRef ||
    `PEDIDO-${Date.now()}`;


  /* =======================================================
     UTMs
  ======================================================= */

  const urlParams =
    new URLSearchParams(
      window.location.search
    );


  const utmSource =
    urlParams.get('utm_source');

  const utmMedium =
    urlParams.get('utm_medium');

  const utmCampaign =
    urlParams.get('utm_campaign');

  const utmContent =
    urlParams.get('utm_content');

  const utmTerm =
    urlParams.get('utm_term');


  /*
   * A API aceita o objeto `utm` e repassa os pares
   * ao gateway como metadata.
   *
   * Primeiro tenta os parâmetros da URL atual; se não
   * houver, usa o primeiro toque salvo pelo tracking
   * em localStorage (`_utms`) — nos upsells a URL já
   * não carrega mais os UTMs.
   */

  let storedUtms = {};

  try {

    storedUtms =
      JSON.parse(
        localStorage.getItem('_utms') ||
        '{}'
      );

  } catch {

    storedUtms = {};
  }


  const utm = {};


  const utmFields = {

    utm_source:
      utmSource ||
      storedUtms.utm_source,

    utm_medium:
      utmMedium ||
      storedUtms.utm_medium,

    utm_campaign:
      utmCampaign ||
      storedUtms.utm_campaign,

    utm_content:
      utmContent ||
      storedUtms.utm_content,

    utm_term:
      utmTerm ||
      storedUtms.utm_term
  };


  for (
    const [key, value]
    of
    Object.entries(utmFields)
  ) {

    if (value) {

      utm[key] =
        String(value);
    }
  }


  /* =======================================================
     MONTAR PAYLOAD
  ======================================================= */

  const payload = {

    /*
     * TOTAL EM CENTAVOS
     */
    amount:
      Number(amountCents),


    /*
     * ID DO PEDIDO
     */
    externalRef:
      String(externalRef),


    /*
     * PRODUTOS
     *
     * unitPrice em REAIS.
     */
    cart:
      cart,


    /*
     * CLIENTE
     */
    customer: {

      firstName:
        String(firstName),

      lastName:
        String(lastName),

      email:
        String(email),

      phone:
        String(phone),

      cpf:
        String(cpf)
    }
  };


  /*
   * UTMs — só envia se houver algum valor.
   */
  if (
    Object.keys(utm).length
  ) {

    payload.utm =
      utm;
  }


  /* =======================================================
     CRIAR COBRANÇA
  ======================================================= */

  try {

    /*
     * Proxy local primeiro; URL direta do middleware
     * como fallback automático (ver requestPixApi).
     *
     * Erros de negócio (422, 4xx do gateway) voltam
     * como exceção com error.status e error.data.
     */
    const { data } =
      await requestPixApi(
        '/payments',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              payload
            )
        }
      );


    /* =====================================================
       RESPOSTA ESPERADA

       {
         "id": "...",
         "qrCode": "...",
         "expiresAt": "..."
       }
    ===================================================== */

    if (
      !data ||
      !data.id ||
      !data.qrCode
    ) {

      console.error(
        'Resposta inesperada:',
        data
      );

      throw new Error(
        'A API não retornou os dados necessários do PIX.'
      );
    }


    currentTransactionId =
      data.id;


    /*
     * Salva o ID para consulta posterior.
     */
    localStorage.setItem(
      'pix_transaction_id',
      data.id
    );


    /*
     * Salva externalRef.
     */
    localStorage.setItem(
      'pix_external_ref',
      externalRef
    );


    /*
     * Salva expiração.
     */
    if (data.expiresAt) {

      localStorage.setItem(
        'pix_expires_at',
        data.expiresAt
      );
    }


    /* =====================================================
       MOSTRAR PIX
    ===================================================== */

    loader.style.display =
      'none';

    qrContainer.style.display =
      'block';

    copySection.style.display =
      'block';

    statusEl.style.display =
      'block';


    /*
     * Copia e cola
     */
    const pixInput =
      document.getElementById(
        'duttyfyPixCodeInput'
      );

    pixInput.value =
      data.qrCode;


    /*
     * Gerar QR Code.
     *
     * Usa qrcode-generator (kazuhikoarase) em vez do
     * qrcodejs: o código PIX do gateway vem longo e o
     * qrcodejs estoura ("code length overflow"), pois a
     * tabela de capacidade dele para cedo. Esta lib vai
     * até a versão 40 do QR (~3 KB de payload).
     */
    await waitForQRCode();


    const qr =
      qrcode(
        0,      /* typeNumber 0 = versão automática */
        'M'     /* correção de erro; sobra espaço p/ payload grande */
      );

    qr.addData(
      data.qrCode
    );

    qr.make();


    /*
     * SVG escalável — ocupa os 200px do container
     * (.duttyfy-pix-qr-code) sem perder qualidade.
     */
    qrContainer.innerHTML =
      qr.createSvgTag({
        cellSize: 4,
        margin: 4,
        scalable: true
      });

    qrContainer.style.display =
      'block';

    qrContainer.style.opacity =
      '1';


    /*
     * Começa a consultar status.
     */
    startPixPolling(
      data.id
    );


  } catch (error) {

    console.error(
      'Erro ao gerar PIX:',
      error
    );


    /*
     * Erro de validação (422): junta os campos
     * com problema em uma única mensagem.
     */
    if (
      error.status === 422 &&
      Array.isArray(error.data?.issues)
    ) {

      mostrarErroPix(
        error.data.issues
          .map(issue => {

            if (
              typeof issue === 'string'
            ) {
              return issue;
            }

            return (
              issue.message ||
              issue.error ||
              JSON.stringify(issue)
            );

          })
          .join(' | ')
      );


      return;
    }


    mostrarErroPix(
      error.message ||
      'Erro ao gerar PIX. Tente novamente.'
    );
  }
}


/* =========================================================
   CONSULTAR STATUS
========================================================= */

/**
 * Consulta:
 *
 * GET
 * /api/payments/:id/status
 * (ou a URL direta do middleware, conforme o modo
 * usado na criação da cobrança)
 *
 * Retorno oficial:
 *
 * {
 *   paid: true,
 *   status: "PAID",
 *   raw: { }
 * }
 */
async function checkPixStatus(
  transactionId
) {

  if (!transactionId) {

    throw new Error(
      'ID da transação não informado.'
    );
  }


  const bases =
    pixDirectMode
      ? [PIX_DIRECT_API, PIX_API_BASE]
      : [PIX_API_BASE, PIX_DIRECT_API];


  let lastError =
    null;


  for (const base of bases) {

    try {

      const response =
        await fetch(
          `${base}/payments/${encodeURIComponent(transactionId)}/status`,
          {
            method: 'GET',

            headers: {
              'Accept':
                'application/json'
            },

            cache:
              'no-store'
          }
        );


      let data;

      try {

        data =
          await response.json();

      } catch {

        throw Object.assign(
          new Error(
            'Resposta inválida ao consultar pagamento.'
          ),
          { pixInfra: true }
        );
      }


      if (!response.ok) {

        if (
          response.status >= 500 &&
          !pixDirectMode
        ) {

          lastError =
            Object.assign(
              new Error(
                data.error ||
                'Erro ao consultar pagamento.'
              ),
              { pixInfra: true }
            );

          continue;
        }


        throw new Error(
          data.error ||
          'Erro ao consultar pagamento.'
        );
      }


      /*
       * Sucesso — fixa o modo para as próximas.
       */
      pixDirectMode =
        base === PIX_DIRECT_API;


      return data;

    } catch (error) {

      if (
        error.pixInfra ||
        error instanceof TypeError
      ) {

        lastError =
          error;

        continue;
      }


      throw error;
    }
  }


  throw (
    lastError ||
    new Error(
      'Erro ao consultar pagamento.'
    )
  );
}


/* =========================================================
   POLLING
========================================================= */

function startPixPolling(
  transactionId
) {

  /*
   * Limpa polling anterior.
   */
  if (pixPollingInterval) {

    clearInterval(
      pixPollingInterval
    );

    pixPollingInterval =
      null;
  }


  if (pixPollingTimeout) {

    clearTimeout(
      pixPollingTimeout
    );

    pixPollingTimeout =
      null;
  }


  currentTransactionId =
    transactionId;


  const statusEl =
    document.getElementById(
      'duttyfyPixStatus'
    );


  statusEl.innerText =
    'Aguardando confirmação do pagamento...';

  statusEl.style.display =
    'block';


  /*
   * Consulta imediatamente.
   */
  checkPixPaymentNow(
    transactionId
  );


  /*
   * Depois consulta a cada 4 segundos.
   *
   * A documentação recomenda consultar de 3 em 3
   * a 5 em 5 segundos até o pagamento confirmar
   * ou o PIX expirar.
   */
  pixPollingInterval =
    setInterval(
      () => {

        checkPixPaymentNow(
          transactionId
        );

      },
      4000
    );


  /*
   * Limite de 15 minutos.
   */
  pixPollingTimeout =
    setTimeout(
      () => {

        stopPixPolling();


        mostrarErroPix(
          'Tempo expirado. Gere um novo PIX para continuar.',
          { retry: true }
        );

      },
      900000
    );
}


/* =========================================================
   CONSULTA INDIVIDUAL
========================================================= */

async function checkPixPaymentNow(
  transactionId
) {

  try {

    const data =
      await checkPixStatus(
        transactionId
      );


    console.log(
      'Status PIX:',
      data
    );


    /*
     * CAMPO OFICIAL:
     *
     * paid === true
     */
    if (
      data.paid === true
    ) {

      stopPixPolling();


      const statusEl =
        document.getElementById(
          'duttyfyPixStatus'
        );


      statusEl.innerText =
        'Pagamento confirmado!';


      statusEl.style.display =
        'block';


      /*
       * Pequeno intervalo para o cliente
       * visualizar a confirmação.
       */
      setTimeout(
        () => {

          if (
            currentSuccessUrl
          ) {

            window.location.href =
              currentSuccessUrl;
          }

        },
        700
      );


      return;
    }


    /*
     * Status oficial do gateway (sempre maiúsculo):
     *
     * PENDING  — aguardando; continua consultando
     * PAID     — pago; libera o pedido
     * EXPIRED  — venceu; oferece uma nova cobrança
     * REFUSED, FAILED, ERROR, CANCELLED
     *          — não processado; oferece uma nova cobrança
     * REFUNDED, CHARGEBACK
     *          — dinheiro devolvido; revoga o acesso
     */
    const gatewayStatus =
      String(
        data.status || ''
      ).toUpperCase();


    /*
     * Dinheiro devolvido pelo gateway.
     */
    if (
      PIX_REVOKED_STATUSES.includes(
        gatewayStatus
      )
    ) {

      stopPixPolling();


      mostrarErroPix(
        'Pagamento devolvido pelo gateway. Gere um novo PIX para continuar.',
        { retry: true }
      );


      return;
    }


    /*
     * PIX vencido.
     */
    if (
      gatewayStatus ===
      PIX_EXPIRED_STATUS
    ) {

      stopPixPolling();


      mostrarErroPix(
        'O PIX expirou. Gere um novo código para continuar.',
        { retry: true }
      );


      return;
    }


    /*
     * Recusado / falhou / erro.
     */
    if (
      PIX_FAILED_STATUSES.includes(
        gatewayStatus
      )
    ) {

      stopPixPolling();


      mostrarErroPix(
        'O pagamento não foi concluído. Gere um novo PIX.',
        { retry: true }
      );


      return;
    }


    /*
     * Continua PENDING.
     */
    const statusEl =
      document.getElementById(
        'duttyfyPixStatus'
      );


    statusEl.innerText =
      'Aguardando confirmação do pagamento...';


  } catch (error) {

    /*
     * Não interrompe o polling por um erro
     * temporário de rede.
     */
    console.error(
      'Erro ao consultar PIX:',
      error
    );
  }
}


/* =========================================================
   PARAR POLLING
========================================================= */

function stopPixPolling() {

  if (pixPollingInterval) {

    clearInterval(
      pixPollingInterval
    );

    pixPollingInterval =
      null;
  }


  if (pixPollingTimeout) {

    clearTimeout(
      pixPollingTimeout
    );

    pixPollingTimeout =
      null;
  }
}


/* =========================================================
   FECHAR MODAL
========================================================= */

function closePixModal() {

  const modal =
    document.getElementById(
      'duttyfyPixModal'
    );


  if (modal) {

    modal.classList.remove(
      'show'
    );
  }


  stopPixPolling();
}


/* =========================================================
   COPIAR PIX
========================================================= */

async function copyPixCode() {

  const input =
    document.getElementById(
      'duttyfyPixCodeInput'
    );


  const btn =
    document.getElementById(
      'duttyfyPixCopyBtn'
    );


  if (
    !input ||
    !input.value
  ) {

    return;
  }


  try {

    await navigator.clipboard.writeText(
      input.value
    );

  } catch {

    input.select();

    input.setSelectionRange(
      0,
      99999
    );

    document.execCommand(
      'copy'
    );
  }


  const originalHtml =
    btn.innerHTML;


  btn.innerHTML =
    'Copiado!';


  setTimeout(
    () => {

      btn.innerHTML =
        originalHtml;

    },
    2000
  );
}


/* =========================================================
   AGUARDAR QRCODE.JS
========================================================= */

function waitForQRCode() {

  return new Promise(
    (resolve, reject) => {

      if (
        window.qrcode
      ) {

        resolve();

        return;
      }


      let attempts =
        0;


      const interval =
        setInterval(
          () => {

            attempts++;


            if (
              window.qrcode
            ) {

              clearInterval(
                interval
              );

              resolve();

              return;
            }


            if (
              attempts >= 50
            ) {

              clearInterval(
                interval
              );

              reject(
                new Error(
                  'Não foi possível carregar o gerador de QR Code.'
                )
              );
            }

          },
          100
        );
    }
  );
}


/* =========================================================
   MOSTRAR ERRO
========================================================= */

function mostrarErroPix(
  message,
  options = {}
) {

  const loader =
    document.getElementById(
      'duttyfyPixLoader'
    );

  const errorMsg =
    document.getElementById(
      'duttyfyPixError'
    );

  const qrContainer =
    document.getElementById(
      'duttyfyPixQrCode'
    );

  const copySection =
    document.getElementById(
      'duttyfyPixCopySection'
    );

  const statusEl =
    document.getElementById(
      'duttyfyPixStatus'
    );


  if (loader) {

    loader.style.display =
      'none';
  }


  if (qrContainer) {

    qrContainer.style.display =
      'none';
  }


  if (copySection) {

    copySection.style.display =
      'none';
  }


  if (statusEl) {

    statusEl.style.display =
      'none';
  }


  if (errorMsg) {

    errorMsg.style.display =
      'block';
  }


  /*
   * Texto do erro fica no span interno,
   * para não apagar o botão de retry.
   */
  const errorText =
    document.getElementById(
      'duttyfyPixErrorText'
    );


  if (errorText) {

    errorText.innerText =
      message ||
      'Erro ao gerar PIX. Tente novamente.';
  }


  /*
   * Botão "Gerar novo PIX" — exibido quando o
   * erro permite tentar uma nova cobrança
   * (expirado, recusado, timeout etc.).
   */
  const retryBtn =
    document.getElementById(
      'duttyfyPixRetryBtn'
    );


  if (retryBtn) {

    retryBtn.style.display =
      options.retry
        ? 'inline-flex'
        : 'none';
  }
}


/* =========================================================
   TENTAR NOVAMENTE
========================================================= */

/**
 * Repete a última chamada de openPixModal com os
 * mesmos dados — usado pelo botão "Gerar novo PIX".
 */
function retryPixModal() {

  if (
    !lastPixRequest
  ) {

    closePixModal();

    return;
  }


  openPixModal(
    lastPixRequest.amountCents,
    lastPixRequest.itemTitle,
    lastPixRequest.successUrl,
    lastPixRequest.options
  );
}


/* =========================================================
   CONSULTAR ÚLTIMA TRANSAÇÃO SALVA
========================================================= */

/**
 * Útil caso o cliente recarregue a página.
 */
async function checkLastPixPayment() {

  const transactionId =
    localStorage.getItem(
      'pix_transaction_id'
    );


  if (!transactionId) {

    return null;
  }


  try {

    return await checkPixStatus(
      transactionId
    );

  } catch (error) {

    console.error(
      'Erro ao consultar último PIX:',
      error
    );

    return null;
  }
}


/* =========================================================
   EXPORTAR FUNÇÕES
========================================================= */

window.openPixModal =
  openPixModal;

window.closePixModal =
  closePixModal;

window.copyPixCode =
  copyPixCode;

window.checkPixStatus =
  checkPixStatus;

window.startPixPolling =
  startPixPolling;

window.checkLastPixPayment =
  checkLastPixPayment;

window.retryPixModal =
  retryPixModal;