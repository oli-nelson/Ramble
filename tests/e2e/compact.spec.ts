import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`Compact Mode keeps the core workflow usable at 360×280 · ${theme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 560, height: 420 });
    await page.goto('/');
    const toggle = page.getByRole('switch', { name: 'Compact Mode', exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(async () => {
      const path = '/src/native/client.ts'; const { api } = await import(path);
      return (await api.getSettings()).settings.compactMode;
    })).toBe(true);
    await page.setViewportSize({ width: 360, height: 280 });
    await expect(page.getByRole('combobox', { name: 'Active preset' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'New draft', exact: true })).toBeHidden();
    await expect(page.locator('.app-footer')).toBeHidden();
    const composer = page.getByRole('textbox', { name: 'Add a thought', exact: true });
    await composer.fill('A compact thought'); await composer.press('Enter');
    await page.getByRole('button', { name: 'Edit thought 1', exact: true }).click();
    const inline = page.getByRole('textbox', { name: 'Edit thought 1', exact: true });
    await inline.fill('Revised compact thought'); await inline.press('Enter');
    await expect(page.locator('.entry p')).toHaveText('Revised compact thought');
    await expect(page.locator('.toolbar')).toHaveCSS('height', '40px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: testInfo.outputPath('compact-thoughts.png') });
    await page.getByRole('button', { name: 'Build message', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await expect(page.getByTestId('message')).toHaveText('Revised compact thought');
    await expect(page.locator('.session-style')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Copy message', exact: true })).toBeVisible();
    const edits = page.getByRole('textbox', { name: 'Additional edit for this rebuild', exact: true });
    await edits.fill('Pending refinement');
    await expect(page.getByText('Awaiting edit', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    const rebuild = await page.getByRole('button', { name: 'Rebuild', exact: true }).boundingBox();
    expect(rebuild!.y + rebuild!.height).toBeLessThanOrEqual(280);
    await page.screenshot({ path: testInfo.outputPath('compact-message.png') });
    await page.keyboard.press('Escape');
    await expect(composer).toBeFocused();
    await page.getByRole('button', { name: 'View message', exact: true }).click();
    await expect(edits).toHaveValue('Pending refinement');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Thought font size (px)', exact: true }).fill('28');
    await page.getByRole('spinbutton', { name: 'Message font size (px)', exact: true }).fill('28');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByTestId('message')).toHaveCSS('font-size', '28px');
    await expect(edits).toHaveValue('Pending refinement');
    await page.keyboard.press('Escape');
    await expect(composer).toHaveCSS('font-size', '28px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: testInfo.outputPath('compact-large-text.png') });
    // Simulate only the native macOS control gutter; no OS window/input calls.
    await page.locator('main').evaluate(node => node.setAttribute('data-native-mac', 'true'));
    const switchBounds = await toggle.boundingBox();
    expect(switchBounds!.x).toBeGreaterThanOrEqual(88);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: testInfo.outputPath('compact-native-gutter.png') });
    // A native exit expands to the normal minimum; browser demo has no window API.
    await page.setViewportSize({ width: 560, height: 420 });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('combobox', { name: 'Active preset' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New draft', exact: true })).toBeVisible();
    await expect(page.locator('.app-footer')).toBeVisible();
    await page.getByRole('button', { name: 'View message', exact: true }).click();
    await expect(edits).toHaveValue('Pending refinement');
    await expect(page.locator('.session-style')).toBeVisible();
  });
}

test('Compact Mode never hides build failures or their recovery actions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('switch', { name: 'Compact Mode', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 280 });
  await page.evaluate(async () => {
    const path = '/src/native/client.ts'; const { api } = await import(path);
    api.build = async (request: import('../../src/domain/types').BuildRequest) => ({
      runId: request.runId, draftId: request.draftId, kind: 'failed', durationMs: 1,
      message: 'Synthetic failure. Check the selected CLI.', diagnosticsAvailable: true,
    });
  });
  await page.getByRole('textbox', { name: 'Add a thought', exact: true }).fill('Keep errors actionable');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic failure');
  await expect(page.getByRole('button', { name: 'Check settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View harness output', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});
