# Farol SOS

Sistema de alertas de emergência que chega na tela da central **mesmo quando quem pede socorro não tem internet**. Um alerta pode viajar por três caminhos, e o painel junta todos num só:

| Canal | Do que precisa | Como funciona |
|---|---|---|
| **Internet** | Dados móveis ou Wi-Fi | O botão SOS envia direto para o servidor |
| **SMS (rede da operadora)** | Só sinal do chip, sem plano de dados | O celular manda um SMS compacto para o número do gateway, que repassa ao servidor |
| **Retransmissão por aparelho próximo** | Alguém perto com internet | Quem está sem rede mostra um QR; quem escaneia repassa o alerta. Se essa pessoa também estiver sem rede, vira mais um elo da corrente |

O mesmo alerta chegando por vários caminhos (ex.: SMS + 2 repasses) aparece **uma vez só** no painel, com os canais marcados.

## Rodar

```bash
npm start          # http://localhost:3000
npm test
```

- **Painel da central:** `http://localhost:3000/` — lista ao vivo, mapa, som, notificação, botões *Atendendo* / *Resolvido*
- **Botão SOS:** `http://localhost:3000/sos.html` — segurar 1 s para enviar (evita disparo no bolso). Instalável como app (PWA) e abre offline.

Não tem dependências: só Node 20+.

## Configurar o canal SMS

O servidor recebe SMS em `POST /api/sms`. Escolha um gateway:

**Opção A — Celular Android com chip (mais barato).** Instale um app de gateway SMS (ex.: *SMS Gateway for Android*, *httpSMS*) num celular com chip ativo e configure o webhook para:
```
https://SEU-SERVIDOR/api/sms?token=SEU_TOKEN
```

**Opção B — Twilio (ou similar).** Compre um número e aponte o webhook de mensagens recebidas para a mesma URL. O servidor responde em TwiML confirmando o recebimento a quem enviou.

Depois, abra uma vez `/sos.html?sms=+55319XXXXXXXX` em cada celular para gravar o número do gateway.

Variáveis de ambiente:

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `SMS_GATEWAY_TOKEN` | vazio | Se definido, o webhook de SMS exige `?token=` |
| `DATA_FILE` | `data/alertas.json` | Onde os alertas ficam salvos |

### Formato do SMS

```
SOS*<id>*<tipo>*<lat>,<lon>*<mensagem>
SOS*LQ3K9A2B*M*-19.93,-44.85*caido na rua 7
```
Tipos: `M` médico · `F` fogo · `V` violência · `A` acidente · `D` desastre · `P` perdido · `O` outro.
Qualquer SMS que comece com **SOS** em texto livre também vira alerta — quem não tem o app ainda consegue pedir ajuda.

## API

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/alertas` | Envia um alerta ou um lote (fila offline) |
| `POST` | `/api/sms` | Webhook do gateway SMS (Twilio, apps Android ou `{texto, de}`) |
| `GET` | `/api/alertas` | Lista os alertas |
| `PATCH` | `/api/alertas/:id` | Muda o status: `aberto`, `atendendo`, `resolvido` |
| `GET` | `/api/stream` | Eventos ao vivo (SSE): `novo`, `atualizado` |
| `GET` | `/api/saude` | Status do servidor |

## Protocolo de retransmissão

Fica em `shared/protocol.js` e é o mesmo no servidor, na página e no futuro app. Cada alerta tem `id` único, `ttl` (máximo de 6 saltos) e `caminho` (aparelhos por onde passou). Cada aparelho que repassa descarta ids já vistos (sem loop) e para quando o TTL zera.

## Limites — o que a rede da operadora permite e o que não permite

- **Alerta na tela de todo mundo da região (Cell Broadcast / Defesa Civil Alerta)** é exclusivo das operadoras e da Defesa Civil, por regulamentação da Anatel. Um app de terceiros **não consegue** disparar esse tipo de alerta. O Farol SOS usa SMS comum, que qualquer chip envia.
- **Celular sem nenhum sinal** (nem SMS) depende de alguém perto. Na versão web isso é feito por QR, porque navegadores não podem anunciar Bluetooth.
- **Não substitui o 190, 192 e 193.** Em risco imediato, ligue para eles; a ligação de emergência funciona até sem chip.

## Próximos passos (roadmap)

1. **App Android nativo** com retransmissão automática por Bluetooth LE e Wi-Fi Direct (Google Nearby Connections): o celular sem rede anuncia o alerta e qualquer aparelho com o app por perto repassa sozinho, sem precisar escanear nada. O formato do alerta já é o de `shared/protocol.js`.
2. Envio automático de SMS pelo app (no Android, com permissão `SEND_SMS`) quando a internet falhar.
3. Banco de dados (SQLite/Postgres) e login para operadores da central.
4. Assinatura dos alertas para impedir alertas falsos.

## Licença

MIT
