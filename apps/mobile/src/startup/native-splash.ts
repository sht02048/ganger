import { hide, preventAutoHideAsync } from "expo-splash-screen";

import type { SplashScreenPort } from "./splash-gate";

export const nativeSplash: SplashScreenPort = { hide };

export function holdNativeSplash(): void {
  void preventAutoHideAsync().catch(() => undefined);
}
