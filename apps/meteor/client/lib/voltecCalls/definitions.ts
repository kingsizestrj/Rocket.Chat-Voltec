/**
 * Voltec WebRTC calls — shared type definitions and signaling contract.
 *
 * This file is RC-agnostic on purpose: it has zero Rocket.Chat imports and only
 * uses standard DOM/WebRTC types. The engine and orchestrator build on top of it
 * and can be unit-tested in isolation. The Rocket.Chat-specific transport is
 * injected via the {@link SignalingTransport} interface.
 */

export type CallId = string;

export type CallDirection = 'incoming' | 'outgoing';

export type CallState =
	| 'idle' // no active call
	| 'calling' // outgoing offer sent, waiting for callee
	| 'ringing' // incoming offer received, waiting for local accept
	| 'connecting' // negotiating / ICE in progress
	| 'connected' // media flowing
	| 'ended' // closed normally
	| 'failed'; // closed due to error / ICE failure

/** Whether the call carries video in addition to audio. */
export type CallKind = 'audio' | 'video';

/**
 * Signaling messages exchanged between the two peers through the server relay.
 * Discriminated union on `kind` so the engine can switch exhaustively.
 */
export type CallSignal =
	| { kind: 'offer'; callId: CallId; sdp: RTCSessionDescriptionInit; video: boolean }
	| { kind: 'answer'; callId: CallId; sdp: RTCSessionDescriptionInit }
	| { kind: 'candidate'; callId: CallId; candidate: RTCIceCandidateInit }
	| { kind: 'hangup'; callId: CallId; reason?: string }
	| { kind: 'reject'; callId: CallId; reason?: string };

/** A signal addressed to a specific user, as it travels over the transport. */
export type CallSignalEnvelope = {
	/** Target user id (recipient). */
	to: string;
	/** Sender user id (filled by the server on inbound). */
	from?: string;
	signal: CallSignal;
};

export type IceServerConfig = RTCIceServer;

export type CallEngineConfig = {
	/** STUN/TURN servers. At least one STUN server is recommended. */
	iceServers: IceServerConfig[];
	/** Media constraints used for getUserMedia. */
	media?: {
		audio?: boolean | MediaTrackConstraints;
		video?: boolean | MediaTrackConstraints;
	};
};

/**
 * Transport seam between the pure engine and Rocket.Chat. Implementations relay
 * {@link CallSignalEnvelope}s to/from the other peer (e.g. via DDP streamers).
 */
export interface SignalingTransport {
	/** Send a signal to the remote user. */
	send(envelope: CallSignalEnvelope): void | Promise<void>;
	/**
	 * Subscribe to inbound signals addressed to the local user.
	 * @returns an unsubscribe function.
	 */
	onSignal(handler: (envelope: CallSignalEnvelope) => void): () => void;
}

/** Events emitted by a single {@link WebRTCCallSession}. */
export type CallSessionEvents = {
	localstream: MediaStream;
	remotestream: MediaStream;
	statechange: CallState;
	ended: { reason?: string };
	error: Error;
};

/** Events emitted by the {@link CallManager}. */
export type CallManagerEvents = {
	incoming: { callId: CallId; from: string; video: boolean };
	statechange: { callId: CallId; state: CallState };
	ended: { callId: CallId; reason?: string };
};
