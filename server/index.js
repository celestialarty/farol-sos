// Servidor Farol SOS — recebe alertas por internet, SMS e retransmissão,
// guarda, remove duplicados e empurra tudo ao vivo para o painel (SSE).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');
const P = require('../shared/protocol');

const PORTA = Number(process.env.PORT) || 3000;
const ARQUIVO_DADOS = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'alertas.json');
const TOKEN_GATEWAY = process.env.SMS_GATEWAY_TOKEN || ''; // protege o webhook de SMS
const PUBLICO = path.join(__dirname, '..', 'public');
const COMPARTILHADO = path.join(__dirname, '..', 'shared');

// ---------- armazenamento ----------
let alertas = carregar();
function carregar() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_DADOS, 'utf8')); } catch { return []; }
}
function salvar() {
  fs.mkdirSync(path.dirname(ARQUIVO_DADOS), { recursive: true });
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(alertas.slice(-5000), null, 1));
}

// ---------- painel ao vivo (Server-Sent Events) ----------
const clientes = new Set();
function transmitir(evento, dados) {
  const msg = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const res of clientes) res.write(msg);
}

// Junta o mesmo alerta chegando por canais diferentes (ex.: SMS + 3 retransmissões)
function registrar(alerta, canal) {
  const existente = alertas.find(a => a.id === alerta.id);
  if (existente) {
    if (!existente.canais.includes(canal)) existente.canais.push(canal);
    existente.recebimentos += 1;
    existente.saltos = Math.min(existente.saltos, alerta.saltos || 0);
    if (existente.lat == null && alerta.lat != null) { existente.lat = alerta.lat; existente.lon = alerta.lon; }
    salvar();
    transmitir('atualizado', existente);
    return { alerta: existente, novo: false };
  }
  const registro = { ...alerta, canais: [canal], recebimentos: 1, recebidoEm: new Date().toISOString(), status: 'aberto' };
  alertas.push(registro);
  salvar();
  transmitir('novo', registro);
  return { alerta: registro, novo: true };
}

// ---------- utilidades HTTP ----------
function lerCorpo(req, limite = 64 * 1024) {
  return new Promise((ok, falha) => {
    let dados = '';
    req.on('data', c => { dados += c; if (dados.length > limite) { falha(new Error('corpo grande demais')); req.destroy(); } });
    req.on('end', () => ok(dados));
    req.on('error', falha);
  });
}
function json(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(corpo));
}
const TIPOS_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
function servirArquivo(res, raiz, relativo) {
  const alvo = path.normalize(path.join(raiz, relativo));
  if (!alvo.startsWith(raiz)) return json(res, 403, { erro: 'proibido' });
  fs.readFile(alvo, (err, conteudo) => {
    if (err) return json(res, 404, { erro: 'não encontrado' });
    res.writeHead(200, { 'Content-Type': TIPOS_MIME[path.extname(alvo)] || 'application/octet-stream' });
    res.end(conteudo);
  });
}

// ---------- rotas ----------
async function rotear(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rota = `${req.method} ${url.pathname}`;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // Alerta enviado pelo app/página com internet, ou por um aparelho que retransmitiu
  if (rota === 'POST /api/alertas') {
    let corpo;
    try { corpo = JSON.parse(await lerCorpo(req)); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
    const lista = Array.isArray(corpo) ? corpo : [corpo]; // aceita lote (fila offline)
    const resultados = [];
    for (const item of lista) {
      const alerta = item.id ? { ...P.criarAlerta(item), ttl: item.ttl ?? P.TTL_PADRAO, saltos: item.saltos || 0, caminho: item.caminho || [] } : P.criarAlerta(item);
      const erros = P.validar(alerta);
      if (erros.length) { resultados.push({ id: alerta.id, erros }); continue; }
      const canal = alerta.saltos > 0 ? 'retransmissao' : 'internet';
      const { novo } = registrar(alerta, canal);
      resultados.push({ id: alerta.id, novo });
    }
    return json(res, 201, { resultados });
  }

  // Webhook de SMS. Funciona com Twilio (form-urlencoded: Body, From),
  // com gateways Android tipo "SMS Gateway" (JSON: message, phoneNumber) e com JSON genérico {texto, de}.
  if (rota === 'POST /api/sms') {
    if (TOKEN_GATEWAY && url.searchParams.get('token') !== TOKEN_GATEWAY) return json(res, 401, { erro: 'token inválido' });
    const bruto = await lerCorpo(req);
    let texto, de;
    if ((req.headers['content-type'] || '').includes('application/json')) {
      try {
        const j = JSON.parse(bruto);
        const p = j.payload || j;
        texto = p.texto || p.message || p.Body || p.text;
        de = p.de || p.phoneNumber || p.From || p.from;
      } catch { return json(res, 400, { erro: 'JSON inválido' }); }
    } else {
      const f = new URLSearchParams(bruto);
      texto = f.get('Body'); de = f.get('From');
    }
    const alerta = P.deSms(texto, de || '');
    if (!alerta) return json(res, 200, { ignorado: true, motivo: 'mensagem não começa com SOS' });
    const { novo } = registrar(alerta, 'sms');
    if ((req.headers.accept || '').includes('xml') || req.headers['x-twilio-signature']) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end(`<Response><Message>Farol SOS: alerta ${alerta.id} recebido.</Message></Response>`);
    }
    return json(res, 200, { id: alerta.id, novo });
  }

  if (rota === 'GET /api/alertas') return json(res, 200, alertas.slice().reverse());

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/alertas/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    const alerta = alertas.find(a => a.id === id);
    if (!alerta) return json(res, 404, { erro: 'alerta não existe' });
    let corpo;
    try { corpo = JSON.parse(await lerCorpo(req)); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
    if (['aberto', 'atendendo', 'resolvido'].includes(corpo.status)) alerta.status = corpo.status;
    salvar();
    transmitir('atualizado', alerta);
    return json(res, 200, alerta);
  }

  if (rota === 'GET /api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clientes.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clientes.delete(res); });
    return;
  }

  if (rota === 'GET /api/saude') return json(res, 200, { ok: true, alertas: alertas.length, paineis: clientes.size });

  if (req.method === 'GET' && url.pathname.startsWith('/shared/')) return servirArquivo(res, COMPARTILHADO, url.pathname.slice(8));
  if (req.method === 'GET') {
    const arquivo = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return servirArquivo(res, PUBLICO, arquivo);
  }
  json(res, 404, { erro: 'rota não encontrada' });
}

const servidor = http.createServer((req, res) => {
  rotear(req, res).catch(err => { console.error(err); if (!res.headersSent) json(res, 500, { erro: 'erro interno' }); });
});

if (require.main === module) {
  servidor.listen(PORTA, () => console.log(`Farol SOS rodando em http://localhost:${PORTA}  (painel: /  ·  botão SOS: /sos.html)`));
}
module.exports = { servidor, registrar, _limpar: () => { alertas = []; } };
