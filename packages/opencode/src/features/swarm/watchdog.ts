const timers = new Map<string, ReturnType<typeof setTimeout>>()

export namespace SwarmWatchdog {
  export function clear(taskID: string) {
    const timer = timers.get(taskID)
    if (!timer) return
    clearTimeout(timer)
    timers.delete(taskID)
  }

  export function arm(input: {
    taskID: string
    staleTimeoutMs: number
    onStale: () => void
  }) {
    clear(input.taskID)
    const timer = setTimeout(() => {
      timers.delete(input.taskID)
      input.onStale()
    }, input.staleTimeoutMs)
    timers.set(input.taskID, timer)
  }

  export function touch(input: {
    taskID: string
    staleTimeoutMs: number
    onStale: () => void
  }) {
    arm(input)
  }
}
