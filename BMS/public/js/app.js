import { db, newId } from "./db.js";
import { MeetingRecorder, support, fmtClock } from "./recorder.js";
import {
  meetingEvent,
  todoEvent,
  downloadIcs,
  googleMeetingLink,
  googleTodoLink,
} from "./calendar-export.js";
import { findTasks } from "./tasks.js";

// ---------- 공통 ----------
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDue(due) {
  if (!due) return "마감일 없음";
  const d = new Date(`${due}T00:00`);
  const diff = Math.round((d - new Date(ymd(new Date()) + "T00:00")) / 86400000);
  const label = `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
  if (diff < 0) return `${label} · ${-diff}일 지남`;
  if (diff === 0) return `${label} · 오늘`;
  return `${label} · D-${diff}`;
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

const settings = {
  get remindMin() {
    return Number(safeStorage.get("bms.remindMin") || 10);
  },
  set remindMin(v) {
    safeStorage.set("bms.remindMin", String(v));
  },
};
const safeStorage = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 저장 불가 환경 */
    }
  },
};

// ---------- 데이터 ----------
const state = {
  meetings: [],
  todos: [],
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDay: ymd(new Date()),
  tab: "calendar",
  currentId: null,
};

async function load() {
  state.meetings = (await db.all("meetings")).sort((a, b) => a.start.localeCompare(b.start));
  state.todos = await db.all("todos");
}

const groupKey = (m) => (m.series || m.title || "").trim();
const meetingById = (id) => state.meetings.find((m) => m.id === id);

// 이 회의에 앞서 같은 그룹 회의에서 나온, 아직 안 끝난 할 일
function carriedTodos(meeting) {
  const key = groupKey(meeting);
  return state.todos.filter((t) => {
    if (t.done || t.meetingId === meeting.id) return false;
    const src = meetingById(t.meetingId);
    return src && groupKey(src) === key && src.start < meeting.start;
  });
}

function meetingDescription(meeting) {
  const parts = [];
  if (meeting.attendees) parts.push(`참석자: ${meeting.attendees}`);
  if (meeting.agenda) parts.push(`안건:\n${meeting.agenda}`);
  const carried = carriedTodos(meeting);
  if (carried.length) {
    parts.push(
      "지난 회의 할 일:\n" +
        carried.map((t) => `- ${t.task}${t.owner ? ` (${t.owner})` : ""}${t.dueDate ? ` ~${t.dueDate}` : ""}`).join("\n")
    );
  }
  return parts.join("\n\n");
}

// ---------- 화면 전환 ----------
function show(view) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== `view-${view}`;
  const titles = { calendar: "회의 일정", todos: "해야 할 일", settings: "설정", meeting: "회의" };
  $("#page-title").textContent = titles[view];
  $("#back-btn").hidden = view !== "meeting";
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("active", b.dataset.tab === view);
  window.scrollTo(0, 0);
}

function render() {
  if (state.tab === "calendar") renderCalendar();
  if (state.tab === "todos") renderTodos();
  if (state.tab === "meeting") renderMeeting();
  $("#series-options").innerHTML = [...new Set(state.meetings.map(groupKey).filter(Boolean))]
    .map((s) => `<option value="${escapeHtml(s)}"></option>`)
    .join("");
}

async function goTab(tab) {
  if (recorder?.active) {
    toast("녹음 중에는 화면을 옮길 수 없습니다. 먼저 녹음을 멈춰 주세요.");
    return;
  }
  state.tab = tab;
  show(tab);
  render();
}

// ---------- 캘린더 ----------
function renderCalendar() {
  const { month } = state;
  $("#month-label").textContent = `${month.getFullYear()}년 ${month.getMonth() + 1}월`;
  const first = new Date(month);
  first.setDate(1 - first.getDay());
  const today = ymd(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const key = ymd(d);
    const hasMeeting = state.meetings.some((m) => m.start.startsWith(key));
    const hasTodo = state.todos.some((t) => !t.done && t.dueDate === key);
    cells.push(`<button class="day ${d.getMonth() !== month.getMonth() ? "other" : ""} ${key === today ? "today" : ""} ${
      key === state.selectedDay ? "selected" : ""
    }" data-day="${key}"><span>${d.getDate()}</span><i>${hasMeeting ? '<b class="dot meeting"></b>' : ""}${
      hasTodo ? '<b class="dot todo"></b>' : ""
    }</i></button>`);
  }
  $("#month-grid").innerHTML = cells.join("");

  const sel = new Date(`${state.selectedDay}T00:00`);
  $("#day-label").textContent = `${sel.getMonth() + 1}월 ${sel.getDate()}일 (${WEEK[sel.getDay()]})`;
  const dayMeetings = state.meetings.filter((m) => m.start.startsWith(state.selectedDay));
  const dayTodos = state.todos.filter((t) => !t.done && t.dueDate === state.selectedDay);
  $("#day-list").innerHTML =
    dayMeetings.map(meetingItem).join("") + dayTodos.map(todoItem).join("") ||
    `<p class="muted">일정이 없습니다. <button class="link" data-new-on="${state.selectedDay}">이 날 회의 잡기</button></p>`;

  const upcoming = state.meetings.filter((m) => m.start >= toLocalInput(new Date())).slice(0, 5);
  $("#upcoming-list").innerHTML = upcoming.map(meetingItem).join("") || `<p class="muted">예정된 회의가 없습니다.</p>`;
}

function meetingItem(m) {
  const open = carriedTodos(m).length;
  return `<button class="item" data-open="${m.id}">
    <span class="badge meeting">회의</span>
    <span class="grow"><strong>${escapeHtml(m.title)}</strong><small>${fmtDateTime(m.start)}${
      m.series ? ` · ${escapeHtml(m.series)}` : ""
    }${m.minutes ? " · 회의록 ✓" : ""}</small></span>
    ${open ? `<span class="pill">할 일 ${open}</span>` : ""}
  </button>`;
}

function todoItem(t) {
  const src = meetingById(t.meetingId);
  const overdue = t.dueDate && !t.done && t.dueDate < ymd(new Date());
  return `<div class="item todo-item ${t.done ? "done" : ""}">
    <input type="checkbox" data-toggle="${t.id}" ${t.done ? "checked" : ""} aria-label="완료" />
    <span class="grow" data-edit-todo="${t.id}"><strong>${escapeHtml(t.task)}</strong><small class="${overdue ? "warn" : ""}">${
      t.owner ? `${escapeHtml(t.owner)} · ` : ""
    }${fmtDue(t.dueDate)}${src ? ` · ${escapeHtml(src.title)}` : ""}</small></span>
    ${t.dueDate ? `<a class="mini" href="${googleTodoLink({ ...t, meetingTitle: src?.title })}" target="_blank" rel="noopener" title="구글 캘린더에 등록">📅</a>` : ""}
  </div>`;
}

const toLocalInput = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------- 할 일 목록 ----------
function renderTodos() {
  const showDone = $("#show-done").checked;
  const list = state.todos
    .filter((t) => showDone || !t.done)
    .sort((a, b) => (a.done - b.done) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  $("#todo-list").innerHTML = list.map(todoItem).join("") || `<p class="muted">할 일이 없습니다.</p>`;
}

// ---------- 회의 상세 ----------
let recorder = null;

async function openMeeting(id) {
  if (recorder?.active) return toast("녹음 중입니다. 먼저 녹음을 멈춰 주세요.");
  state.currentId = id;
  state.tab = "meeting";
  show("meeting");
  renderMeeting();
  $("#transcript").value = meetingById(id)?.transcript || "";
  $("#summary-text").value = meetingById(id)?.minutes?.summaryText || "";
  $("#save-state").textContent = "";
  renderAudios();
}

function renderMeeting() {
  const m = meetingById(state.currentId);
  if (!m) return goTab("calendar");
  $("#m-title").textContent = m.title;
  $("#m-meta").textContent = [fmtDateTime(m.start), `${m.durationMin}분`, m.series, m.attendees].filter(Boolean).join(" · ");
  $("#m-agenda").textContent = m.agenda || "";
  $("#gcal-link").href = googleMeetingLink(m, meetingDescription(m));

  const carried = carriedTodos(m);
  $("#carried-card").hidden = !carried.length;
  $("#carried-list").innerHTML = carried
    .map(
      (t) => `<li><label class="check"><input type="checkbox" data-toggle="${t.id}" /> ${escapeHtml(t.task)}
      <small class="muted">${t.owner ? escapeHtml(t.owner) + " · " : ""}${fmtDue(t.dueDate)}</small></label></li>`
    )
    .join("");

  renderMinutes(m);
  const todos = state.todos.filter((t) => t.meetingId === m.id);
  $("#m-todos").innerHTML = todos.map(todoItem).join("") || `<p class="muted">아직 할 일이 없습니다.</p>`;

  const notes = [];
  if (!support.record) notes.push("이 브라우저는 녹음을 지원하지 않습니다.");
  if (!support.speech) notes.push("이 브라우저는 실시간 받아쓰기를 지원하지 않습니다(크롬 권장). 텍스트를 직접 입력해 주세요.");
  $("#support-note").textContent = notes.join(" ");
}

function renderMinutes(m) {
  const mm = m.minutes;
  $("#minutes-actions").hidden = !(mm?.summary || mm?.summaryText);
  if (!mm?.summary) {
    $("#minutes").innerHTML = "";
    return;
  }
  const list = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : `<p class="muted">없음</p>`);
  $("#minutes").innerHTML = `
    <h4>AI 요약</h4><p>${escapeHtml(mm.summary)}</p>
    <h4>주요 논의 내용</h4>${list(mm.keyPoints)}
    <h4>결정 사항</h4>${list(mm.decisions)}
    ${mm.nextMeeting ? `<h4>다음 회의</h4><p>${escapeHtml(mm.nextMeeting)}</p>` : ""}
    <p class="muted small">작성: ${fmtDateTime(mm.createdAt)}</p>`;
}

function minutesMarkdown(m) {
  const mm = m.minutes || {};
  const todos = state.todos.filter((t) => t.meetingId === m.id);
  const bullets = (a) => (a?.length ? a.map((i) => `- ${i}`).join("\n") : "- 없음");
  return `# 회의록: ${m.title}

- 일시: ${fmtDateTime(m.start)} (${m.durationMin}분)
- 참석자: ${m.attendees || "-"}
${m.agenda ? `- 안건: ${m.agenda.replace(/\n/g, " / ")}\n` : ""}
${mm.summaryText ? `## 회의 요약\n${mm.summaryText.trim()}\n` : ""}${
    mm.summary ? `\n## AI 요약\n${mm.summary}\n\n## 주요 논의 내용\n${bullets(mm.keyPoints)}\n\n## 결정 사항\n${bullets(mm.decisions)}\n` : ""
  }
## 해야 할 일
${todos.length ? todos.map((t) => `- [${t.done ? "x" : " "}] ${t.task} (담당: ${t.owner || "-"}, 마감: ${t.dueDate || "-"})`).join("\n") : "- 없음"}
${mm.nextMeeting ? `\n## 다음 회의\n${mm.nextMeeting}\n` : ""}`;
}

async function saveTranscript(quiet = false) {
  const m = meetingById(state.currentId);
  if (!m) return;
  m.transcript = $("#transcript").value;
  await db.put("meetings", m);
  $("#save-state").textContent = `저장됨 ${new Date().toLocaleTimeString("ko-KR")}`;
  if (!quiet) toast("회의 내용을 저장했습니다.");
}

async function renderAudios() {
  const audios = await db.byMeeting("audios", state.currentId);
  $("#audio-list").innerHTML = "";
  audios
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((a, i) => {
      const url = URL.createObjectURL(a.blob);
      const ext = a.mime.includes("mp4") ? "m4a" : "webm";
      const div = document.createElement("div");
      div.className = "audio-row";
      div.innerHTML = `<span class="small">녹음 ${i + 1} · ${fmtClock(a.durationSec)}</span>
        <audio controls src="${url}"></audio>
        <div class="row"><a class="mini" href="${url}" download="회의녹음-${i + 1}.${ext}">받기</a>
        <button class="mini" data-del-audio="${a.id}">삭제</button></div>`;
      $("#audio-list").append(div);
    });
}

async function toggleRecording() {
  const btn = $("#rec-btn");
  if (recorder?.active) {
    btn.disabled = true;
    const { blob, mime, durationSec } = await recorder.stop();
    if (blob?.size) {
      await db.put("audios", { id: newId(), meetingId: state.currentId, blob, mime, durationSec, createdAt: new Date().toISOString() });
    }
    await saveTranscript(true);
    btn.textContent = "● 녹음 시작";
    btn.classList.remove("on");
    btn.disabled = false;
    renderAudios();
    toast("녹음을 마쳤습니다.");
    return;
  }
  const record = $("#opt-record").checked;
  const transcribe = $("#opt-transcribe").checked;
  if (!record && !transcribe) return toast("녹음 또는 받아쓰기 중 하나는 켜 주세요.");
  const ta = $("#transcript");
  recorder = new MeetingRecorder({
    onText(text, sec) {
      if (!text) return;
      ta.value += `${ta.value && !ta.value.endsWith("\n") ? "\n" : ""}[${fmtClock(sec)}] ${text}\n`;
      ta.scrollTop = ta.scrollHeight;
    },
    onInterim: (t) => ($("#interim").textContent = t),
    onTick: (sec) => {
      $("#rec-time").textContent = fmtClock(sec);
      if (sec % 30 === 0) saveTranscript(true); // 30초마다 자동 저장
    },
    onError: toast,
  });
  try {
    await recorder.start({ record, transcribe });
    btn.textContent = "■ 녹음 멈추기";
    btn.classList.add("on");
  } catch (err) {
    recorder.active = false;
    toast("마이크를 사용할 수 없습니다. 브라우저의 마이크 권한을 허용해 주세요.");
    console.error(err);
  }
}

async function summarize() {
  const m = meetingById(state.currentId);
  await saveTranscript(true);
  if (!m.transcript?.trim()) return toast("먼저 회의 내용을 녹음하거나 입력해 주세요.");
  const btn = $("#summarize-btn");
  btn.disabled = true;
  btn.textContent = "요약하는 중… (최대 1분)";
  try {
    const res = await fetch("api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: m.title,
        date: m.start.slice(0, 10),
        attendees: m.attendees,
        agenda: m.agenda,
        transcript: m.transcript,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);

    m.minutes = { ...(m.minutes || {}), ...data, createdAt: new Date().toISOString() };
    await db.put("meetings", m);

    // AI가 뽑은 할 일을 등록 (같은 내용이 이미 있으면 건너뜀)
    const existing = new Set(state.todos.filter((t) => t.meetingId === m.id).map((t) => t.task));
    let added = 0;
    for (const a of data.actionItems || []) {
      if (!a.task || existing.has(a.task)) continue;
      const todo = { id: newId(), meetingId: m.id, task: a.task, owner: a.owner || "", dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate) ? a.dueDate : "", done: false, createdAt: new Date().toISOString() };
      await db.put("todos", todo);
      state.todos.push(todo);
      added++;
    }
    renderMeeting();
    toast(`회의록 작성 완료 · 할 일 ${added}개 등록`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "AI 요약으로 회의록 작성";
  }
}

// ---------- Galaxy AI 요약 붙여넣기 / 할 일 찾기 ----------
async function saveSummary(quiet = false) {
  const m = meetingById(state.currentId);
  if (!m) return;
  const text = $("#summary-text").value.trim();
  m.minutes = { ...(m.minutes || {}), summaryText: text, createdAt: new Date().toISOString() };
  if (!text && !m.minutes.summary) m.minutes = null;
  await db.put("meetings", m);
  renderMeeting();
  if (!quiet) toast(text ? "회의록을 저장했습니다. '할 일 자동 찾기'로 할 일을 등록해 보세요." : "회의록을 비웠습니다.");
}

async function pasteInto(sel) {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return toast("복사된 내용이 없습니다.");
    const el = $(sel);
    el.value = el.value.trim() ? `${el.value.trimEnd()}\n${text}` : text;
    el.dispatchEvent(new Event("input"));
  } catch {
    toast("붙여넣기 권한이 없습니다. 칸을 길게 눌러 '붙여넣기'를 해 주세요.");
  }
}

let candidates = [];
function openTaskFinder() {
  const m = meetingById(state.currentId);
  const source = [$("#summary-text").value, m.minutes?.summary].filter(Boolean).join("\n") || $("#transcript").value;
  if (!source.trim()) return toast("먼저 회의록(요약)이나 회의 내용을 넣어 주세요.");
  const existing = new Set(state.todos.filter((t) => t.meetingId === m.id).map((t) => t.task));
  candidates = findTasks(source, new Date(m.start)).filter((c) => !existing.has(c.task));
  if (!candidates.length) return toast("할 일로 보이는 문장을 찾지 못했습니다. '+ 추가'로 직접 넣어 주세요.");
  $("#task-candidates").innerHTML = candidates
    .map(
      (c, i) => `<label class="item check-item"><input type="checkbox" data-cand="${i}" checked />
      <span class="grow"><strong>${escapeHtml(c.task)}</strong><small>${c.owner ? escapeHtml(c.owner) + " · " : ""}${fmtDue(c.dueDate)}</small></span></label>`
    )
    .join("");
  $("#tasks-dialog").showModal();
}

$("#tasks-dialog").addEventListener("close", async () => {
  if ($("#tasks-dialog").returnValue !== "save") return;
  const picked = [...document.querySelectorAll("[data-cand]")].filter((c) => c.checked).map((c) => candidates[c.dataset.cand]);
  for (const c of picked) {
    const todo = { id: newId(), meetingId: state.currentId, ...c, done: false, createdAt: new Date().toISOString() };
    await db.put("todos", todo);
    state.todos.push(todo);
  }
  renderMeeting();
  toast(`할 일 ${picked.length}개를 등록했습니다.`);
});

async function addAudioFile(file) {
  const durationSec = await new Promise((resolve) => {
    const a = new Audio();
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? Math.round(a.duration) : 0);
    a.onerror = () => resolve(0);
    a.src = URL.createObjectURL(file);
  });
  await db.put("audios", { id: newId(), meetingId: state.currentId, blob: file, mime: file.type || "audio/mp4", durationSec, createdAt: new Date().toISOString() });
  renderAudios();
  toast("녹음 파일을 이 회의에 저장했습니다.");
}

// 다른 앱(음성 녹음 등)에서 '공유 → BMS'로 받은 텍스트
let sharedText = "";
function handleShare() {
  const params = new URLSearchParams(location.search);
  sharedText = [params.get("share_title"), params.get("share_text"), params.get("share_url")].filter(Boolean).join("\n").trim();
  if (!sharedText) return;
  history.replaceState(null, "", location.pathname);
  $("#share-preview").textContent = sharedText.length > 300 ? sharedText.slice(0, 300) + "…" : sharedText;
  const nowIso = toLocalInput(new Date());
  // 오늘 회의 → 최근 지난 회의 → 다가오는 회의 순으로 보여줌
  const sorted = [...state.meetings].sort((a, b) => Math.abs(new Date(a.start) - Date.now()) - Math.abs(new Date(b.start) - Date.now()));
  $("#share-meeting").innerHTML =
    sorted.map((m) => `<option value="${m.id}">${escapeHtml(m.title)} · ${fmtDateTime(m.start)}</option>`).join("") +
    `<option value="__new">+ 새 회의로 만들기 (${fmtDateTime(nowIso)})</option>`;
  $("#share-dialog").showModal();
}

$("#share-dialog").addEventListener("close", async () => {
  if ($("#share-dialog").returnValue !== "save" || !sharedText) return;
  const f = $("#share-form");
  let m;
  if (f.meeting.value === "__new") {
    const now = new Date();
    m = { id: newId(), title: `회의 ${now.getMonth() + 1}/${now.getDate()}`, series: "", start: toLocalInput(now), durationMin: 60, attendees: "", agenda: "", transcript: "", minutes: null, createdAt: now.toISOString() };
    state.meetings.push(m);
  } else m = meetingById(f.meeting.value);
  if (f.target.value === "summary") {
    const prev = m.minutes?.summaryText?.trim();
    m.minutes = { ...(m.minutes || {}), summaryText: prev ? `${prev}\n\n${sharedText}` : sharedText, createdAt: new Date().toISOString() };
  } else {
    m.transcript = m.transcript?.trim() ? `${m.transcript.trimEnd()}\n${sharedText}` : sharedText;
  }
  await db.put("meetings", m);
  sharedText = "";
  await openMeeting(m.id);
  toast("공유 받은 내용을 저장했습니다.");
});

// ---------- 회의 등록/수정 ----------
let editingMeetingId = null;
function openMeetingForm(meeting = null, preset = {}) {
  editingMeetingId = meeting?.id ?? null;
  const f = $("#meeting-form");
  f.reset();
  $("#meeting-form-title").textContent = meeting ? "회의 수정" : "새 회의";
  const base = meeting ?? preset;
  const start = base.start ? new Date(base.start) : null;
  f.title.value = base.title ?? "";
  f.series.value = base.series ?? "";
  f.date.value = start ? ymd(start) : preset.date ?? state.selectedDay;
  f.time.value = start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : "10:00";
  f.durationMin.value = String(base.durationMin ?? 60);
  f.attendees.value = base.attendees ?? "";
  f.agenda.value = base.agenda ?? "";
  $("#meeting-dialog").showModal();
}

$("#meeting-dialog").addEventListener("close", async () => {
  if ($("#meeting-dialog").returnValue !== "save") return;
  const f = $("#meeting-form");
  const data = {
    title: f.title.value.trim(),
    series: f.series.value.trim(),
    start: `${f.date.value}T${f.time.value}`,
    durationMin: Number(f.durationMin.value),
    attendees: f.attendees.value.trim(),
    agenda: f.agenda.value.trim(),
  };
  let m;
  if (editingMeetingId) {
    m = Object.assign(meetingById(editingMeetingId), data);
  } else {
    m = { id: newId(), ...data, transcript: "", minutes: null, createdAt: new Date().toISOString() };
    state.meetings.push(m);
  }
  await db.put("meetings", m);
  state.meetings.sort((a, b) => a.start.localeCompare(b.start));
  state.selectedDay = f.date.value;
  toast(editingMeetingId ? "회의를 수정했습니다." : "회의를 등록했습니다.");
  openMeeting(m.id);
});

// ---------- 할 일 추가/수정 ----------
let editingTodo = null;
function openTodoForm(todo) {
  editingTodo = todo;
  const f = $("#todo-form");
  f.task.value = todo.task || "";
  f.owner.value = todo.owner || "";
  f.dueDate.value = todo.dueDate || "";
  $("#todo-dialog").showModal();
}
$("#todo-dialog").addEventListener("close", async () => {
  if ($("#todo-dialog").returnValue !== "save" || !editingTodo) return;
  const f = $("#todo-form");
  Object.assign(editingTodo, { task: f.task.value.trim(), owner: f.owner.value.trim(), dueDate: f.dueDate.value });
  await db.put("todos", editingTodo);
  if (!state.todos.includes(editingTodo)) state.todos.push(editingTodo);
  render();
});

async function toggleTodo(id, done) {
  const t = state.todos.find((x) => x.id === id);
  if (!t) return;
  t.done = done;
  await db.put("todos", t);
  render();
}

// ---------- 알림 ----------
function notifState() {
  if (!("Notification" in window)) return "이 브라우저는 알림을 지원하지 않습니다.";
  return { granted: "알림 허용됨 ✓", denied: "알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.", default: "알림 권한이 아직 없습니다." }[
    Notification.permission
  ];
}

async function notify(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    toast(`${title} - ${body.split("\n")[0]}`);
    return;
  }
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification(title, { body, tag, icon: "icon.svg", data: { url: location.href } });
  else new Notification(title, { body, tag });
}

// 30초마다: 곧 시작할 회의가 있으면 지난 할 일과 함께 알림
function checkReminders() {
  const now = Date.now();
  const lead = settings.remindMin * 60000;
  let sent = {};
  try {
    sent = JSON.parse(safeStorage.get("bms.notified") || "{}");
  } catch {
    /* ignore */
  }
  for (const m of state.meetings) {
    const start = new Date(m.start).getTime();
    if (start - now > lead || start < now - 60000 || sent[m.id] === m.start) continue;
    const todos = carriedTodos(m);
    const body = todos.length
      ? `확인할 할 일 ${todos.length}개:\n` + todos.map((t) => `• ${t.task}${t.owner ? ` (${t.owner})` : ""}`).join("\n")
      : `${fmtDateTime(m.start)} 시작`;
    notify(`곧 회의: ${m.title}`, body, `meeting-${m.id}`);
    sent[m.id] = m.start;
  }
  safeStorage.set("bms.notified", JSON.stringify(sent));
}

// ---------- 백업 ----------
async function exportData() {
  const data = { app: "BMS", version: 1, exportedAt: new Date().toISOString(), meetings: state.meetings, todos: state.todos };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `BMS-backup-${ymd(new Date())}.json`;
  a.click();
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "BMS") throw new Error();
    for (const m of data.meetings || []) await db.put("meetings", m);
    for (const t of data.todos || []) await db.put("todos", t);
    await load();
    render();
    toast(`불러오기 완료: 회의 ${data.meetings?.length || 0}개, 할 일 ${data.todos?.length || 0}개`);
  } catch {
    toast("올바른 BMS 백업 파일이 아닙니다.");
  }
}

// ---------- 이벤트 연결 ----------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-open],[data-day],[data-edit-todo],[data-new-on],[data-del-audio],[data-tab]");
  if (!t) return;
  if (t.dataset.open) openMeeting(t.dataset.open);
  else if (t.dataset.day) {
    state.selectedDay = t.dataset.day;
    renderCalendar();
  } else if (t.dataset.editTodo) openTodoForm(state.todos.find((x) => x.id === t.dataset.editTodo));
  else if (t.dataset.newOn) openMeetingForm(null, { date: t.dataset.newOn });
  else if (t.dataset.delAudio) {
    if (!confirm("이 녹음을 삭제할까요?")) return;
    await db.delete("audios", t.dataset.delAudio);
    renderAudios();
  } else if (t.dataset.tab) goTab(t.dataset.tab);
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.toggle) toggleTodo(e.target.dataset.toggle, e.target.checked);
});

$("#back-btn").onclick = () => goTab("calendar");
$("#new-meeting-btn").onclick = () => openMeetingForm();
$("#prev-month").onclick = () => {
  state.month.setMonth(state.month.getMonth() - 1);
  renderCalendar();
};
$("#next-month").onclick = () => {
  state.month.setMonth(state.month.getMonth() + 1);
  renderCalendar();
};
$("#today-btn").onclick = () => {
  const now = new Date();
  state.month = new Date(now.getFullYear(), now.getMonth(), 1);
  state.selectedDay = ymd(now);
  renderCalendar();
};
$("#show-done").onchange = renderTodos;
$("#edit-meeting-btn").onclick = () => openMeetingForm(meetingById(state.currentId));
$("#rec-btn").onclick = toggleRecording;
$("#save-transcript-btn").onclick = () => saveTranscript();
$("#transcript").addEventListener("input", () => ($("#save-state").textContent = "저장 안 됨"));
$("#summarize-btn").onclick = summarize;
$("#save-summary-btn").onclick = () => saveSummary();
$("#paste-summary-btn").onclick = () => pasteInto("#summary-text");
$("#paste-transcript-btn").onclick = () => pasteInto("#transcript");
$("#find-tasks-btn").onclick = async () => {
  await saveSummary(true);
  openTaskFinder();
};
$("#transcript-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const ta = $("#transcript");
  ta.value = ta.value.trim() ? `${ta.value.trimEnd()}\n${await file.text()}` : await file.text();
  e.target.value = "";
  await saveTranscript();
};
$("#audio-file").onchange = (e) => {
  if (e.target.files[0]) addAudioFile(e.target.files[0]);
  e.target.value = "";
};
$("#add-todo-btn").onclick = () =>
  openTodoForm({ id: newId(), meetingId: state.currentId, task: "", owner: "", dueDate: "", done: false, createdAt: new Date().toISOString() });
$("#ics-btn").onclick = () => {
  const m = meetingById(state.currentId);
  downloadIcs(`${m.title}.ics`, [meetingEvent(m, { description: meetingDescription(m), remindMin: settings.remindMin })]);
};
$("#todos-ics-btn").onclick = () => {
  const m = meetingById(state.currentId);
  const todos = state.todos.filter((t) => t.meetingId === m.id && !t.done && t.dueDate);
  if (!todos.length) return toast("마감일이 있는 할 일이 없습니다. 할 일을 눌러 마감일을 정해 주세요.");
  downloadIcs(`${m.title}-할일.ics`, todos.map((t) => todoEvent({ ...t, meetingTitle: m.title })));
};
$("#next-meeting-btn").onclick = () => {
  const m = meetingById(state.currentId);
  const next = new Date(m.start);
  next.setDate(next.getDate() + 7);
  openMeetingForm(null, { title: m.title, series: groupKey(m), start: toLocalInput(next), durationMin: m.durationMin, attendees: m.attendees });
};
$("#delete-meeting-btn").onclick = async () => {
  const m = meetingById(state.currentId);
  if (!confirm(`'${m.title}' 회의와 녹음·할 일을 모두 삭제할까요?`)) return;
  for (const a of await db.byMeeting("audios", m.id)) await db.delete("audios", a.id);
  for (const t of state.todos.filter((x) => x.meetingId === m.id)) await db.delete("todos", t.id);
  await db.delete("meetings", m.id);
  await load();
  goTab("calendar");
};
$("#copy-minutes-btn").onclick = async () => {
  try {
    await navigator.clipboard.writeText(minutesMarkdown(meetingById(state.currentId)));
    toast("회의록을 복사했습니다.");
  } catch {
    toast("복사하지 못했습니다.");
  }
};
$("#download-minutes-btn").onclick = () => {
  const m = meetingById(state.currentId);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([minutesMarkdown(m)], { type: "text/markdown;charset=utf-8" }));
  a.download = `회의록-${m.start.slice(0, 10)}-${m.title}.md`;
  a.click();
};

$("#remind-min").value = String(settings.remindMin);
$("#remind-min").onchange = (e) => (settings.remindMin = Number(e.target.value));
$("#notif-state").textContent = notifState();
$("#notif-btn").onclick = async () => {
  if ("Notification" in window) await Notification.requestPermission();
  $("#notif-state").textContent = notifState();
};
$("#notif-test-btn").onclick = () => notify("BMS 알림 테스트", "회의 알림이 이렇게 표시됩니다.", "test");
$("#export-btn").onclick = exportData;
$("#import-file").onchange = (e) => e.target.files[0] && importData(e.target.files[0]);

window.addEventListener("beforeunload", (e) => {
  if (recorder?.active) e.preventDefault();
});

// ---------- 앱 설치 ----------
let installPrompt = null;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function updateInstallUi() {
  const canPrompt = Boolean(installPrompt) && !isStandalone();
  $("#install-btn").hidden = !canPrompt;
  $("#install-banner").hidden = !canPrompt;
  let msg;
  if (isStandalone()) msg = "설치된 앱으로 실행 중입니다 ✓";
  else if (canPrompt) msg = "위 버튼을 누르면 홈 화면에 BMS 앱이 설치됩니다.";
  else if (/SamsungBrowser/.test(navigator.userAgent))
    msg = "삼성 인터넷에서는 주소창의 ⬇(설치) 아이콘, 또는 메뉴(≡) → '현재 페이지 추가' → '홈 화면'으로 설치하세요. 음성 녹음 앱의 '공유 → BMS'까지 쓰려면 크롬에서 설치하는 것을 권장합니다.";
  else msg = "크롬 메뉴(⋮) → '홈 화면에 추가' → '설치'를 누르세요. (설치 버튼이 바로 안 보이면 페이지를 한 번 새로고침해 주세요.)";
  $("#install-state").textContent = msg;
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  updateInstallUi();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  updateInstallUi();
  toast("BMS 앱이 설치되었습니다. 홈 화면에서 실행하세요.");
});
async function promptInstall() {
  if (!installPrompt) return goTab("settings");
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  updateInstallUi();
}
$("#install-btn").onclick = promptInstall;
$("#install-banner-btn").onclick = promptInstall;

// ---------- 시작 ----------
(async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  await load();
  updateInstallUi();
  show("calendar");
  render();
  checkReminders();
  setInterval(checkReminders, 30000);
  fetch("api/health")
    .then((r) => r.json())
    .then((h) => {
      $("#summarize-btn").hidden = !h.aiConfigured;
      $("#ai-state").textContent = h.aiConfigured
        ? "Galaxy AI 요약 붙여넣기 + 서버 AI 요약 모두 사용 가능 ✓"
        : "Galaxy AI 요약 붙여넣기 방식을 사용합니다. (API 키 필요 없음)";
    })
    .catch(() => ($("#ai-state").textContent = "Galaxy AI 요약 붙여넣기 방식을 사용합니다. (API 키 필요 없음)"));
  handleShare();
})();
