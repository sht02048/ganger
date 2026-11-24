import { InfoTip, SettingsGroup, SettingsRow, SettingsSection, Switch } from "@ganger/ui";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { PowerView, SettingsPage } from "@ganger/app/settings/model";
import type { LogSettingsView } from "@ganger/app/diagnostics/model";
import { LogSection, type LogActions } from "./log-section";
import { AutoSaveStatusText, RevertedMessage, useAutoSave } from "./row-state";
import type { UnsavedGuard } from "./navigation-guard";
import { SettingsFrame, withSettingsEditors } from "./settings-frame";
import type { SettingsActions } from "./settings-screen";
import { UpdatesRows } from "./updates-panel";

export interface ServerScreenProps {
  page: Pick<SettingsPage, "install">;
  logs: LogSettingsView;
  logActions: LogActions;
  actions: SettingsActions;
  nav: ReactNode;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

function ServerPage({ page, logs, logActions, actions, nav }: ServerScreenProps) {
  const t = useTranslations("settings");
  return (
    <SettingsFrame title={t("pages.server")} nav={nav}>
      <SettingsSection id="version" title={t("server.version")}>
        <SettingsGroup>
          <UpdatesRows />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection id="machine" title={t("server.machine")}>
        <SettingsGroup>
          <PowerRow power={page.install.power} actions={actions} />
        </SettingsGroup>
      </SettingsSection>
      <LogSection view={logs} actions={logActions} />
    </SettingsFrame>
  );
}

function PowerRow({ power, actions }: { power: PowerView; actions: SettingsActions }) {
  const t = useTranslations("settings");
  const labelId = useId();
  const switchId = useId();
  const autoSave = useAutoSave(power.preventSleep, (preventSleep: boolean) =>
    actions.savePower({ preventSleep }),
  );
  return (
    <SettingsRow
      label={t("power.toggle")}
      labelId={labelId}
      labelFor={switchId}
      disabled={!power.available}
      info={
        <InfoTip label={t("infoLabel", { label: t("power.toggle") })} content={t("power.info")} />
      }
      detail={power.available ? t("power.detail") : t("power.unavailable")}
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <Switch
          id={switchId}
          aria-labelledby={labelId}
          checked={power.available && autoSave.value}
          disabled={!power.available}
          onCheckedChange={autoSave.change}
        />
      }
      message={<RevertedMessage error={autoSave.error} />}
    />
  );
}

export const ServerScreen = withSettingsEditors(ServerPage);
