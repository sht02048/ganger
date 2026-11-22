import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Card,
  CodeBlock,
  InfoTip,
  PageHeader,
  ScreenLayout,
  SegmentedTabs,
  SettingsGroup,
  SettingsLayout,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  showToast,
  textStyles,
} from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { isMcpRejectReason, isMcpWriteTool } from "@ganger/app/mcp/actions";
import type { McpActionView } from "@ganger/app/mcp/actions";
import { hermesConfig, jsonConfig } from "@ganger/app/settings/mcp-launch";
import type { McpView } from "@ganger/app/settings/model";
import { useTime } from "../format/time";
import { browserClipboard, copyText } from "./clipboard";
import { AutoSaveStatusText, RevertedMessage, useAutoSave } from "./row-state";
import type { SettingsActions } from "./settings-screen";
import {
  MCP_ROW_ID,
  SettingsBackLink,
  plainSettingsLink,
  type RenderSettingsLink,
} from "./settings-page";

type McpClient = "hermes" | "json";

export interface McpScreenProps {
  mcp: McpView;
  ws: string | undefined;
  actions: SettingsActions;
  renderLink?: RenderSettingsLink;
}

export function McpScreen({
  mcp,
  ws,
  actions,
  renderLink = plainSettingsLink(ws),
}: McpScreenProps) {
  const t = useTranslations("settings");
  const back = (
    <SettingsBackLink label={t("mcp.back")} rowId={MCP_ROW_ID} renderLink={renderLink} />
  );
  return (
    <ScreenLayout header={<PageHeader lead={back} title={t("mcp.title")} />}>
      <SettingsLayout>
        <SettingsSection
          id="client"
          title={t("mcp.clientTitle")}
          info={
            <InfoTip
              label={t("infoLabel", { label: t("mcp.clientTitle") })}
              content={t("mcp.intro")}
            />
          }
        >
          <ClientConfig mcp={mcp} />
        </SettingsSection>
        <SettingsSection id="write" title={t("mcp.writeTitle")}>
          <SettingsGroup>
            <WriteRow allowed={mcp.writeAllowed} actions={actions} />
          </SettingsGroup>
        </SettingsSection>
        <SettingsSection
          id="recent"
          title={t("mcp.recentTitle")}
          info={
            <InfoTip
              label={t("infoLabel", { label: t("mcp.recentTitle") })}
              content={t("mcp.recentNote")}
            />
          }
        >
          <Recent recent={mcp.recent} now={mcp.now} />
        </SettingsSection>
      </SettingsLayout>
    </ScreenLayout>
  );
}

function ClientConfig({ mcp }: { mcp: McpView }) {
  const t = useTranslations("settings.mcp");
  const [client, setClient] = useState<McpClient>("hermes");
  const name = client === "hermes" ? t("hermes") : t("json");
  const text = client === "hermes" ? hermesConfig(mcp.launch) : jsonConfig(mcp.launch);
  const copy = () => {
    void copyText(text, browserClipboard()).then((copied) =>
      showToast(copied ? t("copied", { name }) : t("copyFailed")),
    );
  };
  return (
    <Card>
      <div {...stylex.props(styles.tabs)}>
        <SegmentedTabs<McpClient>
          label={t("clientTabs")}
          value={client}
          onValueChange={setClient}
          items={[
            { value: "hermes", label: t("hermes") },
            { value: "json", label: t("json") },
          ]}
        />
        <Button onClick={copy}>{t("copy")}</Button>
      </div>
      <CodeBlock tone="command" label={name}>
        {text}
      </CodeBlock>
      <Text variant="meta" as="p">
        {client === "hermes" ? t("hermesWhere") : t("jsonWhere")}
      </Text>
      {mcp.launch.located ? null : (
        <Text variant="meta" as="p" tone="problem">
          {t("notLocated")}
        </Text>
      )}
    </Card>
  );
}

function WriteRow({ allowed, actions }: { allowed: boolean; actions: SettingsActions }) {
  const t = useTranslations("settings.mcp");
  const labelId = useId();
  const switchId = useId();
  const autoSave = useAutoSave(allowed, (next: boolean) => actions.saveMcpWrite({ allowed: next }));
  return (
    <SettingsRow
      label={t("writeToggle")}
      labelId={labelId}
      labelFor={switchId}
      info={<InfoTip label={t("writeRiskLabel")} content={t("writeRisk")} />}
      detail={t("writeDetail")}
      status={<AutoSaveStatusText status={autoSave.status} />}
      control={
        <Switch
          id={switchId}
          aria-labelledby={labelId}
          checked={autoSave.value}
          onCheckedChange={autoSave.change}
        />
      }
      message={<RevertedMessage error={autoSave.error} />}
    />
  );
}

function Recent({ recent, now }: { recent: ReadonlyArray<McpActionView>; now: string }) {
  const t = useTranslations("settings.mcp");
  const { stamp } = useTime();
  const toolName = (tool: string): string => (isMcpWriteTool(tool) ? t(`tool.${tool}`) : tool);
  if (recent.length === 0) {
    return (
      <SettingsGroup>
        <SettingsRow label={t("recentEmpty")} />
      </SettingsGroup>
    );
  }
  return (
    <SettingsGroup>
      {recent.map((action, index) => (
        <SettingsRow
          key={`${action.at}-${index}`}
          label={t("detail", {
            tool: toolName(action.tool),
            target: action.target ?? "",
            hasTarget: action.target === null ? "no" : "yes",
          })}
          detail={
            action.outcome === "done"
              ? t("actor", { client: action.client })
              : `${t("actor", { client: action.client })} · ${
                  isMcpRejectReason(action.reason)
                    ? t("rejected", { reason: t(`reason.${action.reason}`) })
                    : t("rejectedUnknown")
                }`
          }
          detailTone={action.outcome === "done" ? "default" : "problem"}
          value={
            <time dateTime={action.at} {...stylex.props(textStyles("meta"))}>
              {stamp(action.at, now)}
            </time>
          }
        />
      ))}
    </SettingsGroup>
  );
}

const styles = stylex.create({
  tabs: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
  },
});
