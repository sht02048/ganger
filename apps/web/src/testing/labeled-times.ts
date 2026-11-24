export interface RenderedLabeledTime {
  dateTime: string;
  title: string;
  hidden: string;
  visible: string;
}

const LABELED_TIME =
  /<time dateTime="([^"]*)" title="([^"]*)"><span[^>]*>([^<]*)<\/span>(?:<!-- -->)?([^<]*)<\/time>/g;

export function labeledTimesOf(html: string): RenderedLabeledTime[] {
  return [...html.matchAll(LABELED_TIME)].map((m) => ({
    dateTime: m[1] ?? "",
    title: m[2] ?? "",
    hidden: (m[3] ?? "").trim(),
    visible: m[4] ?? "",
  }));
}
