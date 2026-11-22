export const ROW_EDITOR_SELECTOR = "[data-editing]";
export const PROJECT_EDITOR_SELECTOR = "#repo";

export function blockedEditorField(selector: string): HTMLElement | null {
  return (
    document.querySelector(selector)?.querySelector<HTMLElement>("input:not([readonly]), button") ??
    null
  );
}

export function openEditorField(): HTMLElement | null {
  return blockedEditorField(ROW_EDITOR_SELECTOR) ?? blockedEditorField(PROJECT_EDITOR_SELECTOR);
}
