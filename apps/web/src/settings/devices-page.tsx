import { InfoTip, SettingsGroup, SettingsRow } from "@ganger/ui";
import type { DevicesView } from "@ganger/app/devices/connection";
import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { AddressesView, SettingsPage } from "@ganger/app/settings/model";
import { DevicesSection, type DeviceActions } from "./devices-section";
import type { UnsavedGuard } from "./navigation-guard";
import { useInlineEdit } from "./row-state";
import { SettingsFrame, withSettingsEditors } from "./settings-frame";
import { ChangeButton, TextEditor, WEB_ADDRESS_ROW_ID } from "./settings-page";
import type { SettingsActions } from "./settings-screen";

export interface DevicesScreenProps {
  page: Pick<SettingsPage, "install">;
  devices: DevicesView;
  deviceActions: DeviceActions;
  actions: SettingsActions;
  nav: ReactNode;
  renderGuard?: (guard: UnsavedGuard) => ReactNode;
}

function DevicesPage({ page, devices, deviceActions, actions, nav }: DevicesScreenProps) {
  const t = useTranslations("settings");
  return (
    <SettingsFrame title={t("pages.devices")} nav={nav}>
      <SettingsGroup>
        <WebAddressRow addresses={page.install.addresses} actions={actions} />
        <AutoAllowedRow hosts={page.install.addresses.autoAllowedHosts} />
      </SettingsGroup>
      <DevicesSection view={devices} actions={deviceActions} />
    </SettingsFrame>
  );
}

function WebAddressRow({
  addresses,
  actions,
}: {
  addresses: AddressesView;
  actions: SettingsActions;
}) {
  const t = useTranslations("settings");
  const edit = useInlineEdit("address-webAddress");
  const labelId = useId();
  const current = addresses.webAddress;
  const label = t("addresses.web");
  return (
    <SettingsRow
      id={WEB_ADDRESS_ROW_ID}
      label={label}
      labelId={labelId}
      info={<InfoTip label={t("infoLabel", { label })} content={t("addresses.webInfo")} />}
      detail={current ?? t("addresses.webNone")}
      detailMono={current !== null}
      control={
        edit.open ? undefined : (
          <ChangeButton
            edit={edit}
            label={label}
            action={current === null ? t("addresses.set") : t("change")}
          />
        )
      }
      formOnly
      expanded={
        edit.open ? (
          <TextEditor
            label={label}
            initial={current ?? ""}
            type="url"
            mono
            placeholder={t("addresses.webPlaceholder")}
            validate={() => null}
            save={(value) =>
              actions.saveAddresses({
                webAddress: value.trim(),
                webhookAddress: addresses.webhookAddress ?? "",
              })
            }
            saved={t("saved")}
            onClose={edit.close}
          />
        ) : null
      }
    />
  );
}

function AutoAllowedRow({ hosts }: { hosts: ReadonlyArray<string> }) {
  const t = useTranslations("settings");
  if (hosts.length === 0) return null;
  const label = t("addresses.autoAllowed");
  return (
    <SettingsRow
      label={label}
      info={<InfoTip label={t("infoLabel", { label })} content={t("addresses.autoAllowedInfo")} />}
      detail={hosts.join(", ")}
      detailMono
    />
  );
}

export const DevicesScreen = withSettingsEditors(DevicesPage);
