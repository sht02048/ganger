import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sectionScrollTop } from "./components/settings-layout";

import {
  FlatViewIcon,
  GroupedViewIcon,
  ISSUE_STATE_KINDS,
  IconToggleGroup,
  IssueGroupLabel,
  IssueList,
  IssueListFrame,
  IssueListHead,
  IssueRow,
  IssueStateIcon,
  ProgressRing,
  InfoTip,
  SectionNav,
  SettingsGroup,
  SettingsLayout,
  SettingsLinkRow,
  SettingsRow,
  SettingsSection,
  Switch,
  Button,
  CAPACITY_CELLS_MAX,
  CapacityBar,
  CapacityCells,
  CapacityTrack,
  CheckResultRow,
  ExpandableRow,
  Card,
  Checkbox,
  DefinitionItem,
  DefinitionList,
  Dialog,
  DialogClose,
  Field,
  GroupHeader,
  Input,
  Menu,
  RadioGroup,
  RadioOption,
  MenuItem,
  MoreIcon,
  PILL_STATUSES,
  BlockerChip,
  BlockerChips,
  KanbanCard,
  KanbanCards,
  PrChip,
  PrChipMore,
  KanbanColumn,
  KanbanSubheading,
  Popover,
  ProblemCallout,
  Sheet,
  Row,
  RowActionSlot,
  RowTitle,
  SURFACE_ROLES,
  Section,
  SegmentedTabs,
  Select,
  SplitView,
  StatTile,
  StatusDot,
  StatusPill,
  Tab,
  Table,
  TableCell,
  TableHead,
  TableFoldedOnly,
  TableHeader,
  tableColumnTemplates,
  TableRow,
  TableRows,
  Tabs,
  TEXT_VARIANTS,
  Text,
  TimeSlot,
  Tooltip,
  UsageBar,
  UsageMeter,
  PanelRows,
  PanelHeader,
  PanelListRow,
  PanelSection,
  SignalList,
  SignalRow,
  PinnedToast,
  Toaster,
  ResponsiveColumns,
  ResponsiveColumnsHead,
  responsiveColumnTemplates,
  statusTone,
  surfaceStyles,
  textStyles,
  type PillStatus,
  type StatusTone,
  type TextVariant,
} from "./index";
import * as stylex from "@stylexjs/stylex";

const noop = () => {};

describe("PinnedToast(티켓 0083)", () => {
  it("제목으로 이름 붙은 구역이고, 본문과 행동을 그리며, 화면 읽기 알림 칸은 마운트 뒤에 채운다", () => {
    const html = renderToString(
      <PinnedToast
        title="새 버전 0.2.0을 받았어요"
        announcement="새 버전 0.2.0을 받았어요"
        actions={<Button>나중에</Button>}
      >
        서버도 함께 바뀌어요.
      </PinnedToast>,
    );
    expect(html).toMatch(/<section aria-labelledby="([^"]+)"[^>]*>[\s\S]*<p id="\1"/);
    expect(html).toContain("서버도 함께 바뀌어요.");
    expect(html).toContain("나중에");
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(html).not.toContain('role="alert"');
  });

  it("Toaster 는 고정 토스트를 받으면 함께 그리고, 없으면 그리지 않는다", () => {
    const html = renderToString(
      <Toaster
        label="알림"
        pinned={<PinnedToast title="바꿨어요" announcement="바꿨어요" actions={null} />}
      />,
    );
    expect(html).toContain("바꿨어요");
    expect(renderToString(<Toaster label="알림" />)).not.toContain("aria-labelledby");
  });
});

describe("서버 렌더", () => {
  it("Button 은 변형마다 다른 클래스를 갖고 disabled 를 넘긴다", () => {
    const html = (variant?: "primary" | "secondary" | "danger" | "ghost") =>
      renderToString(<Button {...(variant === undefined ? {} : { variant })}>시작</Button>);
    expect(html("primary")).toContain('type="button"');
    expect(html()).toEqual(html("secondary"));
    const classes = new Set(["primary", "secondary", "danger", "ghost"] as const);
    expect(new Set([...classes].map((v) => html(v))).size).toBe(4);
    expect(renderToString(<Button disabled>시작</Button>)).toContain("disabled");
  });

  it("StatusPill 은 상태 값마다 ADR 0010 5번의 색을 고른다", () => {
    const expected: Record<StatusTone, PillStatus[]> = {
      answer: ["waiting-for-input", "question", "permission"],
      check: ["human-check"],
      problem: ["disconnected", "failed", "offline", "runner-issue"],
      progress: ["running", "online"],
      merged: ["succeeded"],
      idle: ["queued", "paused", "canceled"],
    };
    const actual: Record<StatusTone, PillStatus[]> = {
      answer: [],
      check: [],
      problem: [],
      progress: [],
      merged: [],
      idle: [],
    };
    for (const status of PILL_STATUSES) actual[statusTone(status)].push(status);
    expect(actual).toEqual(expected);
  });

  it("StatusPill 은 점과 이름을 함께 그리고, 점은 스크린 리더에서 숨긴다", () => {
    const html = renderToString(<StatusPill status="succeeded">Succeeded</StatusPill>);
    expect(html).toContain("Succeeded");
    expect(html).toContain('data-tone="merged"');
    expect(html).toContain('aria-hidden="true"');
    const failed = renderToString(<StatusPill status="failed">Succeeded</StatusPill>);
    expect(failed.replace(/data-[a-z]+="[^"]*"/g, "")).not.toEqual(
      html.replace(/data-[a-z]+="[^"]*"/g, ""),
    );
  });

  it("Card 는 이름이 있으면 구역으로, Row 는 앞·뒤 칸을 그린다", () => {
    expect(renderToString(<Card>내용</Card>)).toMatch(/^<div/);
    expect(renderToString(<Card label="To do">내용</Card>)).toMatch(/^<section aria-label="To do"/);
    const row = renderToString(
      <Row leading={<StatusPill status="running">Running</StatusPill>} trailing="10:45">
        시작했어요
      </Row>,
    );
    expect(row).toContain("Running");
    expect(row).toContain("시작했어요");
    expect(row).toContain("10:45");
  });

  it("Row 는 href 를 주면 행 전체가 링크이고, 누를 수 없는 행은 hover 면을 끈다(티켓 0050)", () => {
    const link = renderToString(<Row href="/runs/run-1?ws=ws-1">시작했어요</Row>);
    expect(link).toMatch(/^<a href="\/runs\/run-1\?ws=ws-1"/);
    const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";
    const plain = renderToString(<Row interactive={false}>시작했어요</Row>);
    const hover = renderToString(<Row>시작했어요</Row>);
    expect(plain).toMatch(/^<div/);
    expect(classOf(plain)).not.toEqual(classOf(hover));
  });

  it("Text 는 변형에 맞는 기본 요소를 쓴다", () => {
    expect(renderToString(<Text variant="page">Runs</Text>)).toMatch(/^<h1/);
    expect(renderToString(<Text variant="panel">제목</Text>)).toMatch(/^<h2/);
    expect(renderToString(<Text variant="meta">ACME-1</Text>)).toMatch(/^<span/);
    expect(
      renderToString(
        <Text variant="page" as="p">
          Runs
        </Text>,
      ),
    ).toMatch(/^<p/);
  });

  it("Table 행은 listbox 의 option 이고 고른 행이 aria-selected 다", () => {
    const html = renderToString(
      <Table columns="minmax(0, 1fr) 80px">
        <TableRows label="런 목록" value="b" onValueChange={noop}>
          <TableRow value="a" label="첫째">
            <TableCell>첫째</TableCell>
          </TableRow>
          <TableRow value="b" label="둘째">
            <TableCell align="end" numeric>
              둘째
            </TableCell>
          </TableRow>
        </TableRows>
      </Table>,
    );
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="런 목록"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-selected="true"[^>]*>.*둘째|둘째.*aria-selected="true"/s);
    expect(html).toMatch(
      /style="(?:--[^:]+:minmax\(0, 1fr\) 80px;){3}--[^:]+:minmax\(0, 1fr\) 80px"/,
    );
  });

  it("Table 은 좁은 폭 열 값을 따로 받는다(티켓 0091)", () => {
    const html = renderToString(
      <Table columns="minmax(0, 1fr) 152px 88px" narrowColumns="minmax(0, 1fr)">
        <TableRows label="런 목록" value="a" onValueChange={noop}>
          <TableRow value="a" label="첫째">
            <TableCell>첫째</TableCell>
          </TableRow>
        </TableRows>
      </Table>,
    );
    expect(html).toMatch(
      /style="(?:--[^:]+:minmax\(0, 1fr\) 152px 88px;){3}--[^:]+:minmax\(0, 1fr\)"/,
    );
  });

  it("Table 은 접힌 폭의 열 값을 차례로 받고, 빠진 값은 앞 단계를 따른다(티켓 0101)", () => {
    expect(
      tableColumnTemplates({
        columns: "a b c",
        foldedColumns: { first: "a b", second: "a" },
        narrowColumns: "z",
      }),
    ).toEqual({ wide: "a b c", first: "a b", second: "a", third: null, narrow: "z" });
    expect(
      tableColumnTemplates({
        columns: "a b c",
        foldedColumns: { first: "a b", second: "a", third: "y" },
      }),
    ).toEqual({ wide: "a b c", first: "a b", second: "a", third: "y", narrow: "y" });
    expect(tableColumnTemplates({ columns: "a b c", foldedColumns: { first: "a b" } })).toEqual({
      wide: "a b c",
      first: "a b",
      second: "a b",
      third: null,
      narrow: "a b",
    });
    expect(tableColumnTemplates({ columns: "a b" })).toEqual({
      wide: "a b",
      first: "a b",
      second: "a b",
      third: null,
      narrow: "a b",
    });
  });

  it("접히면 숨는 칸과 접혔을 때만 보이는 내용은 접힘 단계를 드러낸다(티켓 0101)", () => {
    const html = renderToString(
      <Table columns="1fr 80px" foldedColumns={{ first: "1fr" }}>
        <TableHead>
          <TableHeader>제목</TableHeader>
          <TableHeader hideWhen="first">러너</TableHeader>
        </TableHead>
        <TableRows label="런 목록" value="a" onValueChange={noop}>
          <TableRow value="a" label="첫째">
            <TableCell>
              <RowTitle fullText="아주 긴 첫째 제목">아주 긴 첫째 제목</RowTitle>
              <TableFoldedOnly when="first" block>
                runner-a
              </TableFoldedOnly>
            </TableCell>
            <TableCell hideWhen="first">runner-a</TableCell>
          </TableRow>
        </TableRows>
      </Table>,
    );
    expect(html).toContain('data-hide-when="first"');
    expect(html).toContain('data-folded-only="first"');
    expect(html).toContain('title="아주 긴 첫째 제목"');
    expect(renderToString(<RowTitle>짧음</RowTitle>)).not.toContain("title=");
  });

  it("Table 은 narrowColumns 를 준 표에서만 좁을 때 머리글을 숨긴다(티켓 0091)", () => {
    const headClass = (narrow: string | undefined) =>
      /<div aria-hidden="true" class="([^"]*)"/.exec(
        renderToString(
          <Table
            columns="minmax(0, 1fr) 80px"
            {...(narrow === undefined ? {} : { narrowColumns: narrow })}
          >
            <TableHead>
              <TableHeader>제목</TableHeader>
            </TableHead>
          </Table>,
        ),
      )?.[1] ?? "";
    expect(headClass(undefined)).not.toBe("");
    expect(headClass("minmax(0, 1fr)").split(" ").length).toBeGreaterThan(
      headClass(undefined).split(" ").length,
    );
  });

  it("Tabs 는 고른 탭을 aria-selected 로 표시하고 개수를 붙인다", () => {
    const html = renderToString(
      <Tabs value="todo" onValueChange={noop} label="상태로 거르기">
        <Tab value="all" count={42}>
          전체
        </Tab>
        <Tab value="todo" count={3} attention>
          처리할 일
        </Tab>
      </Tabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="상태로 거르기"');
    expect(html).toMatch(/aria-selected="true"[^>]*>처리할 일/);
    expect(html).toContain(">42<");
  });

  it("Tabs chips 는 같은 탭 목록을 칩 모양으로 그린다", () => {
    const html = renderToString(
      <Tabs value="all" onValueChange={noop} label="상태로 거르기" variant="chips">
        <Tab value="all" count={52}>
          전체
        </Tab>
        <Tab value="todo" count={4} attention>
          처리할 일
        </Tab>
      </Tabs>,
    );
    const underline = renderToString(
      <Tabs value="all" onValueChange={noop} label="상태로 거르기">
        <Tab value="all" count={52}>
          전체
        </Tab>
      </Tabs>,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>전체/);
    expect(html).toContain(">4<");
    const listClass = (h: string) =>
      /role="tablist"[^>]*class="([^"]+)"|class="([^"]+)"[^>]*role="tablist"/.exec(h);
    const chips = listClass(html);
    const under = listClass(underline);
    expect(chips?.[1] ?? chips?.[2]).not.toBe(under?.[1] ?? under?.[2]);
  });

  it("Tabs 는 값이 null 이면 아무 탭도 고르지 않는다(티켓 0091)", () => {
    for (const html of [
      renderToString(
        <Tabs<string> value={null} onValueChange={noop} label="상태로 거르기" variant="chips">
          <Tab value="queued" count={1}>
            Queued
          </Tab>
        </Tabs>,
      ),
      renderToString(
        <SegmentedTabs<string>
          value={null}
          onValueChange={noop}
          label="묶음으로 거르기"
          items={[{ value: "all", label: "모두", count: 3 }]}
        />,
      ),
    ]) {
      expect(html).toContain('role="tab"');
      expect(html).not.toContain('aria-selected="true"');
    }
  });

  it("TimeSlot 은 시간 글을 같은 폭 칸에 두고, dateTime 을 주면 time 요소다(티켓 0091)", () => {
    const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";
    const short = renderToString(<TimeSlot>{"<1 min"}</TimeSlot>);
    const long = renderToString(<TimeSlot>1 hr 3 min</TimeSlot>);
    expect(short).toMatch(/^<span data-slot="time"/);
    expect(classOf(short)).toBe(classOf(long));
    const time = renderToString(<TimeSlot dateTime="2026-11-17T09:00:00.000Z">11월 17일</TimeSlot>);
    expect(time).toMatch(/^<time dateTime="2026-11-17T09:00:00.000Z" data-slot="time"/);
    expect(classOf(time)).toBe(classOf(short));
    expect(renderToString(<TimeSlot>12345 days</TimeSlot>)).toContain(">12345 days<");
  });

  it("RowActionSlot 은 버튼이 없어도 같은 폭 칸을 남긴다(티켓 0091)", () => {
    const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";
    const empty = renderToString(<RowActionSlot />);
    const filled = renderToString(
      <RowActionSlot>
        <Button>답하기</Button>
      </RowActionSlot>,
    );
    expect(empty).toMatch(/^<span data-slot="action"/);
    expect(filled).toContain("답하기");
    expect(classOf(empty)).toBe(classOf(filled));
  });

  it("Field 의 오류는 입력을 invalid 로 만들고 라벨을 잇는다", () => {
    const html = renderToString(
      <Field label="Orca 경로" error="찾지 못했어요">
        <Input name="orca" defaultValue="/opt/orca" mono />
      </Field>,
    );
    expect(html).toContain("Orca 경로");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("찾지 못했어요");
    const label = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
    expect(label).toBeDefined();
    expect(html).toContain(`id="${label}"`);
  });

  it("Input 은 data 속성과 inputMode 를 입력 요소에 넘긴다(티켓 0055)", () => {
    const html = renderToString(
      <Field label="API 키">
        <Input
          name="apiKey"
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          inputMode="numeric"
        />
      </Field>,
    );
    const input = /<input[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('data-1p-ignore="true"');
    expect(input).toContain('data-lpignore="true"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('autoComplete="off"');
  });

  it("버튼과 버튼 모양 트리거는 data-variant 로 변형을 드러낸다(주 버튼 하나 시험, ADR 0010 6번)", () => {
    const html = renderToString(
      <>
        <Button variant="primary">시작</Button>
        <Button>보기</Button>
        <Button variant="danger">거절</Button>
        <Dialog
          trigger="지우기"
          triggerVariant="danger"
          title="지울까요?"
          actions={<DialogClose>취소</DialogClose>}
        />
      </>,
    );
    expect([...html.matchAll(/data-variant="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "primary",
      "secondary",
      "danger",
      "danger",
    ]);
  });

  it("Button 의 outlined 는 고른 버튼에만 표시되고 기본 버튼은 그대로다(0172)", () => {
    expect(renderToString(<Button outlined>할당</Button>)).toContain("data-outlined");
    expect(renderToString(<Button>할당</Button>)).not.toContain("data-outlined");
  });

  it("Dialog 는 trigger 를 주지 않으면 트리거 버튼을 그리지 않는다(0172)", () => {
    const html = renderToString(
      <Dialog open={false} title="지울까요?" actions={<DialogClose>취소</DialogClose>} />,
    );
    expect(html).not.toContain("<button");
  });

  it("Dialog 의 triggerBusy 는 트리거를 막힌 상태로 드러내고, 없으면 그대로 둔다(0156)", () => {
    const busy = renderToString(
      <Dialog
        trigger="지우기"
        triggerBusy={{ active: true, label: "지우는 중" }}
        title="지울까요?"
        actions={<DialogClose>취소</DialogClose>}
      />,
    );
    const idle = renderToString(
      <Dialog trigger="지우기" title="지울까요?" actions={<DialogClose>취소</DialogClose>} />,
    );

    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-disabled="true"');
    expect(idle).not.toContain("aria-busy");
    expect(idle).not.toContain("aria-disabled");
  });

  it("레일 Menu 는 펼침 화살표 없이 트리거 내용만 그린다", () => {
    const rail = renderToString(
      <Menu variant="rail" label="Workspace 바꾸기" trigger="Acme">
        <MenuItem value="a">A</MenuItem>
      </Menu>,
    );
    const field = renderToString(
      <Menu trigger="Acme">
        <MenuItem value="a">A</MenuItem>
      </Menu>,
    );
    expect(rail).toContain('aria-label="Workspace 바꾸기"');
    expect(rail).toContain("Acme");
    expect(rail).not.toContain("<svg");
    expect(field).toContain("<svg");
  });

  it("Menu 트리거와 RadioGroup 은 설명 글을 aria-describedby 로 잇는다(0115)", () => {
    const html = renderToString(
      <>
        <Menu label="Web에 저장소 더하기" describedBy="hint-a" trigger="저장소 더하기">
          <MenuItem value="a">A</MenuItem>
        </Menu>
        <RadioGroup labelledBy="title-b" describedBy="hint-b">
          <RadioOption name="r" value="a" checked onCheck={noop}>
            A
          </RadioOption>
        </RadioGroup>
      </>,
    );
    expect(html).toMatch(
      /aria-label="Web에 저장소 더하기"[^>]*aria-describedby="hint-a"|aria-describedby="hint-a"[^>]*aria-label="Web에 저장소 더하기"/,
    );
    expect(html).toContain('role="radiogroup" aria-labelledby="title-b" aria-describedby="hint-b"');
  });

  it("팝업(Menu·Select·Dialog·Tooltip)은 닫힌 채 트리거만 보인다", () => {
    const html = renderToString(
      <>
        <Menu trigger="Workspace">
          <MenuItem value="a">A</MenuItem>
        </Menu>
        <Select
          value={null}
          onValueChange={noop}
          placeholder="골라 주세요"
          options={[{ value: "a", label: "A" }]}
        />
        <Dialog trigger="지우기" title="지울까요?" actions={<DialogClose>취소</DialogClose>} />
        <Tooltip content="힌트">capacity</Tooltip>
      </>,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("골라 주세요");
    expect(html).toContain("지우기");
    expect(html).not.toContain("지울까요?");
  });

  it("Tooltip 의 render 는 링크를 트리거로 쓰고, shortcut 은 aria-keyshortcuts 와 키 표시를 더한다(0102)", () => {
    const html = renderToString(
      <Tooltip content="Runs" labelsTrigger shortcut="Mod+3" render={<a href="/runs" />}>
        Runs
      </Tooltip>,
    );
    expect(html).toMatch(/<a [^>]*href="\/runs"[^>]*aria-keyshortcuts="Control\+3"/);
    expect(html).not.toContain("<button");
    expect(html).toContain("Ctrl+3");

    const disabled = renderToString(
      <Tooltip content="Runs" labelsTrigger disabled render={<a href="/runs" />}>
        Runs
      </Tooltip>,
    );
    expect(disabled).toMatch(/<a [^>]*href="\/runs"/);
    expect(disabled).not.toContain("aria-keyshortcuts");

    const plain = renderToString(<Tooltip content="힌트">capacity</Tooltip>);
    expect(plain).toContain("<button");
    expect(plain).not.toContain("aria-keyshortcuts");
  });

  it("Popover 는 닫힌 채 버튼 모양 트리거만 보이고, 열면 제목과 닫기 버튼을 그린다", () => {
    const closed = renderToString(
      <Popover trigger="답하기" title="질문" closeLabel="닫기" open={false} onOpenChange={noop}>
        <p>내용</p>
      </Popover>,
    );
    expect(closed).toMatch(/<button[^>]*data-variant="secondary"[^>]*>답하기<\/button>/);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("내용");

    const danger = renderToString(
      <Popover
        trigger="거절하기"
        triggerVariant="danger"
        title="권한"
        closeLabel="닫기"
        open={false}
        onOpenChange={noop}
      >
        <p>내용</p>
      </Popover>,
    );
    expect(danger).toContain('data-variant="danger"');
  });

  it("KanbanColumn 은 제목으로 이름 붙은 구역이고 h2 제목과 개수를 그린다(티켓 0100)", () => {
    const html = renderToString(
      <KanbanColumn title="Running" count={3}>
        <KanbanCards>
          <li>카드</li>
        </KanbanCards>
        <KanbanSubheading>처리할 일 없이 끝났어요</KanbanSubheading>
      </KanbanColumn>,
    );
    expect(html).toMatch(/^<section aria-label="Running"/);
    expect(html).toMatch(/<h2[^>]*>Running<\/h2><span[^>]*>3<\/span>/);
    expect(html).toMatch(/<ul[^>]*><li>카드<\/li><\/ul>/);
    expect(html).toMatch(/<p[^>]*>처리할 일 없이 끝났어요<\/p>/);
  });

  it("KanbanCard 는 패널을 여는 버튼 하나이고, 행동은 그 버튼 밖에 둔다(티켓 0100)", () => {
    const html = renderToString(
      <KanbanCard
        tag={<StatusPill status="question">Question</StatusPill>}
        title="ACME-1"
        detail="질문"
        meta="runner-a"
        time="12 min"
        action={<Button>답하기</Button>}
        selected
        onOpen={noop}
      />,
    );
    expect(html).toMatch(/<button type="button" aria-haspopup="dialog" aria-expanded="true"/);
    const open = html.slice(html.indexOf("<button"), html.indexOf("</button>") + 9);
    expect(open).toContain("Question");
    expect(open).toContain("ACME-1");
    expect(open).toContain("12 min");
    expect(open).not.toContain("답하기");
    expect(html.indexOf("답하기")).toBeGreaterThan(html.indexOf("</button>"));
    const named = /aria-labelledby="([^"]+)" aria-describedby="([^"]+)"/.exec(html);
    expect(named).not.toBeNull();
    const [, nameId = "", described = ""] = named ?? [];
    expect(html).toMatch(new RegExp(`<span id="${nameId}"[^>]*>ACME-1</span>`));
    expect(described.split(" ")).toHaveLength(3);
    expect(html).not.toMatch(/draggable|grab/);

    const plain = renderToString(<KanbanCard title="ACME-2" titleId="card-2" onOpen={noop} />);
    expect(plain).toContain('aria-expanded="false"');
    expect(plain).toContain('aria-labelledby="card-2"');
    expect(plain).not.toContain("aria-describedby");
    expect(plain).not.toContain("data-status=");
  });

  it("KanbanCard ticketKey 는 번호 줄에 알약을 두고 이름은 번호와 제목이다(티켓 0160)", () => {
    const html = renderToString(
      <KanbanCard
        ticketKey="ACME-15"
        tag={<StatusPill status="failed">Failed</StatusPill>}
        title="알림 묶기"
        blockers={
          <BlockerChips>
            <BlockerChip state="done" ticketKey="ACME-9" stateName="Done" />
            <BlockerChip state="canceled" ticketKey="ACME-10" stateName="취소" />
          </BlockerChips>
        }
        stuck
        meta="선행 티켓이 취소됐어요"
        metaTone="problem"
        time="2 hr"
        onOpen={noop}
      />,
    );
    const nameId = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    const name = new RegExp(`<span id="${nameId}"[^>]*>(.*?)</span></span>`).exec(html)?.[1] ?? "";
    expect(name).toContain("ACME-15");
    expect(name).toContain("알림 묶기");
    expect(name).not.toContain("Failed");
    expect(html.indexOf("Failed")).toBeGreaterThan(html.indexOf("알림 묶기"));
    expect(html).toContain('data-blocker-state="done"');
    expect(html).toContain('data-blocker-state="canceled"');
    expect(/aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(" ")).toHaveLength(3);

    const calm = renderToString(<KanbanCard ticketKey="ACME-15" title="알림 묶기" onOpen={noop} />);
    const classOfButton = (rendered: string) => /<button[^>]*class="([^"]*)"/.exec(rendered)?.[1];
    expect(classOfButton(html)).not.toBe(classOfButton(calm));
  });

  it("KanbanCard prChips 는 선행 칩 뒤, 바닥 줄 위에 두고 설명에 들어간다(티켓 0167)", () => {
    const html = renderToString(
      <KanbanCard
        ticketKey="ACME-15"
        title="알림 묶기"
        detail="기본값을 거절로 둘까요?"
        blockers={
          <BlockerChips>
            <BlockerChip state="active" ticketKey="ACME-9" stateName="In Progress" />
          </BlockerChips>
        }
        prChips={
          <>
            <PrChip kind="ci-failed">CI 실패</PrChip>
            <PrChip kind="behind">3커밋 뒤</PrChip>
            <PrChipMore hiddenLabel="충돌">+1</PrChipMore>
          </>
        }
        meta="runner-a"
        onOpen={noop}
      />,
    );
    const order = ["기본값을", "data-blocker-state", 'data-pr-chip="ci-failed"', "runner-a"].map(
      (part) => html.indexOf(part),
    );
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(order).not.toContain(-1);
    expect(/aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(" ")).toHaveLength(3);
    expect(html).toMatch(/<span aria-hidden="true">\+1<\/span>/);
    expect(html).toContain("충돌");

    const onlyPr = renderToString(
      <KanbanCard title="ACME-2" prChips={<PrChip kind="conflict">충돌</PrChip>} onOpen={noop} />,
    );
    const describedId = /aria-describedby="([^"]+)"/.exec(onlyPr)?.[1] ?? "";
    expect(onlyPr).toContain(`id="${describedId}"`);
  });

  it("KanbanCard 의 menu 는 카드 버튼 밖에 두고, 아이콘 메뉴 단추는 label 을 이름으로 가진다(티켓 0118)", () => {
    const html = renderToString(
      <KanbanCard
        title="ACME-1"
        meta="runner-a"
        time="24 min"
        menu={
          <Menu variant="icon" label="ACME-1 런 메뉴" trigger={<MoreIcon />}>
            <MenuItem value="pause">멈추기</MenuItem>
          </Menu>
        }
        onOpen={noop}
      />,
    );
    const openEnd = html.indexOf("</button>") + "</button>".length;
    const open = html.slice(html.indexOf("<button"), openEnd);
    expect(open).not.toContain("ACME-1 런 메뉴");
    const trigger = /<button[^>]*aria-label="ACME-1 런 메뉴"[^>]*>/.exec(html.slice(openEnd));
    expect(trigger).not.toBeNull();
    expect(trigger?.[0]).toContain('aria-haspopup="menu"');
    expect(html.slice(openEnd)).not.toContain('d="M4 6l4 4 4-4"');

    const plain = renderToString(<KanbanCard title="ACME-1" detail="설명" onOpen={noop} />);
    const problem = renderToString(
      <KanbanCard title="ACME-1" detail="멈추지 못했어요" detailTone="problem" onOpen={noop} />,
    );
    const classOf = (rendered: string, word: string) =>
      new RegExp(`class="([^"]*)"[^>]*>${word}<`).exec(rendered)?.[1];
    expect(classOf(problem, "멈추지 못했어요")).not.toBe(classOf(plain, "설명"));
  });

  it("Sheet 는 닫혀 있으면 아무것도 그리지 않는다(티켓 0100)", () => {
    const html = renderToString(
      <Sheet open={false} onOpenChange={noop} title="ACME-1" closeLabel="닫기">
        <p>내용</p>
      </Sheet>,
    );
    expect(html).not.toContain("내용");
    expect(html).not.toContain("닫기");
  });

  it("Checkbox 는 라벨 안에 체크 상태와 설명을 갖고, 고를 수 없으면 disabled 를 넘긴다", () => {
    const html = renderToString(
      <>
        <Checkbox label="Web" checked onCheckedChange={noop} />
        <Checkbox
          label="API"
          description="다른 Workspace에 있어요"
          checked={false}
          disabled
          onCheckedChange={noop}
        />
      </>,
    );
    const labels = [...html.matchAll(/<label[^>]*>(.*?)<\/label>/gs)].map((m) => m[1] ?? "");
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('role="checkbox"');
    expect(labels[0]).toContain('aria-checked="true"');
    expect(labels[1]).toContain('aria-checked="false"');
    expect(labels[1]).toContain('disabled=""');
    expect(labels[1]).not.toContain("다른 Workspace에 있어요");
    const describedBy = /aria-describedby="([^"]+)"/.exec(labels[1] ?? "")?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toMatch(new RegExp(`id="${describedBy}"[^>]*>다른 Workspace에 있어요<`));
    expect(labels[0]).not.toContain("aria-describedby");
  });

  it("Select 는 aria-label 을 트리거에 붙인다", () => {
    const html = renderToString(
      <Select
        aria-label="Web의 에이전트"
        value={null}
        onValueChange={noop}
        options={[{ value: "a", label: "A" }]}
      />,
    );
    expect(html).toContain('aria-label="Web의 에이전트"');
  });

  it("DefinitionList 는 dt·dd 짝을 만든다", () => {
    const html = renderToString(
      <DefinitionList>
        <DefinitionItem label="러너">runner-a</DefinitionItem>
        <DefinitionItem label="PR" empty>
          없음
        </DefinitionItem>
      </DefinitionList>,
    );
    expect(html.match(/<dt/g)).toHaveLength(2);
    expect(html.match(/<dd/g)).toHaveLength(2);
  });

  it("SplitView stackedListShare larger 는 쌓였을 때 목록에 더 큰 몫을 주고, 주지 않으면 지금 배치 그대로다(0127)", () => {
    const half = renderToString(<SplitView list="목록" panel="패널" />);
    const explicitHalf = renderToString(
      <SplitView stackedListShare="half" list="목록" panel="패널" />,
    );
    const larger = renderToString(<SplitView stackedListShare="larger" list="목록" panel="패널" />);
    expect(explicitHalf).toEqual(half);
    expect(larger).toContain("목록");
    expect(larger).not.toEqual(half);
  });

  it("SplitView editor 는 목록 변형과 다른 열 배치를 쓴다", () => {
    const list = renderToString(<SplitView list="목록" panel="패널" />);
    const editor = renderToString(<SplitView variant="editor" list="목록" panel="패널" />);
    expect(editor).toContain("목록");
    expect(editor).toContain("패널");
    expect(editor).not.toEqual(list);
  });
});

const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";
const classSet = (classes: string) => new Set(classes.split(" ").filter((c) => c !== ""));

describe("글자 역할(티켓 0073)", () => {
  const before = [
    ["page", "x1ghz6dp xymnt6j x1ytcrri x1n3ag6q x7qxgva x9r7267 x1w2vvpw"],
    ["panel", "x1ghz6dp xymnt6j x16htn7p x1n3ag6q x1dcssyw x26juqj x1fzhlzt"],
    ["title", "x1ghz6dp xymnt6j x1ipzcd8 x1xo4w25 x1u72hlg"],
    ["body", "x1ghz6dp xfl7axt x1ipzcd8 x1nvr2p0 x1fzhlzt"],
    ["ui", "x1ghz6dp xfl7axt xhfhf9y x1u72hlg"],
    ["meta", "x1ghz6dp x1p8q0ov xhfhf9y x1u72hlg"],
    ["label", "x1ghz6dp x1p8q0ov xk1alkk x1xo4w25 x1u72hlg"],
  ] as const satisfies ReadonlyArray<readonly [TextVariant, string]>;

  it("기존 변형은 0073 전과 같은 스타일(같은 원자 클래스)을 쓴다", () => {
    for (const [variant, classes] of before) {
      const html = renderToString(<Text variant={variant}>글</Text>);
      expect([variant, classSet(classOf(html))]).toEqual([variant, classSet(classes)]);
    }
  });

  it("새 역할 display·heading·subheading 은 기존 변형과 다른 스타일이고 알맞은 제목 요소를 쓴다", () => {
    const html = (variant: TextVariant) => renderToString(<Text variant={variant}>글</Text>);
    expect(html("display")).toMatch(/^<h2/);
    expect(html("heading")).toMatch(/^<h2/);
    expect(html("subheading")).toMatch(/^<h3/);
    const all = new Set(TEXT_VARIANTS.map((v) => classOf(html(v))));
    expect(all.size).toBe(TEXT_VARIANTS.length);
  });

  it("textStyles 는 Text 와 같은 스타일을 다른 요소에 입힌다", () => {
    for (const role of TEXT_VARIANTS) {
      const fromText = classOf(renderToString(<Text variant={role}>글</Text>));
      expect(stylex.props(textStyles(role)).className).toBe(fromText);
    }
  });
});

describe("면 역할(티켓 0073)", () => {
  it("Card 기본 면은 0073 전과 같은 스타일을 쓴다", () => {
    expect(classSet(classOf(renderToString(<Card>내용</Card>)))).toEqual(
      classSet("x78zum5 xdt5ytf x17ftvvs x3jr529 xeb2ruz xmd46ts"),
    );
    expect(classSet(classOf(renderToString(<Card padding="compact">내용</Card>)))).toEqual(
      classSet("x78zum5 xdt5ytf xeb2ruz xmd46ts xxhr3t x5rrxxc"),
    );
  });

  it("면 역할 네 가지가 서로 다르고, Card surface 와 surfaceStyles 가 같은 면을 쓴다", () => {
    const cards = SURFACE_ROLES.map((surface) =>
      classOf(renderToString(<Card surface={surface}>내용</Card>)),
    );
    expect(new Set(cards).size).toBe(SURFACE_ROLES.length);
    for (const [index, surface] of SURFACE_ROLES.entries()) {
      const surfaceClasses = classSet(stylex.props(surfaceStyles(surface)).className ?? "");
      expect([...surfaceClasses].every((c) => classSet(cards[index] ?? "").has(c))).toBe(true);
    }
  });
});

describe("Section 제목 역할(티켓 0073)", () => {
  it("기본 Section 제목은 subheading 역할의 h3 이다(티켓 0074에서 section 변형을 정리)", () => {
    const html = renderToString(
      <Section title="T" count={2} note="n">
        c
      </Section>,
    );
    expect(html).toContain(
      `<h3 class="${stylex.props(textStyles("subheading")).className}">T</h3>`,
    );
  });

  it("heading 은 h2, subheading 은 h3 이고 글자 역할 스타일을 쓴다", () => {
    const heading = renderToString(
      <Section title="To do" titleRole="heading" count={3}>
        c
      </Section>,
    );
    const subheading = renderToString(
      <Section title="Runners" titleRole="subheading">
        c
      </Section>,
    );
    expect(heading).toContain(
      `<h2 class="${stylex.props(textStyles("heading")).className}">To do</h2>`,
    );
    expect(subheading).toContain(
      `<h3 class="${stylex.props(textStyles("subheading")).className}">Runners</h3>`,
    );
    expect(heading).toContain(">3<");
  });

  it("오른쪽 링크는 이름과 주소를 가진 a 다", () => {
    const html = renderToString(
      <Section title="Done today" titleRole="heading" link={{ href: "/runs", label: "모두 보기" }}>
        c
      </Section>,
    );
    expect(html).toMatch(/<a href="\/runs"[^>]*>모두 보기<\/a>/);
  });
});

describe("새 컴포넌트(티켓 0073)", () => {
  const periods = [
    { value: "7d", label: "7일", count: 12 },
    { value: "30d", label: "30일", count: 40 },
    { value: "all", label: "전체" },
  ] as const;

  it("SegmentedTabs 는 이름 있는 tablist 이고 고른 탭만 탭 순서에 있어 화살표로 옮긴다", () => {
    const html = renderToString(
      <SegmentedTabs value="30d" onValueChange={noop} label="기간" items={periods} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="기간"');
    const tabs = html.match(/<button[^>]*role="tab"[^>]*>.*?<\/button>/g) ?? [];
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => /tabindex="(-?\d)"/.exec(tab)?.[1])).toEqual(["-1", "0", "-1"]);
    expect(tabs.map((tab) => /aria-selected="(\w+)"/.exec(tab)?.[1])).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(tabs[0]).toMatch(/>7일<span[^>]*>12<\/span>/);
    expect(tabs[2]).not.toContain("<span");
  });

  it("GroupHeader 는 상태 값으로 점 색을 고르고, 제목에 이름과 개수가 함께 있다", () => {
    const html = renderToString(
      <GroupHeader status="question" title="Question" count={2} description="답을 기다려요" />,
    );
    expect(html).toContain('data-tone="answer"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><\/span><h3/);
    expect(html).toMatch(/<h3[^>]*>Question<span[^>]*> <!-- -->2<\/span><\/h3>/);
    expect(html).toContain("답을 기다려요");
    expect(
      renderToString(<GroupHeader status="failed" title="Failed" headingLevel="h2" />),
    ).toMatch(/data-tone="problem"[^>]*>.*<h2/);
  });

  it("CapacityBar 는 이름 있는 meter 이고 '쓰는/전체' 를 값 글로 읽는다", () => {
    const html = renderToString(<CapacityBar used={1} total={2} label="작업 칸" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="작업 칸"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuemax="2"');
    expect(html).toContain('aria-valuetext="1/2"');
    expect(html).toContain('data-tone="progress"');
    expect(html).toMatch(/aria-hidden="true"[^>]*>1\/2</);
    expect(
      renderToString(<CapacityBar used={2} total={2} label="작업 칸" tone="problem" />),
    ).toContain('data-tone="problem"');
    expect(renderToString(<CapacityBar used={0} total={0} label="작업 칸" />)).toContain(
      'aria-valuetext="0/0"',
    );
  });

  it("UsageBar 는 이름 있는 meter 이고 '%' 를 값 글로 읽는다", () => {
    const html = renderToString(<UsageBar percent={72.4} label="Claude 주간" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="Claude 주간"');
    expect(html).toContain('aria-valuenow="72.4"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuetext="72%"');
    expect(html).toContain('data-tone="neutral"');
    expect(html).toMatch(/aria-hidden="true"[^>]*>72%</);
    const over = renderToString(<UsageBar percent={130} label="한도" tone="problem" />);
    expect(over).toContain('data-tone="problem"');
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('aria-valuetext="130%"');
  });

  it("UsageMeter 는 이름과 %를 한 줄에, 막대를 그 아래에 두고 meter 하나로 읽는다", () => {
    const html = renderToString(
      <UsageMeter
        name="Claude 5시간"
        percent={93.2}
        label="runner-a Claude 5시간"
        tone="problem"
      />,
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="runner-a Claude 5시간"');
    expect(html).toContain('aria-valuetext="93%"');
    expect(html).toContain('data-tone="problem"');
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*><span[^>]*>Claude 5시간<\/span><span[^>]*>93%<\/span><\/span><div/,
    );
    const over = renderToString(<UsageMeter name="주간" percent={130} label="주간" />);
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('data-tone="neutral"');
  });

  it("ResponsiveColumns 는 앞 칸 + 고정 폭 칸 격자이고 좁으면 마지막 칸만 늘린다", () => {
    expect(responsiveColumnTemplates(["120px", "200px"])).toEqual({
      wide: "minmax(0, 1fr) 120px 200px",
      split: "120px minmax(0, 1fr)",
    });
    const row = renderToString(
      <ResponsiveColumns
        id="row-1"
        lead={<b>이름</b>}
        columns={[
          { width: "120px", content: "1/2" },
          { width: "200px", content: "72%" },
        ]}
      />,
    );
    expect(row).toMatch(/<span id="row-1" data-columns="responsive"/);
    expect(row).toMatch(
      /<span[^>]*><b>이름<\/b><\/span><span[^>]*>1\/2<\/span><span[^>]*>72%<\/span>/,
    );
    const head = renderToString(
      <ResponsiveColumnsHead lead="러너" columns={[{ width: "120px", content: "자리" }]} />,
    );
    expect(head).toContain('data-columns="head"');
    expect(head).toMatch(/>러너<\/span><span>자리<\/span>/);
  });

  it("PanelRows 는 목록 태그를 고르고 목록 표시를 지운다", () => {
    expect(renderToString(<PanelRows>x</PanelRows>)).toMatch(/^<ul /);
    expect(renderToString(<PanelRows ordered>x</PanelRows>)).toMatch(/^<ol /);
  });

  it("PanelSection 은 제목 h3 로 이름 붙은 section 이고 meta 를 제목 줄 끝에 둔다", () => {
    const html = renderToString(
      <PanelSection title="자리" meta="1/2">
        <p>본문</p>
      </PanelSection>,
    );
    const id = /<section aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(id).not.toBe("");
    expect(html).toContain(`<h3 id="${id}"`);
    expect(html).toMatch(/>자리<\/h3><span[^>]*>1\/2<\/span><\/div><p>본문<\/p>/);
    expect(renderToString(<PanelSection title="t">x</PanelSection>)).not.toMatch(/<\/h3><span/);
  });

  it("PanelSection 의 detail 은 제목 바로 옆, meta 는 줄 끝에 둔다", () => {
    const html = renderToString(
      <PanelSection title="PR #1" detail="Open" meta="방금">
        x
      </PanelSection>,
    );
    expect(html).toMatch(/>PR #1<\/h3><span[^>]*>Open<\/span><\/span><span[^>]*>방금<\/span>/);
  });

  it("PanelHeader 에 eyebrow 를 주면 첫 줄이 그 글이고 상태는 제목 아래로 온다", () => {
    const html = renderToString(<PanelHeader eyebrow="ACME-1" status="상태" title="제목" />);
    expect(html.indexOf("ACME-1")).toBeLessThan(html.indexOf("제목"));
    expect(html.indexOf("제목")).toBeLessThan(html.indexOf("상태"));
    const plain = renderToString(<PanelHeader status="상태" title="제목" />);
    expect(plain.indexOf("상태")).toBeLessThan(plain.indexOf("제목"));
  });

  it("SignalRow 는 이름·값을 dt·dd 로 두고 톤마다 아이콘 모양이 다르다", () => {
    const tones = ["pass", "problem", "warning", "neutral"] as const;
    const paths = tones.map((tone) => {
      const html = renderToString(
        <SignalList>
          <SignalRow label="CI" tone={tone} action={<a href="/x">보기</a>}>
            값
          </SignalRow>
        </SignalList>,
      );
      expect(html).toMatch(/^<dl /);
      expect(html).toContain(`data-signal-tone="${tone}"`);
      expect(html).toMatch(/<dt[^>]*>CI<\/dt><dd/);
      expect(html).toContain(">보기</a>");
      return /<path[^>]* d="([^"]+)"/.exec(html)?.[1] ?? /d="([^"]+)"/.exec(html)?.[1];
    });
    expect(new Set(paths).size).toBe(tones.length);
  });

  it("CapacityTrack 은 칸마다 하나를 그리고 자리가 0이거나 너무 많으면 그리지 않는다", () => {
    const html = renderToString(<CapacityTrack used={2} total={3} label="3자리 중 2자리 사용" />);
    expect(html).toContain('role="img" aria-label="3자리 중 2자리 사용"');
    expect(html.match(/data-cell="used"/g)).toHaveLength(2);
    expect(html.match(/data-cell="free"/g)).toHaveLength(1);
    expect(renderToString(<CapacityTrack used={0} total={0} label="x" />)).toBe("");
    expect(renderToString(<CapacityTrack used={1} total={33} label="x" />)).toBe("");
  });

  it("CheckResultRow 는 상태를 아이콘 모양과 화면 읽기 글로 함께 보인다", () => {
    const shape = (state: "ok" | "broken" | "unknown") =>
      /<path d="([^"]+)"/.exec(
        renderToString(<CheckResultRow state={state} stateLabel="상태" name="항목" />),
      )?.[1];
    expect(new Set([shape("ok"), shape("broken"), shape("unknown")]).size).toBe(3);
    const html = renderToString(
      <CheckResultRow state="broken" stateLabel="깨졌어요" name="GitHub push" reason="인증 실패" />,
    );
    expect(html).toContain('data-check="broken"');
    expect(html).toContain("깨졌어요");
    expect(html).toContain("인증 실패");
  });

  it("ExpandableRow 는 처음에 접혀 있고 내용을 그리지 않는다", () => {
    const html = renderToString(<ExpandableRow summary="4개 모두 통과">내용</ExpandableRow>);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
    expect(html).toContain("4개 모두 통과");
    expect(html).not.toContain("내용");
  });

  it("PanelListRow 는 href 를 주면 행 전체가 링크다", () => {
    const html = renderToString(<PanelListRow href="/runs/1" ticketKey="ACME-1" title="제목" />);
    expect(html).toMatch(/<li[^>]*><a href="\/runs\/1"/);
    expect(html).not.toContain("<button");
  });

  it("PanelSection 은 count 와 info 를 제목 옆에, meta 를 오른쪽에 둔다", () => {
    const html = renderToString(
      <PanelSection title="자리" count="2/3" info={<i>도움말</i>} meta="3분 전">
        본문
      </PanelSection>,
    );
    expect(html).toMatch(/<h3[^>]*>자리<\/h3><span[^>]*>2\/3<\/span><i>도움말<\/i><\/span><span/);
  });

  it("CapacityCells 는 자리 하나를 칸 하나로 그리고 칸 묶음을 이름 하나로 읽는다", () => {
    const html = renderToString(<CapacityCells used={2} total={3} label="3자리 중 2자리 사용" />);
    expect(html).toMatch(/^<span role="img" aria-label="3자리 중 2자리 사용" data-tone="progress"/);
    expect([...html.matchAll(/data-cell="(used|free)"/g)].map((m) => m[1])).toEqual([
      "used",
      "used",
      "free",
    ]);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*><span data-cell="used"/);
    expect(html).toMatch(/aria-hidden="true"[^>]*>2\/3</);
    expect(renderToString(<CapacityCells used={1} total={2} label="x" tone="problem" />)).toContain(
      'data-tone="problem"',
    );
  });

  it("CapacityCells 는 쓰는 칸과 빈칸의 모양을 다르게 하고, 쓰는 칸 색은 tone 을 따른다", () => {
    const cellClass = (html: string, kind: "used" | "free") =>
      new RegExp(`data-cell="${kind}" class="([^"]+)"`).exec(html)?.[1] ?? "";
    const progress = renderToString(<CapacityCells used={1} total={2} label="x" />);
    const problem = renderToString(<CapacityCells used={1} total={2} label="x" tone="problem" />);
    expect(cellClass(progress, "used")).not.toBe(cellClass(progress, "free"));
    expect(cellClass(progress, "used")).not.toBe(cellClass(problem, "used"));
    expect(cellClass(progress, "free")).toBe(cellClass(problem, "free"));
  });

  it("CapacityCells 는 자리가 기준보다 많으면 칸 없이 숫자만 보인다", () => {
    expect(CAPACITY_CELLS_MAX).toBe(8);
    const atMax = renderToString(<CapacityCells used={8} total={8} label="x" />);
    expect(atMax).toContain('data-cells="shown"');
    expect([...atMax.matchAll(/data-cell=/g)]).toHaveLength(8);
    const over = renderToString(<CapacityCells used={3} total={9} label="x" />);
    expect(over).toContain('data-cells="number-only"');
    expect(over).not.toContain("data-cell=");
    expect(over).toMatch(/aria-hidden="true"[^>]*>3\/9</);
    const none = renderToString(<CapacityCells used={0} total={0} label="x" />);
    expect(none).toContain('data-cells="number-only"');
    expect(none).toMatch(/>0\/0</);
  });

  it('CapacityCells 는 overflow="meter" 면 8자리까지 칸, 넘으면 막대와 숫자로 보인다(0173)', () => {
    const atMax = renderToString(<CapacityCells used={8} total={8} label="x" overflow="meter" />);
    expect(atMax).toContain('data-cells="shown"');
    expect(atMax).not.toContain("data-capacity-meter");
    const over = renderToString(<CapacityCells used={9} total={12} label="x" overflow="meter" />);
    expect(over).toContain('data-cells="meter"');
    expect(over).toContain("data-capacity-meter");
    expect(over).not.toContain("data-cell=");
    expect(over).toMatch(/aria-hidden="true"[^>]*>9\/12</);
    const none = renderToString(<CapacityCells used={0} total={0} label="x" overflow="meter" />);
    expect(none).toContain('data-cells="number-only"');
  });

  it("CapacityCells 는 쓰는 자리가 capacity 보다 많아도 칸은 capacity 만큼 채우고 숫자는 그대로 보인다", () => {
    const html = renderToString(<CapacityCells used={3} total={2} label="x" />);
    expect([...html.matchAll(/data-cell="(used|free)"/g)].map((m) => m[1])).toEqual([
      "used",
      "used",
    ]);
    expect(html).toMatch(/>3\/2</);
  });

  it("ProblemCallout 은 제목으로 이름 붙은 구역이고, 단계는 번호 목록, 행동은 마지막이다", () => {
    const html = renderToString(
      <ProblemCallout
        title="GitHub 인증이 깨졌어요"
        steps={["러너에서 gh auth login 을 실행해요", "다시 확인을 눌러요"]}
        actions={<Button>다시 확인</Button>}
      >
        이 러너는 PR 을 만들 수 없어요.
      </ProblemCallout>,
    );
    const labelledBy = /^<section aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeDefined();
    expect(html).toMatch(new RegExp(`<h3 id="${labelledBy}"[^>]*>GitHub 인증이 깨졌어요</h3>`));
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.indexOf("<ol")).toBeLessThan(html.indexOf("다시 확인</button>"));
    const plain = renderToString(<ProblemCallout title="Offline" />);
    expect(plain).not.toContain("<ol");
    expect(plain).not.toContain("<button");
  });

  it("StatTile 은 뜻으로 이름 붙은 묶음이고, 비교 줄은 좋아짐·나빠짐에 따라 색이 다르다", () => {
    const tile = (trend?: "better" | "worse") =>
      renderToString(
        <StatTile
          value="12"
          label="끝난 런"
          detail="지난주보다 3 늘었어요"
          {...(trend === undefined ? {} : { trend })}
        />,
      );
    const html = tile("better");
    const labelledBy = /role="group" aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelledBy).toBeDefined();
    expect(html).toMatch(new RegExp(`id="${labelledBy}"[^>]*>끝난 런<`));
    const detailClass = (h: string) => /data-trend="\w+" class="([^"]*)"/.exec(h)?.[1];
    expect(new Set([tile(), tile("better"), tile("worse")].map(detailClass)).size).toBe(3);
    expect(renderToString(<StatTile value="0" label="끝난 런" />)).not.toContain("data-trend");
  });

  it("StatusDot 은 상태 값으로 점 색을 고르고, 상태 이름은 화면 읽기용 글로 남긴다", () => {
    const html = renderToString(<StatusDot status="running">Running</StatusDot>);
    expect(html).toContain('data-tone="progress"');
    expect(html).toMatch(
      /<span aria-hidden="true"[^>]*><\/span><span class="[^"]+">Running<\/span>/,
    );
    const tones = PILL_STATUSES.map(
      (status) =>
        /data-tone="(\w+)"/.exec(renderToString(<StatusDot status={status}>x</StatusDot>))?.[1],
    );
    expect(tones).toEqual(PILL_STATUSES.map((status) => statusTone(status)));
    const dotClass = (status: PillStatus) =>
      /aria-hidden="true" class="([^"]*)"/.exec(
        renderToString(<StatusDot status={status}>x</StatusDot>),
      )?.[1];
    expect(dotClass("failed")).not.toEqual(dotClass("running"));
    expect(dotClass("failed")).toEqual(dotClass("offline"));
  });
});

describe("설정 한 페이지 부품(티켓 0119)", () => {
  it("SettingsRow labelFor 는 라벨을 그 스위치에 잇고, 누르면 바뀌는 label 로 그린다", () => {
    const html = renderToString(
      <SettingsRow
        label="잠자기"
        labelFor="sleep"
        control={<Switch id="sleep" checked onCheckedChange={noop} />}
      />,
    );
    expect(html).toMatch(/<label for="sleep"[^>]*>잠자기<\/label>/);
    expect(html).toMatch(/id="sleep"[^>]*role="switch"|role="switch"[^>]*id="sleep"/);
  });

  it("Field info 는 라벨 옆에 도움말을 두고, mono Input 은 맞춤법 검사를 끈다", () => {
    const html = renderToString(
      <Field label="토큰" info={<InfoTip label="토큰 도움말" content="암호화해 저장해요." />}>
        <Input value="" onValueChange={noop} mono />
      </Field>,
    );
    expect(html).toContain('aria-label="토큰 도움말"');
    expect(html).toMatch(/spellcheck="false"/i);
    expect(renderToString(<Input value="" onValueChange={noop} />)).not.toMatch(/spellcheck/i);
  });

  it("SettingsGroup padded 는 내용을 줄과 같은 안쪽 여백 상자로 감싼다", () => {
    const plain = renderToString(<SettingsGroup>내용</SettingsGroup>);
    const padded = renderToString(<SettingsGroup padded>내용</SettingsGroup>);
    expect(plain).not.toMatch(/<div[^>]*><div[^>]*>내용/);
    expect(padded).toMatch(/<div[^>]*><div[^>]*>내용<\/div><\/div>/);
  });

  it("Input invalid 는 aria-invalid 를 단다", () => {
    expect(
      renderToString(<Input aria-label="분" value="0" onValueChange={noop} invalid />),
    ).toContain('aria-invalid="true"');
  });

  it("Switch 는 role=switch 이고 켜짐·못 씀을 aria 로 알린다", () => {
    const on = renderToString(<Switch aria-label="잠자기" checked onCheckedChange={noop} />);
    expect(on).toMatch(/role="switch"/);
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('aria-label="잠자기"');
    const off = renderToString(
      <Switch aria-label="잠자기" checked={false} onCheckedChange={noop} disabled />,
    );
    expect(off).toContain('aria-checked="false"');
    expect(off).toMatch(/role="switch"[^>]*disabled|disabled[^>]*role="switch"/);
  });

  it("InfoTip 은 이름 있는 단추이고 설명을 aria-describedby 로 잇는 툴팁에 담는다", () => {
    const html = renderToString(<InfoTip label="최대 실행 시간 도움말" content="멈추고 끝내요." />);
    expect(html).toContain('aria-label="최대 실행 시간 도움말"');
    expect(html).toMatch(/<button[^>]*aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(html).toMatch(new RegExp(`role="tooltip"[^>]*id="${id}"[^>]*>멈추고 끝내요.`));
  });

  it("SettingsRow 는 라벨·값·동작을 한 줄에 두고 상태 칸을 늘 그려 둔다", () => {
    const html = renderToString(
      <SettingsGroup label="예시">
        <SettingsRow
          label="이름"
          labelId="name-label"
          value="Acme"
          detail="두 번째 줄"
          detailTone="problem"
          control={<Button>바꾸기</Button>}
        />
        <SettingsRow label="빈 줄" />
      </SettingsGroup>,
    );
    expect(html).toContain('role="group" aria-label="예시"');
    expect(html).toContain('id="name-label"');
    expect(html.match(/role="status"/g)).toHaveLength(2);
    expect(html).toContain(">바꾸기</button>");
    expect(html.match(/>Acme</g)).toHaveLength(2);
  });

  it("SettingsRow 는 펼치면 편집 영역을 그리고, formOnly 이면 줄 대신 편집 영역만 그린다", () => {
    const open = renderToString(
      <SettingsRow label="토큰" detail="저장했어요" expanded={<form />} />,
    );
    expect(open).toContain("토큰");
    expect(open).toContain("<form>");
    const only = renderToString(
      <SettingsRow label="이름" control={<Button>바꾸기</Button>} formOnly expanded={<form />} />,
    );
    expect(only).not.toContain("바꾸기");
    expect(only).toContain("<form>");
  });

  it("SettingsLinkRow 는 넘긴 링크 요소로 줄 전체를 감싸고 화살표를 붙인다", () => {
    const html = renderToString(
      <SettingsLinkRow
        id="runners-row"
        label="러너"
        detail="3대"
        render={(props) => <a href="/runners" {...props} />}
      />,
    );
    expect(html).toMatch(/<div id="runners-row"[^>]*><a href="\/runners"[^>]*>/);
    expect(html).toContain('<path d="M6 4l4 4-4 4"');
  });

  it("SectionNav 는 이름 있는 nav 안에 구역 링크를 두고 첫 구역을 지금 위치로, 문제 구역에 점과 읽을 글을 붙인다", () => {
    const html = renderToString(
      <SettingsLayout
        nav={
          <SectionNav
            label="목차"
            problemLabel="확인할 것이 있어요"
            items={[
              { id: "a", label: "가" },
              { id: "b", label: "나", problem: true },
            ]}
          />
        }
      >
        <SettingsSection id="a" title="가">
          본문
        </SettingsSection>
      </SettingsLayout>,
    );
    expect(html).toContain('<nav aria-label="목차"');
    expect(html).toMatch(/href="#a" aria-current="location"/);
    expect(html).not.toMatch(/href="#b" aria-current/);
    expect(html.match(/확인할 것이 있어요/g)).toHaveLength(1);
    expect(html).toContain('<section id="a" aria-labelledby="a-heading"');
    expect(html).toMatch(/<h2 id="a-heading" tabindex="-1" data-section-heading=""/);
  });

  it("SectionNav 는 구역을 스크롤 칸 안에서만 맨 위로 옮기고, 끝까지 못 가면 끝에서 멈춘다", () => {
    const base = { scrollerTop: 100, scrollTop: 200, marginTop: 32, maxScrollTop: 784 };
    expect(sectionScrollTop({ ...base, sectionTop: 400 })).toBe(468);
    expect(sectionScrollTop({ ...base, sectionTop: 2000 })).toBe(784);
    expect(sectionScrollTop({ ...base, sectionTop: -500 })).toBe(0);
    expect(sectionScrollTop({ ...base, sectionTop: 400, maxScrollTop: -10 })).toBe(0);
  });
});

describe("IssueList(티켓 0171)", () => {
  it("상태 아이콘은 모양을 분류로 고르고 이름을 접근 이름으로 둔다", () => {
    for (const kind of ISSUE_STATE_KINDS) {
      const html = renderToString(<IssueStateIcon kind={kind} label="In Review" />);
      expect(html).toContain(`data-issue-state="${kind}"`);
      expect(html).toContain('aria-label="In Review"');
    }
  });

  it("진행 고리는 0개 분모에도 그려지고 이름을 가진다", () => {
    const html = renderToString(<ProgressRing done={0} total={0} label="없음" />);
    expect(html).toContain('data-progress="0/0"');
    expect(html).toContain('aria-label="없음"');
  });

  it("보기 토글은 고른 단추만 눌림이다", () => {
    const html = renderToString(
      <IconToggleGroup
        label="보기"
        value="b"
        onValueChange={() => {}}
        items={[
          { value: "a", label: "가", icon: <GroupedViewIcon /> },
          { value: "b", label: "나", icon: <FlatViewIcon /> },
        ]}
      />,
    );
    expect(html).toMatch(/aria-label="가"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/aria-label="나"[^>]*aria-pressed="true"/);
  });

  it("행의 고르기·펼치기·할 일은 서로 안에 들어가지 않은 단추다", () => {
    const html = renderToString(
      <IssueListFrame>
        <IssueListHead keyLabel="키" titleLabel="제목" runLabel="런" indented />
        <IssueList label="목록" onMove={() => {}}>
          <IssueGroupLabel rowKey="head" name="상위 이슈 없음" count={1} />
          <IssueRow
            rowKey="a"
            label="A-1 제목"
            selected
            tabbable
            onSelect={() => {}}
            indent="top"
            toggle={{ expanded: true, label: "접기", onToggle: () => {} }}
            icon={<IssueStateIcon kind="todo" label="Todo" />}
            ticketKey="A-1"
            title="제목"
            run="Running"
            action={<button type="button">할당</button>}
          />
        </IssueList>
      </IssueListFrame>,
    );
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });
});
