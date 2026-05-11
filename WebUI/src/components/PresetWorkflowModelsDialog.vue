<template>
  <div
    v-if="dialogStore.presetWorkflowModelsDialogVisible"
    class="dialog-container fixed inset-0 z-50 flex items-center justify-center bg-background/55 p-4"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    @click.self="close"
  >
    <div
      ref="panelRef"
      tabindex="-1"
      class="bg-card text-foreground rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col border border-border outline-none"
      @keydown.escape.prevent="close"
    >
      <div class="p-5 border-b border-border flex justify-between items-start gap-4 shrink-0">
        <div>
          <h2 :id="titleId" class="text-lg font-semibold">
            {{ languages.SETTINGS_PRESET_MODELS_TITLE }}
          </h2>
          <p class="text-sm text-muted-foreground mt-1">
            {{ languages.SETTINGS_PRESET_MODELS_DESCRIPTION }}
          </p>
        </div>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground text-2xl leading-none px-1"
          :aria-label="languages.COM_CLOSE"
          @click="close"
        >
          ×
        </button>
      </div>

      <div class="overflow-y-auto flex-1 px-5 py-3 space-y-6 min-h-0">
        <template v-if="groupedRows.length === 0">
          <p class="text-sm text-muted-foreground">{{ languages.SETTINGS_PRESET_MODELS_EMPTY }}</p>
        </template>
        <template v-else>
          <section v-for="[cat, catRows] in groupedRows" :key="cat">
            <h3 class="text-sm font-medium mb-2 text-foreground/90">
              {{ categoryTitle(cat) }}
            </h3>
            <ul class="space-y-2">
              <li
                v-for="row in catRows"
                :key="row.id"
                class="flex items-start gap-3 text-sm"
              >
                <Checkbox
                  :id="row.id"
                  :disabled="!row.hasModels"
                  :model-value="selectedIds.has(row.id)"
                  @update:model-value="
                    (v: boolean | 'indeterminate') => toggleRow(row.id, v === true)
                  "
                />
                <label :for="row.id" class="cursor-pointer select-none leading-snug pt-0.5">
                  {{ row.label }}
                  <span v-if="!row.hasModels" class="text-muted-foreground text-xs ml-1">
                    ({{ languages.SETTINGS_PRESET_MODELS_NO_MODELS_IN_PRESET }})
                  </span>
                </label>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <div
        class="p-5 border-t border-border flex flex-wrap gap-2 justify-between items-center shrink-0"
      >
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" type="button" @click="selectAllWithModels">
            {{ languages.SETTINGS_PRESET_MODELS_SELECT_ALL }}
          </Button>
          <Button variant="outline" size="sm" type="button" @click="clearSelection">
            {{ languages.SETTINGS_PRESET_MODELS_CLEAR }}
          </Button>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" type="button" @click="close">
            {{ languages.COM_CLOSE }}
          </Button>
          <Button
            type="button"
            :disabled="!canStartDownload || preparing"
            @click="startDownload"
          >
            <span v-if="preparing" class="svg-icon i-loading w-4 h-4 inline-block mr-1" />
            {{ languages.SETTINGS_PRESET_MODELS_DOWNLOAD }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDialogStore } from '@/assets/js/store/dialogs'
import { usePresets } from '@/assets/js/store/presets'
import { useImageGenerationPresets } from '@/assets/js/store/imageGenerationPresets'
import { useModels } from '@/assets/js/store/models'
import { useI18N } from '@/assets/js/store/i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import * as toast from '@/assets/js/toast'

const dialogStore = useDialogStore()
const presetsStore = usePresets()
const imageGen = useImageGenerationPresets()
const models = useModels()
const languages = useI18N().state

const titleId = 'preset-workflow-models-title'
const panelRef = ref<HTMLElement | null>(null)
const selectedIds = ref(new Set<string>())
const preparing = ref(false)

type RowMeta = {
  id: string
  label: string
  category: string
  presetName: string
  variantName: string | null
  hasModels: boolean
}

const rows = computed<RowMeta[]>(() => {
  const out: RowMeta[] = []
  for (const p of presetsStore.presets) {
    if (p.type !== 'comfy') continue
    const cat = p.category || 'uncategorized'
    if (p.variants && p.variants.length > 0) {
      for (const v of p.variants) {
        const resolved = presetsStore.applyVariant(p, v.name)
        const n = resolved.requiredModels?.length ?? 0
        out.push({
          id: `${p.name}::${v.name}`,
          label: `${p.name} - ${v.name}`,
          category: cat,
          presetName: p.name,
          variantName: v.name,
          hasModels: n > 0,
        })
      }
    } else {
      const n = p.requiredModels?.length ?? 0
      out.push({
        id: p.name,
        label: p.name,
        category: cat,
        presetName: p.name,
        variantName: null,
        hasModels: n > 0,
      })
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label))
  return out
})

const CATEGORY_ORDER: Record<string, number> = {
  'create-images': 0,
  'edit-images': 1,
  'create-videos': 2,
  uncategorized: 4,
}

const groupedRows = computed(() => {
  const map = new Map<string, RowMeta[]>()
  for (const r of rows.value) {
    const list = map.get(r.category) ?? []
    list.push(r)
    map.set(r.category, list)
  }
  return [...map.entries()].sort((a, b) => {
    const oa = CATEGORY_ORDER[a[0]] ?? 3
    const ob = CATEGORY_ORDER[b[0]] ?? 3
    if (oa !== ob) return oa - ob
    return a[0].localeCompare(b[0])
  })
})

function categoryTitle(cat: string): string {
  switch (cat) {
    case 'create-images':
      return languages.SETTINGS_PRESET_MODELS_CATEGORY_IMAGE
    case 'edit-images':
      return languages.SETTINGS_PRESET_MODELS_CATEGORY_EDIT
    case 'create-videos':
      return languages.SETTINGS_PRESET_MODELS_CATEGORY_VIDEO
    default:
      return languages.SETTINGS_PRESET_MODELS_CATEGORY_OTHER
  }
}

function toggleRow(id: string, checked: boolean) {
  const next = new Set(selectedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedIds.value = next
}

function selectAllWithModels() {
  const next = new Set<string>()
  for (const r of rows.value) {
    if (r.hasModels) next.add(r.id)
  }
  selectedIds.value = next
}

function clearSelection() {
  selectedIds.value = new Set()
}

const canStartDownload = computed(() => {
  for (const id of selectedIds.value) {
    const row = rows.value.find((r) => r.id === id)
    if (row?.hasModels) return true
  }
  return false
})

watch(
  () => dialogStore.presetWorkflowModelsDialogVisible,
  async (visible) => {
    if (visible) {
      selectedIds.value = new Set()
      await nextTick()
      panelRef.value?.focus()
    }
  },
)

function close() {
  dialogStore.closePresetWorkflowModelsDialog()
}

async function startDownload() {
  const selections = rows.value
    .filter((r) => selectedIds.value.has(r.id) && r.hasModels)
    .map((r) => ({ presetName: r.presetName, variantName: r.variantName }))
  if (selections.length === 0) {
    toast.error(languages.SETTINGS_PRESET_MODELS_NONE_SELECTED)
    return
  }
  preparing.value = true
  try {
    const missing = await imageGen.getMissingModelsForPresetSelections(selections)
    if (missing.length === 0) {
      toast.success(languages.SETTINGS_PRESET_MODELS_ALL_PRESENT)
      return
    }
    dialogStore.closePresetWorkflowModelsDialog()
    dialogStore.showDownloadDialog(missing, () => {
      void models.refreshModels()
    })
  } catch (error: unknown) {
    console.error(error)
    const msg = error instanceof Error ? error.message : String(error)
    if (/AIPG Backend not running|not running/i.test(msg)) {
      toast.error(languages.SETTINGS_PRESET_MODELS_BACKEND_REQUIRED)
    } else {
      toast.error(msg)
    }
  } finally {
    preparing.value = false
  }
}
</script>
