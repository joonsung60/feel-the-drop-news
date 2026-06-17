import { config as loadEnv } from "dotenv";
import path from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { Agent } from "node:https";
import { Bot, InlineKeyboard } from "grammy";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv({ path: path.resolve(__dirname, ".env") });

setDefaultResultOrder("ipv4first");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_USERS = (process.env.ALLOWED_USERS?.split(",") ?? [])
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
const LOCAL_API = process.env.LOCAL_API ?? "http://localhost:3000";
const ARTICLE_PREVIEW_LENGTH = 500;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN 환경변수가 없습니다. Telegram bot token을 설정하세요.");
}

if (ALLOWED_USERS.length === 0) {
  throw new Error("ALLOWED_USERS 환경변수가 없습니다. 허용할 Telegram user id를 설정하세요.");
}

// WSL2 환경에서 api.telegram.org의 IPv6 주소로 SYN이 빠져나가지 못해 ETIMEDOUT으로
// 죽는 케이스가 있다. family: 4를 강제해 socket이 무조건 IPv4로만 열리게 한다.
const ipv4Agent = new Agent({ family: 4, keepAlive: true });

const bot = new Bot(BOT_TOKEN, {
  client: {
    baseFetchConfig: { agent: ipv4Agent, compress: true },
  },
});

function formatArticlePreview(content: unknown): string {
  if (typeof content !== "string") {
    return "";
  }

  const trimmed = content.trim();
  if (trimmed.length <= ARTICLE_PREVIEW_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, ARTICLE_PREVIEW_LENGTH)}...`;
}

function formatArticleMessage(title: unknown, content: unknown): string {
  const safeTitle = typeof title === "string" && title.trim().length > 0 ? title.trim() : "제목 없음";
  const preview = formatArticlePreview(content);
  return preview ? `${safeTitle}\n\n${preview}` : safeTitle;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replyWithTopicCards(ctx: any, suggestions: any[]) {
  for (const s of suggestions) {
    const keywords = Array.isArray(s.keywords) ? s.keywords.join(", ") : s.keywords;
    const articleCount = s.articles?.length ?? s.articleIds?.length ?? s.article_ids?.length ?? 0;
    const text = `*${s.topic}*\n키워드: ${keywords}\n관련 기사: ${articleCount}개`;
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
    "EDM Star News 봇입니다.\n\n" +
    "/collect - RSS 수집\n" +
    "/suggest - 토픽 제안\n" +
    "/suggest2 - 토픽 확장 제안\n" +
    "/topics - 제안된 토픽 목록\n" +
    "/clear_topics - pending 토픽 제안 전체 삭제\n" +
    "/articles - 기사 초안 목록\n" +
    "/deploy - 사이트 배포 트리거"
  );
});

// /clear_topics
bot.command("clear_topics", async (ctx) => {
  console.log("/clear_topics 진입:", ctx.from?.id);
  const msg = await ctx.reply("pending 토픽 제안 삭제 중...");
  try {
    const getRes = await fetch(`${LOCAL_API}/api/suggest-clusters?status=pending`);
    const getData = await getRes.json().catch(() => ({}));
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

    const { collected = 0, failures = [], diagnostics } = data;
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

    if (failures.length > 0) {
      resultText += `\n실패 소스:\n`;
      failures.slice(0, 5).forEach((f: any) => {
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
  await fetch(`${LOCAL_API}/api/suggest-clusters/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "rejected" }),
  });
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
  await ctx.reply("거절됨");
});

// /articles
bot.command("articles", async (ctx) => {
  try {
    const res = await fetch(`${LOCAL_API}/api/articles?published=false`);
    const data = await res.json();
    const articles = data.articles ?? [];

    if (articles.length === 0) {
      await ctx.reply("게시 대기 중인 기사가 없습니다.");
      return;
    }

    await ctx.reply(`기사 초안 ${articles.length}개`);

    for (const a of articles.slice(0, 10)) {
      const keyboard = new InlineKeyboard()
        .text("게시", `publish:${a.id}`)
        .text("삭제", `delete:${a.id}`);
      await ctx.reply(formatArticleMessage(a.title, a.content), { reply_markup: keyboard });
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
    await fetch(`${LOCAL_API}/api/articles/${id}/publish`, { method: "PATCH" });
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply("게시 완료");
  } catch (e) {
    await ctx.reply(`오류 발생: ${e}`);
  }
});

// 삭제 버튼
bot.callbackQuery(/^delete:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  await ctx.answerCallbackQuery();
  try {
    await fetch(`${LOCAL_API}/api/articles/${id}`, { method: "DELETE" });
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
      { command: "deploy", description: "사이트 배포 트리거" },
    ]);

    await bot.start({
      onStart: (botInfo) => {
        console.log(`EDM Star News 봇 시작됨: @${botInfo.username}`);
      },
    });
  } catch (e) {
    console.error("Telegram bot 시작 실패:", e);
    process.exit(1);
  }
}

void main();
