import { ASK_QUERY_DEVTOOLS, DEV_CHANNEL } from "./values.ts";

const ACTIONS: ReadonlyArray<{ path: string; label: string; help: string }> = [
  {
    path: "label",
    label: "티켓에 라벨 붙이기",
    help: "Auto-assign Label 을 붙이고 webhook 이 온 것처럼 알려요. 곧 자동 할당으로 Queued 런이 생겨요.",
  },
  {
    path: "ticket",
    label: "새 티켓 만들기",
    help: "라벨 없는 티켓을 만들어요. Tickets 화면에서 직접 할당해 볼 수 있어요.",
  },
  {
    path: "question",
    label: "에이전트가 질문하기",
    help: "일하는 런 하나가 질문해요. Dashboard의 To do에 올라 답할 수 있어요.",
  },
  {
    path: "push-auth",
    label: "GitHub 인증 고치기·깨기",
    help: "runner-b 의 GitHub 인증을 바꿔요. Runners 화면과 할당 가능 여부가 따라 바뀌어요.",
  },
  {
    path: "gh",
    label: "서버 기계의 gh 상태 바꾸기",
    help: "가짜 gh 를 연결됨 → 로그인 안 됨 → 없음 차례로 바꿔요. Settings·온보딩의 GitHub 구역에서 다시 확인하면 보여요.",
  },
  {
    path: "remote-login",
    label: "이 맥의 원격 로그인 켜기·끄기",
    help: '가짜 "이 맥"의 원격 로그인을 바꿔요. 러너 단계의 "이 맥을 러너로"가 기다리다 다음 단계로 가요.',
  },
  {
    path: "enroll-mac",
    label: "다른 맥에서 등록 명령 실행하기",
    help: '러너 단계의 "다른 맥 · 터미널 명령으로"에서 받은 명령을 가짜 macbook-pro 가 실행한 것처럼 서버에 알려요.',
  },
  {
    path: "expire-enrollment",
    label: "등록 명령 만료시키기",
    help: "지금 화면에 보이는 등록 명령을 10분이 지난 것처럼 만료시켜요.",
  },
  {
    path: "life",
    label: "자동 진행 켜기·끄기",
    help: "가짜 에이전트가 시간에 따라 일하고 PR 을 여는 진행을 멈추거나 다시 켜요.",
  },
];

export function devPage(lifeEnabled: boolean): string {
  const buttons = ACTIONS.map(
    (action) => `
      <li>
        <button type="button" data-path="${action.path}">${action.label}</button>
        <p>${action.help}</p>
      </li>`,
  ).join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>개발 도구</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
  body { max-width: 560px; margin: 32px auto; padding: 0 16px; }
  ul { list-style: none; padding: 0; display: grid; gap: 12px; }
  button { font: inherit; padding: 6px 12px; cursor: pointer; }
  button[aria-pressed="true"] { background: Highlight; color: HighlightText; }
  p { margin: 4px 0 0; color: GrayText; }
  output { display: block; margin-top: 16px; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>개발 도구</h1>
<p>가짜 어댑터로 도는 개발 진입점이에요. 실제 트래커·러너·GitHub 에 닿지 않아요.
자동 진행: <strong id="life">${lifeEnabled ? "켜짐" : "꺼짐"}</strong> · <a href="/">Dashboard로</a></p>
<ul>${buttons}
  <li>
    <button type="button" id="query-devtools" aria-pressed="false">Query devtools 켜기·끄기</button>
    <p>열린 앱 탭 아래쪽에 TanStack Query devtools 를 열거나 닫아요. 앱 탭이 열려 있어야 해요.</p>
  </li>
</ul>
<output id="result"></output>
<script type="module">
  const result = document.getElementById("result");
  const channel = new BroadcastChannel(${JSON.stringify(DEV_CHANNEL)});
  const queryDevtools = document.getElementById("query-devtools");
  const pressed = () => queryDevtools.getAttribute("aria-pressed") === "true";
  channel.addEventListener("message", (event) => {
    if (event.data === ${JSON.stringify(ASK_QUERY_DEVTOOLS)}) {
      channel.postMessage({ setQueryDevtools: pressed() });
    } else if (typeof event.data?.setQueryDevtools === "boolean") {
      queryDevtools.setAttribute("aria-pressed", String(event.data.setQueryDevtools));
    }
  });
  queryDevtools.addEventListener("click", () => {
    const shown = !pressed();
    queryDevtools.setAttribute("aria-pressed", String(shown));
    channel.postMessage({ setQueryDevtools: shown });
  });
  channel.postMessage(${JSON.stringify(ASK_QUERY_DEVTOOLS)});
  for (const button of document.querySelectorAll("button[data-path]")) {
    button.addEventListener("click", async () => {
      const response = await fetch("/__dev/" + button.dataset.path, { method: "POST" });
      const body = await response.json().catch(() => null);
      result.textContent = response.ok ? JSON.stringify(body) : "실패했어요 (" + response.status + ")";
      if (body && "enabled" in body) {
        document.getElementById("life").textContent = body.enabled ? "켜짐" : "꺼짐";
      }
    });
  }
</script>
</body>
</html>`;
}
