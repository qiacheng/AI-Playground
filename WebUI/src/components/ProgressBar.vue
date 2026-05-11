<template>
  <div class="v-progress-bar mx-auto w-full max-w-2xl min-w-0 px-1">
    <div
      v-if="props.text"
      class="max-w-full break-words text-center text-sm text-foreground md:text-base"
      v-html="html"
    ></div>
    <div class="v-progress-bar-percent-bg">
      <div class="v-progress-bar-percent" :style="{ width: `${props.percent}%` }"></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  percent: number
  text?: string
}>()

const html = computed(() => (props.text == null ? '' : props.text.replace('\r\n', '<br/>')))
</script>
