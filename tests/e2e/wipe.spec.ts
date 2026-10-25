import { expect, test, type Page } from '@playwright/test';

type Wipe = { animation: Animation; target: HTMLElement };
type WipeWindow = typeof window & { capturedWipes: Wipe[] };

async function sampleWipe(page: Page, index: number, progress: number) {
  return page.evaluate(async ({ index, progress }) => {
    const { animation, target } = (window as WipeWindow).capturedWipes[index];
    const duration = Number(animation.effect!.getTiming().duration);
    animation.currentTime = duration * progress;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const style = getComputedStyle(target);
    return { duration, clipPath: style.clipPath, opacity: Number(style.opacity), width: target.getBoundingClientRect().width };
  }, { index, progress });
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    (window as WipeWindow).capturedWipes = [];
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      if (Array.isArray(frames) && frames.some(frame => 'clipPath' in frame)) {
        animation.pause();
        (window as WipeWindow).capturedWipes.push({ animation, target: this as HTMLElement });
      }
      return animation;
    };
  });
  await page.goto('/');
});

test('the rendered thought and result wipe across text for the full fixed duration', async ({ page }, testInfo) => {
  await page.getByRole('textbox', { name: 'Add a thought', exact: true }).fill('Short thought');
  await page.getByRole('button', { name: 'Submit thought', exact: true }).click();
  const start = await sampleWipe(page, 0, 0);
  expect(start.opacity).toBe(0);
  const thought = page.locator('.entry').first();
  const startPixels = await thought.screenshot();
  const middle = await sampleWipe(page, 0, 0.5);
  await page.screenshot({ path: testInfo.outputPath('thought-wipe-midpoint.png') });
  const middlePixels = await thought.screenshot();
  const hiddenRight = Number(middle.clipPath.match(/inset\(0(?:px|%)? ([\d.]+)%/)?.[1]);
  expect(hiddenRight).toBeCloseTo(50, 0);
  expect(middle.opacity).toBeCloseTo(0.5, 1);
  expect(middle.width).toBeLessThan(200); // A short phrase, not the full 608-point row.
  expect(middle.duration).toBe(400);
  const end = await sampleWipe(page, 0, 1);
  expect(end.opacity).toBe(1);
  expect(end.clipPath).toBe('none'); // Finished effects leave no permanent clipping.
  expect(end.width).toBe(middle.width);
  const endPixels = await thought.screenshot();
  expect(startPixels.equals(middlePixels)).toBe(false);
  expect(middlePixels.equals(endPixels)).toBe(false);

  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByTestId('message')).toHaveText('Short thought');
  const resultMiddle = await sampleWipe(page, 1, 0.5);
  expect(resultMiddle.duration).toBe(middle.duration);
  expect(resultMiddle.opacity).toBeCloseTo(0.5, 1);
  expect(resultMiddle.width).toBeLessThan(200);
  expect(Number(resultMiddle.clipPath.match(/inset\(0(?:px|%)? ([\d.]+)%/)?.[1])).toBeCloseTo(50, 0);
  await page.screenshot({ path: testInfo.outputPath('result-wipe-midpoint.png') });
  await sampleWipe(page, 1, 1);
  await page.screenshot({ path: testInfo.outputPath('result-wipe-finished.png') });
});

test('new thoughts are in view before their wipe and new results reset a scrolled preview', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 420 });
  const composer = page.getByRole('textbox', { name: 'Add a thought', exact: true });
  for (let i = 0; i < 12; i++) {
    await composer.fill(`Thought ${i + 1} — enough content to scroll the compact workspace.`);
    await composer.press('Enter');
  }
  await composer.fill('Newest visible thought');
  await composer.press('Enter');
  await sampleWipe(page, 12, 0);
  const textBounds = await page.locator('.entry').last().locator('[data-wipe-content]').boundingBox();
  const paneBounds = await page.locator('.entries').boundingBox();
  expect(textBounds!.y).toBeGreaterThanOrEqual(paneBounds!.y);
  expect(textBounds!.y + textBounds!.height).toBeLessThanOrEqual(paneBounds!.y + paneBounds!.height);
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByTestId('message')).toContainText('Newest visible thought');
  await page.locator('.review-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  expect(await page.locator('.review-scroll').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as WipeWindow).capturedWipes.length)).toBe(15);
  await sampleWipe(page, 14, 0);
  expect(await page.locator('.review-scroll').evaluate(node => node.scrollTop)).toBe(0);
});
