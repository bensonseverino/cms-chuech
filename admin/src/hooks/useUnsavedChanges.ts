import { useCallback, useEffect } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router'

/*
 * Unsaved-changes guard. It covers both in-app navigation (useBlocker) and a
 * browser refresh/close (useBeforeUnload). Screens set `dirty` false before a
 * successful save or publish so the prompt does not fire on their own redirect.
 */

export function useUnsavedChanges(dirty: boolean, message = 'You have unsaved changes. Leave without saving?') {
  const blocker = useBlocker(dirty)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(message)) blocker.proceed()
    else blocker.reset()
  }, [blocker, message])

  const onBeforeUnload = useCallback(
    (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    },
    [dirty],
  )

  useBeforeUnload(onBeforeUnload)

  return blocker
}
