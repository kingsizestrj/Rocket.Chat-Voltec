/**
 * Voltec WebRTC calls — public entry point of the RC-agnostic core.
 *
 * The Rocket.Chat integration (DDP signaling transport, server relay method,
 * UI wiring) lives in the `integration/` reference templates and is documented
 * in `VOLTEC.md` (Fase 3 → activation checklist).
 */
export * from './definitions';
export { Emitter } from './Emitter';
export { WebRTCCallSession } from './WebRTCCallSession';
export type { CallSessionOptions } from './WebRTCCallSession';
export { CallManager } from './CallManager';
export type { CallManagerOptions } from './CallManager';
