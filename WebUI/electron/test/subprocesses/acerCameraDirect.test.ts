import { describe, expect, it, vi } from 'vitest'
import {
  ACER_CAMERA_DIRECT_PROCESSES,
  createCachedAcerCameraDirectProbe,
  queryAcerCameraDirectRunning,
  tasklistOutputIndicatesProcess,
} from '../../subprocesses/acerCameraDirect'

describe('tasklistOutputIndicatesProcess', () => {
  it('matches a running process line', () => {
    const stdout = '"AcerCameraDirectW.exe","1234","Console","1","12,345 K"\r\n'
    expect(tasklistOutputIndicatesProcess(stdout, 'AcerCameraDirectW.exe')).toBe(true)
  })

  it('does not match when tasklist reports no tasks', () => {
    const stdout = 'INFO: No tasks are running which match the specified criteria.\r\n'
    expect(tasklistOutputIndicatesProcess(stdout, 'AcerCameraDirectW.exe')).toBe(false)
  })
})

describe('queryAcerCameraDirectRunning', () => {
  it('returns false off Windows', async () => {
    const runTasklist = vi.fn()
    await expect(queryAcerCameraDirectRunning('linux', runTasklist)).resolves.toBe(false)
    expect(runTasklist).not.toHaveBeenCalled()
  })

  it('stops at the first matching Acer Camera Direct process', async () => {
    const runTasklist = vi.fn(async (name: string) =>
      name === 'AcerCameraDirectW.exe'
        ? '"AcerCameraDirectW.exe","1","Console","1","1 K"'
        : 'INFO: No tasks are running which match the specified criteria.',
    )
    await expect(queryAcerCameraDirectRunning('win32', runTasklist)).resolves.toBe(true)
    expect(runTasklist.mock.calls.length).toBeLessThanOrEqual(ACER_CAMERA_DIRECT_PROCESSES.length)
  })
})

describe('createCachedAcerCameraDirectProbe', () => {
  it('coalesces concurrent calls and respects cacheMs', async () => {
    vi.useFakeTimers()
    const query = vi.fn(async () => true)
    const probe = createCachedAcerCameraDirectProbe(query, 2500)

    await expect(Promise.all([probe(), probe()])).resolves.toEqual([true, true])
    expect(query).toHaveBeenCalledTimes(1)

    await probe()
    expect(query).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2500)
    await probe()
    expect(query).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
