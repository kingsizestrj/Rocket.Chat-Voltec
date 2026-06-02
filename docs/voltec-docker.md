# Voltec — Deploy de produção em Docker

Sobe todo o ambiente: **Rocket.Chat (sua imagem Voltec) + MongoDB (replica set) +
Traefik (proxy reverso + TLS) + coturn (TURN para WebRTC)**.

Arquivos em `docker/`: `docker-compose.yml`, `.env.example`, `Dockerfile.voltec`,
`coturn/turnserver.conf`.

## Pré-requisitos

- Servidor Linux com **Docker + Docker Compose v2**.
- **DNS**: um registro A/AAAA do seu domínio (ex.: `chat.suaempresa.com`) apontando
  para o IP público do servidor.
- **Portas abertas** no firewall: `80/tcp` e `443/tcp` (web/TLS), `3478/tcp+udp`
  (TURN) e a faixa de relay `49160-49200/udp` (WebRTC).
- Para **buildar a imagem**: ~8 GB de RAM livres e ~30-45 min (build do Meteor).

## 1) Configuração

```bash
cp docker/.env.example docker/.env
# edite: DOMAIN, TLS_EMAIL, ADMIN_*, TURN_PUBLIC_IP, TURN_USER, TURN_SECRET
```

## 2) A imagem Voltec — duas opções

> A imagem oficial do Rocket.Chat **não** inclui suas customizações (branding, PWA,
> WebRTC). Por isso você builda a sua.

### Opção A — Build pelo Compose (turnkey)

Builda do código-fonte dentro do Docker (multi-stage `Dockerfile.voltec`):

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env build
```

> É um build pesado. Recomendado fazer numa máquina de build/CI potente e depois
> **publicar num registry** (defina `VOLTEC_IMAGE=ghcr.io/suaempresa/voltec:1.0.0`
> no `.env`) para o servidor de produção só baixar a imagem pronta.

### Opção B — Caminho oficial do Rocket.Chat (mais testado)

Gera o bundle com a tooling do próprio repo e empacota com o `Dockerfile.debian`:

```bash
# num host com Node 22.22.3 + Yarn 4.12.0 + Meteor 3.4.1:
yarn install
yarn build
cd apps/meteor && METEOR_ALLOW_SUPERUSER=true yarn build:ci   # -> /tmp/dist/bundle
cd /tmp/dist && docker build -t voltec/rocketchat:local \
  -f /caminho/Rocket.Chat-Voltec/apps/meteor/.docker/Dockerfile.debian .
```

> Quer a versão **sem o código enterprise**? Rode antes `yarn voltec-fossify` e siga
> `docs/voltec-foss.md` (ou rode em modo Community dormante, sem remover nada).

## 3) Subir

O compose usa **profiles** para você escolher o que sobe:

| O que sobe | Comando |
|---|---|
| **Só app + Mongo** (use seu proxy externo) | `docker compose -f docker/docker-compose.yml --env-file docker/.env up -d` |
| **+ TLS embutido (Traefik)** | adicione `--profile builtin-tls` |
| **+ Chamadas (coturn)** | adicione `--profile calls` |

O Mongo sobe como **replica set `rs0`** (exigência do RC) e o app só inicia quando
o Mongo fica `healthy`. Logs: `docker compose -f docker/docker-compose.yml logs -f rocketchat`.

## 3.1) Atrás de um proxy externo (Nginx Proxy Manager) ⭐

Se você **já tem um proxy** (NPM, nginx, Caddy…), **não** use o Traefik embutido
(não passe `--profile builtin-tls`). O TLS fica no seu proxy.

> ⚠️ **Habilite "Websockets Support" no proxy.** O Rocket.Chat usa WebSocket/DDP —
> sem isso o app carrega mas fica reconectando e não funciona.

**Opção 1 — NPM em Docker (recomendado): rede compartilhada.** O NPM alcança o app
pelo nome do serviço, sem expor porta no host. Veja o cabeçalho de
`docker/docker-compose.external-proxy.yml`:

```bash
# defina PROXY_NETWORK no .env com a rede do seu NPM (docker network ls)
docker compose -f docker/docker-compose.yml \
  -f docker/docker-compose.external-proxy.yml --env-file docker/.env up -d
```
No NPM → Proxy Host: **Forward** `rocketchat` : `3000`, **Scheme** `http`,
**✅ Websockets Support**, e emita o SSL no NPM (Force SSL).

**Opção 2 — proxy no mesmo host (ou fora do Docker): porta publicada.**
O app é publicado em `ROCKETCHAT_BIND` (padrão `127.0.0.1:3000`). Aponte o proxy
para `http://127.0.0.1:3000` (mesmo host). Se o proxy estiver em outra máquina,
use `ROCKETCHAT_BIND=0.0.0.0:3000` e **proteja com firewall**.

Em ambos os casos, `ROOT_URL=https://SEU_DOMINIO` (já vem do `.env`) e
`HTTP_FORWARDED_COUNT=1` (o RC confia no IP repassado pelo proxy).

## 4) Primeiro acesso

- Abra `https://SEU_DOMINIO`. Se preencheu `ADMIN_*`, o admin já existe; senão,
  complete o setup wizard.
- No celular, use **"Adicionar à Tela de Início"** (PWA) — instala o app Voltec.

## 5) Ativar as chamadas WebRTC (coturn)

1. Ative o módulo de chamadas (veja `apps/meteor/client/lib/voltecCalls/README.md`).
2. Suba o coturn com o profile `calls` (preencha `TURN_*` no `.env`):
   `docker compose -f docker/docker-compose.yml --env-file docker/.env --profile calls up -d`
3. Em **Admin → `Voltec_Calls` → `Voltec_Call_ICE_Servers`**, configure:

   ```json
   [
     { "urls": "stun:SEU_DOMINIO:3478" },
     { "urls": "turn:SEU_DOMINIO:3478", "username": "voltec", "credential": "SUA_TURN_SECRET" }
   ]
   ```

   (use o mesmo `TURN_USER`/`TURN_SECRET` do `.env`). Garanta que `TURN_PUBLIC_IP`
   é o IP público real e que as portas TURN/relay estão abertas.

## Operação

**Backup** (volumes nomeados):
```bash
docker run --rm -v voltec_mongo_data:/data -v "$PWD":/b alpine \
  tar czf /b/mongo-backup.tar.gz -C /data .
# uploads: volume voltec_rocketchat_uploads (mesma ideia)
```

**Atualizar**: rebuild ou baixe a nova imagem e `up -d` (o Compose recria só o que mudou):
```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build
```

**Escala**: este compose é **monolito** (ideal para uso interno). Os microserviços
(`ee/apps/*`: ddp-streamer, presence-service, etc.) são para escala horizontal e
exigem licença Enterprise — fora do escopo FOSS.

## Troubleshooting

- **App não conecta no Mongo** → confirme que o healthcheck do `mongo` ficou
  `healthy` e que o replica set `rs0` foi iniciado (`docker compose logs mongo`).
- **Build do Meteor falha por memória** → aumente a RAM/swap (≥8 GB) ou use a
  Opção B numa máquina de build dedicada.
- **TLS não emite** → DNS deve resolver para o servidor e as portas 80/443 abertas
  (o desafio TLS-ALPN do Let's Encrypt usa a 443).
- **Chamada conecta mas sem áudio/vídeo entre redes** → quase sempre é
  TURN/firewall: cheque `TURN_PUBLIC_IP`, a faixa de relay e as portas no firewall.
