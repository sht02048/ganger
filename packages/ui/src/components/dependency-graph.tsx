import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import type { ReactNode } from "react";
import { colors, radius, size, space } from "../tokens.stylex";
import { CheckboxControl } from "./checkbox";
import { ScrollRegion } from "./scroll-region";
import { Text } from "./text";
import { VisuallyHidden } from "./visually-hidden";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 52;
const COLUMN_GAP = 36;
const ROW_GAP = 16;
const HEAD_HEIGHT = 28;
const DIVIDER_GAP = 25;
const SAME_COLUMN_OFFSET = 16;
const ARROW_SIZE = 5;

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

interface Point {
  x: number;
  y: number;
}

function edgeLine(from: Point, to: Point): { line: string; arrow: string } {
  if (from.x === to.x) {
    const down = to.y > from.y;
    const x = from.x + NODE_WIDTH / 2 + (down ? SAME_COLUMN_OFFSET : -SAME_COLUMN_OFFSET);
    const startY = down ? from.y + NODE_HEIGHT : from.y;
    const endY = down ? to.y - 1 : to.y + NODE_HEIGHT + 1;
    const back = down ? -ARROW_SIZE : ARROW_SIZE;
    return {
      line: `M${x} ${startY} L${x} ${endY}`,
      arrow: `M${x - ARROW_SIZE} ${endY + back} L${x} ${endY} L${x + ARROW_SIZE} ${endY + back}`,
    };
  }
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_HEIGHT / 2;
  const endX = to.x - 1;
  const endY = to.y + NODE_HEIGHT / 2;
  const middle = (startX + endX) / 2;
  return {
    line: `M${startX} ${startY} C${middle} ${startY}, ${middle} ${endY}, ${endX} ${endY}`,
    arrow: `M${endX - ARROW_SIZE} ${endY - ARROW_SIZE} L${endX} ${endY} L${endX - ARROW_SIZE} ${endY + ARROW_SIZE}`,
  };
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
  const width = columnLeft(columns.length) - COLUMN_GAP;
  const height = rowTop(rowCount - 1, dividerRow) + NODE_HEIGHT;
  const positions = new Map(
    nodes.map((node) => [node.id, { x: columnLeft(node.column), y: rowTop(node.row, dividerRow) }]),
  );
  const inTabOrder = [...nodes].sort((a, b) => a.column - b.column || a.row - b.row);
  const problemEdgesOnTop = [...edges].sort(
    (a, b) => Number(a.tone === "problem") - Number(b.tone === "problem"),
  );
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
              x2={width}
              y1={dividerY}
              y2={dividerY}
              {...stylex.props(styles.divider)}
            />
          )}
          {problemEdgesOnTop.flatMap((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (from === undefined || to === undefined) return [];
            const { line, arrow } = edgeLine(from, to);
            return [
              <g
                key={`${edge.from}->${edge.to}`}
                data-edge-tone={edge.tone}
                {...stylex.props(edgeTones[edge.tone])}
              >
                <path
                  d={line}
                  strokeWidth={1.5}
                  {...(edge.tone === "default" ? {} : { strokeDasharray: "4 4" })}
                />
                <path d={arrow} strokeWidth={1.5} />
              </g>,
            ];
          })}
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
  waiting: { stroke: colors.textTertiary },
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
