import { acceptHMRUpdate, defineStore } from 'pinia'
import { ref } from 'vue'
import { useOemBranding } from '@/assets/js/store/oemBranding'

const POLL_MS = 3000

export const useAcerPhoneWebcam = defineStore('acerPhoneWebcam', () => {
  const oemBranding = useOemBranding()
  const directActive = ref(false)
  let subscribers = 0
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let pollEnabled = false

  async function refresh() {
    if (!pollEnabled) return
    directActive.value = await window.electronAPI.isAcerCameraDirectRunning()
  }

  async function startPollingIfNeeded() {
    if (pollTimer) return
    await oemBranding.initialize()
    if (!oemBranding.isAcer) return
    const platform = await window.electronAPI.getPlatform()
    pollEnabled = platform === 'win32'
    if (!pollEnabled) return
    await refresh()
    pollTimer = setInterval(() => {
      void refresh()
    }, POLL_MS)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    pollEnabled = false
    directActive.value = false
  }

  function acquire() {
    subscribers += 1
    if (subscribers === 1) {
      void startPollingIfNeeded()
    }
  }

  function release() {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0) {
      stopPolling()
    }
  }

  return {
    directActive,
    acquire,
    release,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAcerPhoneWebcam, import.meta.hot))
}
