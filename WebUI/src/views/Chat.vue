<template>
  <button
    v-if="showScrollButton"
    class="absolute bottom-65 left-1/2 transform -translate-x-1/2 bg-background text-foreground p-2 rounded-full shadow-lg z-50 hover:bg-muted transition-colors"
    @click="scrollToBottom()"
    title="Scroll to bottom"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>
  </button>
  <div
    v-if="
      (activeConversation && activeConversation.length > 0) ||
      openAiCompatibleChat.processing ||
      textInference.isPreparingBackend
    "
    id="chatPanel"
    ref="chatPanel"
    class="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-6 relative"
    @scroll="handleScroll"
  >
    <div
      class="absolute inset-0 flex justify-center items-center bg-background/30 z-10"
      v-if="textInference.isPreparingBackend"
    >
      <loading-bar :text="textInference.preparationMessage" class="w-512px"></loading-bar>
    </div>

    <!-- eslint-disable vue/require-v-for-key -->
    <div class="w-full max-w-4xl mx-auto flex flex-col gap-6">
      <template v-for="(message, i) in activeConversation">
        <!-- eslint-enable -->
        <div v-if="message.role === 'user'" class="flex items-start gap-3">
          <UserCircleIcon :class="textInference.iconSizeClass" class="text-foreground/90" />
          <div class="flex flex-col gap-3 max-w-4/5 bg-muted rounded-md px-4 py-3">
            <p class="text-muted-foreground" :class="textInference.nameSizeClass">
              {{ languages.ANSWER_USER_NAME }}
            </p>
            <img
              v-if="
                message.parts
                  .toReversed()
                  .find((part) => part.type === 'file' && part.mediaType?.startsWith('image/'))
              "
              :src="
                (
                  message.parts
                    .toReversed()
                    .find(
                      (part) => part.type === 'file' && part.mediaType?.startsWith('image/'),
                    ) as { url?: string }
                )?.url
              "
              alt="Generated Image"
            />
            <div
              :class="textInference.fontSizeClass"
              v-html="
                sanitizeMarkdown(
                  parse(message.parts.find((part) => part.type === 'text')?.text ?? '') as string,
                )
              "
            ></div>
            <button
              class="flex items-center gap-1 text-xs text-muted-foreground mt-1"
              :title="languages.COM_COPY"
              @click="copyText(message.parts.find((part) => part.type === 'text')?.text || '')"
            >
              <span class="svg-icon i-copy w-4 h-4"></span>
              <span>{{ languages.COM_COPY }}</span>
            </button>
          </div>
        </div>
        <div v-else-if="message.role === 'assistant'" class="flex items-start gap-3">
          <img :class="textInference.iconSizeClass" src="../assets/svg/ai-icon.svg" />
          <div class="flex flex-col gap-3 max-w-[90%] text-wrap wrap-break-word">
            <div class="flex items-center gap-2">
              <p class="text-muted-foreground mt-0.75" :class="textInference.nameSizeClass">
                {{ languages.ANSWER_AI_NAME }}
              </p>
              <div
                v-if="(message.metadata as { model?: string }).model"
                class="flex items-center gap-2"
              >
                <span
                  class="bg-secondary text-foreground font-sans rounded-md px-1 py-1"
                  :class="textInference.nameSizeClass"
                >
                  {{
                    message.metadata?.model?.endsWith('.gguf')
                      ? (message.metadata?.model?.split('/').at(-1)?.split('.gguf')[0] ??
                        message.metadata?.model)
                      : message.metadata?.model
                  }}
                </span>
                <!-- Display RAG source if available -->
                <span
                  v-if="
                    (message.metadata as { ragSource?: string })?.ragSource ||
                    ragSourcePerMessageId[message.id]
                  "
                  @click="
                    showRagSourcePerMessageId[message.id] = !showRagSourcePerMessageId[message.id]
                  "
                  class="bg-primary text-foreground font-sans rounded-md px-1 py-1 cursor-pointer"
                  :class="textInference.nameSizeClass"
                >
                  Source Docs
                  <button class="ml-1">
                    <img
                      v-if="showRagSourcePerMessageId[message.id]"
                      src="../assets/svg/arrow-up.svg"
                      class="w-3 h-3"
                    />
                    <img v-else src="../assets/svg/arrow-down.svg" class="w-3 h-3" />
                  </button>
                </span>
              </div>
            </div>

            <!-- RAG Source Details (collapsible) -->
            <div
              v-if="
                showRagSourcePerMessageId[message.id] &&
                (message.metadata?.ragSource || ragSourcePerMessageId[message.id])
              "
              class="my-2 text-muted-foreground border-l-2 border-primary pl-2 flex flex-row gap-1"
              :class="textInference.fontSizeClass"
            >
              <div class="font-bold">{{ i18nState.RAG_SOURCE }}:</div>
              <div class="whitespace-pre-wrap">
                {{ message.metadata?.ragSource || ragSourcePerMessageId[message.id] }}
              </div>
            </div>
            <div class="ai-answer chat-content" :class="textInference.fontSizeClass">
              <template v-if="message.parts.some((part) => part.type === 'reasoning')">
                <div class="mb-2 flex items-center">
                  <span class="italic text-muted-foreground">
                    {{
                      message.metadata?.reasoningFinished && message.metadata?.reasoningStarted
                        ? `Done Reasoning after ${((message.metadata.reasoningFinished - message.metadata.reasoningStarted) / 1000).toFixed(1)} seconds`
                        : `Reasoned for ${(
                            (Date.now() - (message.metadata?.reasoningStarted ?? 0)) /
                            1000
                          ).toFixed(1)} seconds`
                    }}
                  </span>
                  <button
                    @click="
                      showThinkingTextPerMessageId[message.id] =
                        !showThinkingTextPerMessageId[message.id]
                    "
                    class="ml-1"
                  >
                    <img
                      v-if="showThinkingTextPerMessageId[message.id]"
                      src="../assets/svg/arrow-up.svg"
                      class="w-4 h-4"
                    />
                    <img v-else src="../assets/svg/arrow-down.svg" class="w-4 h-4" />
                  </button>
                </div>
                <div
                  v-if="showThinkingTextPerMessageId[message.id]"
                  class="border-l-2 border-border pl-4 text-muted-foreground"
                  v-html="
                    sanitizeMarkdown(
                      parse(
                        message.parts.find((part) => part.type === 'reasoning')?.text ?? '',
                      ) as string,
                    )
                  "
                ></div>
              </template>
              <!-- Render tool parts before the final assistant text -->
              <template
                v-for="part in message.parts.filter(
                  (p) => p.type.startsWith('tool-') || p.type === 'dynamic-tool',
                )"
                :key="
                  part.type === 'tool-comfyUI'
                    ? `tool-${part.toolCallId}`
                    : part.type === 'tool-comfyUiImageEdit'
                      ? `tool-${part.toolCallId}`
                      : part.type === 'tool-visualizeObjectDetections'
                        ? `tool-${part.toolCallId}`
                        : part.type === 'dynamic-tool'
                          ? `dynamic-tool-${part.toolCallId}`
                          : undefined
                "
              >
                <template v-if="part.type === 'tool-comfyUI'">
                  <div class="mt-1 pt-1">
                    <span>Using tool {{ part.type.replace('tool-', '') }}</span>
                    <span
                      >Generating using the preset
                      <b>{{ getToolInputWorkflow(part) ?? 'unknown' }}</b></span
                    >
                    <br />
                    <br />
                    <span
                      ><em>{{ getToolInputPrompt(part) }}</em></span
                    >
                    <ChatWorkflowResult
                      :images="getToolImages(part)"
                      :processing="getToolProcessing(part)"
                      :currentState="getToolCurrentState(part)"
                      :stepText="getToolStepText(part)"
                      :toolCallId="(part as any).toolCallId"
                    />
                  </div>
                </template>
                <template v-else-if="part.type === 'tool-comfyUiImageEdit'">
                  <div class="mt-1 pt-1">
                    <span>Using tool {{ part.type.replace('tool-', '') }}</span>
                    <span
                      >Editing using the preset
                      <b>{{ getToolInputWorkflow(part) ?? 'unknown' }}</b></span
                    >
                    <br />
                    <br />
                    <span
                      ><em>{{ getToolInputPrompt(part) }}</em></span
                    >
                    <ChatWorkflowResult
                      :images="getToolImages(part)"
                      :processing="getToolProcessing(part)"
                      :currentState="getToolCurrentState(part)"
                      :stepText="getToolStepText(part)"
                      :toolCallId="(part as any).toolCallId"
                    />
                  </div>
                </template>
                <template v-else-if="part.type === 'tool-visualizeObjectDetections'">
                  <div class="mt-1 pt-1">
                    <span>Using tool {{ part.type.replace('tool-', '') }}</span>
                    <div
                      v-if="
                        part.state === 'output-available' && (part as any).output?.annotatedImageUrl
                      "
                    >
                      <img
                        :src="(part as any).output.annotatedImageUrl"
                        alt="Annotated image with object detections"
                        class="max-w-full rounded-md border-2 border-border"
                      />
                    </div>
                    <div
                      v-else-if="
                        part.state === 'input-streaming' || part.state === 'input-available'
                      "
                    >
                      <span class="text-muted-foreground">Visualizing object detections...</span>
                    </div>
                  </div>
                </template>
                <template v-else-if="part.type === 'dynamic-tool'">
                  <div class="mt-1 pt-1 rounded-md border border-border bg-muted/40 px-3 py-2">
                    <div class="flex items-center gap-2 text-sm">
                      <span class="font-medium">{{ getDynamicToolSummary(message, part) }}</span>
                      <span
                        v-if="getDynamicToolDurationLabel(part) !== null"
                        class="inline-flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span
                          v-if="part.state === 'input-streaming' || part.state === 'input-available'"
                          class="inline-block h-2 w-2 animate-pulse rounded-full bg-primary"
                        ></span>
                        <span>{{ getDynamicToolDurationLabel(part) }}</span>
                      </span>
                    </div>
                    <div
                      v-if="part.state === 'input-streaming' || part.state === 'input-available'"
                      class="text-sm text-muted-foreground mt-1"
                    >
                      Executing MCP tool...
                    </div>
                    <div
                      v-if="getDynamicToolProgressLabel(part.toolCallId)"
                      class="mt-1 text-xs text-muted-foreground"
                    >
                      {{ getDynamicToolProgressLabel(part.toolCallId) }}
                    </div>
                    <div v-if="part.state === 'output-error'" class="text-sm text-destructive mt-1">
                      {{ getDynamicToolVisibleSummary(part) }}
                    </div>
                    <pre
                      v-else-if="part.state === 'output-available'"
                      class="mt-2 whitespace-pre-wrap break-words text-xs"
                      >{{ getDynamicToolVisibleSummary(part) }}</pre
                    >
                    <details class="mt-2 text-xs" v-if="shouldShowDynamicToolDetails(part)">
                      <summary class="cursor-pointer text-muted-foreground">Toggle content</summary>
                      <div class="mt-2 rounded border border-border/60 bg-background/60 px-2 py-2">
                        <div class="font-medium text-muted-foreground">Arguments:</div>
                        <pre class="mt-1 whitespace-pre-wrap break-words">{{
                          formatJsonBlock(part.input)
                        }}</pre>
                        <div
                          v-if="
                            part.state === 'output-available' ||
                            part.state === 'output-error'
                          "
                          class="mt-2 font-medium text-muted-foreground"
                        >
                          Result:
                        </div>
                        <pre
                          v-if="part.state === 'output-available'"
                          class="mt-1 whitespace-pre-wrap break-words"
                          >{{ formatJsonBlock(part.output) }}</pre
                        >
                        <pre
                          v-else-if="part.state === 'output-error'"
                          class="mt-1 whitespace-pre-wrap break-words text-destructive"
                          >{{ part.errorText }}</pre
                        >
                      </div>
                    </details>
                  </div>
                </template>
              </template>
              <div
                v-if="message.parts.find((part) => part.type === 'text')?.text"
                v-html="
                  sanitizeMarkdown(
                    parse(message.parts.find((part) => part.type === 'text')?.text ?? '') as string,
                  )
                "
              ></div>
            </div>
            <div class="answer-tools flex gap-3 items-center text-muted-foreground">
              <button
                class="flex items-end"
                :title="languages.COM_COPY"
                @click="copyText(message.parts.find((part) => part.type === 'text')?.text || '')"
              >
                <span class="svg-icon i-copy w-4 h-4"></span>
                <span class="text-xs ml-1">{{ languages.COM_COPY }}</span>
              </button>
              <button
                class="flex items-end"
                :title="languages.COM_REGENERATE"
                @click="() => openAiCompatibleChat.regenerate(message.id)"
                v-if="i + 1 == activeConversation.length"
                :disabled="openAiCompatibleChat.processing"
                :class="{ 'opacity-50 cursor-not-allowed': openAiCompatibleChat.processing }"
              >
                <span class="svg-icon i-refresh w-4 h-4"></span>
                <span class="text-xs ml-1">{{ languages.COM_REGENERATE }}</span>
              </button>
              <button
                class="flex items-end"
                :title="languages.COM_DELETE"
                @click="
                  () => {
                    openAiCompatibleChat.removeMessage(message.id)
                  }
                "
              >
                <span class="svg-icon i-delete w-4 h-4"></span>
                <span class="text-xs ml-1">{{ languages.COM_DELETE }}</span>
              </button>
            </div>
            <div
              v-if="textInference.metricsEnabled && message.metadata?.timings"
              class="metrics-info text-xs text-muted-foreground"
            >
              <span class="mr-2">{{ message.metadata?.timings.predicted_n }} Tokens</span>
              <span class="mr-2">⋅</span>
              <span class="mr-2"
                >{{ message.metadata?.timings.predicted_per_second.toFixed(2) }} Tokens/s</span
              >
              <span class="mr-2">⋅</span>
              <span class="mr-2"
                >1st Token Time: {{ message.metadata?.timings.prompt_ms.toFixed(2) }}ms</span
              >
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as toast from '@/assets/js/toast.ts'
import { useI18N } from '@/assets/js/store/i18n.ts'
import { useTextInference } from '@/assets/js/store/textInference.ts'
import { parse } from '@/assets/js/markdownParser.ts'
import { sanitizeMarkdown } from '@/lib/sanitize'
import LoadingBar from '@/components/LoadingBar.vue'
import { usePromptStore } from '@/assets/js/store/promptArea.ts'
import { AipgUiMessage, useOpenAiCompatibleChat } from '@/assets/js/store/openAiCompatibleChat'
import ChatWorkflowResult from '@/components/ChatWorkflowResult.vue'
import {
  useImageGenerationPresets,
  type MediaItem,
  type GenerateState,
} from '@/assets/js/store/imageGenerationPresets'
import { useComfyUiPresets } from '@/assets/js/store/comfyUiPresets'
import { DynamicToolUIPart, ToolUIPart } from 'ai'
import { AipgTools } from '@/assets/js/tools/tools'
import { base64ToString } from 'uint8array-extras'
import { UserCircleIcon } from '@heroicons/vue/24/outline'

const openAiCompatibleChat = useOpenAiCompatibleChat()
const textInference = useTextInference()
const promptStore = usePromptStore()
const imageGeneration = useImageGenerationPresets()
const comfyUi = useComfyUiPresets()

const i18nState = useI18N().state
const languages = i18nState
const autoScrollEnabled = ref(true)
const showScrollButton = ref(false)
const chatPanel = ref<HTMLElement | null>(null)
const currentTime = ref(Date.now())

const activeConversation = computed(() => openAiCompatibleChat.messages)
const showThinkingTextPerMessageId = reactive<Record<string, boolean>>({})
const showRagSourcePerMessageId = reactive<Record<string, boolean>>({})
const dynamicToolStartedAt = reactive<Record<string, number>>({})
const dynamicToolFinishedAt = reactive<Record<string, number>>({})
const dynamicToolProgress = reactive<Record<string, { progress?: number; total?: number }>>({})
let currentTimeInterval: number | null = null

const ragSourcePerMessageId = reactive<Record<string, string>>({})

// Track progress for active tool calls
const toolProgressMap = reactive<
  Record<
    string,
    {
      processing: boolean
      currentState?: GenerateState
      stepText?: string
      images: MediaItem[]
      initialImageIds: Set<string> // Track which image IDs existed when tool call started
    }
  >
>({})

defineExpose({
  scrollToBottom,
})

onMounted(() => {
  promptStore.registerSubmitCallback('chat', handlePromptSubmit)
  promptStore.registerCancelCallback('chat', handleCancel)
  window.electronAPI.onMcpEvent((event) => {
    if (!event.toolCallId) return

    if (event.type === 'progress') {
      dynamicToolProgress[event.toolCallId] = {
        progress: event.progress,
        total: event.total,
      }
    }
  })

  currentTimeInterval = window.setInterval(() => {
    currentTime.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  promptStore.unregisterSubmitCallback('chat')
  promptStore.unregisterCancelCallback('chat')
  if (currentTimeInterval !== null) {
    window.clearInterval(currentTimeInterval)
  }
})

watch(
  () => openAiCompatibleChat.messages,
  (messages) => {
    // Initialize RAG source display state from message metadata
    if (messages) {
      messages.forEach((message) => {
        const ragSource = (message.metadata as { ragSource?: string })?.ragSource
        if (ragSource && !ragSourcePerMessageId[message.id]) {
          ragSourcePerMessageId[message.id] = ragSource
          // Default to collapsed state
          showRagSourcePerMessageId[message.id] = false
        }
      })
    }

    if (autoScrollEnabled.value) {
      nextTick(() => scrollToBottom())
    }
    nextTick(() => {
      if (chatPanel.value) {
        chatPanel.value.querySelectorAll('.copy-code').forEach((item) => {
          const el = item as HTMLElement
          el.classList.remove('hidden')
          el.removeEventListener('click', copyCode)
          el.addEventListener('click', copyCode)
        })
      }
    })
  },
  { deep: true, immediate: true },
)

async function handlePromptSubmit(prompt: string) {
  const question = prompt.trim()
  if (question == '') {
    toast.error(useI18N().state.ANSWER_ERROR_NOT_PROMPT)
    promptStore.promptSubmitted = false
    return
  }
  try {
    nextTick(scrollToBottom)
    await openAiCompatibleChat.generate(question)
  } catch (error) {
    // Reset state on any error (including download cancellation)
    promptStore.promptSubmitted = false
    console.error('Error during text inference:', error)
  }
}

function handleCancel() {
  // Fire off stop requests without awaiting to immediately unblock UI
  if (openAiCompatibleChat.processing) {
    openAiCompatibleChat.stop()
  }
  // Also cancel any ongoing ComfyUI inference from tool calls
  comfyUi.stop()

  // Immediately reset prompt state to unblock UI
  promptStore.promptSubmitted = false
}

function handleScroll(e: Event) {
  const target = e.target as HTMLElement
  const distanceFromBottom = target.scrollHeight - (target.scrollTop + target.clientHeight)

  autoScrollEnabled.value = distanceFromBottom <= 35
  showScrollButton.value = distanceFromBottom > 60
}

function scrollToBottom(smooth = true) {
  if (chatPanel.value) {
    chatPanel.value.scrollTo({
      top: chatPanel.value.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    })
  }
}

function copyCode(e: MouseEvent) {
  if (!(e.target instanceof HTMLElement)) return
  if (!e.target?.dataset?.code) return
  copyText(base64ToString(e.target?.dataset?.code))
}

function copyText(text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      toast.success(i18nState.COM_COPY_SUCCESS_TIP)
    })
    .catch((e) => console.error('Error while copying text to clipboard', e))
}

// Helper functions for tool rendering
function getToolImages(part: ToolUIPart<AipgTools>): MediaItem[] {
  if (!(part.type === 'tool-comfyUI' || part.type === 'tool-comfyUiImageEdit')) return []
  const toolCallId = part.toolCallId
  const progress = toolProgressMap[toolCallId]

  // If we have progress tracking with images, use those
  if (progress && progress.images.length > 0) {
    return progress.images
  }

  // Otherwise, use output images if available
  if (part.state === 'output-available') {
    if (!part.output) return []
    const output = part.output as { images?: MediaItem[] }
    return (output.images ?? []).map((img) => ({ ...img, state: 'done' as const }))
  }

  return []
}

function getToolProcessing(part: ToolUIPart<AipgTools>): boolean {
  const toolCallId = part.toolCallId
  const progress = toolProgressMap[toolCallId]

  // If we have progress tracking, use that
  if (progress) {
    return progress.processing
  }

  // Otherwise, check part state
  return part.state === 'input-streaming' || part.state === 'input-available'
}

function getToolCurrentState(part: ToolUIPart<AipgTools>): GenerateState | undefined {
  const toolCallId = part.toolCallId
  const progress = toolProgressMap[toolCallId]

  if (progress && progress.currentState) {
    return progress.currentState as GenerateState
  }

  return undefined
}

function getToolStepText(part: ToolUIPart<AipgTools>): string | undefined {
  const toolCallId = part.toolCallId
  const progress = toolProgressMap[toolCallId]

  if (progress && progress.stepText) {
    return progress.stepText
  }

  return undefined
}

function getToolInputWorkflow(part: ToolUIPart<AipgTools>) {
  const input = part.input as { workflow?: string } | undefined
  return input?.workflow
}

function getToolInputPrompt(part: ToolUIPart<AipgTools>) {
  const input = part.input as { prompt?: string } | undefined
  return input?.prompt ?? ''
}

function formatDynamicToolOutput(output: DynamicToolUIPart['output']) {
  if (typeof output === 'string') return output

  if (output && typeof output === 'object') {
    const mcpOutput = output as {
      content?: Array<{ type?: string; text?: string }>
      structuredContent?: { content?: string }
    }

    const textBlocks =
      mcpOutput.content
        ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text!.trim())
        .filter((text) => text.length > 0) ?? []

    if (textBlocks.length > 0) {
      return textBlocks.join('\n\n')
    }

    if (typeof mcpOutput.structuredContent?.content === 'string') {
      return mcpOutput.structuredContent.content
    }
  }

  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function getDynamicToolVisibleSummary(part: DynamicToolUIPart) {
  if (part.state === 'output-error') {
    return summarizeDynamicToolReason(part.errorText) ?? 'Tool execution failed.'
  }

  if (part.state === 'output-available') {
    const output = part.output
    if (output && typeof output === 'object') {
      const mcpOutput = output as {
        structuredContent?: { status?: string; message?: string; result?: unknown }
      }

      if (mcpOutput.structuredContent?.status?.toLowerCase() === 'error') {
        return (
          summarizeDynamicToolReason(mcpOutput.structuredContent.message ?? '') ??
          'Tool execution failed.'
        )
      }

      if (mcpOutput.structuredContent?.status?.toLowerCase() === 'ok') {
        const resultSummary = summarizeToolResultObject(mcpOutput.structuredContent.result)
        return resultSummary ?? 'Completed successfully.'
      }
    }

    const summarized = summarizeDynamicToolReason(formatDynamicToolOutput(output))
    return summarized ?? 'Completed successfully.'
  }

  return 'Executing MCP tool...'
}

function formatJsonBlock(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getDynamicToolDurationLabel(part: DynamicToolUIPart) {
  const toolCallId = part.toolCallId
  const startedAt = dynamicToolStartedAt[toolCallId]
  const isRunning = part.state === 'input-streaming' || part.state === 'input-available'
  if (!startedAt) {
    return isRunning ? 'Running' : null
  }

  const finishedAt = isRunning ? currentTime.value : (dynamicToolFinishedAt[toolCallId] ?? currentTime.value)
  const elapsedSeconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000))
  if (!isRunning && elapsedSeconds === 0) {
    return null
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`
  }

  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `${minutes}m ${seconds}s`
}

function getDynamicToolProgressLabel(toolCallId: string) {
  const progress = dynamicToolProgress[toolCallId]
  if (!progress) return null
  if (typeof progress.progress !== 'number') return null
  if (typeof progress.total === 'number' && progress.total > 0) {
    const percent = Math.max(0, Math.min(100, (progress.progress / progress.total) * 100))
    return `${percent.toFixed(0)}% (${progress.progress}/${progress.total})`
  }
  return `${progress.progress}`
}

function getDynamicToolSummary(message: AipgUiMessage, part: DynamicToolUIPart) {
  const dynamicParts = message.parts.filter(
    (item): item is DynamicToolUIPart => item.type === 'dynamic-tool',
  )
  const currentIndex = dynamicParts.findIndex((item) => item.toolCallId === part.toolCallId)
  const attempt = currentIndex + 1

  if (attempt <= 1) {
    const reason = getDynamicToolRetryReason(part)
    if (part.state === 'output-error' && reason) {
      return `Attempt 1 failed: ${reason}`
    }
    if (part.state === 'output-available') {
      return 'Attempt 1 succeeded'
    }
    return 'Attempt 1'
  }

  const previousMatchingPart = [...dynamicParts.slice(0, currentIndex)]
    .reverse()
    .find((item) => item.toolName === part.toolName)

  const retryReason = previousMatchingPart ? getDynamicToolRetryReason(previousMatchingPart) : null
  return retryReason ? `Retry ${attempt} after ${retryReason}` : `Retry ${attempt}`
}

function getDynamicToolRetryReason(part: DynamicToolUIPart) {
  const errorText =
    part.state === 'output-error'
      ? part.errorText
      : part.state === 'output-available'
        ? formatDynamicToolOutput(part.output)
        : ''

  return summarizeDynamicToolReason(errorText)
}

function summarizeDynamicToolReason(text: string) {
  if (!text) return null

  const normalized = text.replace(/\s+/g, ' ').trim()
  const keywordMatch = normalized.match(/keyword\s+"([^"]+)"\s+unrecognized/i)
  if (keywordMatch?.[1]) {
    return `keyword "${keywordMatch[1]}" unrecognized`
  }

  const typeErrorMatch = normalized.match(/TypeError:\s*(.+?)(?:Traceback|$)/i)
  if (typeErrorMatch?.[1]) {
    return typeErrorMatch[1].trim()
  }

  const attributeErrorMatch = normalized.match(/AttributeError:\s*(.+?)(?:Traceback|$)/i)
  if (attributeErrorMatch?.[1]) {
    return attributeErrorMatch[1].trim()
  }

  const messageMatch = normalized.match(/"message"\s*:\s*"(.+?)"/)
  if (messageMatch?.[1]) {
    return messageMatch[1].trim()
  }

  if (normalized.length <= 96) {
    return normalized
  }

  return `${normalized.slice(0, 93).trim()}...`
}

function summarizeToolResultObject(result: unknown) {
  if (!result || typeof result !== 'object') {
    return null
  }

  const data = result as Record<string, unknown>
  const status = typeof data.status === 'string' ? data.status : null
  const objectName = typeof data.object_name === 'string' ? data.object_name : null
  const message = typeof data.message === 'string' ? data.message : null

  if (status === 'success' && objectName) {
    return `Created "${objectName}".`
  }

  if (message) {
    return summarizeDynamicToolReason(message) ?? message
  }

  const scalarEntries = Object.entries(data)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 3)

  if (scalarEntries.length === 0) {
    return null
  }

  return scalarEntries.map(([key, value]) => `${key}: ${String(value)}`).join(', ')
}

function shouldShowDynamicToolDetails(part: DynamicToolUIPart) {
  return part.state === 'output-error' || part.state === 'output-available'
}

function isComfyToolPart(
  part: ToolUIPart<AipgTools> | DynamicToolUIPart | AipgUiMessage['parts'][number],
): part is ToolUIPart<AipgTools> {
  return part.type === 'tool-comfyUI' || part.type === 'tool-comfyUiImageEdit'
}

// Watch for new tool calls starting to initialize their image tracking
watch(
  () => activeConversation.value,
  (messages) => {
    if (!messages) return

    // Find tool calls that just started (input-streaming or input-available)
    messages.forEach((msg) => {
      msg.parts.forEach((part) => {
        if (part.type === 'dynamic-tool' && !dynamicToolStartedAt[part.toolCallId]) {
          dynamicToolStartedAt[part.toolCallId] = Date.now()
        }

        if (part.type === 'dynamic-tool' && part.state === 'output-available') {
          dynamicToolFinishedAt[part.toolCallId] ??= Date.now()
          delete dynamicToolProgress[part.toolCallId]
        }

        if (part.type === 'dynamic-tool' && part.state === 'output-error') {
          dynamicToolFinishedAt[part.toolCallId] ??= Date.now()
          delete dynamicToolProgress[part.toolCallId]
        }

        if (isComfyToolPart(part)) {
          const toolCallId = part.toolCallId
          const state = part.state

          // If this tool call just started and we haven't initialized it yet
          if (
            (state === 'input-streaming' || state === 'input-available') &&
            !toolProgressMap[toolCallId]
          ) {
            // Record the current set of image IDs to exclude them from this tool call's images
            const currentImageIds = new Set(imageGeneration.generatedImages.map((img) => img.id))
            toolProgressMap[toolCallId] = {
              processing: true,
              images: [],
              initialImageIds: currentImageIds,
            }
          }
        }
      })
    })
  },
  { deep: true },
)

// Watch imageGeneration store to track progress for active tool calls
watch(
  () => [
    imageGeneration.generatedImages,
    imageGeneration.processing,
    imageGeneration.currentState,
    imageGeneration.stepText,
  ],
  () => {
    // Find active tool calls that are processing
    const activeToolParts =
      activeConversation.value
        ?.flatMap((msg) => msg.parts)
        .filter(isComfyToolPart)
        .filter((part) => part.state === 'input-streaming' || part.state === 'input-available')
        .map((part) => ({
          toolCallId: part.toolCallId,
          part,
        })) || []

    // Update progress for each active tool call
    activeToolParts.forEach(({ toolCallId }) => {
      const progress = toolProgressMap[toolCallId]
      if (!progress) return

      // Only get images that were created for this tool call (not in initial set)
      const toolCallImages = imageGeneration.generatedImages
        .filter((img) => !progress.initialImageIds.has(img.id))
        .filter(
          (img) => img.state === 'queued' || img.state === 'generating' || img.state === 'done',
        )
        // Filter out items without valid URL based on type
        .filter((img) => {
          if (img.type === 'image') return img.imageUrl && img.imageUrl.trim() !== ''
          if (img.type === 'video') return img.videoUrl && img.videoUrl.trim() !== ''
          if (img.type === 'model3d') return img.model3dUrl && img.model3dUrl.trim() !== ''
          return false
        })
        .map((img) => ({ ...img }))

      progress.images = toolCallImages
      progress.processing = imageGeneration.processing
      progress.currentState = imageGeneration.currentState
      progress.stepText = imageGeneration.stepText
    })
  },
  { deep: true },
)

// Also watch processing state
watch(
  () => imageGeneration.processing,
  (processing) => {
    // Get the set of currently active tool call IDs (input-streaming or input-available)
    const activeToolCallIds = new Set(
      activeConversation.value
        ?.flatMap((msg) => msg.parts)
        .filter(isComfyToolPart)
        .filter((part) => part.state === 'input-streaming' || part.state === 'input-available')
        .map((part) => part.toolCallId) || [],
    )

    Object.keys(toolProgressMap).forEach((toolCallId) => {
      const progress = toolProgressMap[toolCallId]
      if (!progress) return

      if (processing) {
        // When processing starts, only set processing=true for active tool calls
        // This prevents completed tool calls from showing the progress indicator again
        if (activeToolCallIds.has(toolCallId)) {
          progress.processing = true
        }
      } else {
        // When processing stops, update any tool call that was processing
        // (it may no longer be "active" since its state changed to output-available)
        if (progress.processing) {
          progress.processing = false
          // Mark images as done and filter out any without valid URL
          progress.images = progress.images
            .filter((img) => {
              if (img.type === 'image') return img.imageUrl && img.imageUrl.trim() !== ''
              if (img.type === 'video') return img.videoUrl && img.videoUrl.trim() !== ''
              if (img.type === 'model3d') return img.model3dUrl && img.model3dUrl.trim() !== ''
              return false
            })
            .map((img) => ({
              ...img,
              state: 'done' as const,
            }))
        }
      }
    })
  },
)
</script>

<style>
.shiki {
  padding-left: 0.5rem;
  border-bottom-left-radius: calc(var(--radius) - 2px);
  border-bottom-right-radius: calc(var(--radius) - 2px);
}
</style>
