export const SPLASH_MAX_MS = 2_000;

export interface SplashScreenPort {
  hide(): void;
}

export interface SplashGate {
  readonly ready: () => void;
  readonly hidden: () => boolean;
}

export function createSplashGate(splash: SplashScreenPort, maxMs = SPLASH_MAX_MS): SplashGate {
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    clearTimeout(limit);
    try {
      splash.hide();
    } catch {
      return;
    }
  };
  const limit = setTimeout(hide, maxMs);
  return { ready: hide, hidden: () => hidden };
}
