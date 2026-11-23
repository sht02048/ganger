import * as stylex from "@stylexjs/stylex";
import { BlockerChip, BlockerChips, blockerDotStyles, Text } from "@ganger/ui";
import type { BlockerChipState } from "@ganger/ui";
import { space } from "@ganger/ui/tokens.stylex";
import { useTranslations } from "use-intl";
import type { BlockerView } from "@ganger/app/runs/model";

export function blockerChipState(stateCategory: string): BlockerChipState {
  switch (stateCategory) {
    case "completed":
      return "done";
    case "canceled":
      return "canceled";
    case "started":
      return "active";
    default:
      return "waiting";
  }
}

export function BlockerChipList({
  blockers,
  cycleKey = null,
}: {
  blockers: ReadonlyArray<BlockerView>;
  cycleKey?: string | null;
}) {
  const t = useTranslations("domain.blocker.stuckCause");
  return (
    <BlockerChips>
      {blockers.map((blocker) => {
        if (blocker.key === cycleKey)
          return (
            <BlockerChip
              key={blocker.key}
              state="stuck"
              ticketKey={blocker.key}
              stateName={t("cycle")}
            />
          );
        const state = blockerChipState(blocker.stateCategory);
        return (
          <BlockerChip
            key={blocker.key}
            state={state}
            ticketKey={blocker.key}
            stateName={state === "canceled" ? t("canceled") : blocker.stateName}
          />
        );
      })}
    </BlockerChips>
  );
}

export function BlockerRows({ blockers }: { blockers: ReadonlyArray<BlockerView> }) {
  return (
    <ul {...stylex.props(styles.rows)}>
      {blockers.map((blocker) => (
        <li key={blocker.key} {...stylex.props(styles.row)}>
          <span
            aria-hidden="true"
            {...stylex.props(blockerDotStyles(blockerChipState(blocker.stateCategory)))}
          />
          <span {...stylex.props(styles.name)}>
            <Text variant="meta" numeric>
              {blocker.key}
            </Text>{" "}
            <Text variant="ui">{blocker.title}</Text>
          </span>
          <Text variant="meta">{blocker.stateName}</Text>
        </li>
      ))}
    </ul>
  );
}

const styles = stylex.create({
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  row: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  name: { flexGrow: 1, flexShrink: 1, minWidth: 0, overflowWrap: "anywhere" },
});
