import * as stylex from "@stylexjs/stylex";
import {
  Actions,
  Button,
  CapacityBar,
  CapacityCells,
  CapacityTrack,
  CheckResultIcon,
  CheckResultList,
  CheckResultRow,
  EditIcon,
  ExpandableRow,
  UnknownIcon,
  Card,
  ExternalIconLink,
  GangerMark,
  GroupHeader,
  InfoTip,
  Mascot,
  MASCOT_MOODS,
  MascotMessage,
  PanelList,
  PanelListRow,
  PanelRows,
  PanelSection,
  ResponsiveColumns,
  ResponsiveColumnsHead,
  ProblemCallout,
  Row,
  Section,
  SegmentedTabs,
  SignalList,
  SignalRow,
  StatTile,
  StatusDot,
  StatusPill,
  SURFACE_ROLES,
  Text,
  textStyles,
  UsageBar,
  UsageMeter,
} from "@ganger/ui";
import { colors, space } from "@ganger/ui/tokens.stylex";
import { useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useStatusName } from "../status";

export const roleSectionIds = [
  "surfaces",
  "statusDot",
  "sections",
  "segmented",
  "groupHeader",
  "capacity",
  "usage",
  "capacityCells",
  "problem",
  "statTile",
  "brand",
] as const;

type Period = "7d" | "14d" | "30d";
type Split = "runner" | "agent" | "project";

const capacityCellsSamples = [
  { name: "runner-a", status: "online", used: 2, total: 3 },
  { name: "runner-b", status: "online", used: 3, total: 3 },
  { name: "runner-c", status: "runner-issue", used: 1, total: 2 },
  { name: "runner-d", status: "offline", used: 0, total: 2 },
  { name: "runner-e", status: "online", used: 5, total: 12 },
] as const;

function Demo({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.demo)}>{children}</div>;
}

export function RoleSections() {
  const t = useTranslations("ds");
  const statusName = useStatusName();
  const [period, setPeriod] = useState<Period>("7d");
  const [split, setSplit] = useState<Split>("runner");

  return (
    <>
      <div id="surfaces">
        <Section title={t("nav.surfaces")} note={t("surfaces.note")}>
          <div {...stylex.props(styles.surfaces)}>
            {SURFACE_ROLES.map((surface) => (
              <Card key={surface} surface={surface}>
                <Text variant="label">{surface}</Text>
                <Text variant="body">{t(`surfaces.${surface}`)}</Text>
              </Card>
            ))}
          </div>
        </Section>
      </div>

      <div id="statusDot">
        <Section title={t("nav.statusDot")} note={t("statusDot.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Section title={t("statusDot.sectionTitle")} titleRole="heading" count={2}>
                <Row
                  interactive={false}
                  leading={<StatusDot status="running">{statusName("running")}</StatusDot>}
                  trailing={t("statusDot.runningTime")}
                >
                  <Text variant="title">{t("statusDot.running")}</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={
                    <StatusDot status="waiting-for-input">
                      {statusName("waiting-for-input")}
                    </StatusDot>
                  }
                  trailing={t("statusDot.waitingTime")}
                >
                  <Text variant="title">{t("statusDot.waiting")}</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={<StatusDot status="queued">{statusName("queued")}</StatusDot>}
                  trailing={t("statusDot.queuedTime")}
                >
                  <Text variant="title">{t("statusDot.queued")}</Text>
                </Row>
              </Section>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="sections">
        <Section title={t("nav.sections")} note={t("sections.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Section
                title={t("sections.headingTitle")}
                titleRole="heading"
                count={3}
                link={{ href: "#sections", label: t("sections.link") }}
              >
                <Text variant="meta">{t("sections.headingBody")}</Text>
              </Section>
              <Section title={t("sections.subheadingTitle")} titleRole="subheading" count={2}>
                <Text variant="meta">{t("sections.subheadingBody")}</Text>
              </Section>
              <p {...stylex.props(textStyles("display"))}>{t("sections.display")}</p>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="segmented">
        <Section title={t("nav.segmented")} note={t("segmented.note")}>
          <Demo>
            <SegmentedTabs<Period>
              value={period}
              onValueChange={setPeriod}
              label={t("segmented.periodLabel")}
              items={[
                { value: "7d", label: t("segmented.days7"), count: 18 },
                { value: "14d", label: t("segmented.days14"), count: 31 },
                { value: "30d", label: t("segmented.days30"), count: 64 },
              ]}
            />
            <SegmentedTabs<Split>
              value={split}
              onValueChange={setSplit}
              label={t("segmented.splitLabel")}
              items={[
                { value: "runner", label: t("segmented.byRunner") },
                { value: "agent", label: t("segmented.byAgent") },
                { value: "project", label: t("segmented.byProject") },
              ]}
            />
          </Demo>
        </Section>
      </div>

      <div id="groupHeader">
        <Section title={t("nav.groupHeader")} note={t("groupHeader.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <GroupHeader
                status="question"
                title={t("groupHeader.answerTitle")}
                count={2}
                description={t("groupHeader.answer")}
              />
              <GroupHeader
                status="failed"
                title={t("groupHeader.stuckTitle")}
                count={7}
                description={t("groupHeader.stuck")}
              />
            </div>
          </Demo>
        </Section>
      </div>

      <div id="capacity">
        <Section title={t("nav.capacity")} note={t("capacity.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Card padding="compact">
                <Row
                  interactive={false}
                  leading={<StatusPill status="online">{statusName("online")}</StatusPill>}
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <CapacityBar used={1} total={2} label={t("capacity.label")} />
                    </span>
                  }
                >
                  <Text variant="title">runner-a</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={<StatusPill status="online">{statusName("online")}</StatusPill>}
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <CapacityBar used={3} total={3} label={t("capacity.label")} />
                    </span>
                  }
                >
                  <Text variant="title">runner-b</Text>
                </Row>
                <Row
                  interactive={false}
                  leading={
                    <StatusPill status="runner-issue">{statusName("runner-issue")}</StatusPill>
                  }
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <CapacityBar used={0} total={2} label={t("capacity.label")} tone="problem" />
                    </span>
                  }
                >
                  <Text variant="title">runner-c</Text>
                </Row>
              </Card>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="usage">
        <Section title={t("nav.usage")} note={t("usage.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Card padding="compact">
                <Row
                  interactive={false}
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <UsageBar percent={42} label={t("usage.label")} />
                    </span>
                  }
                >
                  <Text variant="title">{t("usage.session")}</Text>
                </Row>
                <Row
                  interactive={false}
                  trailing={
                    <span {...stylex.props(styles.capacity)}>
                      <UsageBar percent={93} label={t("usage.label")} tone="problem" />
                    </span>
                  }
                >
                  <Text variant="title">{t("usage.weekly")}</Text>
                </Row>
              </Card>
              <span {...stylex.props(styles.usageMeter)}>
                <UsageMeter
                  name={t("usage.session")}
                  percent={100}
                  label={t("usage.label")}
                  tone="problem"
                />
              </span>
              <PanelSection
                title={t("signals.title")}
                detail={t("signals.detail")}
                meta={t("signals.meta")}
              >
                <SignalList>
                  <SignalRow label={t("signals.ci")} tone="problem">
                    {t("signals.ciValue")}
                  </SignalRow>
                  <SignalRow label={t("signals.conflict")} tone="pass">
                    {t("signals.conflictValue")}
                  </SignalRow>
                  <SignalRow label={t("signals.base")} tone="warning">
                    {t("signals.baseValue")}
                  </SignalRow>
                  <SignalRow label={t("signals.unknown")} tone="neutral">
                    {t("signals.unknownValue")}
                  </SignalRow>
                </SignalList>
              </PanelSection>
              <PanelSection title={t("usage.panelTitle")} meta={t("usage.panelMeta")}>
                <Text variant="ui">{t("usage.panelBody")}</Text>
                <PanelRows>
                  <li>
                    <Row interactive={false}>
                      <Text variant="ui">{t("usage.panelRow")}</Text>
                    </Row>
                  </li>
                </PanelRows>
              </PanelSection>
              <PanelSection
                title={t("usage.listTitle")}
                titleRole="subheading"
                count={2}
                info={<InfoTip label={t("usage.listInfoLabel")} content={t("usage.listInfo")} />}
                meta={
                  <span {...stylex.props(styles.listActions)}>
                    <Button compact>{t("usage.listAction")}</Button>
                    <ExternalIconLink
                      href="https://example.com/acme/ACME-12"
                      label={t("usage.listOpen")}
                    />
                  </span>
                }
              >
                <PanelList>
                  <PanelListRow
                    marker={<StatusDot status="running" />}
                    ticketKey="ACME-12"
                    title={t("usage.listRow")}
                    trailing={statusName("running")}
                    onClick={() => {}}
                  />
                  <PanelListRow
                    marker={<StatusDot status="succeeded" />}
                    ticketKey="ACME-9"
                    title={t("usage.listRowDone")}
                    trailing={statusName("succeeded")}
                    done
                  />
                </PanelList>
              </PanelSection>
              <ResponsiveColumnsHead
                lead={t("usage.columnsLead")}
                columns={[{ width: "200px", content: t("usage.columnsUsage") }]}
              />
              <ResponsiveColumns
                lead={<Text variant="title">{t("usage.columnsLead")}</Text>}
                columns={[
                  {
                    width: "200px",
                    content: (
                      <UsageMeter name={t("usage.weekly")} percent={72} label={t("usage.label")} />
                    ),
                  },
                ]}
              />
            </div>
          </Demo>
        </Section>
      </div>

      <div id="capacityCells">
        <Section title={t("nav.capacityCells")} note={t("capacityCells.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <Section
                title={t("capacityCells.title")}
                count={capacityCellsSamples.length}
                note={t("capacityCells.free", { count: 8 })}
              >
                {capacityCellsSamples.map((sample) => (
                  <Row
                    key={sample.name}
                    interactive={false}
                    leading={
                      <StatusDot status={sample.status}>{statusName(sample.status)}</StatusDot>
                    }
                    trailing={
                      <CapacityCells
                        used={sample.used}
                        total={sample.total}
                        label={t("capacityCells.label", { used: sample.used, total: sample.total })}
                        tone={sample.status === "online" ? "progress" : "problem"}
                      />
                    }
                  >
                    <Text variant="title">{sample.name}</Text>
                  </Row>
                ))}
              </Section>
            </div>
          </Demo>
          <Demo>
            <div {...stylex.props(styles.usageMeter)}>
              <CapacityTrack
                used={2}
                total={3}
                label={t("capacityCells.label", { used: 2, total: 3 })}
              />
            </div>
            <div {...stylex.props(styles.usageMeter)}>
              <CheckResultList>
                <CheckResultRow
                  state="broken"
                  stateLabel={t("checkResult.broken")}
                  name={t("checkResult.push")}
                  reason={t("checkResult.reason")}
                />
                <CheckResultRow
                  state="unknown"
                  stateLabel={t("checkResult.unknown")}
                  name={t("checkResult.service")}
                />
                <CheckResultRow
                  state="ok"
                  stateLabel={t("checkResult.ok")}
                  name={t("checkResult.agent")}
                />
              </CheckResultList>
            </div>
            <div {...stylex.props(styles.usageMeter)}>
              <ExpandableRow
                leading={<CheckResultIcon state="ok" />}
                summary={t("checkResult.allPassed")}
              >
                <CheckResultList>
                  <CheckResultRow
                    state="ok"
                    stateLabel={t("checkResult.ok")}
                    name={t("checkResult.agent")}
                  />
                </CheckResultList>
              </ExpandableRow>
            </div>
            <EditIcon />
            <UnknownIcon />
          </Demo>
        </Section>
      </div>

      <div id="problem">
        <Section title={t("nav.problem")} note={t("problem.note")}>
          <Demo>
            <div {...stylex.props(styles.stack)}>
              <ProblemCallout
                title={t("problem.title")}
                steps={[t("problem.step1"), t("problem.step2")]}
                actions={
                  <Actions>
                    <Button>{t("problem.recheck")}</Button>
                  </Actions>
                }
              >
                {t("problem.body")}
              </ProblemCallout>
              <ProblemCallout title={t("problem.offlineTitle")}>
                {t("problem.offlineBody")}
              </ProblemCallout>
            </div>
          </Demo>
        </Section>
      </div>

      <div id="statTile">
        <Section title={t("nav.statTile")} note={t("statTile.note")}>
          <div {...stylex.props(styles.tiles)}>
            <StatTile
              value="42"
              label={t("statTile.done")}
              detail={t("statTile.doneDetail")}
              trend="better"
            />
            <StatTile
              value="6"
              label={t("statTile.failed")}
              detail={t("statTile.failedDetail")}
              trend="worse"
            />
            <StatTile
              value={t("statTile.waitValue")}
              label={t("statTile.wait")}
              detail={t("statTile.waitDetail")}
            />
          </div>
        </Section>
      </div>

      <div id="brand">
        <Section title={t("nav.brand")} note={t("brand.note")}>
          <Demo>
            <div {...stylex.props(styles.brandRow)}>
              <figure {...stylex.props(styles.figure)}>
                <GangerMark tone="mono" size="large" />
                <Text variant="meta" as="span">
                  {t("brand.mono")}
                </Text>
              </figure>
              <figure {...stylex.props(styles.figure)}>
                <GangerMark tone="brand" size="large" />
                <Text variant="meta" as="span">
                  {t("brand.color")}
                </Text>
              </figure>
            </div>
            <div {...stylex.props(styles.brandRow)}>
              {MASCOT_MOODS.map((mood) => (
                <figure key={mood} {...stylex.props(styles.figure)}>
                  <Mascot mood={mood} />
                  <Text variant="meta" as="span">
                    {t(`brand.moods.${mood}`)}
                  </Text>
                </figure>
              ))}
            </div>
            <MascotMessage mood="resting" size="small">
              <Text variant="meta" as="p">
                {t("brand.message")}
              </Text>
            </MascotMessage>
          </Demo>
        </Section>
      </div>
    </>
  );
}

const styles = stylex.create({
  listActions: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  demo: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s4,
    paddingBlock: space.s5,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4, width: "100%", maxWidth: 640 },
  surfaces: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: space.s3,
  },
  capacity: { display: "block", width: 160 },
  usageMeter: { display: "block", width: 200 },
  brandRow: { display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: space.s6 },
  figure: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    margin: 0,
    color: colors.textPrimary,
  },
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: space.s3,
  },
});
