// 요약/회의 텍스트에서 "해야 할 일" 후보를 찾는 규칙 기반 도우미 (인터넷·AI 없이 동작)
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TASK_WORDS =
  /(하기로|해야|할 것|할것|예정|까지|담당|요청|준비|제출|보내|발송|작성|검토|확인|공유|전달|정리|진행|챙기|조사|연락|회신|업데이트|마무리|완료|수정|결정 필요|TODO|To ?Do|액션)/i;
const TITLES = "님|과장|부장|대리|차장|팀장|사원|주임|이사|상무|전무|대표|매니저|책임|선임|수석|실장|본부장|위원";
const OWNER_RE = new RegExp(`([가-힣]{1,4})\\s?(${TITLES})`);
const DAY_IDX = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

// 회의 날짜(base)를 기준으로 문장 속 날짜 표현을 YYYY-MM-DD로 바꿈
export function parseDue(text, base) {
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const add = (n) => {
    const d = new Date(b);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };

  let m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || text.match(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/);
  if (m) {
    const d = new Date(b.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (d < b && b - d > 60 * 86400000) d.setFullYear(d.getFullYear() + 1);
    return ymd(d);
  }
  if (/모레/.test(text)) return add(2);
  if (/내일/.test(text)) return add(1);
  if (/오늘|금일|당일/.test(text)) return add(0);
  if ((m = text.match(/(\d{1,2})\s*일\s*(후|뒤|이내|내)/))) return add(Number(m[1]));
  if ((m = text.match(/(다다음\s*주|다음\s*주|차주|이번\s*주|금주)?\s*([월화수목금토일])요일/))) {
    const weeks = !m[1] ? 0 : /다다음/.test(m[1]) ? 2 : /다음|차주/.test(m[1]) ? 1 : 0;
    const monday = (b.getDay() + 6) % 7; // 회의일이 그 주 월요일에서 며칠째인지
    let diff = DAY_IDX[m[2]] - 1 - monday + weeks * 7;
    if (!m[1] && diff < 0) diff += 7; // "금요일까지" → 다가오는 금요일
    return add(diff);
  }
  if (/다음\s*주|차주/.test(text)) return add(7 - ((b.getDay() + 6) % 7) + 4); // 다음 주 (금요일)
  if (/이번\s*주|금주/.test(text)) return add(4 - ((b.getDay() + 6) % 7)); // 이번 주 (금요일)
  if (/월말|이번\s*달\s*(말|안)/.test(text)) return ymd(new Date(b.getFullYear(), b.getMonth() + 1, 0));
  if (/다음\s*달/.test(text)) return ymd(new Date(b.getFullYear(), b.getMonth() + 1, 15));
  return "";
}

export function findTasks(text, baseDate) {
  const lines = text
    .split(/\n|(?<=[.!?。])\s+|(?<=다\.)/)
    .map((l) =>
      l
        .replace(/^\s*(\[\d{1,2}:\d{2}(:\d{2})?\]|화자\s*\d+\s*\d{1,2}:\d{2}|[-•*·▪︎◦●○■□✓✔☐☑]|\d+[.)]|[가-하][.)])\s*/g, "")
        .trim()
    )
    .filter((l) => l.length >= 4 && l.length <= 160);

  const seen = new Set();
  const out = [];
  for (const line of lines) {
    if (!TASK_WORDS.test(line)) continue;
    const key = line.replace(/\s/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const ownerMatch = line.match(/담당\s*[:：]?\s*([가-힣A-Za-z]{2,10})/) || line.match(OWNER_RE);
    const owner = ownerMatch ? (ownerMatch[2] && ownerMatch[2] !== "님" ? ownerMatch[0].replace(/\s/g, "") : ownerMatch[1]) : "";
    out.push({ task: line.replace(/[.。]$/, ""), owner, dueDate: parseDue(line, baseDate) });
  }
  return out;
}
