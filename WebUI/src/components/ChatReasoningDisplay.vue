<script setup lang="ts">
import MarkdownRenderer from '@/components/MarkdownRenderer.vue'
import { stripContextTruncationMarker } from '@/lib/utils'

const displayText = computed(() => stripContextTruncationMarker(props.text ?? ''))

const props = defineProps<{
  text?: string
  startedAt?: number
  finishedAt?: number
  streaming?: boolean
  /** Tool-loop turns: collapsed header only; full text on expand (never auto-stream open). */
  toolLoopMode?: boolean
  liveStartedAt?: number
  onCopy?: (text: string) => void
}>()

const isExpanded = ref(false)

// Reactive "now" so the elapsed timer actually advances while streaming —
// `Date.now()` on its own is not reactive and would freeze the displayed value.
const now = ref(Date.now())
let tickHandle: ReturnType<typeof setInterval> | undefined
watch(
  () => props.streaming,
  (streaming) => {
    clearInterval(tickHandle)
    tickHandle = undefined
    if (streaming) {
      now.value = Date.now()
      tickHandle = setInterval(() => (now.value = Date.now()), 100)
    }
  },
  { immediate: true },
)
onUnmounted(() => clearInterval(tickHandle))

const elapsedSeconds = computed(() => {
  if (props.streaming) {
    const start = props.liveStartedAt || props.startedAt
    if (!start) return '0.0'
    return ((now.value - start) / 1000).toFixed(1)
  }
  if (!props.startedAt) return '0.0'
  return (((props.finishedAt ?? props.startedAt) - props.startedAt) / 1000).toFixed(1)
})

const statusText = computed(() => {
  if (props.toolLoopMode) {
    if (props.streaming) return 'Thinking…'
    return 'Thinking (expand to view)'
  }
  if (!props.streaming && props.finishedAt && props.startedAt) {
    return `Done Reasoning after ${elapsedSeconds.value} seconds`
  }
  return `Reasoned for ${elapsedSeconds.value} seconds`
})
</script>

<template>
  <div>
    <button @click="isExpanded = !isExpanded" class="flex items-center cursor-pointer">
      <span class="italic text-muted-foreground">{{ statusText }}</span>
      <img v-if="isExpanded" src="../assets/svg/arrow-up.svg" class="w-4 h-4 ml-1" />
      <img v-else src="../assets/svg/arrow-down.svg" class="w-4 h-4 ml-1" />
    </button>
    <MarkdownRenderer
      v-if="isExpanded"
      class="border-l-2 border-border pl-4 text-muted-foreground"
      :content="displayText"
      :on-copy="onCopy"
    />
  </div>
</template>
