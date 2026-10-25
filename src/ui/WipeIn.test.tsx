import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WipeIn, WIPE_IN_DURATION_MS } from './WipeIn';

const originalAnimate = Element.prototype.animate;
const cancel = vi.fn();
const animate = vi.fn((_frames: Keyframe[] | PropertyIndexedKeyframes | null, _options?: number | KeyframeAnimationOptions) => ({ cancel }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate });
});
afterEach(() => {
  cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Element.prototype.animate = originalAnimate;
  else delete (Element.prototype as { animate?: unknown }).animate;
});

it('uses the same fixed duration for thoughts and final messages regardless of length', () => {
  render(<><WipeIn as="article">Short</WipeIn><WipeIn>{'Long message '.repeat(1000)}</WipeIn></>);
  expect(animate).toHaveBeenCalledTimes(2);
  for (const [frames, options] of animate.mock.calls) {
    expect(frames).toEqual([
      { clipPath: 'inset(0 100% 0 0)', opacity: 0 },
      { clipPath: 'inset(0 0 0 0)', opacity: 1 },
    ]);
    expect(options).toEqual({ duration: WIPE_IN_DURATION_MS, easing: 'linear', fill: 'backwards' });
  }
  expect(WIPE_IN_DURATION_MS).toBe(400);
});

it('does not replay on edits or view changes, but a newly keyed result animates', () => {
  const { rerender, unmount } = render(<WipeIn key="run-one">Message</WipeIn>);
  rerender(<WipeIn key="run-one" hidden>Message</WipeIn>);
  rerender(<WipeIn key="run-one">Edited</WipeIn>);
  expect(animate).toHaveBeenCalledTimes(1);
  rerender(<WipeIn key="run-two">Next result</WipeIn>);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
  unmount(); expect(cancel).toHaveBeenCalledTimes(2);
});

it('does not animate when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  render(<WipeIn>Accessible without motion</WipeIn>);
  expect(animate).not.toHaveBeenCalled();
});

it('targets the actual text rather than empty row space or action buttons', () => {
  const { container } = render(<WipeIn as="article"><p><span data-wipe-content>Short thought</span></p><button>Edit</button></WipeIn>);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(animate.mock.instances[0]).toBe(container.querySelector('[data-wipe-content]'));
});

it('remains usable when the platform does not support animations', () => {
  delete (Element.prototype as { animate?: unknown }).animate;
  const { container } = render(<WipeIn as="article">Still visible</WipeIn>);
  expect(container.querySelector('article')?.textContent).toBe('Still visible');
});
