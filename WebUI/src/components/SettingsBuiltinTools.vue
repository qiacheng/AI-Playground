<template>
  <div class="flex flex-col gap-3 border border-border rounded-md p-3 mr-4">
    <div v-for="builtinTool in builtinTools" :key="builtinTool.name" class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col">
          <Label class="whitespace-nowrap">{{ builtinTool.label }}</Label>
          <span class="text-xs text-muted-foreground">{{ builtinTool.description }}</span>
        </div>
        <Checkbox
          :id="`builtin-tool-${builtinTool.name}`"
          :disabled="!textInference.aipgToolsEnabled"
          :model-value="textInference.isBuiltinToolEnabled(builtinTool.name)"
          @click="toggle(builtinTool.name)"
        />
      </div>

      <!-- Screenshot tool: bind to a single window -->
      <div v-if="builtinTool.name === 'captureScreenshot'" class="flex flex-col gap-1.5 pl-1 pt-1">
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground">Window:</span>
          <span class="text-xs text-foreground truncate max-w-[220px]" :title="boundWindowName">
            {{ boundWindowName }}
          </span>
          <Button
            variant="secondary"
            size="sm"
            class="px-2 py-1 rounded text-xs"
            :disabled="!textInference.aipgToolsEnabled"
            @click="showWindowDialog = true"
          >
            {{ textInference.screenshotWindow ? 'Change window…' : 'Select window…' }}
          </Button>
        </div>
        <p
          v-if="textInference.isBuiltinToolEnabled('captureScreenshot') && !modelSupportsVision"
          class="text-xs text-amber-600 dark:text-amber-300"
        >
          The selected model does not support vision, so the assistant cannot use screenshots.
          Choose a vision-capable model to enable this tool.
        </p>
      </div>

      <div
        v-if="builtinTool.name === 'synthesizeTextToSpeech' && qwen3Tts.isFeatureEnabled"
        class="flex flex-col gap-2 pl-1 pt-1"
      >
        <p
          v-if="!qwen3BackendSetUp"
          class="text-xs text-amber-600 dark:text-amber-300"
        >
          Install the Qwen3 TTS backend from Installation Management to enable speech synthesis.
        </p>
        <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <Label class="text-xs">Default speaker</Label>
            <select
              v-model="qwen3Tts.defaultSpeaker"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs"
              :disabled="!textInference.aipgToolsEnabled"
            >
              <option v-for="sp in QWEN3_TTS_SPEAKERS" :key="sp.id" :value="sp.id">
                {{ sp.id }} — {{ sp.nativeLanguage }}
              </option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <Label class="text-xs">Default language</Label>
            <select
              v-model="qwen3Tts.defaultLanguage"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs"
              :disabled="!textInference.aipgToolsEnabled"
            >
              <option v-for="lang in QWEN3_TTS_LANGUAGES" :key="lang" :value="lang">
                {{ lang }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <ScreenshotWindowDialog v-model:open="showWindowDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import ScreenshotWindowDialog from '@/components/ScreenshotWindowDialog.vue'
import { useTextInference } from '@/assets/js/store/textInference'
import { useQwen3Tts } from '@/assets/js/store/qwen3Tts'
import { useBackendServices } from '@/assets/js/store/backendServices'
import { QWEN3_TTS_LANGUAGES, QWEN3_TTS_SPEAKERS } from '@/assets/js/qwen3TtsConstants'

const textInference = useTextInference()
const qwen3Tts = useQwen3Tts()
const backendServices = useBackendServices()
const showWindowDialog = ref(false)

// User-facing descriptors for the built-in (internal) tools. Keys must match the
// tool names registered in `aipgTools`.
const builtinTools: Array<{ name: string; label: string; description: string }> = [
  {
    name: 'comfyUI',
    label: 'Generate media',
    description: 'Create images, videos, or 3D models from text prompts.',
  },
  {
    name: 'comfyUiImageEdit',
    label: 'Edit images',
    description: 'Edit, upscale, colorize, or transform existing images.',
  },
  {
    name: 'visualizeObjectDetections',
    label: 'Visualize detections',
    description: 'Draw bounding boxes and labels on a detected image.',
  },
  {
    name: 'captureScreenshot',
    label: 'Capture screenshot',
    description:
      'Let the assistant capture a single user-selected window to visually debug other apps.',
  },
  {
    name: 'browseWeb',
    label: 'Browse the web',
    description:
      'Let the assistant search the web, open pages in a background browser to read their ' +
      'content, and (on vision models) capture a screenshot of a page.',
  },
  {
    name: 'synthesizeTextToSpeech',
    label: 'Synthesize speech (Qwen3 TTS)',
    description:
      'Let the assistant turn scripts into WAV audio using Qwen3-TTS voices and languages.',
  },
]

const modelSupportsVision = computed(() => textInference.modelSupportsVision)

const qwen3BackendSetUp = computed(
  () =>
    backendServices.info.find((s) => s.serviceName === 'qwen3-tts-backend')?.isSetUp === true,
)

const boundWindowName = computed(() => textInference.screenshotWindow?.name ?? 'None selected')

function toggle(toolName: string) {
  if (!textInference.aipgToolsEnabled) return
  textInference.setBuiltinToolEnabled(toolName, !textInference.isBuiltinToolEnabled(toolName))
}
</script>
