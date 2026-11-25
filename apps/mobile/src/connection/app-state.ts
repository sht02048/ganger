export interface AppStateSource {
  readonly currentState: string | null | undefined;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
}

export function isForegroundAppState(state: string | null | undefined): boolean {
  return state !== "background";
}

export function followForeground(
  source: AppStateSource,
  onForeground: (foreground: boolean) => void,
): () => void {
  let foreground = isForegroundAppState(source.currentState);
  onForeground(foreground);
  const subscription = source.addEventListener("change", (state) => {
    const next = isForegroundAppState(state);
    if (next === foreground) return;
    foreground = next;
    onForeground(next);
  });
  return () => subscription.remove();
}
