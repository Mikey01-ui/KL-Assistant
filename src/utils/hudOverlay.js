import { dismissOtherHudOverlays } from './overlayCoordinator';

/** One primary HUD overlay at a time. */
export function focusHudOverlay(kind) {
  dismissOtherHudOverlays(kind);
  window.dispatchEvent(new CustomEvent('jarvis:hud-focus', { detail: { kind } }));
}
