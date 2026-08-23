import { Agent, request } from 'node:https'

const TELEGRAM_API_HOST = 'api.telegram.org'
const DEFAULT_TIMEOUT_MS = 15_000
const telegramIpv4Agent = new Agent({ family: 4, keepAlive: true })

export function createTelegramIpv4Agent(): Agent {
  return telegramIpv4Agent
}

export function validateTelegramResponse(status: number, body: string): void {
  let parsed: { ok?: unknown; description?: unknown }
  try {
    parsed = body ? JSON.parse(body) as { ok?: unknown; description?: unknown } : {}
  } catch {
    throw new Error(`Telegram 응답이 JSON이 아닙니다. (HTTP ${status})`)
  }
  if (status < 200 || status >= 300 || parsed.ok !== true) {
    const description = typeof parsed.description === 'string'
      ? parsed.description
      : '알 수 없는 Telegram API 오류'
    throw new Error(`Telegram sendMessage 실패 (HTTP ${status}): ${description}`)
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const payload = JSON.stringify({
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  })

  await new Promise<void>((resolve, reject) => {
    const req = request({
      protocol: 'https:',
      hostname: TELEGRAM_API_HOST,
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      agent: createTelegramIpv4Agent(),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
      })
      response.on('end', () => {
        const status = response.statusCode ?? 0
        try {
          validateTelegramResponse(status, body)
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      response.on('error', reject)
    })

    req.on('timeout', () => req.destroy(new Error(`Telegram sendMessage timeout (${timeoutMs}ms)`)))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

export async function notifyConfiguredTelegramUsers(text: string): Promise<void> {
  const botToken = process.env.BOT_TOKEN
  const chatIds = (process.env.ALLOWED_USERS ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  if (!botToken || chatIds.length === 0) throw new Error('BOT_TOKEN 및 ALLOWED_USERS가 필요합니다.')
  const results = await Promise.allSettled(chatIds.map((chatId) => sendTelegramMessage(botToken, chatId, text)))
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length > 0) throw new Error(`Telegram ${failures.length}/${chatIds.length}건 전송 실패`)
}
