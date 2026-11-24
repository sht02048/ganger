import { VisuallyHidden } from "@ganger/ui";

export function LabeledTime({
  dateTime,
  label,
  children,
}: {
  dateTime: string;
  label: string;
  children: string;
}) {
  return (
    <time dateTime={dateTime} title={label}>
      <VisuallyHidden>{`${label} `}</VisuallyHidden>
      {children}
    </time>
  );
}
