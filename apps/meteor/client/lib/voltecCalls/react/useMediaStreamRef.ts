/**
 * Returns a callback ref that binds a `MediaStream` to a media element's
 * `srcObject`. Pure React + DOM, no Rocket.Chat coupling.
 *
 * Usage: `<video ref={useMediaStreamRef(remoteStream)} autoPlay playsInline />`
 */
import { useCallback } from 'react';

export function useMediaStreamRef(stream: MediaStream | undefined): (element: HTMLMediaElement | null) => void {
	return useCallback(
		(element: HTMLMediaElement | null) => {
			if (!element) {
				return;
			}
			if (element.srcObject !== (stream ?? null)) {
				element.srcObject = stream ?? null;
			}
		},
		[stream],
	);
}
