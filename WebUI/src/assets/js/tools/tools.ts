import { type ToolSet, type UITools } from 'ai'
import { visualizeObjectDetections } from './visualizeObjectDetections'
import { comfyUI } from './comfyUi'
import { comfyUiImageEdit } from './comfyUiImageEdit'
import { useMcp } from '../store/mcp'

export const staticTools = {
  comfyUI,
  comfyUiImageEdit,
  visualizeObjectDetections,
} satisfies ToolSet

export async function getAvailableTools(): Promise<ToolSet> {
  const mcpTools = await useMcp().buildToolSet()
  return {
    ...staticTools,
    ...mcpTools,
  }
}

export type AipgTools = UITools
