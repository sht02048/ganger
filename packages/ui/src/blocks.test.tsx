import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AppFrame,
  BulletList,
  Button,
  CheckTick,
  RadioGroup,
  Chip,
  ExternalIconLink,
  PanelList,
  PanelListRow,
  PanelSection,
  StatusDot,
  CodeBlock,
  ScrollRegion,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableRowHeader,
  Input,
  OutcomeBar,
  RadioOption,
  RemovableChip,
  StepNav,
  StepNavItem,
  TEXT_TONES,
  Text,
  TextLink,
  Textarea,
  Tooltip,
  textStyles,
} from "./index";
import * as stylex from "@stylexjs/stylex";

const noop = () => {};

describe("Text tone·속성(티켓 0074)", () => {
  it("tone 마다 다른 색 클래스를 더하고, 역할 클래스는 그대로 둔다", () => {
    const base = stylex.props(textStyles("ui")).className ?? "";
    const toned = TEXT_TONES.map((tone) => stylex.props(textStyles("ui", tone)).className ?? "");
    expect(new Set(toned).size).toBe(TEXT_TONES.length);
    for (const classes of toned) expect(classes).not.toBe(base);
  });

  it("id·role·tabIndex 를 넘기고 결과 문장은 포커스를 받을 수 있다", () => {
    const html = renderToString(
      <Text variant="meta" as="p" id="r" role="status" tabIndex={-1}>
        보냈어요
      </Text>,
    );
    expect(html).toMatch(/^<p id="r" role="status" tabindex="-1" class="[^"]+">보냈어요<\/p>$/);
  });
});

describe("Button aria 속성(티켓 0067·0074)", () => {
  it("busy 는 두 라벨을 겹쳐 폭을 그대로 두고, 진행 중이면 aria-busy·aria-disabled 와 진행 라벨만 이름으로 남긴다(0122)", () => {
    const idle = renderToString(
      <Button busy={{ active: false, label: "다시 읽는 중…" }}>다시 읽기</Button>,
    );
    const busy = renderToString(
      <Button busy={{ active: true, label: "다시 읽는 중…" }}>다시 읽기</Button>,
    );
    expect(idle).toContain('aria-busy="false"');
    expect(idle).toMatch(
      /<span class="[^"]*">다시 읽기<\/span><span aria-hidden="true" class="[^"]*">다시 읽는 중…<\/span>/,
    );
    expect(busy).toMatch(
      /<span aria-hidden="true" class="[^"]*">다시 읽기<\/span><span class="[^"]*">다시 읽는 중…<\/span>/,
    );
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-disabled="true"');
    const hiddenClass = (html: string, label: string) =>
      new RegExp(`<span (?:aria-hidden="true" )?class="([^"]*)">${label}</span>`).exec(html)?.[1];
    expect(hiddenClass(idle, "다시 읽는 중…")).toBe(hiddenClass(busy, "다시 읽기"));
    expect(hiddenClass(idle, "다시 읽기")).toBe(hiddenClass(busy, "다시 읽는 중…"));

    const callerDisabled = renderToString(
      <Button aria-disabled busy={{ active: false, label: "다시 읽는 중…" }}>
        다시 읽기
      </Button>,
    );
    expect(callerDisabled).toContain('aria-disabled="true"');
  });

  it("aria-pressed·aria-describedby 를 넘긴다", () => {
    const html = renderToString(
      <Button aria-pressed aria-describedby="hint">
        보기
      </Button>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-describedby="hint"');
  });

  it("aria-disabled 는 못 쓰는 모양이지만 disabled 를 걸지 않아 포커스가 남는다", () => {
    const off = renderToString(
      <Button variant="ghost" aria-disabled>
        새로 고침
      </Button>,
    );
    const on = renderToString(<Button variant="ghost">새로 고침</Button>);
    expect(off).toContain('aria-disabled="true"');
    expect(off).not.toMatch(/\sdisabled=""/);
    expect(off.replace(/ aria-disabled="true"/, "")).not.toBe(on);
  });
});

describe("입력(티켓 0074)", () => {
  it("Input 은 aria-label 로 이름을 받는다", () => {
    expect(renderToString(<Input aria-label="찾기" />)).toContain('aria-label="찾기"');
  });

  it("Textarea 는 이름과 설명 연결을 넘기는 textarea 다", () => {
    const html = renderToString(
      <Textarea aria-label="직접 쓰기" aria-describedby="h" value="" onValueChange={noop} />,
    );
    expect(html).toMatch(/^<textarea aria-label="직접 쓰기" aria-describedby="h"/);
  });

  it("RadioOption 은 라벨 안에 radio 와 글을 둔다", () => {
    const html = renderToString(
      <RadioOption name="q" value="0" checked={false} onCheck={noop}>
        30초 고정
      </RadioOption>,
    );
    expect(html).toMatch(
      /^<label[^>]*><input type="radio"[^>]*name="q" value="0"[^>]*\/><span[^>]*>30초 고정<\/span><\/label>$/,
    );
  });
});

describe("칩·링크·코드(티켓 0074)", () => {
  it("RemovableChip 은 지우기 이름을 가진 보조 버튼이고 Chip 은 글 표시다", () => {
    const html = renderToString(
      <RemovableChip removeLabel="러너 조건 지우기" onRemove={noop}>
        러너: a
      </RemovableChip>,
    );
    expect(html).toMatch(/^<button[^>]*aria-label="러너 조건 지우기"[^>]*data-variant="secondary"/);
    expect(html).toContain(">러너: a<svg");
    expect(renderToString(<Chip strong>필수</Chip>)).toMatch(/^<span class="[^"]+">필수<\/span>$/);
  });

  it("Chip wrapText 는 긴 글의 줄바꿈 모양을 더한다(0164)", () => {
    const plain = /class="([^"]+)"/.exec(renderToString(<Chip>a</Chip>))?.[1];
    const wrapped = /class="([^"]+)"/.exec(renderToString(<Chip wrapText>a</Chip>))?.[1];
    expect(wrapped).not.toBe(plain);
  });

  it("StatusDot 은 이름을 주지 않으면 화면 읽기 글 없이 점만 그린다(0164)", () => {
    expect(renderToString(<StatusDot status="running" />)).not.toContain("Running");
    expect(renderToString(<StatusDot status="running">Running</StatusDot>)).toContain("Running");
  });

  it("PanelListRow 는 onClick 이 있으면 버튼, 없으면 글 행이고 끝난 제목은 모양이 다르다(0164)", () => {
    const clickable = renderToString(
      <PanelList>
        <PanelListRow ticketKey="ACME-1" title="제목" trailing="Done" onClick={noop} />
      </PanelList>,
    );
    expect(clickable).toMatch(/^<ul[^>]*><li[^>]*><button type="button"/);
    expect(clickable).toContain('title="제목"');
    const still = renderToString(<PanelListRow title="제목" />);
    expect(still).not.toContain("<button");
    const done = renderToString(<PanelListRow title="제목" done />);
    const titleClass = (html: string) => /title="제목" class="([^"]+)"/.exec(html)?.[1];
    expect(titleClass(done)).not.toBe(titleClass(still));
  });

  it("PanelSection 은 개수와 도움말을 제목 옆에 두고, 주지 않으면 제목만 그린다(0164)", () => {
    const html = renderToString(
      <PanelSection title="런" count={3} info={<i>도움말</i>} titleRole="subheading">
        본문
      </PanelSection>,
    );
    expect(html).toMatch(/런<\/h3><span[^>]*>3<\/span><i>도움말<\/i>/);
    expect(renderToString(<PanelSection title="런">본문</PanelSection>)).not.toContain("<i>");
  });

  it("ExternalIconLink 는 이름을 가진 새 탭 링크다(0164)", () => {
    const html = renderToString(<ExternalIconLink href="https://example.com/a" label="열기" />);
    expect(html).toMatch(/^<a /);
    expect(html).toContain('aria-label="열기"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("Button compact 는 기본 버튼과 다른 크기를 입는다(0164)", () => {
    const classOf = (html: string) => /class="([^"]+)"/.exec(html)?.[1];
    expect(classOf(renderToString(<Button compact>a</Button>))).not.toBe(
      classOf(renderToString(<Button>a</Button>)),
    );
  });

  it("RadioGroup 에 labelledBy 를 주면 그 제목을 이름으로 가진 radiogroup 이고, 주지 않으면 그대로다", () => {
    expect(renderToString(<RadioGroup labelledBy="q-title">a</RadioGroup>)).toMatch(
      /^<div role="radiogroup" aria-labelledby="q-title" class="[^"]+">a<\/div>$/,
    );
    expect(renderToString(<RadioGroup>a</RadioGroup>)).toMatch(/^<div class="[^"]+">a<\/div>$/);
  });

  it("Chip tone=accent 는 기본 칩과 다른 강조 면을 입고, 기본 칩은 그대로다", () => {
    const plain = renderToString(<Chip>선택</Chip>);
    const accent = renderToString(<Chip tone="accent">직접 해요</Chip>);
    const classOf = (html: string) => /class="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(classOf(accent)).not.toBe(classOf(plain));
    expect(classOf(accent).split(" ")).toEqual(
      expect.arrayContaining(classOf(plain).split(" ").slice(0, 2)),
    );
  });

  it("CheckTick running 은 이름을 가진 진행 표시이고 끝나면 체크로 바뀐다", () => {
    const running = renderToString(<CheckTick done={false} running label="진행 중" />);
    const waiting = renderToString(<CheckTick done={false} label="아직이에요" />);
    const done = renderToString(<CheckTick done running label="완료" />);
    expect(running).toMatch(/^<span role="img" aria-label="진행 중" class="[^"]+"><\/span>$/);
    expect(/class="([^"]+)"/.exec(running)?.[1]).not.toBe(/class="([^"]+)"/.exec(waiting)?.[1]);
    expect(done).toContain("<svg");
  });

  it("TextLink 는 바깥 링크면 새 탭으로 연다", () => {
    expect(
      renderToString(
        <TextLink href="https://example.com" external>
          PR
        </TextLink>,
      ),
    ).toContain('target="_blank" rel="noreferrer"');
  });

  it("CodeBlock scroll 은 이름 있는 영역이라 키보드로 스크롤할 수 있다", () => {
    const html = renderToString(
      <CodeBlock scroll label="로그">
        a
      </CodeBlock>,
    );
    expect(html).toMatch(/^<pre tabindex="0" role="region" aria-label="로그"/);
    expect(renderToString(<CodeBlock>a</CodeBlock>)).toMatch(/^<pre class="[^"]+">a<\/pre>$/);
  });
});

describe("ScrollRegion(티켓 0093)", () => {
  it("넘치는지 재기 전에는 영역도 Tab 정지점도 아니고 안쪽에 가장 좁은 폭을 둔다", () => {
    const html = renderToString(
      <ScrollRegion label="표" minWidth="360px">
        a
      </ScrollRegion>,
    );
    expect(html).not.toContain('role="region"');
    expect(html).not.toContain("tabindex");
    expect(html).toContain('<div style="min-width:360px">a</div>');
  });

  it("active 가 아니면 스크롤 상자를 만들지 않아 숨긴 내용이 포커스를 받지 않는다", () => {
    const on = renderToString(<ScrollRegion label="표">a</ScrollRegion>);
    const off = renderToString(
      <ScrollRegion label="표" active={false}>
        a
      </ScrollRegion>,
    );
    const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(classOf(on).split(" ").length).toBeGreaterThan(classOf(off).split(" ").length);
  });
});

describe("DataTable·차트·단계(티켓 0074)", () => {
  it("DataTable 은 열·행 머리를 scope 로 잇고 framed 이면 카드 상자에 담는다", () => {
    const html = renderToString(
      <DataTable label="매핑" framed>
        <DataTableHead>
          <DataTableHeader>이름</DataTableHeader>
        </DataTableHead>
        <DataTableBody>
          <DataTableRow>
            <DataTableRowHeader>Web</DataTableRowHeader>
            <DataTableCell>1</DataTableCell>
          </DataTableRow>
        </DataTableBody>
      </DataTable>,
    );
    expect(html).toMatch(/^<div[^>]*><table aria-label="매핑"/);
    expect(html).toMatch(/<th scope="col"[^>]*>이름<\/th>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Web<\/th>/);
  });

  it("OutcomeBar 는 이름 있는 그림이고 0 인 결과는 그리지 않는다", () => {
    const html = renderToString(
      <OutcomeBar
        label="Succeeded 2"
        segments={[
          { tone: "succeeded", value: 2 },
          { tone: "failed", value: 0 },
        ]}
      />,
    );
    expect(html).toMatch(/^<span role="img" aria-label="Succeeded 2"/);
    expect(html.match(/flex-grow/g)).toHaveLength(1);
  });

  it("StepNavItem 은 지금 단계를 aria-current 로, 끝난 단계는 화면 읽기 글로 알린다", () => {
    const html = renderToString(
      <StepNav label="단계" title="시작하기">
        <StepNavItem number={1} name="Tracker" state="done" doneLabel="완료" onSelect={noop} />
        <StepNavItem number={2} name="GitHub" state="current" doneLabel="완료" />
      </StepNav>,
    );
    expect(html).toMatch(/^<nav aria-label="단계"/);
    expect(html).toMatch(/<button type="button"[^>]*>.*Tracker.*완료.*<\/button>/);
    expect(html).toMatch(/aria-current="step"[^>]*>.*GitHub/);
  });

  it("AppFrame 은 레일과 본문을 나눈다", () => {
    const html = renderToString(<AppFrame rail="레일">본문</AppFrame>);
    expect(html).toMatch(/<aside[^>]*><div[^>]*>레일<\/div><\/aside><main[^>]*>본문<\/main>/);
  });

  it("AppFrame pending 은 진행 중일 때만 진행 줄·aria-busy·상태 문장을 두고, 상태 칸은 늘 그려 둔다(0122)", () => {
    const idle = renderToString(
      <AppFrame rail="레일" pending={{ active: false, label: "화면을 여는 중이에요" }}>
        본문
      </AppFrame>,
    );
    expect(idle).toMatch(/<span role="status"[^>]*><\/span>/);
    expect(idle).not.toContain("data-pending-bar");
    expect(idle).not.toContain("aria-busy");

    const busy = renderToString(
      <AppFrame rail="레일" pending={{ active: true, label: "화면을 여는 중이에요" }}>
        본문
      </AppFrame>,
    );
    expect(busy).toMatch(/<main aria-busy="true"/);
    expect(busy).toMatch(/<\/main><span role="status"/);
    expect(busy).toMatch(/role="status"[^>]*>화면을 여는 중이에요</);
    expect(busy).toContain("data-pending-bar");
  });
});

describe("Tooltip action 트리거(0062 후속)", () => {
  it("action 을 주면 트리거 자신이 버튼 모양이라 버튼 안에 버튼이 생기지 않는다", () => {
    const html = renderToString(
      <Tooltip
        content="다시 찾기"
        labelsTrigger
        action={{ variant: "ghost", busy: true, onClick: noop }}
      >
        <svg aria-hidden="true" />
      </Tooltip>,
    );
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('data-variant="ghost"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toMatch(/<button[^>]*aria-label(ledby)?="[^"]+"/);
  });
});

describe("BulletList", () => {
  it("순서 없는 목록으로 항목마다 li를 두고, 흐린 안내 모양을 고를 수 있다", () => {
    const html = renderToString(<BulletList items={["하나", "둘"]} />);
    expect(html.startsWith("<ul")).toBe(true);
    expect(html.match(/<li>/g)).toHaveLength(2);
    const tertiary = renderToString(<BulletList items={["하나"]} tone="tertiary" />);
    expect(tertiary.match(/class="([^"]+)"/)?.[1]).not.toBe(html.match(/class="([^"]+)"/)?.[1]);
  });
});
