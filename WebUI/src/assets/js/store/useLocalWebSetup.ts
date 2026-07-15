import { ref, computed } from 'vue'
import { useHomeAgent } from './homeAgent'

const DEFAULT_PORT = 8765
const MIN_PASSWORD_LEN = 4

export function useLocalWebSetup() {
  const homeAgent = useHomeAgent()

  const portInput = ref(String(DEFAULT_PORT))
  const allowLan = ref(true)
  const passwordInput = ref('')
  const showPassword = ref(false)
  const verifyStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
  const verifyError = ref('')
  const urls = ref<string[]>([])

  const isAlreadyConfigured = computed(
    () =>
      !!(homeAgent.channels['local-web'].config as { password?: string }).password ||
      homeAgent.channelPrefs['local-web'].verified,
  )

  const portNumber = computed(() => {
    const n = parseInt(portInput.value, 10)
    return Number.isFinite(n) && n >= 1024 && n <= 65535 ? n : DEFAULT_PORT
  })

  const passwordReady = computed(() => {
    const p = passwordInput.value.trim()
    if (p.length >= MIN_PASSWORD_LEN) return true
    return isAlreadyConfigured.value && !p
  })

  const canVerify = computed(() => portNumber.value >= 1024 && passwordReady.value)

  function currentPasswordForSave(): string {
    return passwordInput.value.trim()
  }

  async function refreshUrls() {
    try {
      const status = await window.electronAPI.homeAgent.localWeb.getStatus()
      urls.value = status.urls
    } catch (e) {
      console.error('refreshUrls failed:', e)
      urls.value = []
    }
  }

  async function runVerify() {
    verifyStatus.value = 'loading'
    verifyError.value = ''
    const password = currentPasswordForSave()
    const effectivePassword =
      password ||
      (homeAgent.channels['local-web'].config as { password?: string }).password?.trim() ||
      ''
    if (effectivePassword && effectivePassword.length < MIN_PASSWORD_LEN) {
      verifyStatus.value = 'error'
      verifyError.value = `Password must be at least ${MIN_PASSWORD_LEN} characters.`
      return
    }
    if (!effectivePassword && !isAlreadyConfigured.value) {
      verifyStatus.value = 'error'
      verifyError.value = 'Choose a password for the local web chat page.'
      return
    }
    try {
      const savePayload: Record<string, string> = {
        port: String(portNumber.value),
        allowLan: allowLan.value ? 'true' : 'false',
        sessionId: 'local',
        password: effectivePassword,
      }
      await homeAgent.saveChannelConfig('local-web', savePayload)
      const test = await window.electronAPI.homeAgent.channel.test('local-web')
      if (!test.success) {
        verifyStatus.value = 'error'
        verifyError.value = test.error ?? 'Could not start local web server.'
        return
      }
      homeAgent.channelPrefs['local-web'].identity = 'local'
      homeAgent.setVerified('local-web')
      verifyStatus.value = 'success'
      passwordInput.value = ''
      await refreshUrls()
    } catch (e) {
      verifyStatus.value = 'error'
      verifyError.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function loadSavedIntoForm() {
    const cfg = homeAgent.channels['local-web'].config as {
      port?: string
      allowLan?: string
    }
    if (cfg.port) portInput.value = cfg.port
    if (cfg.allowLan !== undefined) allowLan.value = cfg.allowLan === 'true'
    await refreshUrls()
  }

  return {
    portInput,
    allowLan,
    passwordInput,
    showPassword,
    verifyStatus,
    verifyError,
    urls,
    isAlreadyConfigured,
    portNumber,
    canVerify,
    runVerify,
    refreshUrls,
    loadSavedIntoForm,
  }
}
