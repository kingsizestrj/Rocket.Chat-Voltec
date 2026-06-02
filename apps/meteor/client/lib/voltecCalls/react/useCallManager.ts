/**
 * React binding for the Voltec {@link CallManager}.
 *
 * Pure React (only imports from `react` and the RC-agnostic call core), so it is
 * safe to compile and unit-test in isolation. It turns the manager's imperative
 * event stream into reactive state and exposes ready-to-bind actions for the UI
 * (incoming-call modal, in-call screen). The manager instance is injected, so
 * this hook has no Rocket.Chat coupling.
 */
import { useCallback, useEffect, useState } from 'react';

import type { CallManager } from '../CallManager';
import type { CallManagerEvents, CallState } from '../definitions';
import type { WebRTCCallSession } from '../WebRTCCallSession';

export type IncomingCall = CallManagerEvents['incoming'];

export type UseCallManager = {
	/** Pending incoming call awaiting accept/reject, if any. */
	incoming: IncomingCall | undefined;
	/** Current call lifecycle state. */
	state: CallState | undefined;
	/** The other party's user id during an active/pending call. */
	remoteUserId: string | undefined;
	/** Whether the active call carries video. */
	isVideo: boolean;
	localStream: MediaStream | undefined;
	remoteStream: MediaStream | undefined;
	isMuted: boolean;
	videoEnabled: boolean;
	/** True while there is a pending or active call. */
	isBusy: boolean;
	/** Place an outgoing call. */
	call: (remoteUserId: string, options?: { video?: boolean }) => Promise<void>;
	/** Accept the pending incoming call. */
	accept: (options?: { video?: boolean }) => Promise<void>;
	/** Reject the pending incoming call. */
	reject: () => void;
	/** Hang up the active call. */
	hangup: () => void;
	toggleMute: () => void;
	toggleVideo: () => void;
};

export function useCallManager(manager: CallManager | undefined): UseCallManager {
	const [incoming, setIncoming] = useState<IncomingCall | undefined>(undefined);
	const [session, setSession] = useState<WebRTCCallSession | undefined>(undefined);
	const [state, setState] = useState<CallState | undefined>(undefined);
	const [localStream, setLocalStream] = useState<MediaStream | undefined>(undefined);
	const [remoteStream, setRemoteStream] = useState<MediaStream | undefined>(undefined);
	const [isMuted, setIsMuted] = useState(false);
	const [videoEnabled, setVideoEnabled] = useState(true);

	// Manager-level events.
	useEffect(() => {
		if (!manager) {
			return;
		}

		const offIncoming = manager.on('incoming', (call) => {
			setIncoming(call);
		});

		const offState = manager.on('statechange', ({ state: nextState }) => {
			setState(nextState);
			setSession(manager.getActiveSession());
		});

		const offEnded = manager.on('ended', () => {
			setIncoming(undefined);
			setSession(undefined);
			setState('ended');
			setLocalStream(undefined);
			setRemoteStream(undefined);
			setIsMuted(false);
			setVideoEnabled(true);
		});

		return () => {
			offIncoming();
			offState();
			offEnded();
		};
	}, [manager]);

	// Session-level media events.
	useEffect(() => {
		if (!session) {
			setLocalStream(undefined);
			setRemoteStream(undefined);
			return;
		}

		setLocalStream(session.getLocalStream());
		setRemoteStream(session.getRemoteStream());
		setIsMuted(session.isMuted());

		const offLocal = session.on('localstream', (stream) => {
			setLocalStream(stream);
		});
		const offRemote = session.on('remotestream', (stream) => {
			setRemoteStream(stream);
		});

		return () => {
			offLocal();
			offRemote();
		};
	}, [session]);

	const call = useCallback(
		async (remoteUserId: string, options?: { video?: boolean }): Promise<void> => {
			if (!manager) {
				return;
			}
			setVideoEnabled(options?.video ?? false);
			await manager.startCall(remoteUserId, options);
		},
		[manager],
	);

	const accept = useCallback(
		async (options?: { video?: boolean }): Promise<void> => {
			if (!manager) {
				return;
			}
			setIncoming(undefined);
			setVideoEnabled(options?.video ?? incoming?.video ?? false);
			await manager.accept(options);
		},
		[manager, incoming],
	);

	const reject = useCallback((): void => {
		manager?.reject();
		setIncoming(undefined);
	}, [manager]);

	const hangup = useCallback((): void => {
		manager?.hangup();
	}, [manager]);

	const toggleMute = useCallback((): void => {
		const active = manager?.getActiveSession();
		if (!active) {
			return;
		}
		const next = !active.isMuted();
		active.setMuted(next);
		setIsMuted(next);
	}, [manager]);

	const toggleVideo = useCallback((): void => {
		const active = manager?.getActiveSession();
		if (!active) {
			return;
		}
		setVideoEnabled((prev) => {
			const next = !prev;
			active.setVideoEnabled(next);
			return next;
		});
	}, [manager]);

	return {
		incoming,
		state,
		remoteUserId: session?.remoteUserId ?? incoming?.from,
		isVideo: session?.isVideo() ?? incoming?.video ?? false,
		localStream,
		remoteStream,
		isMuted,
		videoEnabled,
		isBusy: Boolean(session) || Boolean(incoming),
		call,
		accept,
		reject,
		hangup,
		toggleMute,
		toggleVideo,
	};
}
