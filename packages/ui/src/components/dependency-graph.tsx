import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import type { ReactNode } from "react";
import { colors, radius, size, space } from "../tokens.stylex";
import { CheckboxControl } from "./checkbox";
import { ScrollRegion } from "./scroll-region";
import { Text } from "./text";
import { VisuallyHidden } from "./visually-hidden";
import {
  COLUMN_GAP,
  DIVIDER_GAP,
  LOOP_GUTTER,
  NODE_HEIGHT,
  NODE_WIDTH,
  ROW_GAP,
  edgeRoute,
} from "./dependency-graph-route";

const HEAD_HEIGHT = 28;

export type DependencyGraphTone = "default" | "problem";
export type DependencyGraphEdgeTone = "default" | "waiting" | "problem";

export interface DependencyGraphColumn {
  number: number;
  label: string;
}

export interface DependencyGraphCheck {
  checked: boolean;
  disabled: boolean;
  description: string;
  onCheckedChange: (checked: boolean) => void;
}

export interface DependencyGraphNode {
  id: string;
  column: number;
  row: number;
  ticketKey: ReactNode;
  title: string;
  tone: DependencyGraphTone;
  check?: DependencyGraphCheck;
}

export interface DependencyGraphEdge {
  from: string;
  to: string;
  tone: DependencyGraphEdgeTone;
}

export interface DependencyGraphProps {
  label: string;
  scrollLabel: string;
  columns: ReadonlyArray<DependencyGraphColumn>;
  nodes: ReadonlyArray<DependencyGraphNode>;
  edges: ReadonlyArray<DependencyGraphEdge>;
  dividerRow?: number;
}

const columnLeft = (column: number) => column * (NODE_WIDTH + COLUMN_GAP);

function rowTop(row: number, dividerRow: number | undefined): number {
  const pastDivider = dividerRow !== undefined && row >= dividerRow;
  return HEAD_HEIGHT + row * (NODE_HEIGHT + ROW_GAP) + (pastDivider ? DIVIDER_GAP : 0);
}

export function DependencyGraph({
  label,
  scrollLabel,
  columns,
  nodes,
  edges,
  dividerRow,
}: DependencyGraphProps) {
  const rowCount = nodes.reduce((most, node) => Math.max(most, node.row + 1), 0);
  const nodesWidth = columnLeft(columns.length) - COLUMN_GAP;
  const height = rowTop(rowCount - 1, dividerRow) + NODE_HEIGHT;
  const positions = new Map(
    nodes.map((node) => [node.id, { x: columnLeft(node.column), y: rowTop(node.row, dividerRow) }]),
  );
  const inTabOrder = [...nodes].sort((a, b) => a.column - b.column || a.row - b.row);
  const routed = [...edges]
    .sort((a, b) => Number(a.tone === "problem") - Number(b.tone === "problem"))
    .flatMap((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      return from === undefined || to === undefined ? [] : [{ edge, route: edgeRoute(from, to) }];
    });
  const width = nodesWidth + (routed.some(({ route }) => route.usesGutter) ? LOOP_GUTTER : 0);
  const dividerY =
    dividerRow === undefined ? null : rowTop(dividerRow, dividerRow) - (DIVIDER_GAP + ROW_GAP) / 2;
  return (
    <ScrollRegion label={scrollLabel}>
      <div
        role="group"
        aria-label={label}
        {...stylex.props(styles.canvas, canvasSize.of(width, height))}
      >
        {columns.map((column, index) => (
          <span key={column.number} {...stylex.props(styles.head, headAt.of(columnLeft(index)))}>
            <Text variant="label" tone="strong">
              {column.number}
            </Text>
            <Text variant="label" tone="muted">
              {column.label}
            </Text>
          </span>
        ))}
        <svg
          aria-hidden="true"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          fill="none"
          {...stylex.props(styles.lines)}
        >
          {dividerY === null ? null : (
            <line
              data-graph-divider=""
              x1={0}
              x2={nodesWidth}
              y1={dividerY}
              y2={dividerY}
              {...stylex.props(styles.divider)}
            />
          )}
          {routed.map(({ edge, route }) => (
            <g
              key={`${edge.from}->${edge.to}`}
              data-edge-tone={edge.tone}
              {...stylex.props(edgeTones[edge.tone])}
            >
              <path
                d={route.line}
                strokeWidth={1.5}
                {...(edge.tone === "default" ? {} : { strokeDasharray: "4 4" })}
              />
              <path d={route.arrow} strokeWidth={1.5} />
            </g>
          ))}
        </svg>
        {inTabOrder.map((node) => (
          <GraphNode
            key={node.id}
            node={node}
            left={columnLeft(node.column)}
            top={rowTop(node.row, dividerRow)}
          />
        ))}
      </div>
    </ScrollRegion>
  );
}

function GraphNode({ node, left, top }: { node: DependencyGraphNode; left: number; top: number }) {
  const descriptionId = useId();
  const words = (
    <span title={node.title} {...stylex.props(styles.words)}>
      <Text variant="label" tone="muted" truncate>
        {node.ticketKey}
      </Text>
      <Text variant="ui" tone="strong" truncate>
        {node.title}
      </Text>
    </span>
  );
  const place = nodeAt.of(left, top);
  const tone = node.tone === "problem" && styles.nodeProblem;
  const { check } = node;
  if (check === undefined) {
    return (
      <div
        data-graph-node="outside"
        data-tone={node.tone}
        {...stylex.props(styles.node, styles.nodeOutside, tone, place)}
      >
        {words}
      </div>
    );
  }
  return (
    <div
      data-graph-node="ticket"
      data-tone={node.tone}
      {...stylex.props(styles.node, styles.nodeTicket, tone, place)}
    >
      <label {...stylex.props(styles.nodeLabel, check.disabled && styles.nodeLabelDisabled)}>
        <CheckboxControl
          checked={check.checked}
          disabled={check.disabled}
          describedBy={descriptionId}
          onCheckedChange={check.onCheckedChange}
        />
        {words}
      </label>
      <VisuallyHidden>
        <span id={descriptionId}>{check.description}</span>
      </VisuallyHidden>
    </div>
  );
}

const canvasSize = stylex.create({
  of: (width: number, height: number) => ({ width, height }),
});

const headAt = stylex.create({
  of: (left: number) => ({ left }),
});

const nodeAt = stylex.create({
  of: (left: number, top: number) => ({ left, top, width: NODE_WIDTH, height: NODE_HEIGHT }),
});

const edgeTones = stylex.create({
  default: { stroke: colors.borderStrong },
  waiting: { stroke: colors.borderStrong },
  problem: { stroke: colors.problem },
});

const styles = stylex.create({
  canvas: { position: "relative", flexShrink: 0 },
  head: {
    position: "absolute",
    top: 0,
    display: "inline-flex",
    alignItems: "baseline",
    gap: space.px6,
  },
  lines: { position: "absolute", top: 0, left: 0, pointerEvents: "none" },
  divider: { stroke: colors.borderSubtle },
  node: {
    position: "absolute",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    borderStyle: "solid",
  },
  nodeTicket: {
    backgroundColor: {
      default: colors.bgCard,
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
  },
  nodeOutside: {
    borderStyle: "dashed",
    paddingInline: space.s3,
    backgroundColor: "transparent",
  },
  nodeProblem: { borderColor: colors.problemBorder },
  nodeLabel: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    width: "100%",
    height: "100%",
    paddingInline: space.s3,
    cursor: "pointer",
  },
  nodeLabelDisabled: { cursor: "not-allowed" },
  words: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    maxWidth: `calc(100% - ${size.tick})`,
  },
});
