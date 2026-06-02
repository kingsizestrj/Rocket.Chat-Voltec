/**
 * Voltec WebRTC calls — shared signaling envelope (server-side / cross-package).
 *
 * Intentionally DOM-free (no RTCSessionDescriptionInit etc.) so it compiles in
 * core-typings, which targets both server and client. The signaling payload is
 * relayed opaquely by the server; the browser engine casts it to the precise
 * WebRTC DOM types at the boundary.
 */
export type VoltecCallSignal = {
	kind: 'offer' | 'answer' | 'candidate' | 'hangup' | 'reject';
	callId: string;
	/** Present on offer/answer (RTCSessionDescriptionInit-shaped). */
	sdp?: { type: string; sdp?: string };
	/** Present on candidate (RTCIceCandidateInit-shaped). */
	candidate?: Record<string, unknown>;
	/** Present on offer. */
	video?: boolean;
	reason?: string;
};

export type VoltecCallEnvelope = {
	/** Recipient user id. */
	to: string;
	/** Sender user id (stamped by the server). */
	from?: string;
	signal: VoltecCallSignal;
};
