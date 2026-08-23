import { config as loadEnv } from "dotenv";
import path from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { Bot, InlineKeyboard } from "grammy";
import { formatTopicDates } from "./topic-date";
import { parsePublishNumbers } from "../lib/daily-pipeline";
import { createTelegramIpv4Agent } from "../lib/telegram";
import { buildArticleCardMessage } from "../lib/telegram-article-card";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv({ path: path.resolve(__dirname, ".env") });

setDefaultResultOrder("ipv4first");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USERS = (process.env.ALLOWED_USERS?.split(",") ?? [])
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
const LOCAL_API = process.env.LOCAL_API ?? "http://127.0.0.1:3001";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN 환경변수가 없습니다. Telegram bot token을 설정하세요.");
}

if (ALLOWED_USERS.length === 0) {
  throw new Error("ALLOWED_USERS 환경변수가 없습니다. 허용할 Telegram user id를 설정하세요.");
}

// WSL2 환경에서 api.telegram.org의 IPv6 주소로 SYN이 빠져나가지 못해 ETIMEDOUT으로
// 죽는 케이스가 있다. family: 4를 강제해 socket이 무조건 IPv4로만 열리게 한다.
const ipv4Agent = createTelegramIpv4Agent();

const bot = new Bot(BOT_TOKEN, {
  client: {
    baseFetchConfig: { agent: ipv4Agent, compress: true },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replyArticleCard(ctx: any, input: {
  title: unknown;
  content: unknown;
  displayOrder?: number | null;
  publishData: string;
  deleteData: string;
}) {
  const message = buildArticleCardMessage(input, input.publishData, input.deleteData);
  await ctx.reply(message.text, { reply_markup: message.replyMarkup });
}

async function readApiResponse<T extends Record<string, unknown>>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} 응답이 JSON이 아닙니다. (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || data.error) {
    throw new Error(`${label} 실패 (HTTP ${res.status}): ${data.error ?? text.slice(0, 300)}`);
  }
  return data as T;
}

async function getActiveDailyRun() {
  const res = await fetch(`${LOCAL_API}/api/daily-pipeline/active`);
  return readApiResponse<{
    run: { id: string; run_date: string } | null;
    items: Array<{
      display_order: number;
      article_id: string;
      article_title: string | null;
      articles: { title: string; content: string; published: boolean }
        | Array<{ title: string; content: string; published: boolean }> | null;
    }>;
  }>(res, "일일 실행 조회");
}

async function publishDailySelection(runId: string, numbers: string) {
  const res = await fetch(`${LOCAL_API}/api/articles/publish-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, numbers }),
  });
  return readApiResponse<{ published?: unknown[]; deployWarning?: string | null; deploy?: { status?: string } }>(res, "일괄 게시");
}

async function deleteDailyArticle(runId: string, displayOrder: string) {
  const res = await fetch(`${LOCAL_API}/api/daily-pipeline/${runId}/items/${displayOrder}`, {
    method: "DELETE",
  });
  return readApiResponse<{ deleted?: boolean; deploy?: { status?: string; error?: string } }>(res, "일일 초안 삭제");
}

async function retryDailyDeploy(runId: string) {
  const res = await fetch(`${LOCAL_API}/api/daily-pipeline/${runId}/deploy`, { method: "POST" });
  return readApiResponse<{ deploy?: { status?: string } }>(res, "일일 배포 재시도");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replyWithTopicCards(ctx: any, suggestions: any[]) {
  for (const s of suggestions) {
    const keywords = Array.isArray(s.keywords) ? s.keywords.join(", ") : s.keywords;
    const articleCount = s.articles?.length ?? s.articleIds?.length ?? s.article_ids?.length ?? 0;
    const dates = formatTopicDates(s);
    const text = `*${s.topic}*\n주요 날짜: ${dates.eventDates}\n원문 게시: ${dates.publishedDates}\n키워드: ${keywords}\n관련 기사: ${articleCount}개`;
    const keyboard = new InlineKeyboard()
      .text("기사 생성", `approve:${s.id}`)
      .text("거절", `reject:${s.id}`);
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

bot.catch((err) => {
  console.error("Telegram bot 처리 중 오류:", err.error);
});

// update 수신 여부 확인
bot.use(async (ctx, next) => {
  console.log("Telegram update 수신:", {
    updateId: ctx.update.update_id,
    message: ctx.message?.text,
    callbackQuery: ctx.callbackQuery?.data,
    from: ctx.from?.id,
  });
  await next();
});

// 허용된 사용자만 접근
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (!userId || !ALLOWED_USERS.includes(userId)) {
    console.log("ALLOWED_USERS 차단:", userId ?? "unknown", "allowed:", ALLOWED_USERS);
    await ctx.reply("접근 권한이 없습니다.");
    return;
  }
  await next();
});

// /start
bot.command("start", async (ctx) => {
  console.log("/start 진입:", ctx.from?.id);
  await ctx.reply(
    "FEEL THE DROP 봇입니다.\n\n" +
    "/collect - RSS 수집\n" +
    "/suggest - 토픽 제안\n" +
    "/suggest2 - 토픽 확장 제안\n" +
    "/topics - 제안된 토픽 목록\n" +
    "/clear_topics - pending 토픽 제안 전체 삭제\n" +
    "/articles - 기사 초안 목록\n" +
    "/daily - 최근 일일 실행 초안 목록\n" +
    "/daily_status - 최근 일일 실행 상태\n" +
    "/daily_deploy_retry RUN_ID - 실패한 최종 배포 재시도\n" +
    "/publish 1,3,5 - 최근 일일 실행 초안 게시\n" +
    "/deploy - 사이트 배포 트리거"
  );
});

// /clear_topics
bot.command("clear_topics", async (ctx) => {
  console.log("/clear_topics 진입:", ctx.from?.id);
  const msg = await ctx.reply("pending 토픽 제안 삭제 중...");
  try {
    const getRes = await fetch(`${LOCAL_API}/api/suggest-clusters?status=pending`);
    const getData = await readApiResponse<{ suggestions?: unknown[] }>(getRes, "pending 토픽 조회");
    const count = getData.suggestions?.length || 0;

    const res = await fetch(`${LOCAL_API}/api/suggest-clusters?status=pending`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(`삭제 실패 (status ${res.status}): ${data.error ?? res.statusText}`);
    }
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `pending 토픽 제안 ${count}개 삭제 완료`);
  } catch (e) {
    console.error("pending 토픽 제안 삭제 실패:", e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// /deploy
bot.command("deploy", async (ctx) => {
  console.log("/deploy 진입:", ctx.from?.id);
  const msg = await ctx.reply("배포 트리거 요청 중...");
  try {
    const res = await fetch(`${LOCAL_API}/api/deploy`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(`배포 트리거 실패 (status ${res.status}): ${data.error ?? res.statusText}`);
    }
    if (data.cooldown) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "쿨다운 중입니다. 잠시 후 다시 시도해주세요.");
    } else if (data.success) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "배포 트리거 완료");
    } else {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "배포 트리거에 실패했습니다.");
    }
  } catch (e) {
    console.error("배포 트리거 실패:", e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// /collect
bot.command("collect", async (ctx) => {
  console.log("/collect 진입:", ctx.from?.id);
  const msg = await ctx.reply("RSS 수집 중...");
  let res;
  
  try {
    res = await fetch(`${LOCAL_API}/api/collect`, { method: "POST" });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `Next API에 연결하지 못했습니다. 로컬 서버가 켜져 있는지 확인하세요.\n에러: ${errorMessage.split('\n')[0]}`
    );
    return;
  }

  try {
    const data = await res.json().catch(() => ({}));
    
    if (!res.ok || data.success === false) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `collect API가 실패했습니다. (HTTP ${res.status})\n에러: ${data.error || '알 수 없는 에러'}`
      );
      return;
    }

    type CollectFailure = { source: string; error: unknown };
    const { collected = 0, failures = [], diagnostics, viewsSynced = 0 } = data as {
      collected?: number;
      viewsSynced?: number;
      failures?: CollectFailure[];
      diagnostics?: {
        insertedCount: number;
        duplicateSkippedCount: number;
        processedFeedItems: number;
        totalFeedItems: number;
        parsedSourceCount: number;
        sourceCount: number;
        failedSourceCount: number;
      };
      success?: boolean;
      error?: string;
    };
    let resultText = "";

    if (diagnostics && typeof diagnostics.sourceCount === "number") {
      const {
        insertedCount,
        duplicateSkippedCount,
        processedFeedItems,
        totalFeedItems,
        parsedSourceCount,
        sourceCount,
        failedSourceCount,
      } = diagnostics;

      resultText += `RSS 수집 완료\n`;
      resultText += `- 신규 저장: ${insertedCount}개\n`;
      resultText += `- 중복 스킵: ${duplicateSkippedCount}개\n`;
      resultText += `- 처리 아이템: ${processedFeedItems}개 / 피드 전체 ${totalFeedItems}개\n`;
      resultText += `- 소스 성공: ${parsedSourceCount}/${sourceCount}개\n`;
      resultText += `- 실패 소스: ${failedSourceCount}개\n`;

      if (collected === 0 && duplicateSkippedCount > 0) {
        resultText += `\n새 기사는 없지만 RSS 확인은 정상 완료됐습니다.\n`;
      }
    } else {
      resultText += `수집 완료\n새 기사: ${collected}개\n`;
    }
    resultText += `- 조회수 동기화: ${viewsSynced}개\n`;

    if (failures.length > 0) {
      resultText += `\n실패 소스:\n`;
      failures.slice(0, 5).forEach((f) => {
        let errStr = String(f.error).split('\n')[0];
        if (errStr.length > 50) errStr = errStr.substring(0, 50) + "...";
        resultText += `- ${f.source}: ${errStr}\n`;
      });
      if (failures.length > 5) {
        resultText += `...외 ${failures.length - 5}개 실패\n`;
      }
    }

    if (resultText.length > 4000) {
      resultText = resultText.substring(0, 4000) + "... (메시지 길이 초과)";
    }

    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, resultText.trim());
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `응답 처리 중 오류 발생: ${errorMessage.split('\n')[0]}`
    );
  }
});

// /suggest
bot.command("suggest", async (ctx) => {
  const msg = await ctx.reply("토픽 제안 생성 중... (시간이 걸릴 수 있어요)");
  try {
    const res = await fetch(`${LOCAL_API}/api/suggest-clusters`, { method: "POST" });
    const data = await res.json();
    const suggestions = data.suggestions ?? [];

    if (suggestions.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "제안된 토픽이 없습니다.");
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `토픽 제안 ${suggestions.length}개 생성됨`
    );

    // 각 제안을 카드로 표시
    await replyWithTopicCards(ctx, suggestions);
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// /suggest2
bot.command("suggest2", async (ctx) => {
  console.log("/suggest2 진입:", ctx.from?.id);
  const msg = await ctx.reply("토픽 확장 제안 시작 중...");
  try {
    const res = await fetch(`${LOCAL_API}/api/suggest-clusters/extended`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 && data.code === "suggest2_rework") {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        "Suggest 2는 재설계 중이라 임시 비활성화되어 있습니다. Suggest 1을 이용해 주세요."
      );
      return;
    }
    if (!res.ok || data.error) {
      throw new Error(`토픽 확장 제안 실패 (status ${res.status}): ${data.error ?? res.statusText}`);
    }

    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      "토픽 확장 제안을 시작했습니다.\n완료 후 /topics로 제안 목록을 확인하세요."
    );
  } catch (e) {
    console.error("토픽 확장 제안 실패:", e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// /topics
bot.command("topics", async (ctx) => {
  console.log("/topics 진입:", ctx.from?.id);
  const msg = await ctx.reply("제안된 토픽 목록 불러오는 중...");
  try {
    const res = await fetch(`${LOCAL_API}/api/suggest-clusters?status=pending`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(`토픽 목록 조회 실패 (status ${res.status}): ${data.error ?? res.statusText}`);
    }

    const suggestions = data.suggestions ?? [];

    if (suggestions.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, "제안된 토픽이 없습니다.");
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `제안된 토픽 ${suggestions.length}개`
    );
    await replyWithTopicCards(ctx, suggestions);
  } catch (e) {
    console.error("토픽 목록 조회 실패:", e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// 기사 생성 버튼: 큐에 등록만 하고 즉시 응답.
bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
  const msg = await ctx.reply("기사 생성 큐에 등록 중...");

  try {
    const approveRes = await fetch(`${LOCAL_API}/api/suggest-clusters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    const approveData = await approveRes.json().catch(() => ({}));
    if (!approveRes.ok || approveData.error) {
      throw new Error(
        `제안 승인 실패 (status ${approveRes.status}): ${approveData.error ?? approveRes.statusText}`
      );
    }

    const jobRes = await fetch(`${LOCAL_API}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_type: "generate_from_suggestion",
        payload: { suggestionId: id },
      }),
    });
    const jobData = await jobRes.json().catch(() => ({}));
    if (!jobRes.ok || jobData.error) {
      throw new Error(
        `잡 등록 실패 (status ${jobRes.status}): ${jobData.error ?? jobRes.statusText}`
      );
    }

    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      "기사 생성 큐에 등록됐습니다 ⏳"
    );
  } catch (e) {
    console.error("기사 생성 큐 등록 실패:", e);
    await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `오류 발생: ${e}`);
  }
});

// 거절 버튼
bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  try {
    const res = await fetch(`${LOCAL_API}/api/suggest-clusters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
    await readApiResponse(res, "토픽 거절");
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply("거절됨");
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

// /articles
bot.command("articles", async (ctx) => {
  try {
    const res = await fetch(`${LOCAL_API}/api/articles?published=false`);
    const data = await readApiResponse<{ articles?: Array<Record<string, unknown>> }>(res, "초안 목록 조회");
    const articles = data.articles ?? [];

    if (articles.length === 0) {
      await ctx.reply("게시 대기 중인 기사가 없습니다.");
      return;
    }

    await ctx.reply(`기사 초안 ${articles.length}개`);

    for (const a of articles.slice(0, 10)) {
      await replyArticleCard(ctx, {
        title: a.title,
        content: a.content,
        publishData: `publish:${a.id}`,
        deleteData: `delete:${a.id}`,
      });
    }
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

// 게시 버튼
bot.callbackQuery(/^publish:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  try {
    const res = await fetch(`${LOCAL_API}/api/articles/${id}/publish`, { method: "PATCH" });
    await readApiResponse(res, "기사 게시");
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply("게시 완료");
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

bot.command("daily", async (ctx) => {
  try {
    const data = await getActiveDailyRun();
    if (!data.run || !Array.isArray(data.items) || data.items.length === 0) {
      await ctx.reply("게시 가능한 일일 실행 초안이 없습니다.");
      return;
    }
    await ctx.reply(
      `${data.run.run_date} 일일 초안 ${data.items.length}개\n게시: /publish 1,3,5`,
    );
    for (const item of data.items) {
      const article = Array.isArray(item.articles) ? item.articles[0] : item.articles;
      if (!article) throw new Error(`${item.display_order}번 기사 본문을 찾을 수 없습니다.`);
      await replyArticleCard(ctx, {
        displayOrder: item.display_order,
        title: article.title ?? item.article_title ?? item.article_id,
        content: article.content,
        publishData: `daily_publish:${data.run.id}:${item.display_order}`,
        deleteData: `daily_delete:${data.run.id}:${item.display_order}`,
      });
    }
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

bot.command("publish", async (ctx) => {
  const raw = typeof ctx.match === "string" ? ctx.match.trim() : "";
  const numbers = parsePublishNumbers(raw);
  if (!numbers) {
    await ctx.reply("형식이 올바르지 않습니다. 예: /publish 1,3,5");
    return;
  }
  try {
    const active = await getActiveDailyRun();
    if (!active.run) throw new Error("활성 일일 실행이 없습니다.");
    const result = await publishDailySelection(active.run.id, numbers.join(","));
    const warning = result.deployWarning ? `\n⚠️ ${result.deployWarning}` : "";
    await ctx.reply(`게시 완료: ${result.published?.length ?? 0}개${warning}`);
  } catch (e) {
    await ctx.reply(`아무 기사도 게시하지 않았습니다. 번호를 확인해 다시 입력하세요.\n${e}`);
  }
});

bot.callbackQuery(/^daily_publish:([0-9a-f-]+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const result = await publishDailySelection(ctx.match[1], ctx.match[2]);
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    const warning = result.deployWarning ? `\n⚠️ ${result.deployWarning}` : "";
    await ctx.reply(`${ctx.match[2]}번 기사 게시 완료${warning}`);
  } catch (e) {
    await ctx.reply(`게시하지 않았습니다.\n${e}`);
  }
});

bot.callbackQuery(/^daily_delete:([0-9a-f-]+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const result = await deleteDailyArticle(ctx.match[1], ctx.match[2]);
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    const warning = result.deploy?.status === "failed" ? "\n⚠️ 최종 Cloudflare 배포 실패. /daily_deploy_retry를 사용하세요." : "";
    await ctx.reply(`${ctx.match[2]}번 초안 삭제 완료${warning}`);
  } catch (e) {
    await ctx.reply(`삭제하지 않았습니다.\n${e}`);
  }
});

bot.command("daily_status", async (ctx) => {
  try {
    const res = await fetch(`${LOCAL_API}/api/daily-pipeline/status`);
    const data = await readApiResponse<{
      run: null | { id: string; run_date: string; status: string; selected_count: number; success_count: number; failure_count: number; deploy_status: string; deploy_attempt_count: number; deploy_error?: string | null };
      progress: Record<string, number>;
    }>(res, "일일 상태 조회");
    if (!data.run) return void await ctx.reply("일일 실행 기록이 없습니다.");
    const progress = Object.entries(data.progress).map(([status, count]) => `${status} ${count}`).join(", ") || "item 없음";
    await ctx.reply(
      `Daily ${data.run.run_date}\nrun: ${data.run.id}\n상태: ${data.run.status}\n진행: ${progress}\n` +
      `생성 성공/실패: ${data.run.success_count}/${data.run.failure_count}\n배포: ${data.run.deploy_status} (시도 ${data.run.deploy_attempt_count})` +
      (data.run.deploy_error ? `\n배포 오류: ${data.run.deploy_error}` : ""),
    );
  } catch (error) {
    await ctx.reply(`일일 상태 조회 실패: ${error}`);
  }
});

bot.command("daily_deploy_retry", async (ctx) => {
  const runId = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    await ctx.reply("형식: /daily_deploy_retry RUN_ID");
    return;
  }
  try {
    await retryDailyDeploy(runId);
    await ctx.reply(`Daily 최종 배포 재시도 성공\nrun: ${runId}`);
  } catch (error) {
    await ctx.reply(`Daily 최종 배포 재시도 실패\n${error}`);
  }
});

// 삭제 버튼
bot.callbackQuery(/^delete:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  try {
    const res = await fetch(`${LOCAL_API}/api/articles/${id}`, { method: "DELETE" });
    await readApiResponse(res, "기사 삭제");
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply("삭제 완료");
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

async function main() {
  try {
    const me = await bot.api.getMe();
    console.log(`Telegram bot token 확인됨: @${me.username}`);

    await bot.api.setMyCommands([
      { command: "collect", description: "RSS 수집" },
      { command: "suggest", description: "토픽 제안" },
      { command: "suggest2", description: "토픽 확장 제안" },
      { command: "topics", description: "제안된 토픽 목록" },
      { command: "clear_topics", description: "pending 토픽 제안 전체 삭제" },
      { command: "articles", description: "기사 초안 목록" },
      { command: "daily", description: "최근 일일 실행 초안 목록" },
      { command: "daily_status", description: "최근 일일 실행 상태" },
      { command: "daily_deploy_retry", description: "실패한 Daily 배포 재시도" },
      { command: "publish", description: "일일 실행 번호로 게시" },
      { command: "deploy", description: "사이트 배포 트리거" },
    ]);

    await bot.start({
      onStart: (botInfo) => {
        console.log(`FEEL THE DROP 봇 시작됨: @${botInfo.username}`);
      },
    });
  } catch (e) {
    console.error("Telegram bot 시작 실패:", e);
    process.exit(1);
  }
}

void main();
