import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { fontFamily } from "../design/tokens";

export function fontsBuiltIn(isFontLoaded: (family: string) => boolean): boolean {
  return Object.values(fontFamily).every((family) => isFontLoaded(family));
}

function RuntimeFontGate({
  loadFonts,
  children,
}: {
  loadFonts: () => Promise<void>;
  children: ReactNode;
}) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let current = true;
    const settle = () => {
      if (current) setSettled(true);
    };
    loadFonts().then(settle, settle);
    return () => {
      current = false;
    };
  }, [loadFonts]);
  return settled ? children : null;
}

export function FontGate({
  builtIn,
  loadFonts,
  children,
}: {
  builtIn: boolean;
  loadFonts: () => Promise<void>;
  children: ReactNode;
}) {
  return builtIn ? children : <RuntimeFontGate loadFonts={loadFonts}>{children}</RuntimeFontGate>;
}
