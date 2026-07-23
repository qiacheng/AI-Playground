import type { AipgUiMessage } from '@/assets/js/store/openAiCompatibleChat'
import type { FileUIPart } from 'ai'

/** Conservative multiplier — char/heuristic estimates often undercount vs the backend tokenizer. */
export const TOKEN_ESTIMATE_SAFETY = 1.35

const CONTEXT_SLACK = 128
/** Fraction of context size left for new turns after a one-shot compact (history capped at the remainder). */
export const AVAILABLE_CONTEXT_SHARE = 0.7
/** Max share of context size used by message history after compacting (1 − available). */
export const TARGET_HISTORY_SHARE = 1 - AVAILABLE_CONTEXT_SHARE
/** Compact when estimated history exceeds this share; after compact, skip until crossed again. */
export const COMPACT_TRIGGER_SHARE = 0.5

const COMPACT_SUMMARY_MARKER = '[Earlier conversation — auto-compacted]'

/** Max share of the context window for the full prompt after a one-shot compact (system + history). */
export const POST_COMPACT_MAX_PROMPT_SHARE = TARGET_HISTORY_SHARE

export function postCompactPromptTokenBudget(contextSize: number): number {
  return Math.floor(contextSize * POST_COMPACT_MAX_PROMPT_SHARE)
}

/** Token budget for chat messages after compact (full prompt cap minus system). */
export function messageTokenBudgetAfterCompact(
  contextSize: number,
  systemPrompt: string,
): number {
  const total = postCompactPromptTokenBudget(contextSize)
  const system = Math.ceil(estimateTextTokens(systemPrompt) * TOKEN_ESTIMATE_SAFETY)
  return Math.max(total - system, 256)
}

export function targetHistoryTokenBudget(contextSize: number): number {
  return Math.floor(contextSize * TARGET_HISTORY_SHARE)
}

export const AUTO_COMPACT_SYSTEM_INSTRUCTION =
  '\n\nWhen a user message begins with "[Earlier conversation — auto-compacted]", it summarizes ' +
  'earlier turns in this same chat. Treat facts in that summary (including the user\'s name and ' +
  'preferences they shared) as established context. Answer from the summary directly; do not claim ' +
  'you lack access to earlier conversation when the summary covers it.\n'

export function appendAutoCompactSystemInstruction(
  systemPrompt: string,
  messages: AipgUiMessage[],
): string {
  if (!hasAutoCompactSummaryMessage(messages)) return systemPrompt
  if (systemPrompt.includes(COMPACT_SUMMARY_MARKER)) return systemPrompt
  return `${systemPrompt}${AUTO_COMPACT_SYSTEM_INSTRUCTION}`
}

export function estimatedHistoryTokens(messages: AipgUiMessage[], pendingTokens = 0): number {
  return Math.ceil(
    (estimateUiMessagesTokens(messages) + Math.max(pendingTokens, 0)) * TOKEN_ESTIMATE_SAFETY,
  )
}

export function historyExceedsTargetShare(
  messages: AipgUiMessage[],
  contextSize: number,
  pendingTokens = 0,
): boolean {
  return estimatedHistoryTokens(messages, pendingTokens) > targetHistoryTokenBudget(contextSize)
}

export function historyExceedsCompactTrigger(
  messages: AipgUiMessage[],
  contextSize: number,
  pendingTokens = 0,
): boolean {
  return (
    estimatedHistoryTokens(messages, pendingTokens) >
    Math.floor(contextSize * COMPACT_TRIGGER_SHARE)
  )
}

export function buildContextSummaryPrompt(transcript: string, concise = false): string {
  const intro = concise
    ? 'Compress this conversation summary further. Keep only essential facts, decisions, and open questions. Output only the shortened summary.\n\n'
    : 'Summarize the following conversation so the chat can continue without losing important ' +
      'context. Begin with a line "User-stated facts:" listing names, preferences, and constraints ' +
      'the user explicitly shared. Then cover decisions, tool outcomes, and open questions. ' +
      'Be concise but complete. Output only the summary.\n\n'
  return intro + transcript
}

const COMPACT_SUMMARY_PREFIX = `${COMPACT_SUMMARY_MARKER}\n\n`

/** Rough token estimate (~4 chars per token) for budgeting before the request. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function hasAutoCompactSummaryMessage(messages: AipgUiMessage[]): boolean {
  return messages.some((m) =>
    (m.parts ?? []).some(
      (p) =>
        p.type === 'text' &&
        typeof (p as { text?: string }).text === 'string' &&
        (p as { text: string }).text.includes(COMPACT_SUMMARY_MARKER),
    ),
  )
}

/** After a one-shot compact, do not summarize again until history grows past the re-trigger threshold. */
export function shouldSkipFurtherCompaction(
  messages: AipgUiMessage[],
  contextSize: number,
  pendingTokens: number,
  force: boolean,
): boolean {
  if (force) return false
  if (!hasAutoCompactSummaryMessage(messages)) return false
  return !historyExceedsCompactTrigger(messages, contextSize, pendingTokens)
}

export function clampSummaryToHistoryBudget(
  summary: string,
  contextSize: number,
  systemPrompt = '',
  suffix: AipgUiMessage[] = [],
): string {
  const messageBudget = messageTokenBudgetAfterCompact(contextSize, systemPrompt)
  const suffixTokens = suffix.length > 0 ? estimatedHistoryTokens(suffix, 0) : 0
  const maxSummaryTokens = Math.max(Math.floor((messageBudget - suffixTokens) * 0.85), 128)
  const maxChars = Math.max(Math.floor((maxSummaryTokens / TOKEN_ESTIMATE_SAFETY) * 4 * 0.9), 256)
  const trimmed = summary.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars).trimEnd()}…`
}


export function formatCompactSummaryMessage(summary: string): string {
  return `${COMPACT_SUMMARY_PREFIX}${summary.trim()}`
}

type UiPart = {
  type: string
  text?: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
}

/** Flatten UI messages into a transcript suitable for summarization. */
export function flattenUiMessagesForSummary(messages: AipgUiMessage[]): string {
  return messages
    .map((m) => {
      const role =
        m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role === 'tool' ? 'Tool' : m.role
      const parts = (m.parts ?? []) as UiPart[]
      const body = parts
        .map((p) => {
          if (p.type === 'text' && p.text?.trim()) return p.text.trim()
          if (p.type === 'reasoning' && p.text?.trim()) return `(reasoning) ${p.text.trim()}`
          if (p.type === 'tool-invocation') {
            const name = p.toolName ?? 'tool'
            return `(called ${name})`
          }
          if (p.type === 'file') return '(attachment)'
          return ''
        })
        .filter(Boolean)
        .join(' ')
      return body ? `${role}: ${body}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function estimatePartTokens(part: UiPart): number {
  if (part.type === 'text' || part.type === 'reasoning') {
    return estimateTextTokens(part.text ?? '')
  }
  if (part.type === 'file') {
    return 768
  }
  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool' || part.type === 'tool-invocation') {
    return estimateTextTokens(JSON.stringify(part))
  }
  return estimateTextTokens(JSON.stringify(part))
}

export function estimateUiMessagesTokens(messages: AipgUiMessage[]): number {
  let total = 0
  for (const m of messages) {
    for (const part of (m.parts ?? []) as UiPart[]) {
      total += estimatePartTokens(part)
    }
  }
  return total
}

export function estimatePendingUserTokens(question: string, files?: FileUIPart[]): number {
  let total = estimateTextTokens(question)
  for (const file of files ?? []) {
    if (file.mediaType?.startsWith('image/')) {
      total += 768
    } else {
      total += estimateTextTokens(typeof file.url === 'string' ? file.url : '')
    }
  }
  return total
}

export function maxPromptTokensForContext(contextSize: number, maxOutputTokens: number): number {
  return Math.max(contextSize - maxOutputTokens - CONTEXT_SLACK, 256)
}

export function projectedPromptTokens(
  messages: AipgUiMessage[],
  systemPrompt: string,
  pendingTokens = 0,
): number {
  const raw =
    estimateUiMessagesTokens(messages) + estimateTextTokens(systemPrompt) + Math.max(pendingTokens, 0)
  return Math.ceil(raw * TOKEN_ESTIMATE_SAFETY)
}

export function shouldCompactFromMeasuredUsage(
  measuredPromptTokens: number | undefined,
  contextSize: number,
): boolean {
  if (!measuredPromptTokens || measuredPromptTokens <= 0) return false
  return measuredPromptTokens >= contextSize - CONTEXT_SLACK
}

export function needsContextCompaction(
  messages: AipgUiMessage[],
  systemPrompt: string,
  contextSize: number,
  maxOutputTokens: number,
  pendingTokens = 0,
  measuredPromptTokens?: number,
  force = false,
): boolean {
  if (messages.length === 0 && pendingTokens <= 0) return false
  if (shouldSkipFurtherCompaction(messages, contextSize, pendingTokens, force)) return false
  if (force && messages.length > 0) return true
  if (historyExceedsCompactTrigger(messages, contextSize, pendingTokens)) return true
  if (shouldCompactFromMeasuredUsage(measuredPromptTokens, contextSize)) return true
  return projectedExceedsContext(
    messages,
    systemPrompt,
    contextSize,
    maxOutputTokens,
    pendingTokens,
  )
}

export function isContextOverflowErrorMessage(message: string): boolean {
  return /exceeds the available context size/i.test(message)
}

export function projectedExceedsContext(
  messages: AipgUiMessage[],
  systemPrompt: string,
  contextSize: number,
  maxOutputTokens: number,
  pendingTokens = 0,
): boolean {
  const projected = projectedPromptTokens(messages, systemPrompt, pendingTokens)
  const maxPrompt = maxPromptTokensForContext(contextSize, maxOutputTokens)
  if (projected >= contextSize - CONTEXT_SLACK) return true
  return projected >= maxPrompt
}

export type InputTokenBudget = {
  maxPromptTokens: number
  inputBudget: number
  compactThreshold: number
}

export function computeInputTokenBudget(
  contextSize: number,
  maxOutputTokens: number,
  systemPrompt: string,
): InputTokenBudget {
  const maxPromptTokens = maxPromptTokensForContext(contextSize, maxOutputTokens)
  const systemTokens = estimateTextTokens(systemPrompt)
  return {
    maxPromptTokens,
    inputBudget: Math.max(maxPromptTokens - systemTokens, 256),
    compactThreshold: targetHistoryTokenBudget(contextSize),
  }
}

export function shouldCompactContext(
  messages: AipgUiMessage[],
  systemPrompt: string,
  contextSize: number,
  maxOutputTokens: number,
  pendingTokens = 0,
): boolean {
  return needsContextCompaction(
    messages,
    systemPrompt,
    contextSize,
    maxOutputTokens,
    pendingTokens,
  )
}

export type CompactSplit = {
  prefix: AipgUiMessage[]
  suffix: AipgUiMessage[]
}

/** One-shot split: summarize prefix, keep a small recent tail within the post-compact message budget. */
export function splitForTargetHistoryShare(
  messages: AipgUiMessage[],
  contextSize: number,
  systemPrompt = '',
): CompactSplit | null {
  if (messages.length <= 1) return null

  const messageBudget = messageTokenBudgetAfterCompact(contextSize, systemPrompt)
  const maxTailTokens = Math.max(Math.floor(messageBudget * 0.22), 192)

  let tailCount = 1
  while (tailCount < messages.length) {
    const suffix = stripReasoningFromMessages(messages.slice(-tailCount))
    if (estimatedHistoryTokens(suffix) > maxTailTokens) break
    tailCount++
  }
  tailCount = Math.max(1, tailCount - 1)
  if (tailCount >= messages.length) tailCount = messages.length - 1

  const prefix = messages.slice(0, -tailCount)
  if (prefix.length === 0) return null

  return {
    prefix,
    suffix: stripReasoningFromMessages(messages.slice(-tailCount)),
  }
}

/** @deprecated Use splitForTargetHistoryShare — kept for tests. */
export function splitMessagesForCompaction(
  messages: AipgUiMessage[],
  budget: InputTokenBudget,
  minTailMessages = 4,
): CompactSplit | null {
  const effectiveMinTail = Math.min(Math.max(1, minTailMessages), messages.length - 1)
  if (effectiveMinTail < 1 || messages.length <= effectiveMinTail) return null

  let tailCount = effectiveMinTail
  while (tailCount < messages.length - 1) {
    const suffix = messages.slice(-tailCount)
    if (estimateUiMessagesTokens(suffix) >= budget.inputBudget * 0.45) break
    tailCount++
  }

  const prefix = messages.slice(0, -tailCount)
  if (prefix.length === 0) return null

  return { prefix, suffix: messages.slice(-tailCount) }
}

export function buildCompactedMessageList(
  summaryText: string,
  suffix: AipgUiMessage[],
  messageId: string,
): AipgUiMessage[] {
  const summaryMessage = {
    id: messageId,
    role: 'user',
    parts: [{ type: 'text', text: formatCompactSummaryMessage(summaryText) }],
  } as AipgUiMessage
  return [summaryMessage, ...suffix]
}

export function stripReasoningFromMessages(messages: AipgUiMessage[]): AipgUiMessage[] {
  return messages.map((m) => {
    const parts = (m.parts ?? []).filter((p) => p.type !== 'reasoning')
    if (parts.length === (m.parts ?? []).length) return m
    if (parts.length === 0) {
      return { ...m, parts: [{ type: 'text', text: '(reasoning omitted)' }] } as AipgUiMessage
    }
    return { ...m, parts }
  })
}

export function stripUsageFromMessages(messages: AipgUiMessage[]): AipgUiMessage[] {
  return messages.map((m) => {
    if (!m.metadata) return m
    const { usage: _u, timings: _t, ...rest } = m.metadata
    return { ...m, metadata: Object.keys(rest).length > 0 ? rest : undefined }
  })
}

export function postCompactPromptWithinBudget(
  messages: AipgUiMessage[],
  systemPrompt: string,
  contextSize: number,
  pendingTokens = 0,
): boolean {
  return (
    projectedPromptTokens(messages, systemPrompt, pendingTokens) <=
    postCompactPromptTokenBudget(contextSize)
  )
}

export function compactedHistoryFitsBudget(
  compacted: AipgUiMessage[],
  contextSize: number,
  systemPrompt = '',
  pendingTokens = 0,
): boolean {
  return postCompactPromptWithinBudget(compacted, systemPrompt, contextSize, pendingTokens)
}
