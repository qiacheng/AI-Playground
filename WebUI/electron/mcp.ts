import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  McpEvent,
  McpServerConfig,
  McpToolDefinition,
  qualifyMcpToolName,
} from '../src/types/mcp'

type JsonRpcId = number | string

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: {
    code: number
    message: string
    data?: unknown
  }
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure
type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timeout: NodeJS.Timeout
  toolCallId?: string
  progressToken?: string
}

type McpSession = {
  key: string
  config: McpServerConfig
  process: ChildProcessWithoutNullStreams
  stdoutBuffer: string
  nextId: number
  initialized: boolean
  closed: boolean
  pendingRequests: Map<JsonRpcId, PendingRequest>
}

const MCP_PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'] as const
const DEFAULT_REQUEST_TIMEOUT_MS = 30000
const mcpSessions = new Map<string, McpSession>()
let mcpEventSink: ((event: McpEvent) => void) | null = null

function createSessionKey(config: McpServerConfig): string {
  return JSON.stringify({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: config.env,
    name: config.name,
  })
}

function rejectPendingRequests(session: McpSession, reason: Error) {
  for (const pending of session.pendingRequests.values()) {
    clearTimeout(pending.timeout)
    pending.reject(reason)
  }
  session.pendingRequests.clear()
}

function closeSession(session: McpSession, reason?: Error) {
  if (session.closed) return
  session.closed = true
  if (reason) {
    rejectPendingRequests(session, reason)
  }
  session.process.removeAllListeners()
  session.process.stdout.removeAllListeners()
  session.process.stderr.removeAllListeners()
  if (!session.process.killed) {
    session.process.kill()
  }
  mcpSessions.delete(session.key)
}

function emitMcpEvent(event: McpEvent) {
  mcpEventSink?.(event)
}

function sendJsonRpcMessage(session: McpSession, message: JsonRpcRequest | JsonRpcNotification) {
  session.process.stdin.write(`${JSON.stringify(message)}\n`)
}

function sendJsonRpcResponse(session: McpSession, response: JsonRpcResponse) {
  session.process.stdin.write(`${JSON.stringify(response)}\n`)
}

function handleServerRequest(session: McpSession, message: JsonRpcRequest) {
  if (message.method === 'ping') {
    sendJsonRpcResponse(session, {
      jsonrpc: '2.0',
      id: message.id,
      result: {},
    })
    return
  }

  sendJsonRpcResponse(session, {
    jsonrpc: '2.0',
    id: message.id,
    error: {
      code: -32601,
      message: `Method not supported by AI Playground MCP bridge: ${message.method}`,
    },
  })
}

function handleJsonRpcMessage(session: McpSession, message: JsonRpcMessage) {
  if ('id' in message && ('result' in message || 'error' in message)) {
    const pending = session.pendingRequests.get(message.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    session.pendingRequests.delete(message.id)

    if ('error' in message) {
      pending.reject(
        new Error(
          `[MCP:${session.config.name}] ${message.error.message} (${message.error.code})`,
        ),
      )
      return
    }

    pending.resolve(message.result)
    return
  }

  if ('method' in message && !('id' in message)) {
    if (message.method === 'notifications/progress') {
      const params = (message.params ?? {}) as {
        progressToken?: string | number
        progress?: number
        total?: number
        message?: string
      }
      const progressToken =
        typeof params.progressToken === 'string' || typeof params.progressToken === 'number'
          ? String(params.progressToken)
          : null
      const pending = progressToken
        ? [...session.pendingRequests.values()].find((request) => request.progressToken === progressToken)
        : undefined

      emitMcpEvent({
        type: 'progress',
        serverName: session.config.name,
        toolCallId: pending?.toolCallId,
        message: params.message,
        progress: params.progress,
        total: params.total,
        timestamp: Date.now(),
      })
      return
    }

    if (message.method === 'notifications/message') {
      const params = (message.params ?? {}) as {
        data?: unknown
        level?: string
        logger?: string
      }
      const activeToolCallIds = [...session.pendingRequests.values()]
        .map((request) => request.toolCallId)
        .filter((value): value is string => typeof value === 'string')

      emitMcpEvent({
        type: 'log',
        serverName: session.config.name,
        toolCallId: activeToolCallIds.length === 1 ? activeToolCallIds[0] : undefined,
        message:
          typeof params.data === 'string'
            ? params.data
            : JSON.stringify(
                {
                  level: params.level,
                  logger: params.logger,
                  data: params.data,
                },
                null,
                2,
              ),
        timestamp: Date.now(),
      })
      return
    }
  }

  if ('id' in message && 'method' in message) {
    handleServerRequest(session, message)
  }
}

function attachSessionHandlers(session: McpSession) {
  session.process.stdout.on('data', (chunk: Buffer | string) => {
    session.stdoutBuffer += chunk.toString()

    let newlineIndex = session.stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const rawLine = session.stdoutBuffer.slice(0, newlineIndex).trim()
      session.stdoutBuffer = session.stdoutBuffer.slice(newlineIndex + 1)

      if (rawLine.length > 0) {
        try {
          const parsed = JSON.parse(rawLine) as JsonRpcMessage | JsonRpcMessage[]
          const messages = Array.isArray(parsed) ? parsed : [parsed]
          for (const message of messages) {
            handleJsonRpcMessage(session, message)
          }
        } catch (error) {
          console.warn(`[MCP:${session.config.name}] Failed to parse stdout line`, error, rawLine)
        }
      }

      newlineIndex = session.stdoutBuffer.indexOf('\n')
    }
  })

  session.process.stderr.on('data', (chunk: Buffer | string) => {
    const message = chunk.toString().trim()
    if (!message) return
    console.warn(`[MCP:${session.config.name}] ${message}`)

    const activeToolCallIds = [...session.pendingRequests.values()]
      .map((request) => request.toolCallId)
      .filter((value): value is string => typeof value === 'string')

    emitMcpEvent({
      type: 'stderr',
      serverName: session.config.name,
      toolCallId: activeToolCallIds.length === 1 ? activeToolCallIds[0] : undefined,
      message,
      timestamp: Date.now(),
    })
  })

  session.process.on('error', (error) => {
    closeSession(session, error instanceof Error ? error : new Error(String(error)))
  })

  session.process.on('exit', (code, signal) => {
    closeSession(
      session,
      new Error(
        `[MCP:${session.config.name}] server exited unexpectedly (code=${code}, signal=${signal})`,
      ),
    )
  })
}

function spawnSession(config: McpServerConfig): McpSession {
  const key = createSessionKey(config)
  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    env: {
      ...process.env,
      ...config.env,
    },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })

  const session: McpSession = {
    key,
    config,
    process: child,
    stdoutBuffer: '',
    nextId: 1,
    initialized: false,
    closed: false,
    pendingRequests: new Map(),
  }

  attachSessionHandlers(session)
  mcpSessions.set(key, session)
  return session
}

function sendRequest(
  session: McpSession,
  method: string,
  params?: unknown,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  requestMetadata?: {
    toolCallId?: string
    progressToken?: string
  },
) {
  const id = session.nextId++
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  }

  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.pendingRequests.delete(id)
      reject(new Error(`[MCP:${session.config.name}] ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    session.pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      toolCallId: requestMetadata?.toolCallId,
      progressToken: requestMetadata?.progressToken,
    })

    sendJsonRpcMessage(session, request)
  })
}

function sendNotification(session: McpSession, method: string, params?: unknown) {
  sendJsonRpcMessage(session, {
    jsonrpc: '2.0',
    method,
    ...(params !== undefined ? { params } : {}),
  })
}

async function initializeSession(session: McpSession) {
  if (session.initialized) return

  let lastError: Error | null = null
  for (const protocolVersion of MCP_PROTOCOL_VERSIONS) {
    try {
      await sendRequest(session, 'initialize', {
        protocolVersion,
        capabilities: {},
        clientInfo: {
          name: 'AI Playground',
          version: '3.0.3-beta',
        },
      })

      sendNotification(session, 'notifications/initialized', {})
      session.initialized = true
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError ?? new Error(`[MCP:${session.config.name}] failed to initialize session`)
}

async function getOrCreateSession(config: McpServerConfig) {
  const key = createSessionKey(config)
  const existing = mcpSessions.get(key)
  if (existing && !existing.closed) {
    await initializeSession(existing)
    return existing
  }

  const session = spawnSession(config)
  await initializeSession(session)
  return session
}

function normalizeToolsListResult(result: unknown): Array<{
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}> {
  if (!result || typeof result !== 'object') return []

  const data = result as {
    tools?: Array<{
      name?: string
      description?: string
      inputSchema?: Record<string, unknown>
    }>
  }

  return (data.tools ?? []).filter(
    (tool): tool is { name: string; description?: string; inputSchema?: Record<string, unknown> } =>
      typeof tool.name === 'string',
  )
}

function parseTextContentAsJson(content: unknown): unknown | null {
  if (!Array.isArray(content)) return null

  const textPart = content.find(
    (part): part is { type?: string; text?: string } =>
      !!part &&
      typeof part === 'object' &&
      'type' in part &&
      (part as { type?: string }).type === 'text' &&
      typeof (part as { text?: string }).text === 'string',
  )

  if (!textPart?.text) return null

  try {
    return JSON.parse(textPart.text)
  } catch {
    return null
  }
}

function isMcpErrorResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false

  const data = result as {
    isError?: boolean
    structuredContent?: { status?: string }
    content?: unknown
  }

  if (data.isError === true) return true
  if (data.structuredContent?.status?.toLowerCase() === 'error') return true

  const parsedTextJson = parseTextContentAsJson(data.content)
  if (
    parsedTextJson &&
    typeof parsedTextJson === 'object' &&
    (parsedTextJson as { status?: string }).status?.toLowerCase() === 'error'
  ) {
    return true
  }

  return false
}

export async function listMcpTools(serverConfigs: McpServerConfig[]) {
  const tools: McpToolDefinition[] = []
  const errors: string[] = []

  for (const config of serverConfigs.filter((item) => item.enabled)) {
    try {
      const session = await getOrCreateSession(config)
      let cursor: string | undefined

      do {
        const result = await sendRequest(
          session,
          'tools/list',
          cursor ? { cursor } : {},
          DEFAULT_REQUEST_TIMEOUT_MS,
        )
        const normalizedTools = normalizeToolsListResult(result)

        for (const tool of normalizedTools) {
          tools.push({
            serverName: config.name,
            toolName: tool.name!,
            qualifiedToolName: qualifyMcpToolName(config.name, tool.name!),
            description: tool.description,
            inputSchema:
              tool.inputSchema && typeof tool.inputSchema === 'object'
                ? tool.inputSchema
                : { type: 'object', additionalProperties: true },
          })
        }

        cursor =
          result && typeof result === 'object' && 'nextCursor' in result
            ? ((result as { nextCursor?: string }).nextCursor ?? undefined)
            : undefined
      } while (cursor)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  return { tools, errors }
}

export async function callMcpTool(
  serverConfig: McpServerConfig,
  toolName: string,
  args: unknown,
  toolCallId?: string,
) {
  const session = await getOrCreateSession(serverConfig)
  const progressToken = toolCallId ? `tool-${toolCallId}` : undefined
  const result = await sendRequest(
    session,
    'tools/call',
    {
      name: toolName,
      arguments:
        args && typeof args === 'object' && !Array.isArray(args)
          ? args
          : { value: args },
      ...(progressToken
        ? {
            _meta: {
              progressToken,
            },
          }
        : {}),
    },
    DEFAULT_REQUEST_TIMEOUT_MS,
    {
      toolCallId,
      progressToken,
    },
  )

  return {
    serverName: serverConfig.name,
    toolName,
    ...(result && typeof result === 'object'
      ? result
      : { content: [{ type: 'text', text: String(result) }] }),
    isError: isMcpErrorResult(result),
  }
}

export function closeAllMcpSessions() {
  for (const session of mcpSessions.values()) {
    closeSession(session)
  }
}

export function setMcpEventSink(eventSink: ((event: McpEvent) => void) | null) {
  mcpEventSink = eventSink
}
