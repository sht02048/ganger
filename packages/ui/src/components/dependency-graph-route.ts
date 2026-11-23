export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 52;
export const COLUMN_GAP = 36;
export const ROW_GAP = 16;
export const DIVIDER_GAP = 25;
export const LOOP_GUTTER = COLUMN_GAP / 2 + 4;

const SAME_COLUMN_OFFSET = 16;
const ARROW_SIZE = 5;
const LANE_STEP = 3;

export interface Point {
  x: number;
  y: number;
}

export interface EdgeRoute {
  line: string;
  arrow: string;
  points: ReadonlyArray<Point>;
  usesGutter: boolean;
}

const polyline = (points: ReadonlyArray<Point>): string =>
  points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ");

const rightArrow = ({ x, y }: Point): string =>
  polyline([
    { x: x - ARROW_SIZE, y: y - ARROW_SIZE },
    { x, y },
    { x: x - ARROW_SIZE, y: y + ARROW_SIZE },
  ]);

function neighborRoute(from: Point, to: Point): EdgeRoute {
  const down = to.y > from.y;
  const x = from.x + NODE_WIDTH / 2 + (down ? SAME_COLUMN_OFFSET : -SAME_COLUMN_OFFSET);
  const start = { x, y: down ? from.y + NODE_HEIGHT : from.y };
  const end = { x, y: down ? to.y - 1 : to.y + NODE_HEIGHT + 1 };
  const back = down ? -ARROW_SIZE : ARROW_SIZE;
  return {
    line: polyline([start, end]),
    arrow: polyline([
      { x: x - ARROW_SIZE, y: end.y + back },
      end,
      { x: x + ARROW_SIZE, y: end.y + back },
    ]),
    points: [start, end],
    usesGutter: false,
  };
}

function gutterRoute(from: Point, to: Point): EdgeRoute {
  const side = from.x + NODE_WIDTH;
  const gutter = side + COLUMN_GAP / 2;
  const startY = from.y + NODE_HEIGHT / 3;
  const endY = to.y + (NODE_HEIGHT * 2) / 3;
  const end = { x: side + 1, y: endY };
  const points = [{ x: side, y: startY }, { x: gutter, y: startY }, { x: gutter, y: endY }, end];
  return {
    line: polyline(points),
    arrow: polyline([
      { x: end.x + ARROW_SIZE, y: endY - ARROW_SIZE },
      end,
      { x: end.x + ARROW_SIZE, y: endY + ARROW_SIZE },
    ]),
    points,
    usesGutter: true,
  };
}

function skippingRoute(from: Point, to: Point): EdgeRoute {
  const lane = (Math.round(from.y / (NODE_HEIGHT + ROW_GAP)) % 3) - 1;
  const offset = lane * LANE_STEP;
  const start = { x: from.x + NODE_WIDTH, y: from.y + NODE_HEIGHT / 2 };
  const end = { x: to.x - 1, y: to.y + NODE_HEIGHT / 2 };
  const leave = start.x + COLUMN_GAP / 2 + offset;
  const enter = end.x - COLUMN_GAP / 2 + offset;
  const channel = to.y - ROW_GAP / 2 + offset;
  const points = [
    start,
    { x: leave, y: start.y },
    { x: leave, y: channel },
    { x: enter, y: channel },
    { x: enter, y: end.y },
    end,
  ];
  return { line: polyline(points), arrow: rightArrow(end), points, usesGutter: false };
}

function neighborColumnRoute(from: Point, to: Point): EdgeRoute {
  const start = { x: from.x + NODE_WIDTH, y: from.y + NODE_HEIGHT / 2 };
  const end = { x: to.x - 1, y: to.y + NODE_HEIGHT / 2 };
  const middle = (start.x + end.x) / 2;
  return {
    line: `M${start.x} ${start.y} C${middle} ${start.y}, ${middle} ${end.y}, ${end.x} ${end.y}`,
    arrow: rightArrow(end),
    points: [start, end],
    usesGutter: false,
  };
}

export function edgeRoute(from: Point, to: Point): EdgeRoute {
  if (from.x === to.x) {
    const distance = Math.abs(to.y - from.y);
    const neighbors = distance > 0 && distance <= NODE_HEIGHT + ROW_GAP + DIVIDER_GAP;
    return neighbors ? neighborRoute(from, to) : gutterRoute(from, to);
  }
  const adjacent = to.x - from.x === NODE_WIDTH + COLUMN_GAP;
  return adjacent ? neighborColumnRoute(from, to) : skippingRoute(from, to);
}
