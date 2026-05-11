<template>
  <div class="dialog-container z-50">
    <div
      class="dialog-mask absolute left-0 top-0 w-full h-full bg-background/55 flex justify-center items-center"
    >
      <div
        class="flex w-[min(95vw,56rem)] max-h-[92vh] min-w-0 flex-col overflow-hidden rounded-3xl bg-card px-5 py-6 text-foreground shadow-xl md:px-8 md:py-8 gap-6"
        :class="{ 'animate-scale-in': animate }"
      >
        <div
          v-if="showConfirm"
          class="flex max-h-[calc(92vh-2.5rem)] w-full flex-col gap-4 overflow-x-hidden overflow-y-auto"
        >
          <p class="shrink-0 text-center text-sm md:text-base">
            {{ i18nState.DOWNLOADER_CONFRIM_TIP }}
          </p>

          <Collapsible
            v-model:open="modelListOpen"
            class="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/15"
          >
            <CollapsibleTrigger
              type="button"
              class="flex w-full shrink-0 items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/35"
            >
              <span>{{ modelListSummary }}</span>
              <ChevronDownIcon
                class="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200"
                :class="{ 'rotate-180': modelListOpen }"
              />
            </CollapsibleTrigger>
            <CollapsibleContent class="min-h-0">
              <div
                class="max-h-[min(50vh,26rem)] overflow-x-auto overflow-y-auto border-t border-border"
              >
                <table class="w-full min-w-[36rem] text-left text-sm">
                  <thead class="sticky top-0 z-[1] border-b border-border bg-card shadow-sm">
                    <tr class="text-center text-muted-foreground font-bold">
                      <th class="bg-card px-1 py-2 text-left font-bold">
                        {{ languages.DOWNLOADER_MODEL }}
                      </th>
                      <th class="bg-card px-1 py-2 font-bold">{{ languages.DOWNLOADER_FILE_SIZE }}</th>
                      <th class="bg-card px-1 py-2 font-bold">{{ languages.DOWNLOADER_GATED }}</th>
                      <th class="bg-card px-1 py-2 font-bold">{{ languages.DOWNLOADER_INFO }}</th>
                      <th class="bg-card px-1 py-2 font-bold">{{ languages.DOWNLOADER_LICENSE }}</th>
                      <th class="bg-card px-1 py-2 font-bold">{{ languages.DOWNLOADER_REASON }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in downloadModelRender" :key="item.repo_id" class="border-b border-border/60">
                      <td
                        class="max-w-[10rem] break-all py-2 pr-2 align-top text-xs md:max-w-[14rem] md:text-sm"
                        :title="item.repo_id"
                      >
                        {{ item.repo_id }}
                      </td>
                <td>
                  <div class="flex flex-col items-center">
                    <span v-if="sizeRequesting" class="svg-icon i-loading w-4 h-4"></span>
                    <span v-else>{{ item.size }}</span>
                  </div>
                </td>
                <td>
                  <div class="flex flex-col items-center">
                    <span v-if="sizeRequesting" class="svg-icon i-loading w-4 h-4"></span>
                    <div v-else>
                      <svg
                        v-if="item.gated"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="1"
                        stroke="currentColor"
                        class="size-6 ml-2"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                        />
                      </svg>
                      <svg
                        v-else
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="1"
                        stroke="currentColor"
                        class="size-6 ml-2"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                        />
                      </svg>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="flex flex-col items-center">
                    <a
                      :href="getInfoUrl(item.repo_id, item.type)"
                      target="_blank"
                      class="text-primary text-sm"
                    >
                      {{ i18nState.DOWNLOADER_TERMS }}
                    </a>
                  </div>
                </td>
                <td>
                  <div
                    class="flex flex-col items-center"
                    v-if="item.additionalLicenseLink !== undefined"
                  >
                    <a
                      :href="item.additionalLicenseLink"
                      target="_blank"
                      class="text-primary text-sm"
                    >
                      {{ i18nState.DOWNLOADER_TERMS }}
                    </a>
                  </div>
                  <div class="flex flex-col items-center" v-else>-</div>
                </td>
                      <td class="px-1 py-2 text-center text-sm text-green-400">
                        {{ getFunctionTip(item.type) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div
            v-if="
              downloadModelRender.some((i) => i.gated && !i.accessGranted) &&
              downloadModelRender.length === 1
            "
            class="flex shrink-0 flex-col items-center gap-2 rounded-lg border border-red-600 bg-red-600/10 p-4"
          >
            <span class="font-bold mx-4">{{ languages.DOWNLOADER_ACCESS_INFO_SINGLE }}</span>
            <span class="text-left">
              {{ !models.hfTokenIsValid ? languages.DOWNLOADER_GATED_TOKEN : '' }}
              {{
                downloadModelRender.some((i) => i.gated)
                  ? languages.DOWNLOADER_GATED_ACCEPT_SINGLE
                  : ''
              }}
              {{
                downloadModelRender.some((i) => !i.accessGranted)
                  ? languages.DOWNLOADER_ACCESS_ACCEPT_SINGLE
                  : ''
              }}
            </span>
          </div>
          <div
            v-if="
              downloadModelRender.some((i) => i.gated && !i.accessGranted) &&
              downloadModelRender.length > 1
            "
            class="flex shrink-0 flex-col items-center gap-2 rounded-lg border border-red-600 bg-red-600/10 p-4"
          >
            <span class="font-bold mx-4">{{ languages.DOWNLOADER_ACCESS_INFO }}</span>
            <span class="text-left">
              {{ !models.hfTokenIsValid ? languages.DOWNLOADER_GATED_TOKEN : '' }}
              {{
                downloadModelRender.some((i) => i.gated) ? languages.DOWNLOADER_GATED_ACCEPT : ''
              }}
              {{
                downloadModelRender.some((i) => !i.accessGranted)
                  ? languages.DOWNLOADER_ACCESS_ACCEPT
                  : ''
              }}
            </span>
          </div>
          <label class="flex shrink-0 items-center gap-2">
            <Checkbox v-model="readTerms" />
            <span class="text-left text-sm">{{ languages.DOWNLOADER_TERMS_TIP }}</span>
          </label>
          <div class="flex shrink-0 flex-wrap justify-center gap-4 md:gap-9">
            <button @click="cancelConfirm" class="rounded bg-muted px-4 py-1 text-foreground">
              {{ i18nState.COM_CANCEL }}
            </button>
            <button
              type="button"
              @click="confirmDownload"
              :disabled="sizeRequesting || !readTerms || !hasAnyDownloadableModel"
              class="rounded bg-primary px-4 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {{ i18nState.COM_CONFIRM }}
            </button>
          </div>
        </div>
        <div
          v-else-if="hashError"
          class="flex flex-col items-center justify-center gap-4 overflow-y-auto px-2 py-4"
        >
          <p class="text-center">{{ errorText }}</p>
          <p
            v-if="downloadErrType === 'download_exception'"
            class="text-sm text-muted-foreground text-center max-w-lg"
          >
            {{ i18nState.ERR_DOWNLOAD_RESUME_HINT }}
          </p>
          <div class="flex flex-wrap justify-center gap-4">
            <button
              v-if="downloadErrType === 'download_exception'"
              type="button"
              @click="retryDownload"
              class="bg-primary text-primary-foreground py-1 px-4 rounded"
            >
              {{ i18nState.COM_RETRY }}
            </button>
            <button type="button" @click="close" class="bg-red-500 py-1 px-4">
              {{ i18nState.COM_CLOSE }}
            </button>
          </div>
        </div>
        <div
          v-else
          class="mx-auto flex w-full min-w-0 max-w-2xl flex-col items-center gap-6 overflow-y-auto px-6 py-8"
        >
          <progress-bar :text="allDownloadTip" :percent="taskPercent"></progress-bar>
          <progress-bar :text="curDownloadTip" :percent="percent"></progress-bar>
          <button type="button" class="bg-red-500 px-4 py-1" @click="cancelDownload">
            {{ i18nState.COM_CANCEL }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, toRaw } from 'vue'
import { storeToRefs } from 'pinia'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import { useGlobalSetup } from '@/assets/js/store/globalSetup'
import ProgressBar from './ProgressBar.vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useI18N } from '@/assets/js/store/i18n'
import { SSEProcessor } from '@/assets/js/sseProcessor'
import * as util from '@/assets/js/util'
import * as toast from '@/assets/js/toast'
import { useModels } from '@/assets/js/store/models'
import { useDialogStore } from '@/assets/js/store/dialogs.ts'
import { EtaEstimator } from '@/lib/etaEstimator'

const i18nState = useI18N().state
const languages = i18nState
const globalSetup = useGlobalSetup()
const models = useModels()
const dialogStore = useDialogStore()

const { downloadDialogVisible, downloadList, downloadSuccessFunction, downloadFailFunction } =
  storeToRefs(dialogStore)

let downloding = false
const curDownloadTip = ref('')
const allDownloadTip = ref('')
const percent = ref(0)
const completeCount = ref(0)
const taskPercent = ref(0)
const showConfirm = ref(false)
const sizeRequesting = ref(false)
const hashError = ref(false)
const errorText = ref('')
const downloadErrType = ref<string | undefined>(undefined)
let abortController: AbortController
const animate = ref(false)
const readTerms = ref(false)
const downloadModelRender = ref<DownloadModelRender[]>([])
const etaEstimator = new EtaEstimator(100)
const modelListOpen = ref(true)

const modelListSummary = computed(() =>
  i18nState.DOWNLOADER_MODELS_LIST_SUMMARY.replace(
    '{count}',
    String(downloadModelRender.value.length),
  ),
)

function dataProcess(line: string) {
  console.log(line)
  const dataJson = line.slice(5)
  const data = JSON.parse(dataJson) as LLMOutCallback
  switch (data.type) {
    case 'download_model_progress': {
      const etaStr = etaEstimator.updateAndEstimate(data.percent)
      curDownloadTip.value = `${i18nState.COM_DOWNLOAD_MODEL} ${data.repo_id}\r\n${data.download_size}/${data.total_size} ${data.percent}% ${i18nState.COM_DOWNLOAD_SPEED}: ${data.speed} ETA: ${etaStr}`
      percent.value = data.percent
      break
    }
    case 'download_model_completed':
      completeCount.value++
      const allTaskCount = downloadModelRender.value.length
      if (completeCount.value == allTaskCount) {
        downloding = false
        dialogStore.closeDownloadDialog()
        downloadSuccessFunction.value?.()
      } else {
        taskPercent.value = util.toFixed((completeCount.value / allTaskCount) * 100, 1)
        percent.value = 100
        allDownloadTip.value = `${i18nState.DOWNLOADER_DONWLOAD_TASK_PROGRESS} ${completeCount.value}/${allTaskCount}`
      }
      models.refreshModels()
      break
    case 'allComplete':
      downloding = false
      dialogStore.closeDownloadDialog()
      break
    case 'error':
      hashError.value = true
      downloding = false
      downloadErrType.value = data.err_type
      abortController?.abort()
      fetch(`${globalSetup.apiHost}/api/stopDownloadModel`)

      switch (data.err_type) {
        case 'not_enough_disk_space': {
          const disk = data as NotEnoughDiskSpaceExceptionCallback
          errorText.value = i18nState.ERR_NOT_ENOUGH_DISK_SPACE.replace(
            '{requires_space}',
            disk.requires_space,
          ).replace('{free_space}', disk.free_space)
          break
        }
        case 'download_exception':
          errorText.value = i18nState.ERR_DOWNLOAD_FAILED
          break
        case 'runtime_error':
          errorText.value = i18nState.ERROR_RUNTIME_ERROR
          break
        case 'unknown_exception':
          errorText.value = i18nState.ERROR_GENERATE_UNKONW_EXCEPTION
          break
        default:
          errorText.value = i18nState.ERROR_GENERATE_UNKONW_EXCEPTION
          break
      }

      downloadFailFunction.value?.({ type: 'error', error: errorText.value })
      break
  }
}

watch(downloadDialogVisible, async (isVisible) => {
  if (isVisible) {
    nextTick(() => {
      animate.value = true
    })
    await initializeDownloadDialog()
    animate.value = false
  }
})

async function initializeDownloadDialog() {
  if (downloding) {
    toast.error(i18nState.DOWNLOADER_CONFLICT)
    downloadFailFunction.value?.({ type: 'conflict' })
    dialogStore.closeDownloadDialog()
    return
  }

  sizeRequesting.value = true
  curDownloadTip.value = i18nState.DOWNLOADER_CONFRIM_TIP
  showConfirm.value = true
  hashError.value = false
  downloadErrType.value = undefined
  percent.value = 0
  taskPercent.value = 0
  downloadModelRender.value = downloadList.value.map((item) => {
    return { size: '???', ...item }
  })
  readTerms.value = false
  modelListOpen.value = downloadList.value.length <= 10

  try {
    const sizeResponse = await fetch(`${globalSetup.apiHost}/api/getModelSize`, {
      method: 'POST',
      body: JSON.stringify(downloadList.value),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const gatedResponse = await fetch(`${globalSetup.apiHost}/api/isModelGated`, {
      method: 'POST',
      body: JSON.stringify([downloadList.value, models.hfToken]),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const accessResponse = await fetch(`${globalSetup.apiHost}/api/isAccessGranted`, {
      method: 'POST',
      body: JSON.stringify([downloadList.value, models.hfToken]),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    const sizeData = (await sizeResponse.json()) as ApiResponse & { sizeList: StringKV }
    const gatedData = (await gatedResponse.json()) as ApiResponse & {
      gatedList: Record<string, boolean>
    }
    const accessData = (await accessResponse.json()) as ApiResponse & {
      accessList: Record<string, boolean>
    }
    for (const item of downloadModelRender.value) {
      item.size = sizeData.sizeList[`${item.repo_id}_${item.type}`] || ''
      item.gated = gatedData.gatedList[item.repo_id] || false
      item.accessGranted = accessData.accessList[item.repo_id] || false
    }
    sizeRequesting.value = false
  } catch (ex) {
    downloadFailFunction.value?.({ type: 'error', error: ex })
    sizeRequesting.value = false
  }
}

function getInfoUrl(repoId: string, type: string) {
  if (type === 'upscale') {
    return 'https://github.com/xinntao/Real-ESRGAN'
  }

  switch (repoId) {
    case 'Lykon/dreamshaper-8':
      return 'https://huggingface.co/spaces/CompVis/stable-diffusion-license'
    case 'Lykon/dreamshaper-8-inpainting':
      return 'https://huggingface.co/spaces/CompVis/stable-diffusion-license'
    case 'RunDiffusion/Juggernaut-XL-v9':
      return 'https://huggingface.co/spaces/CompVis/stable-diffusion-license'
    case 'microsoft/Phi-3-mini-4k-instruct':
      return 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct/resolve/main/LICENSE'
    case 'BAAI/bge-large-en-v1.5':
      return 'https://huggingface.co/datasets/choosealicense/licenses/blob/main/markdown/mit.md'
    case 'latent-consistency/lcm-lora-sdv1-5':
      return 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md'
    case 'latent-consistency/lcm-lora-sdxl':
      return 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md'
  }

  return `https://huggingface.co/${repoId.split('/').slice(0, 2).join('/')}`
}

/** Public (non-gated) repos do not require accessGranted; gated repos need a successful access probe. */
function canDownloadItem(item: DownloadModelRender): boolean {
  if (!item.gated) return true
  return item.accessGranted === true
}

const hasAnyDownloadableModel = computed(() =>
  downloadModelRender.value.some((item) => canDownloadItem(item)),
)

function getFunctionTip(type: string): string {
  switch (type) {
    case 'llm':
      return i18nState.DOWNLOADER_FOR_ANSWER_GENERATE
    case 'embedding':
      return i18nState.DOWNLOADER_FOR_RAG_QUERY
    case 'stableDiffusion':
    case 'checkpoints':
      return i18nState.DOWNLOADER_FOR_IMAGE_GENERATE
    case 'loras':
    case 'lora':
      return i18nState.DOWNLOADER_FOR_IMAGE_LORA
    case 'upscale':
      return i18nState.DOWNLOADER_FOR_IMAGE_UPSCALE
    case 'vae':
      return i18nState.DOWNLOADER_FOR_IMAGE_PREVIEW
    case 'inpaint':
    case 'outpaint':
      return i18nState.DOWNLOADER_FOR_INAPINT_GENERATE
    default:
      return i18nState.DOWNLOADER_FOR_WORKFLOW_MODEL
  }
}

function download() {
  downloding = true
  const accessableDownloadList = downloadModelRender.value.filter((item) => canDownloadItem(item))
  allDownloadTip.value = `${i18nState.DOWNLOADER_DONWLOAD_TASK_PROGRESS} 0/${accessableDownloadList.length}`
  percent.value = 0
  completeCount.value = 0
  abortController = new AbortController()
  curDownloadTip.value = ''
  fetch(`${globalSetup.apiHost}/api/downloadModel`, {
    method: 'POST',
    body: JSON.stringify(toRaw({ data: accessableDownloadList })),
    headers: {
      'Content-Type': 'application/json',
      ...(models.hfTokenIsValid ? { Authorization: `Bearer ${models.hfToken}` } : {}),
    },
    signal: abortController.signal,
  })
    .then((response) => {
      const reader = response.body!.getReader()
      return new SSEProcessor(reader, dataProcess, undefined).start()
    })
    .catch((ex) => {
      downloadFailFunction.value?.({ type: 'error', error: ex })
      downloding = false
    })
}

function cancelConfirm() {
  downloadFailFunction.value?.({ type: 'cancelConfrim' })
  dialogStore.closeDownloadDialog()
}

function confirmDownload() {
  showConfirm.value = false
  hashError.value = false
  downloadErrType.value = undefined
  return download()
}

function cancelDownload() {
  abortController?.abort()
  fetch(`${globalSetup.apiHost}/api/stopDownloadModel`)
  downloadFailFunction.value?.({ type: 'cancelDownload' })
  dialogStore.closeDownloadDialog()
}

function retryDownload() {
  const accessableDownloadList = downloadModelRender.value.filter((item) => canDownloadItem(item))
  hashError.value = false
  errorText.value = ''
  downloadErrType.value = undefined
  etaEstimator.reset()
  percent.value = 0
  completeCount.value = 0
  taskPercent.value = 0
  curDownloadTip.value = ''
  allDownloadTip.value = `${i18nState.DOWNLOADER_DONWLOAD_TASK_PROGRESS} 0/${accessableDownloadList.length}`
  showConfirm.value = false
  download()
}

function close() {
  dialogStore.closeDownloadDialog()
}
</script>

<style scoped>
table {
  border-collapse: separate;
  border-spacing: 10px;
}
</style>
