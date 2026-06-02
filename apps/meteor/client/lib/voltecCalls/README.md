# Voltec WebRTC Calls

Chamadas de voz/vídeo 1:1 próprias (MIT), independentes do `media-calls` Enterprise.
Arquitetura em camadas: um **núcleo WebRTC puro** (sem dependências do Rocket.Chat) +
uma **camada de integração** RC (transporte de sinalização DDP, método servidor, UI).

## Estrutura

```
client/lib/voltecCalls/
  definitions.ts        # tipos + contrato SignalingTransport (puro)
  Emitter.ts            # emitter tipado mínimo (puro)
  WebRTCCallSession.ts  # motor: RTCPeerConnection, mídia, ICE, mute/vídeo (puro)
  CallManager.ts        # orquestrador: entrada/saída, sessão atual (puro)
  index.ts              # barrel do núcleo
  integration/          # TEMPLATES .ts.example (não compilados até ativar)
    ddpSignaling.ts.example      # SignalingTransport via sdk.stream + método
    bootstrap.client.ts.example  # liga o CallManager no login
server/lib/voltec/
  voltecCallSignaling.server.ts.example  # método voltec:call:signal (relay)
  settings.server.ts.example             # settings STUN/TURN
```

O **núcleo** (`definitions`, `Emitter`, `WebRTCCallSession`, `CallManager`, `index`)
é `.ts` real, compilado e testável — **zero imports do RC**. A **integração** vem como
`.ts.example` para não entrar no typecheck/CI antes de você buildar e validar.

## Fluxo de sinalização

```
caller.startCall(uid)                      callee
   │ offer ─► método voltec:call:signal ─► api.broadcast('notify.voltecCall')
   │                                          └► notifyUser(uid,'voltec-call') ─► stream
   │                                                       ▼
   │                                          CallManager 'incoming' ─► UI accept/reject
   ◄──────────── answer / ICE (mesma rota, sentido inverso) ───────────►
                         RTCPeerConnection ⇄ mídia (P2P, via STUN/TURN)
```

Caller é o peer "impolite"; callee é "polite" (perfect-negotiation para glare).
Candidatos ICE que chegam antes da `accept()` são bufferizados e reaplicados.

## Checklist de ativação (requer build Meteor)

1. **Tipo compartilhado** — `packages/core-typings/src/voltec/IVoltecCall.ts`:

   ```ts
   export type VoltecCallSignal =
     | { kind: 'offer'; callId: string; sdp: RTCSessionDescriptionInit; video: boolean }
     | { kind: 'answer'; callId: string; sdp: RTCSessionDescriptionInit }
     | { kind: 'candidate'; callId: string; candidate: RTCIceCandidateInit }
     | { kind: 'hangup'; callId: string; reason?: string }
     | { kind: 'reject'; callId: string; reason?: string };
   export type VoltecCallEnvelope = { to: string; from?: string; signal: VoltecCallSignal };
   ```
   e em `packages/core-typings/src/index.ts`: `export * from './voltec/IVoltecCall';`

2. **Stream tipado** — em `packages/ddp-client/src/types/streams.ts`, dentro do array
   `'notify-user'`, adicione:

   ```ts
   { key: `${string}/voltec-call`; args: [import('@rocket.chat/core-typings').VoltecCallEnvelope] },
   ```

3. **Evento de broadcast** — em `packages/core-services/src/events/Events.ts` (interface
   `EventSignatures`):

   ```ts
   'notify.voltecCall'(uid: string, data: import('@rocket.chat/core-typings').VoltecCallEnvelope): void;
   ```

4. **Listener** — junto dos outros `notify.*`, mapeie o broadcast para o streamer
   (no módulo de listeners que injeta `notifications`):

   ```ts
   listener.onNotifyUser?.(); // padrão existente
   // ou, no listeners.module:
   notifications.notifyUser(uid, 'voltec-call', data);
   ```

5. **Método + settings (servidor)** — renomeie
   `server/lib/voltec/voltecCallSignaling.server.ts.example` → `.ts` e
   `settings.server.ts.example` → `.ts`; importe ambos a partir de
   `server/main.ts` / `server/settings/index.ts`.

6. **Transporte + bootstrap (client)** — renomeie
   `integration/ddpSignaling.ts.example` e `integration/bootstrap.client.ts.example`
   para `.ts`, ajuste os caminhos relativos, e adicione
   `import './startup/voltecCalls'` em `client/main.ts`.

7. **UI** — modal de chamada recebida + barra em-chamada (aceitar/recusar, mudo,
   vídeo on/off), consumindo `callManager` (eventos `incoming`/`statechange`/`ended`).

8. **STUN/TURN** — suba um **coturn** e configure em
   Admin → `Voltec_Calls` → `Voltec_Call_ICE_Servers`.

9. `yarn dev` e teste 1:1 entre dois usuários.

## Uso da API do núcleo (referência)

```ts
import { CallManager } from '@/client/lib/voltecCalls';

const manager = new CallManager({ localUserId, transport, getConfig });
manager.on('incoming', ({ from, video }) => {/* mostrar modal */});
manager.start();

await manager.startCall(remoteUserId, { video: true }); // ligar
await manager.accept({ video: true });                  // atender
manager.hangup();                                       // desligar
```
