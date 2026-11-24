import * as stylex from "@stylexjs/stylex";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { focusStyles } from "./focus";
import { CheckIcon, ChevronRightIcon } from "./icons";
import { StepMarker } from "./steps";
import { textStyles } from "./text";
import { VisuallyHidden } from "./visually-hidden";
import { breakpoints, colors, fonts, fontSize, radius, size, space } from "../tokens.stylex";

export interface SettingsLayoutProps {
  nav?: ReactNode;
  children: ReactNode;
}

export function SettingsLayout({ nav, children }: SettingsLayoutProps) {
  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.navColumn)}>{nav}</div>
        <div {...stylex.props(styles.body)}>{children}</div>
      </div>
    </div>
  );
}

export interface SectionNavItem {
  id: string;
  label: string;
  problem?: boolean;
}

export interface SectionNavProps {
  label: string;
  items: ReadonlyArray<SectionNavItem>;
  problemLabel: string;
}

const CURRENT_LINE_OFFSET = 96;

export function SectionNav({ label, items, problemLabel }: SectionNavProps) {
  const [current, setCurrent] = useState(items[0]?.id ?? "");
  const pinned = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const ids = items.map((item) => item.id).join(" ");

  useEffect(() => {
    const sections = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const first = sections[0];
    if (first === undefined) return undefined;
    const scroller = scrollParent(first);
    let frame = 0;
    const update = () => {
      frame = 0;
      if (pinned.current) return;
      setCurrent(currentSection(sections, scroller));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    const unpin = () => {
      pinned.current = false;
    };
    update();
    const target: HTMLElement | Window = scroller ?? window;
    const settle = () => {
      pinned.current = false;
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    target.addEventListener("scrollend", settle, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    for (const event of ["wheel", "touchmove", "keydown", "pointerdown"] as const) {
      window.addEventListener(event, unpin, { passive: true });
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
      target.removeEventListener("scrollend", settle);
      window.removeEventListener("resize", onScroll);
      for (const event of ["wheel", "touchmove", "keydown", "pointerdown"] as const) {
        window.removeEventListener(event, unpin);
      }
    };
  }, [ids]);

  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (list === null || link === null || link === undefined) return;
    if (list.scrollWidth <= list.clientWidth) return;
    const start = link.offsetLeft - list.offsetLeft;
    const end = start + link.offsetWidth;
    if (start < list.scrollLeft) list.scrollLeft = start;
    else if (end > list.scrollLeft + list.clientWidth) list.scrollLeft = end - list.clientWidth;
  }, [current]);

  const go = useCallback((event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id);
    if (section === null) return;
    event.preventDefault();
    pinned.current = true;
    setCurrent(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollSectionToTop(section, reduce ? "auto" : "smooth");
    const heading = section.querySelector<HTMLElement>("[data-section-heading]");
    (heading ?? section).focus({ preventScroll: true });
  }, []);

  return (
    <nav aria-label={label} {...stylex.props(styles.nav)}>
      <ul ref={listRef} {...stylex.props(styles.navList)}>
        {items.map((item) => {
          const isCurrent = item.id === current;
          return (
            <li key={item.id} {...stylex.props(styles.navItem)}>
              <a
                href={`#${item.id}`}
                onClick={(event) => go(event, item.id)}
                {...(isCurrent ? { "aria-current": "location" as const } : {})}
                {...stylex.props(
                  textStyles("ui"),
                  styles.navLink,
                  isCurrent && styles.navLinkCurrent,
                  focusStyles.ring,
                )}
              >
                {item.label}
                {item.problem === true ? (
                  <>
                    <span aria-hidden="true" {...stylex.props(styles.problemDot)} />
                    <VisuallyHidden>{problemLabel}</VisuallyHidden>
                  </>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface SettingsNavLinkRenderProps {
  className?: string;
  style?: CSSProperties;
  "aria-current"?: "page";
  children: ReactNode;
}

export interface SettingsNavItem {
  id: string;
  label: string;
  problem?: boolean;
  render: (props: SettingsNavLinkRenderProps) => ReactNode;
}

export interface SettingsNavGroup {
  id: string;
  label: string;
  items: ReadonlyArray<SettingsNavItem>;
}

export interface SettingsNavProps {
  label: string;
  groups: ReadonlyArray<SettingsNavGroup>;
  current: string;
  problemLabel: string;
}

export function SettingsNav({ label, groups, current, problemLabel }: SettingsNavProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list === null || link === null || link === undefined) return;
    if (list.scrollWidth <= list.clientWidth) return;
    const start = link.offsetLeft - list.offsetLeft;
    const end = start + link.offsetWidth;
    if (start < list.scrollLeft) list.scrollLeft = start;
    else if (end > list.scrollLeft + list.clientWidth) list.scrollLeft = end - list.clientWidth;
  }, [current]);
  return (
    <nav aria-label={label} {...stylex.props(styles.nav)}>
      <div ref={listRef} {...stylex.props(styles.pageNavGroups)}>
        {groups.map((group) => {
          const groupLabelId = `settings-nav-${group.id}`;
          return (
            <div key={group.id} {...stylex.props(styles.pageNavGroup)}>
              <span
                id={groupLabelId}
                {...stylex.props(textStyles("meta"), styles.pageNavGroupLabel)}
              >
                {group.label}
              </span>
              <ul aria-labelledby={groupLabelId} {...stylex.props(styles.pageNavList)}>
                {group.items.map((item) => {
                  const isCurrent = item.id === current;
                  return (
                    <li key={item.id} {...stylex.props(styles.navItem)}>
                      {item.render({
                        ...stylex.props(
                          textStyles("ui"),
                          styles.navLink,
                          isCurrent && styles.navLinkCurrent,
                          focusStyles.ring,
                        ),
                        ...(isCurrent ? { "aria-current": "page" as const } : {}),
                        children: (
                          <>
                            {item.label}
                            {item.problem === true ? (
                              <>
                                <span aria-hidden="true" {...stylex.props(styles.problemDot)} />
                                <VisuallyHidden>{problemLabel}</VisuallyHidden>
                              </>
                            ) : null}
                          </>
                        ),
                      })}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function sectionScrollTop(input: {
  sectionTop: number;
  scrollerTop: number;
  scrollTop: number;
  marginTop: number;
  maxScrollTop: number;
}): number {
  const wanted = input.sectionTop - input.scrollerTop + input.scrollTop - input.marginTop;
  return Math.min(Math.max(wanted, 0), Math.max(input.maxScrollTop, 0));
}

function scrollSectionToTop(section: HTMLElement, behavior: ScrollBehavior): void {
  const scroller = scrollParent(section);
  const marginTop = Number.parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
  const sectionTop = section.getBoundingClientRect().top;
  if (scroller === null) {
    const root = document.documentElement;
    window.scrollTo({
      top: sectionScrollTop({
        sectionTop,
        scrollerTop: 0,
        scrollTop: window.scrollY,
        marginTop,
        maxScrollTop: root.scrollHeight - window.innerHeight,
      }),
      behavior,
    });
    return;
  }
  scroller.scrollTo({
    top: sectionScrollTop({
      sectionTop,
      scrollerTop: scroller.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
      marginTop,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    }),
    behavior,
  });
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node !== null) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

function currentSection(
  sections: ReadonlyArray<HTMLElement>,
  scroller: HTMLElement | null,
): string {
  const top = scroller === null ? 0 : scroller.getBoundingClientRect().top;
  const atEnd =
    scroller === null
      ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  const scrolled = scroller === null ? window.scrollY > 0 : scroller.scrollTop > 0;
  if (atEnd && scrolled) return sections.at(-1)?.id ?? "";
  let found = sections[0]?.id ?? "";
  for (const section of sections) {
    if (section.getBoundingClientRect().top - top <= CURRENT_LINE_OFFSET) found = section.id;
  }
  return found;
}

export interface SettingsSectionProps {
  id: string;
  title: ReactNode;
  info?: ReactNode;
  detail?: ReactNode;
  detailTone?: SettingsDetailTone;
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({
  id,
  title,
  info,
  detail,
  detailTone = "default",
  actions,
  children,
}: SettingsSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} {...stylex.props(styles.section)}>
      <div
        {...stylex.props(
          styles.sectionHead,
          detail !== undefined && detail !== null && styles.sectionHeadWrap,
        )}
      >
        <h2
          id={headingId}
          tabIndex={-1}
          data-section-heading=""
          {...stylex.props(textStyles("subheading"), styles.sectionTitle, focusStyles.ring)}
        >
          {title}
        </h2>
        {info}
        {detail === undefined || detail === null ? null : (
          <span
            {...stylex.props(
              textStyles("meta", detailTone === "problem" ? "problem" : undefined),
              styles.sectionDetail,
            )}
          >
            {detail}
          </span>
        )}
        {actions === undefined ? null : (
          <div {...stylex.props(styles.sectionActions)}>{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

export function SettingsGroup({
  children,
  label,
  padded = false,
}: {
  children: ReactNode;
  label?: string;
  padded?: boolean;
}) {
  return (
    <div
      {...(label === undefined ? {} : { role: "group", "aria-label": label })}
      {...stylex.props(styles.group)}
    >
      {padded ? <div {...stylex.props(styles.groupBody)}>{children}</div> : children}
    </div>
  );
}

export type SettingsDetailTone = "default" | "problem";

export interface SettingsRowProps {
  label: ReactNode;
  labelId?: string;
  labelFor?: string;
  info?: ReactNode;
  detail?: ReactNode;
  detailTone?: SettingsDetailTone;
  detailMono?: boolean;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  message?: ReactNode;
  expanded?: ReactNode;
  formOnly?: boolean;
  wideControl?: boolean;
  disabled?: boolean;
  inset?: boolean;
  id?: string;
  ref?: Ref<HTMLDivElement>;
}

export function SettingsRow({
  label,
  labelId,
  labelFor,
  info,
  detail,
  detailTone = "default",
  detailMono = false,
  value,
  control,
  status,
  message,
  expanded,
  formOnly = false,
  wideControl = false,
  disabled = false,
  inset = false,
  id,
  ref,
}: SettingsRowProps) {
  const open = expanded !== undefined && expanded !== null && expanded !== false;
  if (open && formOnly) {
    return (
      <div
        ref={ref}
        data-editing=""
        {...(id === undefined ? {} : { id })}
        {...stylex.props(styles.row, styles.rowOpen)}
      >
        <div {...stylex.props(styles.editor, styles.editorOnly)}>{expanded}</div>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      {...(open ? { "data-editing": "" } : {})}
      {...(id === undefined ? {} : { id })}
      {...stylex.props(styles.row, open && styles.rowOpen)}
    >
      <div
        {...stylex.props(
          styles.rowMain,
          wideControl && styles.rowMainWide,
          inset && styles.rowMainInset,
        )}
      >
        <RowText
          label={label}
          labelId={labelId}
          labelFor={labelFor}
          info={info}
          detail={detail}
          detailTone={detailTone}
          detailMono={detailMono}
          disabled={disabled}
          value={value}
        />
        <span {...stylex.props(styles.rowEnd, wideControl && styles.rowEndWide)}>
          {value === undefined ? null : (
            <span {...stylex.props(textStyles("ui"), styles.value)}>{value}</span>
          )}
          <span role="status" {...stylex.props(textStyles("meta"), styles.status)}>
            {status}
          </span>
          {control}
        </span>
      </div>
      {message === undefined || message === null ? null : (
        <div {...stylex.props(styles.message)}>{message}</div>
      )}
      {open ? <div {...stylex.props(styles.editor)}>{expanded}</div> : null}
    </div>
  );
}

export function SettingsSteps({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol aria-label={label} {...stylex.props(styles.group, styles.steps)}>
      {children}
    </ol>
  );
}

export type SettingsStepState = "locked" | "open" | "current" | "done";

export interface SettingsStepProps {
  id?: string;
  number: number;
  state: SettingsStepState;
  label: ReactNode;
  stateLabel: string;
  info?: ReactNode;
  detail?: ReactNode;
  detailMono?: boolean;
  control?: ReactNode;
  children?: ReactNode;
}

export function SettingsStep({
  id,
  number,
  state,
  label,
  stateLabel,
  info,
  detail,
  detailMono = false,
  control,
  children,
}: SettingsStepProps) {
  const current = state === "current";
  return (
    <li
      {...(id === undefined ? {} : { id })}
      {...(current ? { "aria-current": "step" as const } : {})}
      {...stylex.props(styles.row, styles.step, current && styles.rowOpen)}
    >
      <span {...stylex.props(styles.stepMarker)}>
        <StepMarker state={state === "locked" || state === "open" ? "todo" : state}>
          {state === "done" ? (
            <>
              <CheckIcon />
              <VisuallyHidden>{number}</VisuallyHidden>
            </>
          ) : (
            number
          )}
        </StepMarker>
      </span>
      <div {...stylex.props(styles.stepHead)}>
        <span {...stylex.props(styles.rowText)}>
          <span {...stylex.props(styles.labelLine)}>
            <span
              {...stylex.props(textStyles("title", state === "locked" ? "disabled" : "strong"))}
            >
              {label}
            </span>
            <VisuallyHidden>{stateLabel}</VisuallyHidden>
            {info === undefined || info === null ? null : (
              <span {...stylex.props(styles.infoSlot)}>{info}</span>
            )}
          </span>
          {detail === undefined || detail === null ? null : (
            <span {...stylex.props(textStyles("meta"), detailMono && styles.mono, styles.detail)}>
              {detail}
            </span>
          )}
        </span>
        {control === undefined || control === null ? null : (
          <span {...stylex.props(styles.stepControl)}>{control}</span>
        )}
      </div>
      {children === undefined || children === null || state === "locked" ? null : (
        <div {...stylex.props(styles.stepContent)}>{children}</div>
      )}
    </li>
  );
}

export interface SettingsLinkRowRenderProps {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export interface SettingsLinkRowProps {
  label: ReactNode;
  detail?: ReactNode;
  detailTone?: SettingsDetailTone;
  value?: ReactNode;
  id?: string;
  render: (props: SettingsLinkRowRenderProps) => ReactNode;
}

export function SettingsLinkRow({
  label,
  detail,
  detailTone = "default",
  value,
  id,
  render,
}: SettingsLinkRowProps) {
  return (
    <div {...(id === undefined ? {} : { id })} {...stylex.props(styles.row)}>
      {render({
        ...stylex.props(styles.rowMain, styles.linkRow, focusStyles.ringInset),
        children: (
          <>
            <RowText
              label={label}
              labelId={undefined}
              labelFor={undefined}
              info={undefined}
              detail={detail}
              detailTone={detailTone}
              detailMono={false}
              disabled={false}
              value={value}
            />
            <span {...stylex.props(styles.rowEnd)}>
              {value === undefined ? null : (
                <span {...stylex.props(textStyles("ui"), styles.value, styles.linkValue)}>
                  {value}
                </span>
              )}
              <span {...stylex.props(styles.chevron)}>
                <ChevronRightIcon />
              </span>
            </span>
          </>
        ),
      })}
    </div>
  );
}

function RowText({
  label,
  labelId,
  labelFor,
  info,
  detail,
  detailTone,
  detailMono,
  disabled,
  value,
}: {
  label: ReactNode;
  labelId: string | undefined;
  labelFor: string | undefined;
  info: ReactNode;
  detail: ReactNode;
  detailTone: SettingsDetailTone;
  detailMono: boolean;
  disabled: boolean;
  value: ReactNode;
}) {
  return (
    <span {...stylex.props(styles.rowText)}>
      <span {...stylex.props(styles.labelLine)}>
        {labelFor === undefined ? (
          <span
            {...(labelId === undefined ? {} : { id: labelId })}
            {...stylex.props(textStyles("title", disabled ? "disabled" : "strong"))}
          >
            {label}
          </span>
        ) : (
          <label
            htmlFor={labelFor}
            {...(labelId === undefined ? {} : { id: labelId })}
            {...stylex.props(
              textStyles("title", disabled ? "disabled" : "strong"),
              !disabled && styles.labelClickable,
            )}
          >
            {label}
          </label>
        )}
        {info === undefined || info === null ? null : (
          <span {...stylex.props(styles.infoSlot)}>{info}</span>
        )}
      </span>
      {detail === undefined || detail === null ? null : (
        <span
          {...stylex.props(
            textStyles("meta", detailTone === "problem" ? "problem" : undefined),
            detailMono && styles.mono,
            styles.detail,
          )}
        >
          {detail}
        </span>
      )}
      {value === undefined || value === null ? null : (
        <span {...stylex.props(textStyles("meta"), styles.detail, styles.valueBelow)}>{value}</span>
      )}
    </span>
  );
}

const NAV_TOP_HEIGHT = `calc(${size.settingsChipHeight} + 2 * ${space.s3} + ${space.s4})`;

const styles = stylex.create({
  frame: { containerType: "inline-size", minWidth: 0 },
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: `${size.settingsNavWidth} minmax(0, ${size.settingsBodyWidth})`,
      [breakpoints.settingsNavTop]: "minmax(0, 1fr)",
    },
    columnGap: space.s10,
    paddingTop: { default: space.s8, [breakpoints.settingsNavTop]: 0 },
    paddingInline: {
      default: space.s8,
      [breakpoints.settingsNavTop]: 0,
    },
    paddingBottom: `max(${space.s10}, var(--pinned-toast-space, 0px) + ${space.s10})`,
  },
  navColumn: {
    minWidth: 0,
    position: "sticky",
    top: { default: space.s8, [breakpoints.settingsNavTop]: 0 },
    alignSelf: "start",
    zIndex: 1,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.s10,
    minWidth: 0,
    paddingInline: { default: 0, [breakpoints.settingsNavTop]: space.s4 },
    paddingTop: { default: 0, [breakpoints.settingsNavTop]: space.s5 },
  },
  nav: {
    backgroundColor: { default: "transparent", [breakpoints.settingsNavTop]: colors.bgCanvas },
    borderBottomWidth: { default: 0, [breakpoints.settingsNavTop]: 1 },
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderSubtle,
  },
  navList: {
    display: "flex",
    flexDirection: { default: "column", [breakpoints.settingsNavTop]: "row" },
    gap: { default: space.px2, [breakpoints.settingsNavTop]: space.px6 },
    margin: 0,
    paddingBlock: { default: 0, [breakpoints.settingsNavTop]: space.s3 },
    paddingInline: { default: 0, [breakpoints.settingsNavTop]: space.s4 },
    listStyle: "none",
    overflowX: { default: "visible", [breakpoints.settingsNavTop]: "auto" },
    scrollbarWidth: "none",
  },
  navItem: { flexShrink: 0 },
  pageNavGroups: {
    display: "flex",
    flexDirection: { default: "column", [breakpoints.settingsNavTop]: "row" },
    gap: { default: space.s5, [breakpoints.settingsNavTop]: space.px6 },
    paddingBlock: { default: 0, [breakpoints.settingsNavTop]: space.s3 },
    paddingInline: { default: 0, [breakpoints.settingsNavTop]: space.s4 },
    overflowX: { default: "visible", [breakpoints.settingsNavTop]: "auto" },
    scrollbarWidth: "none",
  },
  pageNavGroup: {
    display: "flex",
    flexDirection: { default: "column", [breakpoints.settingsNavTop]: "row" },
    gap: { default: space.s1, [breakpoints.settingsNavTop]: space.px6 },
    flexShrink: 0,
  },
  pageNavGroupLabel: {
    display: { default: "block", [breakpoints.settingsNavTop]: "none" },
    paddingInline: space.s3,
    overflowWrap: "anywhere",
  },
  pageNavList: {
    display: "flex",
    flexDirection: { default: "column", [breakpoints.settingsNavTop]: "row" },
    gap: { default: space.px2, [breakpoints.settingsNavTop]: space.px6 },
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: { default: size.control, [breakpoints.settingsNavTop]: size.settingsChipHeight },
    paddingInline: space.s3,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      [breakpoints.settingsNavTop]: colors.navChip,
      ":hover": colors.bgHover,
    },
    color: colors.textSecondary,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  navLinkCurrent: {
    backgroundColor: {
      default: colors.bgSelected,
      [breakpoints.settingsNavTop]: colors.bgSelected,
      ":hover": colors.bgSelected,
    },
    color: colors.textPrimary,
  },
  problemDot: {
    flexShrink: 0,
    width: size.dot,
    height: size.dot,
    borderRadius: radius.full,
    backgroundColor: colors.problem,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    scrollMarginTop: { default: space.s8, [breakpoints.settingsNavTop]: NAV_TOP_HEIGHT },
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s1,
    minHeight: size.control,
  },
  sectionTitle: { margin: 0 },
  sectionHeadWrap: { flexWrap: "wrap", columnGap: space.s2, rowGap: space.px2 },
  sectionDetail: { flexShrink: 0, maxWidth: "100%", overflowWrap: "anywhere" },
  steps: { margin: 0, padding: 0, listStyle: "none" },
  step: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "start",
    columnGap: { default: space.s4, [breakpoints.settingsRowStacked]: space.s3 },
    rowGap: space.s4,
    paddingBlock: space.s4,
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
  },
  stepMarker: { display: "flex", alignItems: "center", minHeight: size.control },
  stepHead: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.control,
    minWidth: 0,
  },
  stepControl: { display: "flex", flexShrink: 0, marginInlineStart: "auto" },
  stepContent: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minWidth: 0,
    gridColumn: { default: "2", [breakpoints.settingsRowStacked]: "1 / -1" },
  },
  sectionActions: { display: "flex", gap: space.s2, marginInlineStart: "auto" },
  group: {
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.card,
    backgroundColor: colors.bgCard,
    overflow: "clip",
  },
  row: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderTopWidth: { default: 0, ":not(:first-child)": 1 },
    borderTopStyle: "solid",
    borderTopColor: colors.borderSubtle,
    scrollMarginTop: { default: space.s8, [breakpoints.settingsNavTop]: NAV_TOP_HEIGHT },
  },
  groupBody: {
    paddingBlock: space.s4,
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
  },
  rowOpen: {
    backgroundColor: colors.bgCardHover,
    scrollMarginTop: { default: space.s8, [breakpoints.settingsNavTop]: NAV_TOP_HEIGHT },
  },
  rowMain: {
    display: "flex",
    alignItems: "center",
    gap: { default: space.s4, [breakpoints.settingsRowStacked]: space.s3 },
    minHeight: size.rowMinHeight,
    paddingBlock: space.s3,
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
  },
  rowMainInset: {
    paddingInlineStart: {
      default: `calc(${space.s5} + ${space.s6})`,
      [breakpoints.settingsRowStacked]: `calc(${space.s4} + ${space.s4})`,
    },
  },
  rowMainWide: { flexWrap: { default: "nowrap", [breakpoints.settingsRowStacked]: "wrap" } },
  rowEndWide: {
    flexBasis: { default: "auto", [breakpoints.settingsRowStacked]: "100%" },
    maxWidth: { default: "60%", [breakpoints.settingsRowStacked]: "100%" },
  },
  linkRow: {
    color: "inherit",
    textDecoration: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: null, "@media (hover: hover)": colors.bgCardHover },
    },
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: space.px2,
    flexGrow: 1,
    minWidth: 0,
  },
  labelClickable: { cursor: "pointer" },
  labelLine: { display: "block", minWidth: 0 },
  infoSlot: {
    display: "inline-flex",
    verticalAlign: "middle",
    marginInlineStart: space.s1,
    marginBlock: `calc(-1 * ${space.s1})`,
  },
  detail: { overflowWrap: "anywhere" },
  mono: { fontFamily: fonts.mono },
  rowEnd: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    flexShrink: 0,
    maxWidth: "60%",
    marginInlineStart: "auto",
  },
  valueBelow: { display: { default: "none", [breakpoints.settingsRowStacked]: "block" } },
  value: {
    display: { default: "inline", [breakpoints.settingsRowStacked]: "none" },
    minWidth: 0,
    color: colors.textSecondary,
    textAlign: "end",
    overflowWrap: "anywhere",
  },
  linkValue: { fontSize: fontSize.small },
  status: { whiteSpace: "nowrap" },
  chevron: { display: "inline-flex", color: colors.textTertiary },
  message: {
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
    paddingBottom: space.s3,
    marginTop: `calc(-1 * ${space.s1})`,
  },
  editorOnly: { paddingTop: space.s4 },
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    paddingInline: { default: space.s5, [breakpoints.settingsRowStacked]: space.s4 },
    paddingBottom: space.s4,
  },
});
