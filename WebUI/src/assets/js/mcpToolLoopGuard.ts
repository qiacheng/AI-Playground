/** Stable fingerprint for MCP tool args (key order normalized). */
export function fingerprintMcpToolCall(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  return `${serverId}\0${toolName}\0${stableJson(args)}`
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`
}

export type McpToolLoopGuard = {
  /** @returns tool result text when the call should be blocked; undefined to proceed. */
  checkBeforeCall(serverId: string, toolName: string, args: Record<string, unknown>): string | undefined
}

export type McpToolLoopGuardOptions = {
  maxIdenticalCalls?: number
  maxListDescribeCalls?: number
  maxSameCallToolName?: number
}

const DEFAULTS: Required<McpToolLoopGuardOptions> = {
  maxIdenticalCalls: 3,
  maxListDescribeCalls: 8,
  maxSameCallToolName: 5,
}

export function createMcpToolLoopGuard(options?: McpToolLoopGuardOptions): McpToolLoopGuard {
  const opts = { ...DEFAULTS, ...options }
  const identicalCounts = new Map<string, number>()
  let listDescribeCalls = 0
  const callToolNameCounts = new Map<string, number>()

  return {
    checkBeforeCall(serverId, toolName, args) {
      if (toolName === 'list_toolsets' || toolName === 'describe_toolset') {
        listDescribeCalls++
        if (listDescribeCalls > opts.maxListDescribeCalls) {
          return (
            'Blocked: list_toolsets/describe_toolset was called too many times this turn. ' +
            'Reuse schemas and refPath values from earlier results, or stop and summarize ' +
            'what is blocking progress for the user.'
          )
        }
      }

      if (toolName === 'call_tool') {
        const innerName =
          typeof args.tool_name === 'string'
            ? args.tool_name
            : typeof args.toolName === 'string'
              ? args.toolName
              : 'unknown'
        const innerCount = (callToolNameCounts.get(innerName) ?? 0) + 1
        callToolNameCounts.set(innerName, innerCount)
        if (innerCount > opts.maxSameCallToolName) {
          return (
            `Blocked: call_tool for "${innerName}" was invoked ${innerCount} times this turn without success. ` +
            'Do not retry the same approach. Tell the user what failed and what refPath or parameters are still missing.'
          )
        }
      }

      const fp = fingerprintMcpToolCall(serverId, toolName, args)
      const seen = (identicalCounts.get(fp) ?? 0) + 1
      identicalCounts.set(fp, seen)
      if (seen > opts.maxIdenticalCalls) {
        return (
          'Blocked: this exact MCP call (same tool name and arguments) was already attempted repeatedly. ' +
          'Change parameters or stop and explain the error to the user instead of looping.'
        )
      }

      return undefined
    },
  }
}
