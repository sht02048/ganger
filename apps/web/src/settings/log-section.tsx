import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Checkbox,
  Field,
  InfoTip,
  Select,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  showToast,
} from "@ganger/ui";
import { size, space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { useByteSize } from "../format/size";
import type { DiagnosticsRunChoice, LogSettingsView } from "@ganger/app/diagnostics/model";
import { browserClipboard, copyText } from "./clipboard";
import { AutoSaveStatusText, RevertedMessage, useAutoSave, useInlineEdit } from "./row-state";
import type { ActionResult } from "./settings-screen";
import { ChangeButton, FocusFirst } from "./settings-page";

export type DiagnosticsResult = { ok: true; name: string } | { ok: false; reason: string };

export interface LogActions {
  saveDebug: (input: { debug: boolean }) => Promise<ActionResult>;
  makeDiagnostics: (input: {
    anonymize: boolean;
    runId: string | null;
  }) => Promise<DiagnosticsResult>;
  openFolder: (() => Promise<boolean>) | null;
}

export interface LogSectionProps {
  view: LogSettingsView;
  actions: LogActions;
}

const NO_RUN = "";
export function LogSection({ view, actions }: LogSectionProps) {
  const t = useTranslations("settings");
  return (
    <SettingsSection id="logs" title={t("logs.title")}>
      <SettingsGroup>
        <SizeRow view={view} />
        {view.available ? (
          <FolderRow
            folder={view.folder}
            shown={view.folderShown}
            openFolder={actions.openFolder}
          />
        ) : null}
        <DebugRow view={view} saveDebug={actions.saveDebug} />
        <DiagnosticsRow view={view} makeDiagnostics={actions.makeDiagnostics} />
      </SettingsGroup>
    </SettingsSection>
  );
}

function SizeRow({ view }: { view: LogSettingsView }) {
  const t = useTranslations("settings");
  const byteSize = useByteSize();
  const label = t("logs.size");
  return (
    <SettingsRow
      label={label}
      info={<InfoTip label={t("infoLabel", { label })} content={t("logs.sizeInfo")} />}
      detail={
        view.available
          ? t("logs.sizeDetail", { size: byteSize(view.totalBytes) })
          : t("logs.unavailable")
      }
    />
  );
}

function FolderRow({
  folder,
  shown,
  openFolder,
}: {
  folder: string;
  shown: string;
  openFolder: (() => Promise<boolean>) | null;
}) {
  const t = useTranslations("settings");
  const label = t("logs.folder");
  const [opening, setOpening] = useState(false);
  const open = () => {
    if (openFolder === null || opening) return;
    setOpening(true);
    openFolder().then(
      (opened) => {
        setOpening(false);
        if (!opened) showToast(t("logs.openFailed"));
      },
      () => {
        setOpening(false);
        showToast(t("logs.openFailed"));
      },
    );
  };
  const copy = () => {
    void copyText(folder, browserClipboard()).then((copied) =>
      showToast(copied ? t("logs.copied") : t("logs.copyFailed")),
    );
  };
  return (
    <SettingsRow
      label={label}
      info={
        <InfoTip
          label={t("infoLabel", { label })}
          content={openFolder === null ? t("logs.folderInfoBrowser") : t("logs.folderInfo")}
        />
      }
      detail={shown}
      detailMono
      control={
        openFolder === null ? (
          <Button onClick={copy}>{t("logs.copyPath")}</Button>
        ) : (
          <Button aria-busy={opening} onClick={open}>
            {t("logs.openFolder")}
          </Button>
        )
      }
    />
  );
}

function DebugRow({
  view,
  saveDebug,
}: {
  view: LogSettingsView;
  saveDebug: LogActions["saveDebug"];
}) {
  const t = useTranslations("settings");
  const labelId = useId();
  const switchId = useId();
  const available = view.available;
  const autoSave = useAutoSave(available && view.debug, (debug: boolean) => saveDebug({ debug }));
  const label = t("logs.debug");
  return (
    <SettingsRow
      label={label}
      labelId={labelId}
      labelFor={switchId}
      disabled={!available}
      info={<InfoTip label={t("infoLabel", { label })} content={t("logs.debugInfo")} />}
      detail={t("logs.debugDetail")}
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <Switch
          id={switchId}
          aria-labelledby={labelId}
          checked={available && autoSave.value}
          disabled={!available}
          onCheckedChange={autoSave.change}
        />
      }
      message={<RevertedMessage error={autoSave.error} />}
    />
  );
}

type MakeState =
  | { kind: "idle" }
  | { kind: "making" }
  | { kind: "made"; name: string }
  | { kind: "failed" };

function DiagnosticsRow({
  view,
  makeDiagnostics,
}: {
  view: LogSettingsView;
  makeDiagnostics: LogActions["makeDiagnostics"];
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("logs-diagnostics");
  const label = t("logs.diagnostics");
  const [state, setState] = useState<MakeState>({ kind: "idle" });
  const close = () => {
    setState({ kind: "idle" });
    edit.close();
  };
  return (
    <SettingsRow
      label={label}
      info={<InfoTip label={t("infoLabel", { label })} content={t("logs.diagnosticsInfo")} />}
      detail={t("logs.diagnosticsDetail")}
      control={
        edit.open ? undefined : <ChangeButton edit={edit} label={label} action={t("logs.make")} />
      }
      expanded={
        edit.open ? (
          <FocusFirst onEscape={close}>
            <DiagnosticsForm
              runs={view.available ? view.runs : []}
              state={state}
              onClose={close}
              onMake={(input) => {
                if (state.kind === "making") return;
                setState({ kind: "making" });
                makeDiagnostics(input).then(
                  (result) => {
                    setState(result.ok ? { kind: "made", name: result.name } : { kind: "failed" });
                  },
                  () => setState({ kind: "failed" }),
                );
              }}
            />
          </FocusFirst>
        ) : null
      }
    />
  );
}

function DiagnosticsForm({
  runs,
  state,
  onClose,
  onMake,
}: {
  runs: ReadonlyArray<DiagnosticsRunChoice>;
  state: MakeState;
  onClose: () => void;
  onMake: (input: { anonymize: boolean; runId: string | null }) => void;
}) {
  const t = useTranslations("settings");
  const td = useTranslations("domain");
  const [anonymize, setAnonymize] = useState(true);
  const [runId, setRunId] = useState(NO_RUN);
  const making = state.kind === "making";
  const reviewId = useId();
  const runOptions = [
    { value: NO_RUN, label: t("logs.runNone") },
    ...runs.map((run) => ({
      value: run.id,
      label: t("logs.runOption", { ticket: run.ticketKey, state: td(`runState.${run.state}`) }),
    })),
  ];
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event) => {
        event.preventDefault();
        onMake({ anonymize, runId: runId === NO_RUN ? null : runId });
      }}
    >
      <Checkbox
        label={t("logs.anonymize")}
        description={t("logs.anonymizeDescription")}
        checked={anonymize}
        onCheckedChange={setAnonymize}
      />
      <Field label={t("logs.run")} description={t("logs.runDescription")}>
        <Select options={runOptions} value={runId} onValueChange={setRunId} />
      </Field>
      <Text id={reviewId} variant="ui" as="p" tone="strong">
        {t("logs.review")}
      </Text>
      <Text
        variant="ui"
        as="p"
        role="status"
        {...(state.kind === "failed" ? { tone: "problem" as const } : {})}
      >
        {state.kind === "made"
          ? t("logs.made", { name: state.name })
          : state.kind === "failed"
            ? t("logs.makeFailed")
            : null}
      </Text>
      <div {...stylex.props(styles.actions)}>
        <Button variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
        <Button variant="primary" type="submit" aria-busy={making} aria-describedby={reviewId}>
          {making ? t("logs.making") : t("logs.make")}
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  form: { display: "flex", flexDirection: "column", gap: space.s4, maxWidth: size.formWidth },
  actions: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: space.s2 },
});
