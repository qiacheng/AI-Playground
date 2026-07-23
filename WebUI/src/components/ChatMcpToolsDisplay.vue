<script lang="ts">
import type { DynamicToolUIPart } from 'ai'

export type McpToolEntry = {
  toolCallId: string
  part: DynamicToolUIPart
  state: DynamicToolUIPart['state']
  displayName: string
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { Spinner } from '@/components/ui/spinner'

const props = defineProps<{
  entries: McpToolEntry[]
}>()

const isExpanded = ref(false)

const isRunning = computed(() =>
  props.entries.some((e) => e.state === 'input-streaming' || e.state === 'input-available'),
)

const completedCount = computed(
  () => props.entries.filter((e) => e.state === 'output-available').length,
)

const failedCount = computed(
  () => props.entries.filter((e) => e.state === 'output-error').length,
)

const stepCount = computed(() => props.entries.length)

const activeEntry = computed(() => {
  for (let i = props.entries.length - 1; i >= 0; i--) {
    const e = props.entries[i]
    if (e.state === 'input-streaming' || e.state === 'input-available') return e
  }
  return undefined
})

const headerLabel = computed(() => {
  const n = stepCount.value
  const steps = `${n} step${n === 1 ? '' : 's'}`
  if (failedCount.value > 0 && completedCount.value === 0) {
    return `MCP tools · ${steps} · ${failedCount.value} failed`
  }
  if (failedCount.value > 0) {
    return `MCP tools · ${steps} · ${completedCount.value} ok, ${failedCount.value} failed`
  }
  return `MCP tools · ${steps}`
})

const runningHint = computed(() => {
  if (!isRunning.value) return ''
  return activeEntry.value?.displayName ?? 'working…'
})

function stateLabel(state: DynamicToolUIPart['state']): string {
  if (state === 'input-streaming') return 'Running'
  if (state === 'input-available') return 'Queued'
  if (state === 'output-available') return 'Completed'
  if (state === 'output-error') return 'Failed'
  return state
}

function stateClass(state: DynamicToolUIPart['state']): string {
  if (state === 'output-available') return 'text-green-600'
  if (state === 'output-error') return 'text-destructive'
  if (state === 'input-streaming' || state === 'input-available') return 'text-amber-500'
  return 'text-muted-foreground'
}

function formatToolPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

</script>

<template>
  <div class="flex flex-col rounded-md border border-border/80 bg-muted/20">
    <div
      class="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground"
      role="button"
      :aria-expanded="isExpanded"
      @click="isExpanded = !isExpanded"
    >
      <ChevronRight
        class="size-4 shrink-0 transition-transform"
        :class="isExpanded ? 'rotate-90' : ''"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate">{{ headerLabel }}</span>
        <span v-if="runningHint" class="truncate text-xs text-muted-foreground/80">
          {{ runningHint }}
        </span>
      </span>
      <Spinner v-if="isRunning" class="size-3.5 shrink-0" />
    </div>

    <ol v-if="isExpanded" class="flex flex-col gap-2 px-3 pb-3 animate-in fade-in-0 duration-200">
      <li
        v-for="(entry, index) in entries"
        :key="entry.toolCallId"
        class="rounded-md border border-border/60 bg-background/40 px-3 py-2"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground tabular-nums">{{ index + 1 }}.</span>
          <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {{ entry.displayName }}
          </span>
          <span class="shrink-0 text-xs rounded-md border border-border px-2 py-0.5" :class="stateClass(entry.state)">
            {{ stateLabel(entry.state) }}
          </span>
        </div>

        <details v-if="entry.part.input" class="mt-2">
          <summary class="cursor-pointer text-xs text-muted-foreground">Arguments</summary>
          <pre class="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs leading-5">{{
            formatToolPayload(entry.part.input)
          }}</pre>
        </details>

        <details v-if="entry.state === 'output-available'" class="mt-2">
          <summary class="cursor-pointer text-xs text-muted-foreground">Result</summary>
          <pre class="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs leading-5">{{
            formatToolPayload(entry.part.output)
          }}</pre>
        </details>

        <div
          v-if="entry.state === 'output-error' && entry.part.errorText"
          class="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {{ entry.part.errorText }}
        </div>
      </li>
    </ol>
  </div>
</template>
