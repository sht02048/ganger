import { Text } from "@ganger/ui";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "use-intl";
import { ROW_EDITOR_SELECTOR, blockedEditorField } from "./blocked-editor";
import type { UnsavedGuard } from "./navigation-guard";
import { ReportUnsavedContext, useReason, type ActionResult } from "./settings-screen";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "reverted";

export interface AutoSave<T> {
  value: T;
  status: AutoSaveStatus;
  error: string | null;
  change: (value: T) => void;
}

export function useAutoSave<T>(saved: T, save: (value: T) => Promise<ActionResult>): AutoSave<T> {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const change = useCallback(
    (value: T) => {
      const attempt = latest.current + 1;
      latest.current = attempt;
      setPending({ value });
      setStatus("saving");
      setError(null);
      const settle = (result: ActionResult) => {
        if (latest.current !== attempt) return;
        setPending(null);
        if (result.ok) {
          setStatus("saved");
        } else {
          setStatus("reverted");
          setError(result.reason);
        }
      };
      save(value).then(settle, () => settle({ ok: false, reason: "unknown" }));
    },
    [save],
  );
  return { value: pending === null ? saved : pending.value, status, error, change };
}

export function AutoSaveStatusText({ status }: { status: AutoSaveStatus }) {
  const t = useTranslations("settings.status");
  return status === "idle" ? null : t(status);
}

export function RevertedMessage({ error }: { error: string | null }) {
  const t = useTranslations("settings");
  const reason = useReason();
  if (error === null) return null;
  const known = reason(error);
  return (
    <Text variant="meta" as="p" tone="problem" role="alert">
      {known === t("failed") ? t("revertedRetry") : t("revertedReason", { reason: known })}
    </Text>
  );
}

interface EditorSlot {
  openId: string | null;
  blocked: boolean;
  open: (id: string) => void;
  closeAll: () => void;
}

const EditorContext = createContext<EditorSlot>({
  openId: null,
  blocked: false,
  open: () => {},
  closeAll: () => {},
});

export function showBlockedEditor(selector: string): void {
  document.querySelector(selector)?.scrollIntoView({ block: "nearest" });
  blockedEditorField(selector)?.focus({ preventScroll: true });
}

export function useUnsavedHold(blockedSelector: string) {
  const dirty = useRef(new Set<string>());
  const warned = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const report = useCallback((formId: string, unsaved: boolean) => {
    if (unsaved) dirty.current.add(formId);
    else dirty.current.delete(formId);
    if (dirty.current.size === 0) {
      warned.current = false;
      setBlocked(false);
    }
  }, []);
  const guard = useMemo(
    (): UnsavedGuard => ({
      hold: () => {
        if (dirty.current.size === 0) return false;
        if (warned.current) return false;
        warned.current = true;
        setBlocked(true);
        showBlockedEditor(blockedSelector);
        return true;
      },
    }),
    [blockedSelector],
  );
  return { blocked, report, guard };
}

export function EditorProvider({
  children,
  renderGuard,
  blockedSelector = ROW_EDITOR_SELECTOR,
}: {
  children: ReactNode;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
  blockedSelector?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { blocked, report, guard } = useUnsavedHold(blockedSelector);
  const open = useCallback(
    (id: string) => {
      if (openId !== null && openId !== id && guard.hold()) return;
      setOpenId(id);
    },
    [openId, guard],
  );
  const closeAll = useCallback(() => {
    setOpenId(null);
  }, []);
  const value = useMemo(
    () => ({ openId, blocked, open, closeAll }),
    [openId, blocked, open, closeAll],
  );
  return (
    <ReportUnsavedContext value={report}>
      <EditorContext value={value}>
        {renderGuard?.(guard)}
        {children}
      </EditorContext>
    </ReportUnsavedContext>
  );
}

export function EditorBlockedNotice() {
  const t = useTranslations("settings");
  const { blocked } = use(EditorContext);
  return (
    <Text variant="meta" as="p" tone="problem" role="alert">
      {blocked ? t("unsavedBlocked") : null}
    </Text>
  );
}

export interface InlineEdit {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  show: () => void;
  close: () => void;
}

export function useInlineEdit(id: string): InlineEdit {
  const { openId, open: openEditor, closeAll } = use(EditorContext);
  const open = openId === id;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    triggerRef.current?.focus();
  }, [open]);
  const show = useCallback(() => openEditor(id), [id, openEditor]);
  const close = useCallback(() => {
    refocus.current = true;
    closeAll();
  }, [closeAll]);
  return { open, triggerRef, show, close };
}

export function focusEditor(container: HTMLElement | null): void {
  if (container === null) return;
  const typing = window.matchMedia("(pointer: fine)").matches;
  const field =
    (typing
      ? container.querySelector<HTMLElement>(
          "input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])",
        )
      : null) ?? container.querySelector<HTMLElement>("button:not([disabled])");
  (field ?? container).focus({ preventScroll: field === null });
}

export function useFocusFirstField(): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusEditor(ref.current);
  }, []);
  return ref;
}
