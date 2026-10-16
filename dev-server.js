/**
 * Servidor local de desenvolvimento.
 *
 * Serve o site estático + as rotas /api/payments e
 * /api/payments/:id/status (o mesmo código que roda na Vercel),
 * sem precisar de `vercel dev` nem deploy.
 *
 * Uso:
 *   node dev-server.js
 *
 * Depois abra:
 *   http://localhost:5501
 *
 * Dica: pare o Live Server (porta 5500) para não confundir.
 * A porta 3000 costuma estar ocupada por outros serviços.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5501;

const createPayment = require('./api/payments/index.js');
const checkStatus = require('./api/payments/[id]/status.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/*
 * Adapta o formato das funções (estilo Vercel:
 * req.body / req.query + res.status().json()) para o
 * http nativo do Node.
 */
function runApiHandler(handler, apiReq, apiRes) {
  const fakeRes = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      Object.entries(this.headers).forEach(([k, v]) =>
        apiRes.setHeader(k, v)
      );
      apiRes.writeHead(this.statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      apiRes.end(JSON.stringify(body));
      return this;
    },
  };

  handler(apiReq, fakeRes);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Body não é JSON válido.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let relPath = decodeURIComponent(pathname);
  if (relPath.endsWith('/')) relPath += 'index.html';

  const filePath = path.normalize(path.join(ROOT, relPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Acesso negado.');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado: ' + relPath);
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  try {
    /*
     * POST /api/payments — cria cobrança
     */
    if (pathname === '/api/payments' && req.method === 'POST') {
      const body = await readBody(req);
      return runApiHandler(
        createPayment,
        { method: 'POST', headers: req.headers, body, query: {} },
        res
      );
    }

    /*
     * GET /api/payments/:id/status — consulta pagamento
     */
    const statusMatch = pathname.match(/^\/api\/payments\/([^/]+)\/status$/);
    if (statusMatch && req.method === 'GET') {
      return runApiHandler(
        checkStatus,
        {
          method: 'GET',
          headers: req.headers,
          body: {},
          query: { id: statusMatch[1] },
        },
        res
      );
    }

    /*
     * Resto: arquivos estáticos
     */
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Método não permitido.');
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error('Erro no servidor:', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Erro interno do servidor local.' }));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Site + API rodando em:');
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  Abra qualquer página (ex.: /up1/index.html)');
  console.log('  e teste o modal PIX.');
  console.log('');
});