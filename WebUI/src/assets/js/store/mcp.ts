import { acceptHMRUpdate, defineStore } from 'pinia'
import {
  dynamicTool,
  jsonSchema,
  type JSONSchema7,
  type ToolResultOutput,
  type ToolSet,
} from 'ai'
import {
  McpListToolsResultSchema,
  McpServerConfigSchema,
  type McpToolDefinition,
} from '@/types/mcp'
import * as toast from '../toast'

const DEFAULT_SERVER_CONFIG_TEXT = `[
  {
    "name": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
    "guidance": "Use for listing, reading, and searching files and directories in the allowed workspace.",
    "enabled": false
  }
]`

function formatMcpError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatMcpToolResultForModel(output: unknown): ToolResultOutput {
  if (!output || typeof output !== 'object') {
    return {
      type: 'text',
      value: String(output),
    }
  }

  const data = output as {
    serverName?: string
    toolName?: string
    structuredContent?: { status?: string; message?: string; result?: unknown; content?: string }
    content?: Array<{ type?: string; text?: string }>
    isError?: boolean
  }

  if (data.structuredContent?.status?.toLowerCase() === 'error') {
    return {
      type: 'text',
      value: [
        `Tool ${data.toolName ?? 'unknown'} failed.`,
        data.structuredContent.message ?? 'Unknown MCP tool error.',
      ].join('\n'),
    }
  }

  const textParts =
    data.content
      ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text!.trim())
      .filter((text) => text.length > 0) ?? []

  if (textParts.length > 0) {
    return {
      type: 'text',
      value: textParts.join('\n\n'),
    }
  }

  if (data.structuredContent?.content && typeof data.structuredContent.content === 'string') {
    return {
      type: 'text',
      value: data.structuredContent.content,
    }
  }

  if (data.structuredContent?.result !== undefined) {
    return {
      type: 'text',
      value: JSON.stringify(data.structuredContent.result, null, 2),
    }
  }

  return {
    type: 'text',
    value: JSON.stringify(output, null, 2),
  }
}

export const useMcp = defineStore(
  'mcp',
  () => {
    const serverConfigsText = ref(DEFAULT_SERVER_CONFIG_TEXT)
    const discoveredTools = ref<McpToolDefinition[]>([])
    const loading = ref(false)
    const lastRefreshError = ref<string | null>(null)

    const parsedServerConfigs = computed(() => {
      try {
        return McpServerConfigSchema.array().parse(JSON.parse(serverConfigsText.value))
      } catch {
        return null
      }
    })

    const parseError = computed(() => {
      try {
        McpServerConfigSchema.array().parse(JSON.parse(serverConfigsText.value))
        return null
      } catch (error) {
        return formatMcpError(error)
      }
    })

    const enabledServerConfigs = computed(() => {
      return (parsedServerConfigs.value ?? []).filter((config) => config.enabled)
    })

    async function refreshTools(options?: { silent?: boolean }) {
      if (parseError.value) {
        discoveredTools.value = []
        lastRefreshError.value = parseError.value
        if (!options?.silent) {
          toast.error(`Invalid MCP config: ${parseError.value}`)
        }
        return []
      }

      const serverConfigs = enabledServerConfigs.value
      if (serverConfigs.length === 0) {
        discoveredTools.value = []
        lastRefreshError.value = null
        return []
      }

      loading.value = true
      try {
        const result = McpListToolsResultSchema.parse(
          await window.electronAPI.mcpListTools(serverConfigs),
        )
        discoveredTools.value = result.tools
        lastRefreshError.value = result.errors.length > 0 ? result.errors.join('\n') : null

        if (result.errors.length > 0 && !options?.silent) {
          toast.error(result.errors.join('\n'))
        }

        return result.tools
      } catch (error) {
        const message = formatMcpError(error)
        discoveredTools.value = []
        lastRefreshError.value = message
        if (!options?.silent) {
          toast.error(`Failed to refresh MCP tools: ${message}`)
        }
        return []
      } finally {
        loading.value = false
      }
    }

    function getServerConfigForTool(toolDefinition: McpToolDefinition) {
      return enabledServerConfigs.value.find((config) => config.name === toolDefinition.serverName)
    }

    async function buildToolSet(): Promise<ToolSet> {
      const tools =
        discoveredTools.value.length > 0
          ? discoveredTools.value
          : await refreshTools({ silent: true })
      const toolSet: ToolSet = {}

      for (const toolDefinition of tools) {
        const serverConfig = getServerConfigForTool(toolDefinition)
        if (!serverConfig) continue

        toolSet[toolDefinition.qualifiedToolName] = dynamicTool({
          description:
            toolDefinition.description ||
            `MCP tool "${toolDefinition.toolName}" from server "${toolDefinition.serverName}"`,
          inputSchema: jsonSchema(toolDefinition.inputSchema as JSONSchema7),
          execute: async (input, options) =>
            window.electronAPI.mcpCallTool(
              serverConfig,
              toolDefinition.toolName,
              input,
              options.toolCallId,
            ),
          toModelOutput: ({ output }) => formatMcpToolResultForModel(output),
        }) as ToolSet[string]
      }

      return toolSet
    }

    function getSuggestedActiveToolNames(prompt: string): string[] | null {
      const normalizedPrompt = prompt.toLowerCase()
      const scoredServers = enabledServerConfigs.value
        .map((serverConfig) => {
          const serverName = serverConfig.name.toLowerCase()
          const guidance = serverConfig.guidance?.toLowerCase() ?? ''
          let score = 0

          const blenderPrompt =
            /\b(blender|mesh|3d|model|sphere|ball|cube|scene|object|render|material)\b/.test(
              normalizedPrompt,
            )
          const filesystemPrompt =
            /\b(file|folder|directory|read|write|edit|list|search|path)\b/.test(normalizedPrompt)

          if (blenderPrompt && (serverName.includes('blender') || guidance.includes('blender'))) {
            score += 10
          }
          if (
            filesystemPrompt &&
            (serverName.includes('filesystem') ||
              guidance.includes('file') ||
              guidance.includes('directory'))
          ) {
            score += 10
          }

          for (const word of normalizedPrompt.split(/\W+/).filter(Boolean)) {
            if (word.length < 3) continue
            if (serverName.includes(word)) score += 3
            if (guidance.includes(word)) score += 2
          }

          return {
            serverName: serverConfig.name,
            score,
          }
        })
        .filter((server) => server.score > 0)
        .sort((a, b) => b.score - a.score)

      if (scoredServers.length === 0) {
        return null
      }

      const highestScore = scoredServers[0]?.score ?? 0
      const selectedServerNames = new Set(
        scoredServers
          .filter((server) => server.score >= highestScore - 2)
          .slice(0, 3)
          .map((server) => server.serverName),
      )

      return discoveredTools.value
        .filter((tool) => selectedServerNames.has(tool.serverName))
        .map((tool) => tool.qualifiedToolName)
    }

    function shouldRequireToolForPrompt(prompt: string): boolean {
      const normalizedPrompt = prompt.toLowerCase()
      return /\b(blender|mesh|3d|model|sphere|ball|cube|scene|object|render|material)\b/.test(
        normalizedPrompt,
      )
    }

    return {
      serverConfigsText,
      parsedServerConfigs,
      parseError,
      enabledServerConfigs,
      discoveredTools,
      loading,
      lastRefreshError,
      refreshTools,
      buildToolSet,
      getSuggestedActiveToolNames,
      shouldRequireToolForPrompt,
    }
  },
  {
    persist: {
      pick: ['serverConfigsText'],
    },
  },
)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMcp, import.meta.hot))
}
