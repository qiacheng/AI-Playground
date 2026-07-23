import type { AipgUiMessage } from '@/assets/js/store/openAiCompatibleChat'
import type { FileUIPart } from 'ai'

/** Conservative multiplier — char/heuristic estimates often undercount vs the backend tokenizer. */
export const TOKEN_ESTIMATE_SAFETY = 1.35

const CONTEXT_SLACK = 128
/** Safety margin — backend token counts often exceed our heuristics. */
const CONTEXT_SEND_MARGIN = 0.82
/** Fraction of context size left for new turns after a one-shot compact (history capped at the remainder). */
export const AVAILABLE_CONTEXT_SHARE = 0.7
/** Max share of context size used by message history after compacting (1 − available). */
export const TARGET_HISTORY_SHARE = 1 - AVAILABLE_CONTEXT_SHARE
/** Compact when estimated send payload exceeds this share of the prompt budget (not raw context size). */
export const COMPACT_TRIGGER_SHARE = 0.85

const COMPACT_SUMMARY_MARKER = '[Earlier conversation — auto-compacted]'

/** Extra prompt budget reserved before send when tool calling may add several steps. */
export const TOOL_TURN_CONTEXT_RESERVE_TOKENS = 2048

/** Default max model↔tool round-trips per chat send (AI SDK `stopWhen: stepCountIs(...)`). */
export const DEFAULT_TOOL_LOOP_MAX_STEPS = 20
export const MIN_TOOL_LOOP_MAX_STEPS = 5
export const MAX_TOOL_LOOP_MAX_STEPS = 64

export function clampToolLoopMaxSteps(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TOOL_LOOP_MAX_STEPS
  return Math.min(MAX_TOOL_LOOP_MAX_STEPS, Math.max(MIN_TOOL_LOOP_MAX_STEPS, Math.round(value)))
}

/** Cap persisted tool output size so compaction and retries can recover from large results. */
export const MAX_PERSISTED_TOOL_OUTPUT_CHARS = 1500

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
  'earlier turns in this same chat. Treat facts in that summary as established context. Answer from ' +
  'the summary directly.\n'

/** Appended to the system prompt when an inference-only summary is active. */
export function formatInferenceContextSummaryBlock(summary: string): string {
  return `\n\nEarlier conversation summary (for continuity; the chat UI may show more history than this):\n${summary.trim()}\n`
}

export const INFERENCE_LATEST_TURN_PRIORITY =
  '\n\nTreat the user\'s most recent message as their current intent. Short replies such as thanks, ' +
  '"nice job", or ok are about the immediately preceding assistant reply—respond to that tone. Do not ' +
  'resume earlier research tasks or call tools unless the latest message clearly requests it.\n'

export function appendAutoCompactSystemInstruction(
  systemPrompt: string,
  messages: AipgUiMessage[],
): string {
  if (!hasAutoCompactSummaryMessage(messages)) return systemPrompt
  if (systemPrompt.includes(COMPACT_SUMMARY_MARKER)) return systemPrompt
  return `${systemPrompt}${AUTO_COMPACT_SYSTEM_INSTRUCTION}`
}

export type InferenceContextMeta = {
  inferenceContextSummary?: string
  inferenceContextTailFromMessageId?: string
}

/** Message list sent to the model (UI history unchanged). */
export function resolveUiMessagesForInference(
  messages: AipgUiMessage[],
  meta: InferenceContextMeta | undefined,
): AipgUiMessage[] {
  if (!meta?.inferenceContextSummary || !meta.inferenceContextTailFromMessageId) {
    return messages
  }
  const idx = messages.findIndex((m) => m.id === meta.inferenceContextTailFromMessageId)
  if (idx < 0) return messages
  return messages.slice(idx)
}

/** Messages + system text used for compact/skip checks (matches inference, not full UI scrollback). */
export function inferenceContextCheckInputs(
  messages: AipgUiMessage[],
  baseSystemPrompt: string,
  meta?: InferenceContextMeta,
): { uiMessages: AipgUiMessage[]; systemPrompt: string } {
  let systemPrompt = baseSystemPrompt
  if (meta?.inferenceContextSummary) {
    systemPrompt += formatInferenceContextSummaryBlock(meta.inferenceContextSummary)
  }
  systemPrompt += INFERENCE_LATEST_TURN_PRIORITY
  return {
    uiMessages: resolveUiMessagesForInference(messages, meta),
    systemPrompt,
  }
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
  maxOutputTokens = 1024,
): boolean {
  const maxPrompt = maxPromptTokensForContext(contextSize, maxOutputTokens)
  const threshold = Math.floor(maxPrompt * COMPACT_TRIGGER_SHARE)
  return estimatedHistoryTokens(messages, pendingTokens) > threshold
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

/** Keep summary `generateText` prompts inside the loaded context window (llama n_ctx). */
export function clampTranscriptForSummaryGeneration(
  transcript: string,
  contextSize: number,
  summaryMaxOutputTokens = 512,
): string {
  const maxPrompt = maxPromptTokensForContext(contextSize, summaryMaxOutputTokens)
  const templateTokens = estimateTextTokens(buildContextSummaryPrompt('', false)) + 64
  const transcriptTokenBudget = Math.max(maxPrompt - templateTokens, 256)
  const maxChars = Math.max(
    Math.floor((transcriptTokenBudget / TOKEN_ESTIMATE_SAFETY) * 4),
    512,
  )
  return clipTextForContext(transcript, maxChars)
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
  hasStoredInferenceSummary = false,
  maxOutputTokens = 1024,
): boolean {
  if (force) return false
  const hasLegacyCompactMarker = hasAutoCompactSummaryMessage(messages)
  if (!hasStoredInferenceSummary && !hasLegacyCompactMarker) return false
  return !historyExceedsCompactTrigger(
    messages,
    contextSize,
    pendingTokens,
    maxOutputTokens,
  )
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
  errorText?: string
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
          if (p.type.startsWith('tool-') || p.type === 'dynamic-tool') {
            return formatToolPartForSummary(p)
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

function clipTextForContext(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  // Ellipsis only — a verbose marker in tool results gets echoed in thinking models.
  return `${trimmed.slice(0, maxChars).trimEnd()}…`
}

function stripReasoningFromLooseModelMessages(messages: LooseModelMessage[]): LooseModelMessage[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg
    const content = msg.content.filter((part) => {
      if (!part || typeof part !== 'object') return true
      return (part as Record<string, unknown>).type !== 'reasoning'
    })
    if (content.length === msg.content.length) return msg
    return { ...msg, content }
  })
}

function toolPartOutputAsText(part: UiPart): string {
  const raw = part.errorText ?? part.output
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

function formatToolPartForSummary(part: UiPart): string {
  const name = part.toolName ?? (part.type.replace(/^tool-/, '') || 'tool')
  const outText = toolPartOutputAsText(part)
  if (outText) {
    return `(tool ${name}: ${clipTextForContext(outText, 400)})`
  }
  return `(called ${name})`
}

function truncateToolPart(part: UiPart, maxChars: number): UiPart {
  if (!part.type.startsWith('tool-') && part.type !== 'dynamic-tool') return part
  const outText = toolPartOutputAsText(part)
  if (!outText || outText.length <= maxChars) return part
  const clipped = clipTextForContext(outText, maxChars)
  const output = part.output
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const structured = output as Record<string, unknown>
    if (structured.type === 'text' && typeof structured.value === 'string') {
      return { ...part, output: { ...structured, value: clipped } }
    }
    if (structured.type === 'json') {
      return {
        ...part,
        output: { type: 'text', value: clipped },
      }
    }
    return { ...part, output: { type: 'text', value: clipped } }
  }
  if (typeof output === 'string') {
    return { ...part, output: clipped }
  }
  return { ...part, output: { type: 'text', value: clipped } }
}

/** Shrink large tool results in persisted history (does not drop call/result pairs). */
export function truncateToolOutputsInMessages(
  messages: AipgUiMessage[],
  maxOutputChars = MAX_PERSISTED_TOOL_OUTPUT_CHARS,
): AipgUiMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (!message.parts?.length) return message
    let messageChanged = false
    const parts = (message.parts as UiPart[]).map((part) => {
      const truncated = truncateToolPart(part, maxOutputChars)
      if (truncated !== part) messageChanged = true
      return truncated
    })
    if (!messageChanged) return message
    changed = true
    return { ...message, parts }
  })
  return changed ? next : messages
}

/**
 * Progressive forgetting so the current user turn can run under the context limit.
 * Older detail may be dropped; failing the request is worse UX than losing memory.
 */
export type ContextShrinkOutcome = {
  messages: AipgUiMessage[]
  /** History beyond light tool truncation was dropped to fit the current turn. */
  aggressiveForget: boolean
  changed: boolean
}

function uiMessagesStructurallyChanged(
  before: AipgUiMessage[],
  after: AipgUiMessage[],
): boolean {
  if (before.length !== after.length) return true
  return before.some((m, i) => m.id !== after[i]?.id)
}

export function shrinkUiMessagesForSuccessfulTurn(
  messages: AipgUiMessage[],
  systemPrompt: string,
  contextSize: number,
  maxOutputTokens: number,
  pendingTokens = 0,
): ContextShrinkOutcome {
  const fits = (candidate: AipgUiMessage[]) =>
    messagesFitHardContextLimit(
      candidate,
      systemPrompt,
      contextSize,
      maxOutputTokens,
      pendingTokens,
    )

  const forgetLevels: Array<(m: AipgUiMessage[]) => AipgUiMessage[]> = [
    (m) => truncateToolOutputsInMessages(stripReasoningFromMessages(m), MAX_PERSISTED_TOOL_OUTPUT_CHARS),
    (m) => truncateToolOutputsInMessages(stripReasoningFromMessages(m), 400),
    (m) => keepCompactSummaryAndFromLastUser(m),
    (m) => keepCompactSummaryAndLastUserOnly(m),
    (m) => keepLastUserMessageOnly(m),
  ]

  for (let level = 0; level < forgetLevels.length; level++) {
    const candidate = forgetLevels[level](messages)
    if (fits(candidate)) {
      return {
        messages: candidate,
        aggressiveForget: level >= 2,
        changed: uiMessagesStructurallyChanged(messages, candidate),
      }
    }
  }

  const fallback = keepLastUserMessageOnly(messages)
  return {
    messages: fallback,
    aggressiveForget: true,
    changed: uiMessagesStructurallyChanged(messages, fallback),
  }
}

export function emergencyShrinkUiMessagesForContext(
  messages: AipgUiMessage[],
  systemPrompt: string,
  contextSize: number,
  maxOutputTokens: number,
  pendingTokens = 0,
): AipgUiMessage[] {
  return shrinkUiMessagesForSuccessfulTurn(
    messages,
    systemPrompt,
    contextSize,
    maxOutputTokens,
    pendingTokens,
  ).messages
}

function findCompactSummaryMessage(messages: AipgUiMessage[]): AipgUiMessage | undefined {
  return messages.find((m) => hasAutoCompactSummaryMessage([m]))
}

function keepCompactSummaryAndFromLastUser(messages: AipgUiMessage[]): AipgUiMessage[] {
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user')
  if (lastUserIdx < 0) return messages
  const compact = findCompactSummaryMessage(messages)
  const tail = stripReasoningFromMessages(
    truncateToolOutputsInMessages(messages.slice(lastUserIdx), 200),
  )
  if (compact && messages.indexOf(compact) < lastUserIdx) {
    return [compact, ...tail]
  }
  return tail
}

function keepCompactSummaryAndLastUserOnly(messages: AipgUiMessage[]): AipgUiMessage[] {
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user')
  if (lastUserIdx < 0) return messages.slice(-1)
  const compact = findCompactSummaryMessage(messages)
  const lastUser = truncateToolOutputsInMessages(
    stripReasoningFromMessages([messages[lastUserIdx]]),
    200,
  )
  if (compact && messages.indexOf(compact) < lastUserIdx) {
    return [compact, ...lastUser]
  }
  return lastUser
}

function keepLastUserMessageOnly(messages: AipgUiMessage[]): AipgUiMessage[] {
  return keepCompactSummaryAndLastUserOnly(messages)
}

type LooseModelMessage = {
  role: string
  content?: unknown
}

function truncateLooseToolResultOutput(output: unknown, maxChars: number): unknown {
  if (output == null) return output
  if (typeof output === 'object' && !Array.isArray(output)) {
    const o = output as Record<string, unknown>
    if (o.type === 'text' && typeof o.value === 'string') {
      if (o.value.length <= maxChars) return output
      return { ...o, value: clipTextForContext(o.value, maxChars) }
    }
    if (o.type === 'json') {
      const text = JSON.stringify(o.value)
      if (text.length <= maxChars) return output
      return { type: 'text', value: clipTextForContext(text, maxChars) }
    }
    if (o.type === 'error-text' && typeof o.value === 'string') {
      if (o.value.length <= maxChars) return output
      return { ...o, value: clipTextForContext(o.value, maxChars) }
    }
  }
  const asText =
    typeof output === 'string' ? output : (() => {
      try {
        return JSON.stringify(output)
      } catch {
        return String(output)
      }
    })()
  return { type: 'text', value: clipTextForContext(asText, maxChars) }
}

function truncateLooseContentPart(part: Record<string, unknown>, maxChars: number): unknown {
  const type = typeof part.type === 'string' ? part.type : ''
  if (type === 'text' && typeof part.text === 'string' && part.text.length > maxChars) {
    return { ...part, text: clipTextForContext(part.text, maxChars) }
  }
  if (type === 'tool-call') {
    const input = part.input
    if (input !== undefined) {
      const serialized = typeof input === 'string' ? input : JSON.stringify(input)
      if (serialized.length > maxChars) {
        return { ...part, input: clipTextForContext(serialized, maxChars) }
      }
    }
  }
  if (type === 'tool-result' && part.output !== undefined) {
    return { ...part, output: truncateLooseToolResultOutput(part.output, maxChars) }
  }
  if (type === 'reasoning' && typeof part.text === 'string' && part.text.length > maxChars) {
    return { ...part, text: clipTextForContext(part.text, maxChars) }
  }
  return part
}

function truncateLooseModelMessage(msg: LooseModelMessage, maxChars: number): LooseModelMessage {
  const { content } = msg
  if (typeof content === 'string') {
    if (content.length <= maxChars) return msg
    return { ...msg, content: clipTextForContext(content, maxChars) }
  }
  if (!Array.isArray(content)) return msg
  const nextContent = content.map((part) => {
    if (!part || typeof part !== 'object') return part
    return truncateLooseContentPart(part as Record<string, unknown>, maxChars)
  })
  return { ...msg, content: nextContent }
}

function estimateLooseMessagesTokens(messages: LooseModelMessage[], systemPrompt: string): number {
  const raw = estimateTextTokens(systemPrompt) + estimateTextTokens(JSON.stringify(messages))
  return Math.ceil(raw * TOKEN_ESTIMATE_SAFETY)
}

export type TrimModelMessagesOptions = {
  /** Follow-up model steps after tool execution — tighter send budget. */
  toolStep?: boolean
  /** First request in a tool-calling turn — leave headroom for tool results. */
  toolLoop?: boolean
  /** Last step's backend prompt token count (calibrates heuristic underestimates). */
  measuredPromptTokens?: number
}

/** Trim model messages between tool-loop steps (truncate only — never drop messages). */
export function trimModelMessagesToContextBudget(
  messages: LooseModelMessage[],
  systemPrompt: string,
  contextSize: number,
  maxOutputTokens: number,
  options?: TrimModelMessagesOptions,
): LooseModelMessage[] {
  let working = messages
  if (options?.toolLoop || options?.toolStep) {
    working = stripReasoningFromLooseModelMessages(working)
  }

  const hardMax = maxPromptTokensForContext(contextSize, maxOutputTokens)
  let target = Math.min(
    maxAllowedPromptTokens(contextSize, maxOutputTokens),
    Math.floor(hardMax * CONTEXT_SEND_MARGIN),
  )
  if (options?.toolLoop) {
    target = Math.floor(target * 0.9)
  }
  if (options?.toolStep) {
    target = Math.floor(target * 0.85)
  }

  const rawEstimate = estimateLooseMessagesTokens(working, systemPrompt)
  if (
    options?.measuredPromptTokens &&
    options.measuredPromptTokens > 0 &&
    rawEstimate > 0 &&
    options.measuredPromptTokens > rawEstimate
  ) {
    target = Math.floor((target * rawEstimate) / options.measuredPromptTokens)
  }
  target = Math.max(target, 256)

  const measuredAtContextLimit =
    !!options?.measuredPromptTokens &&
    shouldCompactFromMeasuredUsage(options.measuredPromptTokens, contextSize)

  const finishTrim = (candidate: LooseModelMessage[]) => {
    if (!measuredAtContextLimit) return candidate
    return emergencyTrimModelMessagesForMeasuredOverflow(candidate, systemPrompt, target)
  }

  const fits = (candidate: LooseModelMessage[]) =>
    estimateLooseMessagesTokens(candidate, systemPrompt) <= target

  let globalCap = MAX_PERSISTED_TOOL_OUTPUT_CHARS
  let current = working.map((m) => truncateLooseModelMessage(m, globalCap))
  if (fits(current)) return finishTrim(current)

  while (globalCap > 48) {
    globalCap = Math.floor(globalCap / 2)
    current = working.map((m) => truncateLooseModelMessage(m, globalCap))
    if (fits(current)) return finishTrim(current)
  }

  let baseCap = 1600
  while (baseCap > 40) {
    const caps = working.map((_, i) => {
      const ageFromEnd = working.length - 1 - i
      if (ageFromEnd <= 1) return Math.max(baseCap * 2, 512)
      if (ageFromEnd <= 3) return Math.max(baseCap, 256)
      return Math.max(Math.floor(baseCap / 2), 64)
    })
    current = working.map((m, i) => truncateLooseModelMessage(m, caps[i] ?? baseCap))
    if (fits(current)) return finishTrim(current)
    baseCap = Math.floor(baseCap * 0.55)
  }

  current = working.map((m) => truncateLooseModelMessage(m, 48))
  if (fits(current)) return finishTrim(current)

  return finishTrim(current)
}

/** Keep the current user turn and later tool steps; drop older history when the backend is at n_ctx. */
function sliceModelMessagesFromLastUser(messages: LooseModelMessage[]): LooseModelMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages.slice(i)
  }
  return messages.length > 2 ? messages.slice(-2) : messages
}

/** Drop oldest assistant/tool round-trips after the last user message, keeping the most recent cycles. */
function keepRecentToolCyclesAfterLastUser(
  messages: LooseModelMessage[],
  maxCycles: number,
): LooseModelMessage[] {
  let userIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx < 0) return messages

  const head = messages.slice(0, userIdx + 1)
  const tail = messages.slice(userIdx + 1)
  if (tail.length === 0) return messages

  type Cycle = { assistant?: LooseModelMessage; tools: LooseModelMessage[] }
  const cycles: Cycle[] = []
  let current: Cycle = { tools: [] }

  for (const msg of tail) {
    if (msg.role === 'assistant') {
      if (current.assistant || current.tools.length > 0) cycles.push(current)
      current = { assistant: msg, tools: [] }
    } else if (msg.role === 'tool') {
      current.tools.push(msg)
    } else {
      if (current.assistant || current.tools.length > 0) cycles.push(current)
      current = { tools: [] }
      head.push(msg)
    }
  }
  if (current.assistant || current.tools.length > 0) cycles.push(current)

  const kept = cycles.slice(-Math.max(maxCycles, 1))
  const rebuiltTail = kept.flatMap((c) =>
    c.assistant ? [c.assistant, ...c.tools] : c.tools,
  )
  return [...head, ...rebuiltTail]
}

function emergencyTrimModelMessagesForMeasuredOverflow(
  messages: LooseModelMessage[],
  systemPrompt: string,
  target: number,
): LooseModelMessage[] {
  const fits = (candidate: LooseModelMessage[]) =>
    estimateLooseMessagesTokens(candidate, systemPrompt) <= target

  let current = messages
  const forgetSteps: Array<(m: LooseModelMessage[]) => LooseModelMessage[]> = [
    (m) => sliceModelMessagesFromLastUser(m),
    (m) => keepRecentToolCyclesAfterLastUser(m, 4),
    (m) => keepRecentToolCyclesAfterLastUser(m, 2),
    (m) => keepRecentToolCyclesAfterLastUser(m, 1),
  ]

  for (const step of forgetSteps) {
    const next = step(current)
    if (next.length === current.length && step !== forgetSteps[0]) continue
    current = next
    current = current.map((m) => truncateLooseModelMessage(m, 48))
    if (fits(current)) return current
  }

  return current.map((m) => truncateLooseModelMessage(m, 48))
}

/**
 * Remove the failed in-flight turn before an overflow retry (partial assistant/tool steps
 * and the user message that will be sent again).
 */
export function rollbackMessagesBeforeTurnRetry(messages: AipgUiMessage[]): AipgUiMessage[] {
  let end = messages.length
  while (end > 0 && messages[end - 1].role !== 'user') {
    end--
  }
  if (end > 0 && messages[end - 1].role === 'user') {
    end--
  }
  return messages.slice(0, end)
}

function alignSplitStartToUserBoundary(messages: AipgUiMessage[], tailCount: number): number {
  let start = Math.max(messages.length - tailCount, 0)
  while (start > 0 && messages[start].role !== 'user') {
    start--
  }
  if (start >= messages.length) {
    return Math.max(messages.length - 1, 0)
  }
  return start
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

export function maxAllowedPromptTokens(contextSize: number, maxOutputTokens: number): number {
  return Math.floor(maxPromptTokensForContext(contextSize, maxOutputTokens) * CONTEXT_SEND_MARGIN)
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
  hasStoredInferenceSummary = false,
): boolean {
  if (messages.length === 0 && pendingTokens <= 0) return false
  if (force && messages.length > 0) return true
  if (
    projectedExceedsContext(
      messages,
      systemPrompt,
      contextSize,
      maxOutputTokens,
      pendingTokens,
    )
  ) {
    return true
  }
  if (shouldCompactFromMeasuredUsage(measuredPromptTokens, contextSize)) return true
  if (
    shouldSkipFurtherCompaction(
      messages,
      contextSize,
      pendingTokens,
      force,
      hasStoredInferenceSummary,
      maxOutputTokens,
    )
  ) {
    return false
  }
  if (historyExceedsCompactTrigger(messages, contextSize, pendingTokens, maxOutputTokens)) {
    // Align with the context ring: if the last request still had clear headroom, do
    // not run an expensive summary while the meter shows ~25%+ free.
    if (
      measuredPromptTokens &&
      measuredPromptTokens > 0 &&
      measuredPromptTokens < Math.floor(contextSize * 0.75)
    ) {
      return false
    }
    return true
  }
  return false
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
  const maxPrompt = maxAllowedPromptTokens(contextSize, maxOutputTokens)
  if (projected >= contextSize - CONTEXT_SLACK) return true
  return projected >= maxPrompt
}

export function messagesFitHardContextLimit(
  messages: AipgUiMessage[],
  systemPrompt: string,
  contextSize: number,
  maxOutputTokens: number,
  pendingTokens = 0,
): boolean {
  return !projectedExceedsContext(
    messages,
    systemPrompt,
    contextSize,
    maxOutputTokens,
    pendingTokens,
  )
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

  let splitAt = alignSplitStartToUserBoundary(messages, tailCount)
  while (splitAt <= 0 && tailCount > 1) {
    tailCount--
    splitAt = alignSplitStartToUserBoundary(messages, tailCount)
  }
  const prefix = messages.slice(0, splitAt)
  if (prefix.length === 0) return null

  return {
    prefix,
    suffix: stripReasoningFromMessages(messages.slice(splitAt)),
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
