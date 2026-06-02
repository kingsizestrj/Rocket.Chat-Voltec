/**
 * Voltec call orchestrator.
 *
 * Sits between the UI and the {@link WebRTCCallSession}s, handling one active 1:1
 * call at a time: it listens for inbound signaling through the injected
 * {@link SignalingTransport}, raises an `incoming` event for the UI to accept or
 * reject, and routes answers/candidates/hangups to the right session. It is
 * Rocket.Chat-agnostic — the transport and ICE configuration are injected.
 */
import { Emitter } from './Emitter';
import { WebRTCCallSession } from './WebRTCCallSession';
import type { CallEngineConfig, CallId, CallManagerEvents, CallSignal, CallSignalEnvelope, SignalingTransport } from './definitions';

type PendingIncoming = {
	callId: CallId;
	from: string;
	offer: RTCSessionDescriptionInit;
	video: boolean;
	candidates: RTCIceCandidateInit[];
};

export type CallManagerOptions = {
	localUserId: string;
	transport: SignalingTransport;
	/** Resolves the ICE configuration (e.g. from server settings) lazily per call. */
	getConfig: () => CallEngineConfig | Promise<CallEngineConfig>;
};

function createCallId(): CallId {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
		return cryptoObj.randomUUID();
	}
	return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class CallManager extends Emitter<CallManagerEvents> {
	private readonly localUserId: string;

	private readonly transport: SignalingTransport;

	private readonly getConfig: CallManagerOptions['getConfig'];

	private session: WebRTCCallSession | undefined;

	private pending: PendingIncoming | undefined;

	private unsubscribe: (() => void) | undefined;

	constructor(options: CallManagerOptions) {
		super();
		this.localUserId = options.localUserId;
		this.transport = options.transport;
		this.getConfig = options.getConfig;
	}

	/** Begin listening for inbound calls. Call once after login. */
	start(): void {
		if (this.unsubscribe) {
			return;
		}
		this.unsubscribe = this.transport.onSignal((envelope) => {
			void this.onEnvelope(envelope);
		});
	}

	/** Stop listening and tear down any active call. */
	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.session?.hangup('stopped');
		this.session = undefined;
		this.pending = undefined;
		this.clear();
	}

	isBusy(): boolean {
		return Boolean(this.session) || Boolean(this.pending);
	}

	getLocalUserId(): string {
		return this.localUserId;
	}

	getActiveSession(): WebRTCCallSession | undefined {
		return this.session;
	}

	/** Place an outgoing call to a user. */
	async startCall(remoteUserId: string, options: { video?: boolean } = {}): Promise<WebRTCCallSession> {
		if (this.isBusy()) {
			throw new Error('Already in a call');
		}
		const callId = createCallId();
		const video = options.video ?? false;
		const config = await this.getConfig();

		// Caller is the "impolite" peer in perfect-negotiation terms.
		const session = this.attachSession(callId, remoteUserId, config, false);
		await session.start(video);
		return session;
	}

	/** Accept the pending incoming call. */
	async accept(options: { video?: boolean } = {}): Promise<WebRTCCallSession> {
		const pending = this.pending;
		if (!pending) {
			throw new Error('No incoming call to accept');
		}
		this.pending = undefined;
		const config = await this.getConfig();
		const video = options.video ?? pending.video;

		// Callee is the "polite" peer.
		const session = this.attachSession(pending.callId, pending.from, config, true);
		await session.accept(pending.offer, video);

		// Replay any ICE candidates that arrived before we accepted.
		for (const candidate of pending.candidates) {
			void session.handleSignal({ kind: 'candidate', callId: pending.callId, candidate });
		}
		return session;
	}

	/** Reject the pending incoming call. */
	reject(reason?: string): void {
		const pending = this.pending;
		if (!pending) {
			return;
		}
		this.pending = undefined;
		void this.transport.send({
			to: pending.from,
			signal: { kind: 'reject', callId: pending.callId, ...(reason ? { reason } : {}) },
		});
		this.emit('ended', { callId: pending.callId, ...(reason ? { reason } : {}) });
	}

	/** Hang up the active call. */
	hangup(reason?: string): void {
		this.session?.hangup(reason);
	}

	// --- internals -----------------------------------------------------------

	private attachSession(callId: CallId, remoteUserId: string, config: CallEngineConfig, polite: boolean): WebRTCCallSession {
		const session = new WebRTCCallSession({
			callId,
			remoteUserId,
			config,
			polite,
			send: (signal) => {
				void this.transport.send({ to: remoteUserId, signal });
			},
		});

		session.on('statechange', (state) => {
			this.emit('statechange', { callId, state });
		});

		session.on('ended', ({ reason }) => {
			if (this.session === session) {
				this.session = undefined;
			}
			this.emit('ended', { callId, ...(reason ? { reason } : {}) });
		});

		this.session = session;
		return session;
	}

	private async onEnvelope(envelope: CallSignalEnvelope): Promise<void> {
		const { signal } = envelope;
		const from = envelope.from;

		if (signal.kind === 'offer') {
			this.onOffer(signal, from);
			return;
		}

		// Candidates may arrive for a not-yet-accepted incoming call: buffer them.
		if (signal.kind === 'candidate' && this.pending && this.pending.callId === signal.callId) {
			this.pending.candidates.push(signal.candidate);
			return;
		}

		// Route everything else to the active session when the call id matches.
		if (this.session && this.session.callId === signal.callId) {
			void this.session.handleSignal(signal);
			return;
		}

		// A hangup/reject for the pending incoming call clears it.
		if ((signal.kind === 'hangup' || signal.kind === 'reject') && this.pending && this.pending.callId === signal.callId) {
			const { callId } = this.pending;
			this.pending = undefined;
			this.emit('ended', { callId, reason: signal.reason ?? signal.kind });
		}
	}

	private onOffer(signal: Extract<CallSignal, { kind: 'offer' }>, from: string | undefined): void {
		const caller = from ?? 'unknown';

		// Already on a call (or already ringing): politely reject the new offer.
		if (this.isBusy()) {
			void this.transport.send({ to: caller, signal: { kind: 'reject', callId: signal.callId, reason: 'busy' } });
			return;
		}

		this.pending = {
			callId: signal.callId,
			from: caller,
			offer: signal.sdp,
			video: signal.video,
			candidates: [],
		};
		this.emit('incoming', { callId: signal.callId, from: caller, video: signal.video });
	}
}
