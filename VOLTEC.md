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

### 🧰 Fase 2 — FOSS-ização robusta (toolkit entregue, execução no seu ambiente)

O script oficial `scripts/fossify.ts` apaga `ee/` inteiro e troca o entrypoint, **mas
quebra o build**: `@rocket.chat/license` (em `ee/packages/license`) é importado como
valor por **21 arquivos do core**; e `media-calls`, `presence`, `federation-matrix`,
`omnichannel-services` são importados estaticamente por serviços do core.

**Por que não commitamos a remoção pronta:** deletar pacotes exige `yarn install`
(senão o CI com `--immutable` falha) e quebra imports do core que precisam de
ajuste + verificação de build — algo que **não roda neste container efêmero**.
Commitar a árvore quebrada seria pior que inútil.

**Entregue:**
- `scripts/voltec-fossify.ts` (`yarn voltec-fossify`) — remove `ee/apps` e os pacotes
  de feature de `ee/packages/*` **mantendo `license`**, e troca o entrypoint p/ FOSS.
- `docs/voltec-foss.md` — mapa completo dos acoplamentos core→enterprise e as edições
  exatas para o build voltar a passar.

> Rode `yarn voltec-fossify` no seu ambiente de build, aplique os ajustes do guia,
> e valide com `yarn install && yarn typecheck && yarn dev`.
>
> **Alternativa de risco zero:** rodar como *Community dormante* (sem chave de
> licença → enterprise já desligado), sem remover nada.

### 🚧 Fase 3 — Chamadas WebRTC próprias (núcleo entregue)

Módulo novo e isolado (MIT), independente do `media-calls` Enterprise, em
`apps/meteor/client/lib/voltecCalls/` (veja o `README.md` de lá).

**Entregue (puro, `.ts` compilável, sem imports do RC — só DOM/`react`):**
- `WebRTCCallSession` — motor: `RTCPeerConnection`, mídia (getUserMedia),
  ICE com buffering, mute/vídeo, lifecycle/estados.
- `CallManager` — orquestrador: chamada de entrada/saída, sessão atual,
  accept/reject/hangup, perfect-negotiation (polite/impolite).
- `definitions.ts` (contrato `SignalingTransport`) + `Emitter` tipado.
- `react/useCallManager` — eventos → estado React + ações; `useMediaStreamRef`.

**Templates de integração (`.ts(x).example`, ativar quando puder buildar):**
- `integration/ddpSignaling` — transporte via `sdk.stream` + método servidor.
- `integration/bootstrap.client` — liga o manager no login (ICE das settings).
- `integration/ui/` — `VoltecCallUI` (container), `IncomingCallModal`,
  `CallScreen`, `StartCallButton` (Fuselage/i18n).
- `server/lib/voltec/voltecCallSignaling.server` — método `voltec:call:signal`.
- `server/lib/voltec/settings.server` — settings STUN/TURN.

**Pendente (precisa de build):** plumbing de tipos nos pacotes compartilhados
(core-typings, ddp-client/streams, core-services/Events) + listener + montar a UI
no shell + chaves i18n + **coturn** (STUN/TURN).
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

## Deploy de produção (Docker)

Ambiente completo em `docker/` (Rocket.Chat + MongoDB replica set + Traefik/TLS +
coturn para WebRTC):

```bash
cp docker/.env.example docker/.env   # edite DOMAIN, TLS_EMAIL, ADMIN_*, TURN_*
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build
```

Guia completo (build da imagem, TLS, TURN/WebRTC, backups): **`docs/voltec-docker.md`**.
