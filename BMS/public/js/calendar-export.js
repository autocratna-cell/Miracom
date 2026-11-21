// 캘린더 연동: .ics 파일(휴대폰 기본 캘린더, 구글, 아웃룩 모두 지원)과 구글 캘린더 바로 추가 링크
const pad = (n) => String(n).padStart(2, "0");

// "2026-11-21T14:00" 같은 로컬 시간 → 20261121T140000
function localStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(
    date.getHours()
  )}${pad(date.getMinutes())}00`;
}
function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
const dayStamp = (ymd) => ymd.replace(/-/g, "");
function nextDay(ymd) {
  const d = new Date(`${ymd}T00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function esc(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// 75바이트 줄 접기(RFC 5545) - 한글이 길어도 캘린더 앱이 읽을 수 있게
function fold(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

function alarm(trigger, text) {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

export function meetingEvent(meeting, { description = "", remindMin = 10 } = {}) {
  const start = new Date(meeting.start);
  const end = new Date(start.getTime() + (meeting.durationMin || 60) * 60000);
  return [
    "BEGIN:VEVENT",
    `UID:${meeting.id}@bms`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${localStamp(start)}`,
    `DTEND:${localStamp(end)}`,
    `SUMMARY:${esc(meeting.title)}`,
    `DESCRIPTION:${esc(description)}`,
    ...alarm(`-PT${remindMin}M`, `${meeting.title} 시작 ${remindMin}분 전`),
    "END:VEVENT",
  ];
}

export function todoEvent(todo) {
  return [
    "BEGIN:VEVENT",
    `UID:${todo.id}@bms`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART;VALUE=DATE:${dayStamp(todo.dueDate)}`,
    `DTEND;VALUE=DATE:${nextDay(todo.dueDate)}`,
    `SUMMARY:${esc(`[할 일] ${todo.task}`)}`,
    `DESCRIPTION:${esc(`담당: ${todo.owner || "-"}\n출처 회의: ${todo.meetingTitle || ""}`)}`,
    ...alarm("PT9H", `오늘 마감: ${todo.task}`), // 마감일 오전 9시 알림
    "END:VEVENT",
  ];
}

export function buildIcs(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Miracom//BMS//KO",
    "CALSCALE:GREGORIAN",
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadIcs(filename, events) {
  const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// 구글 캘린더 "일정 추가" 화면을 바로 여는 링크
export function googleMeetingLink(meeting, description = "") {
  const start = new Date(meeting.start);
  const end = new Date(start.getTime() + (meeting.durationMin || 60) * 60000);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: meeting.title,
    dates: `${localStamp(start)}/${localStamp(end)}`,
    details: description,
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function googleTodoLink(todo) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `[할 일] ${todo.task}`,
    dates: `${dayStamp(todo.dueDate)}/${nextDay(todo.dueDate)}`,
    details: `담당: ${todo.owner || "-"}\n출처 회의: ${todo.meetingTitle || ""}`,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
