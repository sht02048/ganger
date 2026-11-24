import * as stylex from "@stylexjs/stylex";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { useId, useRef, useState } from "react";
import { cx } from "../cx";
import { colors, fontSize, fontWeight, fonts, radius, space } from "../tokens.stylex";
import { Button } from "./button";
import { focusStyles } from "./focus";
import { ChevronRightIcon } from "./icons";
import { Spinner } from "./spinner";
import { VisuallyHidden } from "./visually-hidden";

export interface CommitHistoryItem {
  id: string;
  headline: string;
  sha: string;
  author: string | null;
  time: string;
  href: string | null;
}

export type CommitHistoryLoad =
  | { kind: "loading"; label: string }
  | { kind: "failed"; message: string; retryLabel: string; onRetry: () => void };

export interface CommitHistoryProps {
  summary: string;
  newTabLabel: string;
  commits: ReadonlyArray<CommitHistoryItem>;
  load?: CommitHistoryLoad | null;
  onExpandedChange?: (expanded: boolean) => void;
}

export function CommitHistory({
  summary,
  newTabLabel,
  commits,
  load = null,
  onExpandedChange,
}: CommitHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const summaryRef = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    onExpandedChange?.(next);
  };
  const retry = (onRetry: () => void) => {
    summaryRef.current?.focus();
    onRetry();
  };
  return (
    <div {...stylex.props(styles.history)}>
      <SdkButton
        ref={summaryRef}
        aria-expanded={expanded}
        {...(expanded ? { "aria-controls": listId } : {})}
        onClick={toggle}
        className={cx(styles.summary, focusStyles.ringInset)}
      >
        <span {...stylex.props(styles.chevron, expanded && styles.chevronOpen)}>
          <ChevronRightIcon />
        </span>
        <span {...stylex.props(styles.summaryText)}>{summary}</span>
      </SdkButton>
      {expanded && load !== null ? (
        <div id={listId} data-commit-load={load.kind} {...stylex.props(styles.load)}>
          <span role="status" {...stylex.props(styles.loadText)}>
            {load.kind === "loading" ? <Spinner /> : null}
            {load.kind === "loading" ? load.label : load.message}
          </span>
          {load.kind === "failed" ? (
            <Button variant="ghost" compact onClick={() => retry(load.onRetry)}>
              {load.retryLabel}
            </Button>
          ) : null}
        </div>
      ) : expanded ? (
        <ol id={listId} {...stylex.props(styles.list)}>
          {commits.map((commit) => (
            <li key={commit.id} {...stylex.props(styles.item)}>
              <CommitLine commit={commit} newTabLabel={newTabLabel} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function CommitLine({ commit, newTabLabel }: { commit: CommitHistoryItem; newTabLabel: string }) {
  const content = (
    <>
      <span title={commit.headline} {...stylex.props(styles.headline)}>
        {commit.headline}
      </span>
      <span {...stylex.props(styles.sha)}>{commit.sha}</span>
      <span
        {...(commit.author === null ? {} : { title: commit.author })}
        {...stylex.props(styles.meta, styles.author)}
      >
        {commit.author}
      </span>
      <span {...stylex.props(styles.meta, styles.time)}>{commit.time}</span>
    </>
  );
  if (commit.href === null) {
    return (
      <span data-commit={commit.sha} {...stylex.props(styles.line)}>
        {content}
      </span>
    );
  }
  return (
    <a
      data-commit={commit.sha}
      href={commit.href}
      target="_blank"
      rel="noreferrer"
      {...stylex.props(styles.line, styles.link, focusStyles.ringInset)}
    >
      {content}
      <VisuallyHidden> ({newTabLabel})</VisuallyHidden>
    </a>
  );
}

const styles = stylex.create({
  history: { display: "flex", flexDirection: "column", minWidth: 0 },
  summary: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    width: "100%",
    paddingBlock: space.s2,
    paddingInline: 0,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: {
      default: colors.textSecondary,
      ":hover": { default: null, "@media (hover: hover)": colors.textPrimary },
    },
    font: "inherit",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.regular,
    fontVariantNumeric: "tabular-nums",
    textAlign: "start",
    cursor: "pointer",
  },
  summaryText: { flexGrow: 1, minWidth: 0 },
  load: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInline: space.s1,
  },
  loadText: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: colors.textSecondary,
    fontSize: fontSize.ui,
  },
  chevron: {
    display: "inline-flex",
    flexShrink: 0,
    color: colors.textTertiary,
  },
  chevronOpen: { transform: "rotate(90deg)" },
  list: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto fit-content(30%) auto",
    columnGap: space.s2,
    margin: 0,
    paddingBlock: space.s1,
    paddingInline: 0,
    listStyle: "none",
    minWidth: 0,
  },
  item: { display: "grid", gridColumn: "1 / -1", gridTemplateColumns: "subgrid", minWidth: 0 },
  line: {
    position: "relative",
    display: "grid",
    gridColumn: "1 / -1",
    gridTemplateColumns: "subgrid",
    alignItems: "baseline",
    columnGap: space.s2,
    minWidth: 0,
    paddingBlock: space.px6,
    paddingInline: space.s1,
    borderRadius: radius.control,
    color: colors.textPrimary,
    fontSize: fontSize.ui,
  },
  link: {
    textDecorationLine: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgHover },
    },
  },
  headline: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sha: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: fontSize.small,
  },
  meta: {
    color: colors.textTertiary,
    fontSize: fontSize.small,
    whiteSpace: "nowrap",
  },
  author: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  time: { fontVariantNumeric: "tabular-nums" },
});
