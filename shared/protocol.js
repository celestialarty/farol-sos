// Protocolo Farol SOS — formato único de alerta usado por todos os canais:
// internet (JSON), SMS (texto compacto) e retransmissão entre aparelhos próximos.

const TIPOS = {
  M: 'medico',
  F: 'fogo',
  V: 'violencia',
  A: 'acidente',
  D: 'desastre',
  P: 'perdido',
  O: 'outro',
};
const TIPO_PARA_CODIGO = Object.fromEntries(Object.entries(TIPOS).map(([k, v]) => [v, k]));

const TTL_PADRAO = 6; // número máximo de saltos entre aparelhos
const TAMANHO_MAX_SMS = 160;

function novoId() {
  // 8 caracteres base36: curto o bastante para caber num SMS
  const t = Date.now().toString(36).slice(-5);
  const r = Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0');
  return (t + r).toUpperCase();
}

function criarAlerta({ tipo = 'outro', lat, lon, mensagem = '', origem = '', id, criadoEm } = {}) {
  if (!Object.values(TIPOS).includes(tipo)) tipo = 'outro';
  return {
    id: id || novoId(),
    tipo,
    lat: numeroOuNulo(lat),
    lon: numeroOuNulo(lon),
    mensagem: String(mensagem).slice(0, 280),
    origem: String(origem).slice(0, 40),
    criadoEm: criadoEm || new Date().toISOString(),
    ttl: TTL_PADRAO,
    saltos: 0,
    caminho: [],
  };
}

function numeroOuNulo(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? Math.round(n * 1e5) / 1e5 : null;
}

// ---------- SMS ----------
// Formato: SOS*<id>*<tipo>*<lat>,<lon>*<mensagem>
// Ex.:     SOS*LQ3K9A2B*M*-19.93,-44.85*caido na rua 7
// Campos podem ficar vazios: SOS**F**incendio no galpao

function paraSms(alerta) {
  const cod = TIPO_PARA_CODIGO[alerta.tipo] || 'O';
  const pos = alerta.lat != null && alerta.lon != null ? `${alerta.lat},${alerta.lon}` : '';
  const base = `SOS*${alerta.id}*${cod}*${pos}*`;
  return base + alerta.mensagem.slice(0, Math.max(0, TAMANHO_MAX_SMS - base.length));
}

function deSms(texto, remetente = '') {
  if (typeof texto !== 'string') return null;
  const limpo = texto.trim();
  if (!/^sos\b/i.test(limpo)) return null;

  const partes = limpo.split('*');
  if (partes.length >= 5) {
    const [, id, cod, pos, ...resto] = partes;
    const [lat, lon] = (pos || '').split(',');
    return criarAlerta({
      id: /^[A-Z0-9]{4,12}$/i.test(id) ? id.toUpperCase() : undefined,
      tipo: TIPOS[(cod || 'O').toUpperCase()] || 'outro',
      lat,
      lon,
      mensagem: resto.join('*').trim(),
      origem: remetente,
    });
  }
  // Texto livre: "SOS preciso de ajuda" — ainda vale como alerta
  return criarAlerta({ mensagem: limpo.replace(/^sos\s*/i, ''), origem: remetente });
}

// ---------- Retransmissão (mesh) ----------
// Cada aparelho que recebe um alerta de outro aparelho chama relay():
// - descarta se já viu o id (evita loop)
// - descarta se o TTL acabou
// - registra o próprio salto e devolve o alerta pronto para repassar

function relay(alerta, idAparelho, jaVistos) {
  if (!alerta || !alerta.id) return null;
  if (jaVistos.has(alerta.id)) return null;
  jaVistos.add(alerta.id);
  if (alerta.ttl <= 0) return null;
  return {
    ...alerta,
    ttl: alerta.ttl - 1,
    saltos: (alerta.saltos || 0) + 1,
    caminho: [...(alerta.caminho || []), idAparelho].slice(-TTL_PADRAO),
  };
}

function validar(alerta) {
  const erros = [];
  if (!alerta || typeof alerta !== 'object') return ['alerta ausente'];
  if (!alerta.id) erros.push('id obrigatório');
  if (!Object.values(TIPOS).includes(alerta.tipo)) erros.push('tipo inválido');
  if (alerta.lat != null && (alerta.lat < -90 || alerta.lat > 90)) erros.push('lat fora do intervalo');
  if (alerta.lon != null && (alerta.lon < -180 || alerta.lon > 180)) erros.push('lon fora do intervalo');
  return erros;
}

const api = { TIPOS, TTL_PADRAO, criarAlerta, paraSms, deSms, relay, validar, novoId };
if (typeof module !== 'undefined') module.exports = api;
if (typeof window !== 'undefined') window.FarolProtocolo = api;
