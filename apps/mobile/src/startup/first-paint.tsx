import { createContext, useContext, useEffect } from "react";

export const FirstPaintReady = createContext<() => void>(() => undefined);

export function useFirstPaint(ready: boolean): void {
  const markReady = useContext(FirstPaintReady);
  useEffect(() => {
    if (ready) markReady();
  }, [ready, markReady]);
}
