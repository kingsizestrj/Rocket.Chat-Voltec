# Voltec — Remoção do Enterprise (FOSS-ização)

Guia para transformar o fork na versão **FOSS/Community** removendo o código
Enterprise (`ee/`), **mantendo o portão de licença** (`@rocket.chat/license`).

> ⚠️ **Rode no seu ambiente de build, não em CI/container efêmero.** Dois motivos:
> 1. Deletar pacotes de workspace exige `yarn install` para regenerar o `yarn.lock`
>    (senão o CI com `yarn install --immutable` falha).
> 2. A remoção quebra imports estáticos do core que precisam de ajuste +
>    verificação de build. Por isso **não** commitamos a remoção pronta: ela é
>    feita e validada por você, iterando com o `yarn typecheck`/`yarn dev`.

## Alternativa de risco zero: Community dormante

Sem aplicar nenhuma chave de licença, **os recursos Enterprise já ficam
desligados** (o `@rocket.chat/license` reporta "community"). Ou seja, você já tem
o comportamento "sem enterprise" **sem remover nada**. A remoção física abaixo só
vale a pena se você quer não *carregar/distribuir* o código proprietário.

## Procedimento

1. Rode o script de remoção (mantém `ee/packages/license`):

   ```bash
   yarn ts-node scripts/voltec-fossify.ts   # responda "y"
   ```

   Ele remove `ee/apps`, os pacotes de feature em `ee/packages/*` (exceto
   `license`), `apps/meteor/ee`, e troca o entrypoint para o no-op FOSS.

2. Aplique os ajustes de acoplamento (abaixo).
3. `yarn install` → `yarn typecheck` → `yarn dev`, corrigindo o que sobrar.

## Mapa de acoplamentos core → enterprise

Quem mantém: 🔒 `ee/packages/license` (importado como valor por **21** arquivos do core).

| Pacote removido | Onde o core usa | Ação |
|---|---|---|
| `@rocket.chat/media-calls` | `server/services/media-call/service.ts` (serviço VoIP) + 2 `import type` em `media-call/push/*` | Remover o serviço VoIP (substituído pelo WebRTC Voltec) |
| `@rocket.chat/presence` | `server/services/startup.ts:65` — `await import()` dinâmico | Remover o bloco (presence monolítico funciona sem o serviço EE) |
| `@rocket.chat/federation-matrix` | `server/settings/federation-service.ts`; `app/slashcommands-invite/server/server.ts` | Remover imports (ou stubar `generateEd25519RandomSecretKey` / `validateFederatedUsername`) |
| `@rocket.chat/omnichannel-services` | `server/services/startup.ts:3` — `OmnichannelTranscript, QueueWorker` | Remover imports + `registerService(...)` |
| `@rocket.chat/abac`, `network-broker`, `omni-core-ee`, `pdf-worker` | 0 imports diretos no core | Só remover o pacote |

## Edições exatas

### `apps/meteor/server/services/startup.ts`
- Remover `import { OmnichannelTranscript, QueueWorker } from '@rocket.chat/omnichannel-services';`
- Remover `import { MediaCallService } from './media-call/service';`
- Remover as chamadas `api.registerService(new MediaCallService());` e as de
  `OmnichannelTranscript`/`QueueWorker`.
- Remover o bloco `const { Presence } = await import('@rocket.chat/presence'); ... api.registerService(new Presence());`

### `apps/meteor/server/main.ts`
- Remover `import { startupApp } from '../ee/server';` e o `await startupApp();`.
  (O `startRocketChat` já vira o no-op FOSS pelo script.)

### Cliente — UI VoIP (feature Enterprise)
Remover os diretórios e suas referências nos pais:
- `client/lib/voip`, `client/navbar/NavBarVoipGroup`, `client/views/mediaCallHistory`
- Pais a ajustar: `client/navbar/NavBarControls/NavBarControlsSection.tsx`,
  `client/views/room/providers/hooks/useCoreRoomRoutes.ts`,
  `client/views/omnichannel/contactInfo/tabs/ContactInfoDetails/ContactInfoPhoneEntry.tsx`
- `client/hooks/useUserDropdownAppsActionButtons.ts` e
  `useMessageboxAppsActionButtons.ts` → remover os imports de `../ee`.

### Federação (se não for usar Matrix)
- `server/settings/federation-service.ts`: remover `generateEd25519RandomSecretKey`.
- `app/slashcommands-invite/server/server.ts`: remover `validateFederatedUsername`.

### `package.json` (raiz)
- Em `"workspaces"`, remover `"ee/apps/*"` e `"apps/meteor/ee/server/services"`.
- **Manter** `"ee/packages/*"` (o `license` continua lá).

## Verificação

```bash
yarn install            # regenera yarn.lock
yarn typecheck          # corrija imports remanescentes
yarn dev                # sobe e valida (precisa de MongoDB)
```

Procure por `@rocket.chat/license` para confirmar que o portão continua presente,
e por `from '@rocket.chat/(media-calls|presence|federation-matrix|omnichannel-services|abac|network-broker|omni-core-ee|pdf-worker)'`
para confirmar que não sobraram imports dos pacotes removidos.
