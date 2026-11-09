import { useEffect } from 'react';

/** Close this overlay when another HUD mode takes focus (jarvis:hud-dismiss). */
export function useHudDismiss(overlayKind, onDismiss) {
  useEffect(() => {
    const handler = (e) => {
      const except = e.detail?.except;
      if (except && except !== overlayKind) {
        onDismiss?.();
      }
    };
    window.addEventListener('jarvis:hud-dismiss', handler);
    return () => window.removeEventListener('jarvis:hud-dismiss', handler);
  }, [overlayKind, onDismiss]);
}
