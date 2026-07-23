import { describe, expect, it } from 'vitest'
import type { AipgUiMessage } from '@/assets/js/store/openAiCompatibleChat'
import {
  buildCompactedMessageList,
  compactedHistoryFitsBudget,
  computeInputTokenBudget,
  flattenUiMessagesForSummary,
  historyExceedsTargetShare,
  maxPromptTokensForContext,
  messagesFitHardContextLimit,
  needsContextCompaction,
  projectedPromptTokens,
  rollbackMessagesBeforeTurnRetry,
  shrinkUiMessagesForSuccessfulTurn,
  shouldCompactFromMeasuredUsage,
  shouldSkipFurtherCompaction,
  splitForTargetHistoryShare,
  splitMessagesForCompaction,
  targetHistoryTokenBudget,
  TARGET_HISTORY_SHARE,
  trimModelMessagesToContextBudget,
  maxAllowedPromptTokens,
  clampTranscriptForSummaryGeneration,
  clampToolLoopMaxSteps,
  MAX_TOOL_LOOP_MAX_STEPS,
  MIN_TOOL_LOOP_MAX_STEPS,
  resolveUiMessagesForInference,
} from './chatContextCompact'

const uiMsg = (role: string, text: string, id = 'm'): AipgUiMessage =>
  ({ id, role, parts: [{ type: 'text', text }] }) as unknown as AipgUiMessage

describe('targetHistoryTokenBudget', () => {
  it('uses 30% of the configured context size', () => {
    expect(targetHistoryTokenBudget(8192)).toBe(Math.floor(8192 * TARGET_HISTORY_SHARE))
  })
})

describe('shouldCompactContext / needsContextCompaction', () => {
  it('returns true when history exceeds the compact threshold', () => {
    const longHistory = Array.from({ length: 40 }, (_, i) =>
      uiMsg(i % 2 === 0 ? 'user' : 'assistant', `Message ${i} `.repeat(80), `m${i}`),
    )
    expect(needsContextCompaction(longHistory, '', 2048, 256)).toBe(true)
  })

  it('includes pending tokens in the projection', () => {
    const history = [uiMsg('user', 'hello', 'm1')]
    const base = projectedPromptTokens(history, '', 0)
    const withPending = projectedPromptTokens(history, '', 2000)
    expect(withPending).toBeGreaterThan(base)
  })
})

describe('splitForTargetHistoryShare', () => {
  it('keeps a recent suffix and leaves a non-empty prefix', () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      uiMsg(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i}`, `m${i}`),
    )
    const split = splitForTargetHistoryShare(messages, 8192)
    expect(split).not.toBeNull()
    expect(split!.prefix.length).toBeGreaterThan(0)
    expect(split!.prefix.length + split!.suffix.length).toBe(messages.length)
  })
})

describe('splitMessagesForCompaction', () => {
  it('keeps a recent suffix and leaves a non-empty prefix', () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      uiMsg(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i}`, `m${i}`),
    )
    const budget = computeInputTokenBudget(8192, 512, '')
    const split = splitMessagesForCompaction(messages, budget)
    expect(split).not.toBeNull()
    expect(split!.prefix.length).toBeGreaterThan(0)
  })
})

describe('buildCompactedMessageList', () => {
  it('prefixes the summary and preserves the tail', () => {
    const suffix = [uiMsg('user', 'latest question', 'u1')]
    const compacted = buildCompactedMessageList('Prior topic was billing.', suffix, 'summary-id')
    expect(compacted).toHaveLength(2)
    expect(compacted[0].parts[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('auto-compacted'),
    })
    expect(flattenUiMessagesForSummary(compacted)).toContain('latest question')
  })

  it('fits the post-compact full-prompt target after compaction', () => {
    const suffix = [uiMsg('user', 'What next?', 'tail')]
    const compacted = buildCompactedMessageList('Short summary of old turns.', suffix, 's1')
    expect(compactedHistoryFitsBudget(compacted, 4096, 'You are a helpful assistant.')).toBe(true)
  })
})

describe('shouldCompactFromMeasuredUsage', () => {
  it('triggers only when the backend is about to exceed the context window', () => {
    expect(shouldCompactFromMeasuredUsage(8316, 8192)).toBe(true)
    expect(shouldCompactFromMeasuredUsage(5000, 8192)).toBe(false)
    expect(shouldCompactFromMeasuredUsage(1000, 8192)).toBe(false)
  })
})

describe('shouldSkipFurtherCompaction', () => {
  it('skips re-compaction while inference tail stays below the re-trigger threshold', () => {
    const compacted = buildCompactedMessageList('Short summary.', [uiMsg('user', 'hi', 'u2')], 's')
    const meta = {
      inferenceContextSummary: 'Short summary.',
      inferenceContextTailFromMessageId: 'u2',
    }
    const ui = resolveUiMessagesForInference(compacted, meta)
    expect(shouldSkipFurtherCompaction(ui, 8192, 0, false, true, 512)).toBe(true)
  })
})

describe('needsContextCompaction', () => {
  it('uses measured usage even when heuristics underestimate', () => {
    const shortHistory = [uiMsg('user', 'hi', 'u1')]
    expect(needsContextCompaction(shortHistory, '', 8192, 1024, 0, 8316, false)).toBe(true)
  })

  it('does not proactively compact when the backend still shows ~25%+ headroom', () => {
    const history = [uiMsg('user', 'a'.repeat(8000), 'u1')]
    expect(needsContextCompaction(history, '', 8192, 512, 0, 5800, false, false)).toBe(false)
  })

  it('compacts again when the prompt exceeds the hard context limit after a prior compact', () => {
    const compacted = buildCompactedMessageList(
      'Earlier summary.',
      [uiMsg('user', 'a'.repeat(28000), 'u2')],
      's',
    )
    expect(needsContextCompaction(compacted, '', 8192, 1024)).toBe(true)
  })
})

describe('historyExceedsTargetShare', () => {
  it('is false for small threads', () => {
    expect(historyExceedsTargetShare([uiMsg('user', 'hi', 'u')], 8192)).toBe(false)
  })
})

describe('shrinkUiMessagesForSuccessfulTurn', () => {
  it('keeps at least the latest user message under a tight budget', () => {
    const history = [
      ...Array.from({ length: 8 }, (_, i) =>
        uiMsg(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i} `.repeat(200), `m${i}`),
      ),
      uiMsg('user', 'Current question', 'current'),
    ]
    const shrunk = shrinkUiMessagesForSuccessfulTurn(history, 'system', 2048, 256)
    expect(shrunk.messages.some((m) => m.id === 'current')).toBe(true)
    expect(messagesFitHardContextLimit(shrunk.messages, 'system', 2048, 256)).toBe(true)
  })
})

describe('rollbackMessagesBeforeTurnRetry', () => {
  it('removes partial tool steps and the user message for retry', () => {
    const messages = [
      uiMsg('user', 'old', 'u1'),
      uiMsg('assistant', 'ok', 'a1'),
      uiMsg('user', 'retry me', 'u2'),
      uiMsg('assistant', 'calling tool', 'a2'),
    ]
    expect(rollbackMessagesBeforeTurnRetry(messages)).toHaveLength(2)
  })
})

describe('projectedPromptTokens', () => {
  it('flags prompts that would exceed the reserved context window', () => {
    const msgs = [uiMsg('user', 'a'.repeat(28000), 'u')]
    const projected = projectedPromptTokens(msgs, '', 0)
    expect(projected).toBeGreaterThan(maxPromptTokensForContext(8192, 1024))
  })
})

describe('clampTranscriptForSummaryGeneration', () => {
  it('shortens transcripts so summary generation fits the context window', () => {
    const huge = 'word '.repeat(50_000)
    const clamped = clampTranscriptForSummaryGeneration(huge, 8192, 512)
    expect(clamped.length).toBeLessThan(huge.length)
    expect(clamped).toContain('[truncated for context]')
  })
})

describe('clampToolLoopMaxSteps', () => {
  it('clamps to configured bounds', () => {
    expect(clampToolLoopMaxSteps(3)).toBe(MIN_TOOL_LOOP_MAX_STEPS)
    expect(clampToolLoopMaxSteps(100)).toBe(MAX_TOOL_LOOP_MAX_STEPS)
    expect(clampToolLoopMaxSteps(30)).toBe(30)
  })
})

describe('trimModelMessagesToContextBudget', () => {
  it('shrinks oversized tool results so the prompt fits under the send budget', () => {
    const huge = 'x'.repeat(120_000)
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'question' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: '1', toolName: 'search', input: { q: 'a' } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '1',
            toolName: 'search',
            output: { type: 'text', value: huge },
          },
        ],
      },
    ]
    const system = 'You are helpful.'
    const trimmed = trimModelMessagesToContextBudget(messages, system, 8192, 512, {
      toolStep: true,
      toolLoop: true,
    })
    const budget = maxAllowedPromptTokens(8192, 512)
    const estimate = Math.ceil(
      (system.length / 4 + JSON.stringify(trimmed).length / 4) * 1.35,
    )
    expect(estimate).toBeLessThanOrEqual(budget)
  })

  it('drops older history when measured prompt tokens hit the context ceiling', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'old question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
      { role: 'user', content: [{ type: 'text', text: 'current question' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: '1', toolName: 'mcp__x__call_tool', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '1',
            toolName: 'mcp__x__call_tool',
            output: { type: 'text', value: 'y'.repeat(50_000) },
          },
        ],
      },
    ]
    const trimmed = trimModelMessagesToContextBudget(messages, 'system', 8192, 512, {
      toolStep: true,
      measuredPromptTokens: 8100,
    })
    expect(trimmed.length).toBeLessThan(messages.length)
    expect(trimmed[0]?.role).toBe('user')
    expect((trimmed[0]?.content as { text: string }[])[0]?.text).toBe('current question')
  })
})
