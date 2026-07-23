import { describe, expect, it } from 'vitest'
import type { AipgUiMessage } from '@/assets/js/store/openAiCompatibleChat'
import {
  buildCompactedMessageList,
  compactedHistoryFitsBudget,
  computeInputTokenBudget,
  flattenUiMessagesForSummary,
  historyExceedsTargetShare,
  maxPromptTokensForContext,
  needsContextCompaction,
  projectedPromptTokens,
  shouldCompactFromMeasuredUsage,
  shouldSkipFurtherCompaction,
  splitForTargetHistoryShare,
  splitMessagesForCompaction,
  targetHistoryTokenBudget,
  TARGET_HISTORY_SHARE,
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
  it('skips re-compaction while history stays below the re-trigger threshold', () => {
    const compacted = buildCompactedMessageList('Short summary.', [uiMsg('user', 'hi', 'u2')], 's')
    expect(
      shouldSkipFurtherCompaction(compacted, 8192, 0, false),
    ).toBe(true)
  })
})

describe('needsContextCompaction', () => {
  it('uses measured usage even when heuristics underestimate', () => {
    const shortHistory = [uiMsg('user', 'hi', 'u1')]
    expect(needsContextCompaction(shortHistory, '', 8192, 1024, 0, 8316, false)).toBe(true)
  })
})

describe('historyExceedsTargetShare', () => {
  it('is false for small threads', () => {
    expect(historyExceedsTargetShare([uiMsg('user', 'hi', 'u')], 8192)).toBe(false)
  })
})

describe('projectedPromptTokens', () => {
  it('flags prompts that would exceed the reserved context window', () => {
    const msgs = [uiMsg('user', 'a'.repeat(28000), 'u')]
    const projected = projectedPromptTokens(msgs, '', 0)
    expect(projected).toBeGreaterThan(maxPromptTokensForContext(8192, 1024))
  })
})
