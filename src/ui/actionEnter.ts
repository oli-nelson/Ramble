import type { KeyboardEvent } from 'react';

// Plain Enter performs the field's action. Modified app shortcuts stay separate;
// Shift+Enter remains native multiline editing, and IME confirmation is never an action.
export function actionEnter(event: KeyboardEvent, action: () => void) {
  if (event.defaultPrevented || event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey
    || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  if (event.shiftKey) {
    if (event.target instanceof HTMLInputElement) event.preventDefault();
    return;
  }
  event.preventDefault();
  if (!event.repeat) action();
}
