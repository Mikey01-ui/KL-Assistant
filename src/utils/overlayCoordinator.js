/** Tell overlay widgets to close except the active voice-driven kind. */
export function dismissOtherHudOverlays(activeKind) {
  window.dispatchEvent(
    new CustomEvent('jarvis:hud-dismiss', { detail: { except: activeKind } })
  );
}
