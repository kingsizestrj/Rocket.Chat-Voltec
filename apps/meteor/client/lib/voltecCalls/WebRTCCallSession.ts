/**
 * Voltec WebRTC call session — a single 1:1 peer connection.
 *
 * Pure, Rocket.Chat-agnostic engine: it manages one `RTCPeerConnection`, the
 * local/remote `MediaStream`s, ICE candidate exchange (with buffering until the
 * remote description is set), audio mute and camera toggling, and the call
 * lifecycle. Outbound signaling is delegated to the `send` callback passed in by
 * the orchestrator; inbound signaling is fed in through {@link handleSignal}.
 */
import { Emitter } from './Emitter';
import type { CallEngineConfig, CallId, CallSessionEvents, CallSignal, CallState } from './definitions';

export type CallSessionOptions = {
	callId: CallId;
	/** The other participant's user id (for the orchestrator/UI; unused by media). */
	remoteUserId: string;
	config: CallEngineConfig;
	/**
	 * "Polite" peer in perfect-negotiation terms. The callee is polite and yields
	 * on glare; the caller is impolite. Defaults are set by the orchestrator.
	 */
	polite: boolean;
	/** Sends a signal to the remote peer through the active transport. */
	send: (signal: CallSignal) => void;
};

export class WebRTCCallSession extends Emitter<CallSessionEvents> {
	readonly callId: CallId;

	readonly remoteUserId: string;

	private readonly config: CallEngineConfig;

	private readonly polite: boolean;

	private readonly send: (signal: CallSignal) => void;

	private pc: RTCPeerConnection | undefined;

	private localStream: MediaStream | undefined;

	private remoteStream: MediaStream | undefined;

	private state: CallState = 'idle';

	/** Whether this session carries video. */
	private video = false;

	/** ICE candidates received before the remote description was applied. */
	private readonly pendingCandidates: RTCIceCandidateInit[] = [];

	private remoteDescriptionSet = false;

	private closed = false;

	constructor(options: CallSessionOptions) {
		super();
		this.callId = options.callId;
		this.remoteUserId = options.remoteUserId;
		this.config = options.config;
		this.polite = options.polite;
		this.send = options.send;
	}

	getState(): CallState {
		return this.state;
	}

	/** Whether this session carries video. */
	isVideo(): boolean {
		return this.video;
	}

	/** "Polite" peer flag (callee). Used for glare resolution. */
	isPolite(): boolean {
		return this.polite;
	}

	getLocalStream(): MediaStream | undefined {
		return this.localStream;
	}

	getRemoteStream(): MediaStream | undefined {
		return this.remoteStream;
	}

	/** Start an outgoing call: capture media, create an offer and send it. */
	async start(video: boolean): Promise<void> {
		this.video = video;
		this.setState('calling');
		try {
			await this.ensureMedia(video);
			const pc = this.createPeerConnection();
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			this.send({ kind: 'offer', callId: this.callId, sdp: offer, video });
			this.setState('connecting');
		} catch (err) {
			this.fail(err);
		}
	}

	/** Accept an incoming call: apply the remote offer, capture media, answer. */
	async accept(offer: RTCSessionDescriptionInit, video: boolean): Promise<void> {
		this.video = video;
		this.setState('connecting');
		try {
			await this.ensureMedia(video);
			const pc = this.createPeerConnection();
			await pc.setRemoteDescription(offer);
			this.remoteDescriptionSet = true;
			await this.drainPendingCandidates();
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			this.send({ kind: 'answer', callId: this.callId, sdp: answer });
		} catch (err) {
			this.fail(err);
		}
	}

	/** Feed an inbound signal (answer / candidate / hangup / reject) into the session. */
	async handleSignal(signal: CallSignal): Promise<void> {
		if (this.closed) {
			return;
		}

		switch (signal.kind) {
			case 'answer':
				await this.onRemoteAnswer(signal.sdp);
				break;
			case 'candidate':
				await this.onRemoteCandidate(signal.candidate);
				break;
			case 'hangup':
				this.close({ reason: signal.reason ?? 'remote-hangup' });
				break;
			case 'reject':
				this.close({ reason: signal.reason ?? 'rejected', failed: false });
				break;
			default:
				break;
		}
	}

	/** Mute or unmute the local microphone. */
	setMuted(muted: boolean): void {
		this.localStream?.getAudioTracks().forEach((track) => {
			track.enabled = !muted;
		});
	}

	/** Enable or disable the local camera. */
	setVideoEnabled(enabled: boolean): void {
		this.localStream?.getVideoTracks().forEach((track) => {
			track.enabled = enabled;
		});
	}

	isMuted(): boolean {
		const [audio] = this.localStream?.getAudioTracks() ?? [];
		return audio ? !audio.enabled : false;
	}

	/** Hang up locally: notify the peer and tear down. */
	hangup(reason?: string): void {
		if (!this.closed) {
			this.send({ kind: 'hangup', callId: this.callId, ...(reason ? { reason } : {}) });
		}
		this.close(reason ? { reason } : {});
	}

	// --- internals -----------------------------------------------------------

	private async ensureMedia(video: boolean): Promise<void> {
		if (this.localStream) {
			return;
		}
		const constraints: MediaStreamConstraints = {
			audio: this.config.media?.audio ?? true,
			video: video ? this.config.media?.video ?? true : false,
		};
		const stream = await navigator.mediaDevices.getUserMedia(constraints);
		if (this.closed) {
			stream.getTracks().forEach((track) => track.stop());
			return;
		}
		this.localStream = stream;
		this.emit('localstream', stream);
	}

	private createPeerConnection(): RTCPeerConnection {
		const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
		this.pc = pc;

		if (this.localStream) {
			for (const track of this.localStream.getTracks()) {
				pc.addTrack(track, this.localStream);
			}
		}

		pc.onicecandidate = (event): void => {
			if (event.candidate) {
				this.send({ kind: 'candidate', callId: this.callId, candidate: event.candidate.toJSON() });
			}
		};

		pc.ontrack = (event): void => {
			const [stream] = event.streams;
			const remote = stream ?? this.remoteStream ?? new MediaStream();
			if (!stream) {
				remote.addTrack(event.track);
			}
			this.remoteStream = remote;
			this.emit('remotestream', remote);
		};

		pc.onconnectionstatechange = (): void => {
			switch (pc.connectionState) {
				case 'connected':
					this.setState('connected');
					break;
				case 'failed':
					this.fail(new Error('ICE connection failed'));
					break;
				case 'disconnected':
				case 'closed':
					if (!this.closed) {
						this.close({ reason: 'disconnected' });
					}
					break;
				default:
					break;
			}
		};

		return pc;
	}

	private async onRemoteAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
		if (!this.pc) {
			return;
		}
		await this.pc.setRemoteDescription(sdp);
		this.remoteDescriptionSet = true;
		await this.drainPendingCandidates();
	}

	private async onRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		if (!this.pc || !this.remoteDescriptionSet) {
			// Buffer until the remote description is in place.
			this.pendingCandidates.push(candidate);
			return;
		}
		try {
			await this.pc.addIceCandidate(candidate);
		} catch (err) {
			// Non-fatal: a single bad candidate should not drop the call.
			// eslint-disable-next-line no-console
			console.warn('[voltec-calls] failed to add ICE candidate', err);
		}
	}

	private async drainPendingCandidates(): Promise<void> {
		if (!this.pc) {
			return;
		}
		const candidates = this.pendingCandidates.splice(0, this.pendingCandidates.length);
		for (const candidate of candidates) {
			try {
				await this.pc.addIceCandidate(candidate);
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn('[voltec-calls] failed to add buffered ICE candidate', err);
			}
		}
	}

	private setState(state: CallState): void {
		if (this.state === state) {
			return;
		}
		this.state = state;
		this.emit('statechange', state);
	}

	private fail(err: unknown): void {
		const error = err instanceof Error ? err : new Error(String(err));
		this.emit('error', error);
		this.close({ reason: error.message, failed: true });
	}

	private close({ reason, failed = false }: { reason?: string; failed?: boolean } = {}): void {
		if (this.closed) {
			return;
		}
		this.closed = true;

		this.localStream?.getTracks().forEach((track) => track.stop());

		if (this.pc) {
			this.pc.onicecandidate = null;
			this.pc.ontrack = null;
			this.pc.onconnectionstatechange = null;
			try {
				this.pc.close();
			} catch {
				// ignore
			}
			this.pc = undefined;
		}

		this.setState(failed ? 'failed' : 'ended');
		this.emit('ended', reason ? { reason } : {});
		this.clear();
	}
}
