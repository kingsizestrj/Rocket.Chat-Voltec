/**
 * Tiny typed event emitter with no external dependencies, so the call engine
 * stays self-contained and unit-testable. Generic over an event map where each
 * key is an event name and the value is its payload type.
 */
export type EmitterListener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
	private readonly listeners = new Map<keyof Events, Set<EmitterListener<unknown>>>();

	/** Subscribe to an event. Returns an unsubscribe function. */
	on<K extends keyof Events>(event: K, listener: EmitterListener<Events[K]>): () => void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener as EmitterListener<unknown>);
		return () => {
			set?.delete(listener as EmitterListener<unknown>);
		};
	}

	/** Remove every listener for every event. */
	clear(): void {
		this.listeners.clear();
	}

	protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
		const set = this.listeners.get(event);
		if (!set) {
			return;
		}
		// Copy to a array so listeners can safely unsubscribe during emission.
		for (const listener of Array.from(set)) {
			try {
				(listener as EmitterListener<Events[K]>)(payload);
			} catch (err) {
				// A faulty listener must not break the others or the call.
				// eslint-disable-next-line no-console
				console.error('[voltec-calls] listener error', err);
			}
		}
	}
}
