# Voltec — Comunicação Interna

Versão interna da empresa baseada no fork do Rocket.Chat (Community Edition / FOSS).
Objetivo: chat de equipes + **chamadas de voz/vídeo próprias (WebRTC)**, entregue como
**PWA instalável** no Android e iPhone.

## Decisões de arquitetura

| Tema | Decisão |
| --- | --- |
| **Base** | Fork do Rocket.Chat (monorepo, Meteor) — `apps/meteor` |
| **Edição** | **FOSS / Community** (MIT). Sem ativar recursos pagos Enterprise. |
| **Chamadas** | **WebRTC próprio**, autohospedado (sinalização via DDP/WebSocket + STUN/TURN). |
| **App** | **PWA** — evolução do web client atual (instalável, offline, push). |

### Por que FOSS / Community e não Enterprise

Todo código sob `ee/` e `apps/meteor/ee/` está sob a **licença comercial Enterprise**
(`apps/meteor/ee/LICENSE`), que exige assinatura paga para uso **em produção**. Como o
uso é interno/produção, **não** ativamos nem destravamos recursos Enterprise. O recurso
de chamadas Enterprise (`ee/packages/media-calls`, VoIP) **não** será usado — em vez
disso construímos um stack WebRTC próprio (MIT).

O `@rocket.chat/license` (em `ee/packages/license`) é o *portão* de licenciamento:
sem chave válida, ele reporta "community" e mantém os recursos pagos desligados — que é
exatamente o comportamento desejado.

## Roteiro

### ✅ Fase 1 — Fundação Voltec + PWA (concluída)

- `apps/meteor/public/images/manifest.json` — manifest PWA moderno (nome Voltec,
  `display: standalone`, `theme_color`, `scope`, `id`, `shortcuts`, categorias).
- `apps/meteor/client/views/root/AppRoot.tsx` — meta tags PWA: `theme-color`,
  `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`,
  `application-name`, `msapplication-TileColor`.
- `apps/meteor/public/enc.js` — bloco **aditivo e isolado** de offline (network-first
  só para navegações, com fallback ao app-shell em cache). Coexiste com o service worker
  E2E existente no mesmo escopo `/`. Remover o bloco desabilita o offline.
- `apps/meteor/server/settings/general.ts` — `Site_Name` padrão = `Voltec`.

**Instalável já?** Sim. O `enc.js` já possui um `fetch` handler (critério de
instalabilidade do Chrome) e agora há manifest + meta completos. No iOS, "Adicionar à
Tela de Início" funciona com manifest + meta tags.

### ⏳ Fase 2 — FOSS-ização robusta (planejada)

O script oficial `scripts/fossify.ts` apaga `ee/` inteiro e troca o entrypoint, **mas
quebra o build**: `@rocket.chat/license` (em `ee/packages/license`) é importado como
valor por **21 arquivos do core**, e `apps/meteor/server/main.ts` + 2 hooks do client
importam de `../ee`.

Plano robusto:
1. **Manter** `ee/packages/license` (o portão community).
2. Remover pacotes de *features* Enterprise de `ee/packages/` (ex.: `media-calls`,
   `abac`, `federation-matrix`, `omni-core-ee`) — **verificando antes** se cada um é
   importado pelo core (alguns como `presence`/`pdf-worker` podem ser dependências).
3. Remover `ee/apps/` (microserviços de escala — opcionais).
4. Remover `apps/meteor/ee` e religar as poucas referências do core
   (`main.ts` → startup FOSS no-op; 2 hooks do client).
5. Trocar `startRocketChat.ts` pela versão FOSS.

> Requer verificação de build (Meteor) em ambiente apropriado.

### 🚧 Fase 3 — Chamadas WebRTC próprias (núcleo entregue)

Módulo novo e isolado (MIT), independente do `media-calls` Enterprise, em
`apps/meteor/client/lib/voltecCalls/` (veja o `README.md` de lá).

**Entregue (núcleo puro, `.ts` compilável, sem imports do RC):**
- `WebRTCCallSession` — motor: `RTCPeerConnection`, mídia (getUserMedia),
  ICE com buffering, mute/vídeo, lifecycle/estados.
- `CallManager` — orquestrador: chamada de entrada/saída, sessão atual,
  accept/reject/hangup, perfect-negotiation (polite/impolite).
- `definitions.ts` (contrato `SignalingTransport`) + `Emitter` tipado.

**Templates de integração (`.ts.example`, ativar quando puder buildar):**
- `integration/ddpSignaling` — transporte via `sdk.stream` + método servidor.
- `integration/bootstrap.client` — liga o manager no login (ICE das settings).
- `server/lib/voltec/voltecCallSignaling.server` — método `voltec:call:signal`.
- `server/lib/voltec/settings.server` — settings STUN/TURN.

**Pendente (precisa de build):** plumbing de tipos nos pacotes compartilhados
(core-typings, ddp-client/streams, core-services/Events) + listener + **UI**
(modal de chamada recebida e barra em-chamada) + **coturn** (STUN/TURN).
Checklist completo em `apps/meteor/client/lib/voltecCalls/README.md`.

> 1:1 primeiro; grupo depois (mesh → SFU).

## Branding / Assets

O nome e cores já estão aplicados. Para os **ícones** (logo Voltec), substitua os
assets servidos em `/assets/` via **Admin → Layout → Assets** (favicon 192/512,
touch icon 180, tile 144, safari pinned), ou troque os arquivos em
`apps/meteor/public/images/`. Recomenda-se adicionar um **ícone maskable** dedicado
(com zona de segurança) ao `manifest.json` para melhor aparência no Android.

## Build / Run

Monorepo Meteor. Em ambiente de desenvolvimento:

```bash
yarn               # instala dependências (workspaces)
yarn dev           # sobe o apps/meteor em modo dev (requer MongoDB)
```

> O build completo do Meteor exige MongoDB, bastante RAM e tempo; não roda em
> containers efêmeros mínimos.
