const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
process.env.DATA_FILE = path.join(os.tmpdir(), `farol-teste-${process.pid}.json`);
const P = require('../shared/protocol');
const { servidor, _limpar } = require('../server/index');

test('SMS ida e volta preserva o alerta', () => {
  const a = P.criarAlerta({ tipo: 'medico', lat: -19.93121, lon: -44.85, mensagem: 'caido na rua 7' });
  const sms = P.paraSms(a);
  assert.ok(sms.length <= 160);
  const b = P.deSms(sms, '+5531999990000');
  assert.equal(b.id, a.id);
  assert.equal(b.tipo, 'medico');
  assert.equal(b.lat, -19.93121);
  assert.equal(b.mensagem, 'caido na rua 7');
  assert.equal(b.origem, '+5531999990000');
});

test('SMS em texto livre começando com SOS vira alerta', () => {
  const a = P.deSms('sos preciso de ajuda na estrada');
  assert.equal(a.tipo, 'outro');
  assert.equal(a.mensagem, 'preciso de ajuda na estrada');
  assert.equal(P.deSms('oi tudo bem'), null);
});

test('retransmissão descarta repetidos e respeita o TTL', () => {
  const vistos = new Set();
  let a = P.criarAlerta({ tipo: 'fogo' });
  const r1 = P.relay(a, 'A', vistos);
  assert.equal(r1.saltos, 1);
  assert.equal(P.relay(a, 'A', vistos), null, 'mesmo id não é repassado duas vezes');
  let atual = r1;
  for (let i = 0; i < P.TTL_PADRAO - 1; i++) atual = P.relay(atual, 'X' + i, new Set());
  assert.equal(atual.ttl, 0);
  assert.equal(P.relay(atual, 'Z', new Set()), null, 'TTL zerado para de propagar');
});

test('servidor junta o mesmo alerta vindo por internet, SMS e retransmissão', async () => {
  _limpar();
  await new Promise(ok => servidor.listen(0, ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const a = P.criarAlerta({ tipo: 'acidente', lat: -19.9, lon: -44.8, mensagem: 'colisao BR-262' });

    let r = await fetch(`${base}/api/alertas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    assert.equal(r.status, 201);

    r = await fetch(`${base}/api/sms`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ Body: P.paraSms(a), From: '+5537999990000' }).toString() });
    assert.equal(r.status, 200);

    const repassado = P.relay(a, 'R1', new Set());
    await fetch(`${base}/api/alertas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(repassado) });

    const lista = await (await fetch(`${base}/api/alertas`)).json();
    assert.equal(lista.length, 1);
    assert.deepEqual(lista[0].canais.sort(), ['internet', 'retransmissao', 'sms']);
    assert.equal(lista[0].recebimentos, 3);

    r = await fetch(`${base}/api/alertas/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'resolvido' }) });
    assert.equal((await r.json()).status, 'resolvido');
  } finally {
    servidor.close();
  }
});
