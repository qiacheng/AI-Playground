import { describe, expect, it } from 'vitest'
import { createMcpToolLoopGuard, fingerprintMcpToolCall } from './mcpToolLoopGuard'

describe('fingerprintMcpToolCall', () => {
  it('is stable regardless of key order', () => {
    const a = fingerprintMcpToolCall('ue-mcp', 'call_tool', {
      tool_name: 'find_actors',
      toolset_name: 'x',
      arguments: { name: 'Sports' },
    })
    const b = fingerprintMcpToolCall('ue-mcp', 'call_tool', {
      toolset_name: 'x',
      arguments: { name: 'Sports' },
      tool_name: 'find_actors',
    })
    expect(a).toBe(b)
  })
})

describe('createMcpToolLoopGuard', () => {
  it('blocks identical calls after the limit', () => {
    const guard = createMcpToolLoopGuard({ maxIdenticalCalls: 2 })
    const args = { tool_name: 'find_actors', arguments: { name: '' } }
    expect(guard.checkBeforeCall('ue-mcp', 'call_tool', args)).toBeUndefined()
    expect(guard.checkBeforeCall('ue-mcp', 'call_tool', args)).toBeUndefined()
    expect(guard.checkBeforeCall('ue-mcp', 'call_tool', args)).toContain('Blocked')
  })

  it('limits list_toolsets / describe_toolset churn', () => {
    const guard = createMcpToolLoopGuard({ maxListDescribeCalls: 2 })
    expect(guard.checkBeforeCall('ue-mcp', 'list_toolsets', {})).toBeUndefined()
    expect(guard.checkBeforeCall('ue-mcp', 'describe_toolset', { id: 'a' })).toBeUndefined()
    expect(guard.checkBeforeCall('ue-mcp', 'list_toolsets', {})).toContain('Blocked')
  })
})
