import { createElement, useLayoutEffect, useRef, type HTMLAttributes } from 'react';

export const WIPE_IN_DURATION_MS = 400;

/** Mount-only animation: editing or hiding/reopening a pane never replays it. */
export function WipeIn({ as = 'div', ...props }: HTMLAttributes<HTMLElement> & { as?: 'div' | 'article' }) {
  const element = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    // Animate the text's own bounds, not the blank width/height of its flex row.
    // Layout timing and backwards fill keep the first paint from flashing full text.
    const node = element.current?.querySelector<HTMLElement>('[data-wipe-content]') ?? element.current;
    if (!node?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const animation = node.animate([
      { clipPath: 'inset(0 100% 0 0)', opacity: 0 },
      { clipPath: 'inset(0 0 0 0)', opacity: 1 },
    ], { duration: WIPE_IN_DURATION_MS, easing: 'linear', fill: 'backwards' });
    return () => animation.cancel();
  }, []);
  return createElement(as, { ...props, ref: element });
}
