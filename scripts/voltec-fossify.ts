/**
 * Voltec FOSS-ify — improved, license-gate-preserving version of `fossify.ts`.
 *
 * The stock `scripts/fossify.ts` deletes the whole `ee/` tree, which BREAKS the
 * build on this branch because `@rocket.chat/license` (in `ee/packages/license`)
 * is imported as a *value* by 21 core files, and several newer enterprise
 * packages (media-calls, presence, federation-matrix, omnichannel-services) are
 * statically imported by core services.
 *
 * This script removes the enterprise *feature* packages and apps while KEEPING
 * the license gate (which, without a license key, simply reports "community" and
 * leaves paid features disabled). It then swaps the server entrypoint to the
 * FOSS no-op.
 *
 * IMPORTANT — run this in your BUILD environment, not in CI/ephemeral containers:
 *   - Deleting workspace packages requires `yarn install` to regenerate yarn.lock,
 *     otherwise `yarn install --immutable` (CI) fails.
 *   - Removing the feature packages breaks the core import sites listed at the end
 *     ("MANUAL STEPS"). Apply those edits (see docs/voltec-foss.md), then build.
 *
 * Usage: `yarn ts-node scripts/voltec-fossify.ts` (or via a package.json script),
 * then `yarn install` and `yarn build` / `yarn typecheck` and fix what it reports.
 */
import fs from 'fs/promises';
import readline from 'readline';

const rmOpts = { recursive: true, force: true } as const;

/** Enterprise feature packages to remove. `license` is intentionally KEPT. */
const EE_PACKAGES_TO_REMOVE = [
	'abac',
	'federation-matrix',
	'media-calls',
	'network-broker',
	'omni-core-ee',
	'omnichannel-services',
	'pdf-worker',
	'presence',
];

const MANUAL_STEPS = `
=========================  MANUAL STEPS REQUIRED  =========================
The enterprise feature packages were removed but the core still references some
of them. Apply these edits (details + snippets in docs/voltec-foss.md), then run
\`yarn install\` and \`yarn typecheck\`/\`yarn build\` and fix anything left:

 1) apps/meteor/server/services/startup.ts
      - remove import of '@rocket.chat/omnichannel-services' (OmnichannelTranscript, QueueWorker)
        and their registerService(...) calls
      - remove import { MediaCallService } from './media-call/service' and its registerService
      - remove the dynamic  await import('@rocket.chat/presence')  block (monolith presence
        works without the EE scaling service)
 2) apps/meteor/server/services/media-call/      -> delete (replaced by Voltec WebRTC)
 3) apps/meteor/client/lib/voip, client/navbar/NavBarVoipGroup,
    client/views/mediaCallHistory                -> delete, and remove their usage in
      client/navbar/NavBarControls/NavBarControlsSection.tsx and
      client/views/room/providers/hooks/useCoreRoomRoutes.ts
 4) apps/meteor/server/settings/federation-service.ts and
    apps/meteor/app/slashcommands-invite/server/server.ts
      -> remove the '@rocket.chat/federation-matrix' imports (or stub the 2 helpers)
 5) apps/meteor/server/main.ts
      -> remove  import { startupApp } from '../ee/server'  and its  await startupApp()
 6) apps/meteor/client/hooks/useUserDropdownAppsActionButtons.ts and
    useMessageboxAppsActionButtons.ts
      -> remove the '../ee' imports
 7) root package.json "workspaces": drop "ee/apps/*" (and "apps/meteor/ee/server/services")
      if present; keep "ee/packages/*" (license still lives there).

Then:  yarn install  &&  yarn typecheck  &&  yarn dev
===========================================================================
`;

async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

async function fossify(): Promise<void> {
	console.log('• Removing enterprise microservices (ee/apps)...');
	await fs.rm('./ee/apps', rmOpts);

	console.log('• Removing enterprise feature packages (keeping ee/packages/license)...');
	for (const pkg of EE_PACKAGES_TO_REMOVE) {
		const dir = `./ee/packages/${pkg}`;
		if (await exists(dir)) {
			await fs.rm(dir, rmOpts);
			console.log(`    - removed ${dir}`);
		}
	}

	console.log('• Removing premium code in the main app (apps/meteor/ee)...');
	await fs.rm('./apps/meteor/ee', rmOpts);

	console.log('• Swapping server entrypoint to the FOSS no-op...');
	if (await exists('./apps/meteor/startRocketChatFOSS.ts')) {
		await fs.rm('./apps/meteor/startRocketChat.ts', { force: true });
		await fs.rename('./apps/meteor/startRocketChatFOSS.ts', './apps/meteor/startRocketChat.ts');
	}

	console.log('\n✓ Filesystem changes done.');
	console.log(MANUAL_STEPS);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('This permanently deletes enterprise files (license gate is kept). Proceed? (n,y) ', (answer) => {
	rl.close();
	if (answer.toLowerCase() !== 'y') {
		console.log('Aborted.');
		return;
	}
	fossify().catch((e) => {
		console.error(e ?? 'Unknown error');
		process.exitCode = 1;
	});
});
