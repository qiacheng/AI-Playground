import { z } from 'zod'

export const McpServerConfigSchema = z.object({
  name: z.string().trim().min(1, 'Server name is required'),
  command: z.string().trim().min(1, 'Command is required'),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().trim().min(1).optional(),
  guidance: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
})

export const McpToolSchemaSchema = z
  .object({
    type: z.string().optional(),
  })
  .passthrough()

export const McpToolDefinitionSchema = z.object({
  serverName: z.string(),
  toolName: z.string(),
  qualifiedToolName: z.string(),
  description: z.string().optional(),
  inputSchema: McpToolSchemaSchema,
})

export const McpListToolsResultSchema = z.object({
  tools: z.array(McpToolDefinitionSchema),
  errors: z.array(z.string()).default([]),
})

export const McpToolCallResultSchema = z
  .object({
    serverName: z.string(),
    toolName: z.string(),
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough()

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpToolDefinition = z.infer<typeof McpToolDefinitionSchema>
export type McpListToolsResult = z.infer<typeof McpListToolsResultSchema>
export type McpToolCallResult = z.infer<typeof McpToolCallResultSchema>

export const McpEventSchema = z.object({
  type: z.enum(['progress', 'log', 'stderr']),
  serverName: z.string(),
  toolCallId: z.string().optional(),
  message: z.string().optional(),
  progress: z.number().optional(),
  total: z.number().optional(),
  timestamp: z.number(),
})

export type McpEvent = z.infer<typeof McpEventSchema>

export function normalizeMcpServerConfigs(value: unknown): McpServerConfig[] {
  return z.array(McpServerConfigSchema).parse(value)
}

export function qualifyMcpToolName(serverName: string, toolName: string): string {
  const normalizedServer = serverName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const normalizedTool = toolName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  const baseName = `${normalizedServer || 'mcp'}__${normalizedTool || 'tool'}`
  return baseName.slice(0, 64)
}
