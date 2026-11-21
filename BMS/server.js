// BMS (Business Meeting System) - 서버
// - public/ 폴더의 웹앱(PWA)을 제공합니다.
// - /api/summarize : 회의 텍스트를 Claude로 요약해 회의록과 할 일 목록을 만듭니다.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.BMS_MODEL || "claude-opus-5-5";

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(here, "public")));

// 회의록 형식 (Claude가 이 구조 그대로 답하도록 강제)
const MinutesSchema = z.object({
  summary: z.string().describe("회의 전체 요약 (3~5문장)"),
  keyPoints: z.array(z.string()).describe("주요 논의 내용"),
  decisions: z.array(z.string()).describe("결정된 사항"),
  actionItems: z
    .array(
      z.object({
        task: z.string().describe("해야 할 일"),
        owner: z.string().describe("담당자, 모르면 빈 문자열"),
        dueDate: z
          .string()
          .describe("마감일 YYYY-MM-DD, 언급이 없으면 빈 문자열"),
      })
    )
    .describe("해야 할 일 목록"),
  nextMeeting: z
    .string()
    .describe("다음 회의 일정/주제에 대한 언급, 없으면 빈 문자열"),
});

const SYSTEM_PROMPT = `당신은 회사 회의록을 작성하는 비서입니다.
회의 받아쓰기 텍스트를 읽고 한국어로 회의록을 작성하세요.
- 받아쓰기에는 음성 인식 오류가 있을 수 있으니 문맥에 맞게 해석하세요.
- 텍스트에 없는 내용은 지어내지 마세요.
- 해야 할 일은 실제로 누군가 하기로 한 일만 뽑고, 상대적인 날짜("다음 주 금요일")는 회의 날짜를 기준으로 YYYY-MM-DD로 바꾸세요.`;

let client = null;
function getClient() {
  if (!client) client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용
  return client;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.post("/api/summarize", async (req, res) => {
  const { title = "", date = "", attendees = "", agenda = "", transcript = "" } =
    req.body ?? {};
  if (!transcript.trim()) {
    return res.status(400).json({ error: "회의 내용(텍스트)이 비어 있습니다." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "서버에 ANTHROPIC_API_KEY가 설정되지 않아 AI 요약을 사용할 수 없습니다.",
    });
  }

  const userContent = `회의 제목: ${title}
회의 날짜: ${date}
참석자: ${attendees}
안건: ${agenda}

<받아쓰기>
${transcript}
</받아쓰기>`;

  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(MinutesSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "AI가 이 내용의 요약을 거절했습니다." });
    }
    if (!response.parsed_output) {
      return res.status(502).json({ error: "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요." });
    }
    res.json(response.parsed_output);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: "API 키가 올바르지 않습니다." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      return res.status(502).json({ error: `AI 요청 실패 (${err.status ?? "network"})` });
    }
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

app.listen(PORT, () => {
  console.log(`BMS 서버 실행 중: http://localhost:${PORT}`);
});
