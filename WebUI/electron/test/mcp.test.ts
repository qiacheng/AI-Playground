import { describe, expect, it } from 'vitest'
import {
  McpServerConfigSchema,
  normalizeMcpServerConfigs,
  qualifyMcpToolName,
} from '@/types/mcp'

describe('mcp shared helpers', () => {
  it('normalizes valid server configs', () => {
    expect(
      normalizeMcpServerConfigs([
        {
          name: 'Filesystem Server',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
          enabled: true,
        },
      ]),
    ).toEqual([
      {
        name: 'Filesystem Server',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        env: {},
        enabled: true,
      },
    ])
  })

  it('rejects empty command values', () => {
    expect(() =>
      McpServerConfigSchema.parse({
        name: 'broken',
        command: '   ',
      }),
    ).toThrow()
  })

  it('qualifies tool names with a normalized server prefix', () => {
    expect(qualifyMcpToolName('Filesystem Server', 'read_file')).toBe(
      'filesystem-server__read_file',
    )
  })
})
