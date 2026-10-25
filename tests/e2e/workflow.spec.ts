import { test, expect, type Page } from '@playwright/test';

async function thought(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Add a thought', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Submit thought', exact: true }).click();
}

for (const platform of [{ agent: 'Mac', key: 'Meta', hint: '⌘ Enter' }, { agent: 'Windows', key: 'Control', hint: 'Ctrl+Enter' }]) {
  test(`contextual copy/hide and build shortcuts · ${platform.agent}`, async ({ page }, testInfo) => {
    await page.addInitScript(agent => Object.defineProperty(navigator, 'userAgent', { get: () => agent }), platform.agent);
    await page.goto('/');
    await expect(page.getByText(`${platform.hint} to build`, { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Add a thought', exact: true }).fill('Literal text copied before hiding.');
    await page.keyboard.press(`${platform.key}+Enter`);
    await expect(page.getByTestId('message')).toHaveText('Literal text copied before hiding.');
    await expect(page.getByText(`${platform.hint} to copy & hide`, { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const path = '/src/native/client.ts'; const { api } = await import(path);
      const fixture = window as typeof window & { shortcutCalls: string[]; copiedMessage: string };
      fixture.shortcutCalls = []; fixture.copiedMessage = '';
      api.copy = async (text: string) => { fixture.copiedMessage = text; fixture.shortcutCalls.push('copy'); };
      api.hide = async () => { fixture.shortcutCalls.push('hide'); };
      api.hideAndRestoreFocus = async () => { fixture.shortcutCalls.push('hide-and-restore-focus'); };
      api.hideRestoreAndPaste = async () => { fixture.shortcutCalls.push('hide-restore-and-paste'); };
      api.quit = async () => { fixture.shortcutCalls.push('quit'); };
    });
    await page.keyboard.press(`${platform.key}+Enter`);
    expect(await page.evaluate(() => (window as typeof window & { shortcutCalls: string[] }).shortcutCalls)).toEqual(['copy', 'hide-and-restore-focus']);
    await expect(page.getByText(`${platform.agent === 'Mac' ? '⇧⌘ Enter' : 'Ctrl+Shift+Enter'} to paste`, { exact: true })).toBeVisible();
    await page.keyboard.press(`${platform.key}+Shift+Enter`);
    expect(await page.evaluate(() => (window as typeof window & { shortcutCalls: string[] }).shortcutCalls)).toEqual(['copy', 'hide-and-restore-focus', 'copy', 'hide-restore-and-paste']);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as typeof window & { shortcutCalls: string[] }).shortcutCalls)).toEqual(['copy', 'hide-and-restore-focus', 'copy', 'hide-restore-and-paste', 'hide-and-restore-focus']);
    expect(await page.evaluate(() => (window as typeof window & { copiedMessage: string }).copiedMessage)).toBe('Literal text copied before hiding.');
    await page.screenshot({ path: testInfo.outputPath('shortcut-hint.png') });
    await page.getByRole('button', { name: 'Back to thoughts', exact: true }).click();
    await expect(page.getByText(`${platform.hint} to build`, { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Add a thought', exact: true })).toBeFocused();
  });
}

test('wipe-ins have fixed duration, do not replay on navigation, and honor reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    const fixture = window as typeof window & { wipeDurations: (number | string | CSSNumericValue | undefined)[] };
    fixture.wipeDurations = [];
    Element.prototype.animate = function (frames, options) {
      fixture.wipeDurations.push(typeof options === 'number' ? options : options?.duration);
      return original.call(this, frames, options);
    };
  });
  await page.goto('/');
  await thought(page, 'Short');
  await thought(page, 'A longer thought. '.repeat(30));
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByTestId('message')).toContainText('Short');
  expect(await page.evaluate(() => (window as typeof window & { wipeDurations: number[] }).wipeDurations)).toEqual([400, 400, 400]);
  await page.getByRole('button', { name: 'Back to thoughts', exact: true }).click();
  await page.getByRole('button', { name: 'View message', exact: true }).click();
  expect(await page.evaluate(() => (window as typeof window & { wipeDurations: number[] }).wipeDurations)).toEqual([400, 400, 400]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Back to thoughts', exact: true }).click();
  await thought(page, 'No animation for reduced motion');
  await page.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(page.getByTestId('message')).toContainText('No animation for reduced motion');
  expect(await page.evaluate(() => (window as typeof window & { wipeDurations: number[] }).wipeDurations)).toEqual([400, 400, 400]);
});

test('capture, inline edits, undo, immutable builds, styles and one-off edits', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Build message', exact: true })).toBeDisabled();
  await thought(page, 'found a crash reconnecting after a timeout');
  await thought(page, 'fix is in review — hold the next build\nuntil verified 🦊');
  await thought(page, 'can someone test reconnects this afternoon? especially Windows');
  await page.getByRole('button', { name: 'Edit thought 2', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit thought 2', exact: true }).fill('fix in review — hold until verified 🦊');
  await expect(page.getByRole('button', { name: 'Build message', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Delete thought 1', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('textbox', { name: 'Add a thought', exact: true }).fill('Pending thought included exactly once');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Source thoughts' })).toBeHidden();
  await page.getByRole('button', { name: 'Back to thoughts', exact: true }).click();
  await thought(page, 'Written during the build');
  await page.getByRole('button', { name: /^View (message|build)$/ }).click();
  await expect(page.getByTestId('message')).toContainText('Pending thought included exactly once');
  await expect(page.getByTestId('message')).not.toContainText('Written during the build');
  await expect(page.getByText('Out of date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await page.getByText('Session style', { exact: true }).first().click();
  const style = page.getByRole('textbox', { name: 'Session style', exact: true });
  const original = await style.inputValue();
  await style.fill('Short and warm');
  await expect(page.getByText('Out of date', { exact: true })).toBeVisible();
  await style.fill(original);
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Additional edit for this rebuild', exact: true }).fill('More direct');
  await expect(page.getByText('Awaiting edit', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional edit for this rebuild', exact: true })).toHaveValue('');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
});

test('keyboard composition, cancellation and new-draft confirmation', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Add a thought', exact: true });
  await composer.fill('確認');
  await composer.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(composer).toHaveValue('確認');
  await composer.press('Shift+Enter'); await composer.press('a'); await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Build cancelled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New draft', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Start a new draft?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep working' }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'New draft', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.entry')).toHaveCount(0);
});

test('quick model preset, duplicate, rename, removal and default style', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.toolbar').getByRole('button', { name: /preset/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.getByRole('combobox', { name: 'Edit preset', exact: true }).selectOption('default-codex');
  await expect(page.getByRole('textbox', { name: 'Model ID for Codex', exact: true })).toHaveValue('gpt-6-luna');
  await expect(page.getByRole('combobox', { name: 'Reasoning Effort for Codex', exact: true })).toHaveValue('medium');
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name for New preset', exact: true }).fill('OpenCode — quick');
  await page.getByRole('textbox', { name: 'Model ID for OpenCode — quick', exact: true }).fill('provider/quick');
  await page.getByRole('combobox', { name: 'Reasoning Effort for OpenCode — quick', exact: true }).fill('low');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Active preset' })).toHaveValue(/.+/);
  await expect(page.getByRole('combobox', { name: 'Active preset' }).locator('option:checked')).toHaveText('OpenCode — quick');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Saved default style', exact: false }).fill('Be warm and brief.');
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate preset OpenCode — quick', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Model ID for OpenCode — quick — copy', exact: true })).toHaveValue('provider/quick');
  await expect(page.getByRole('combobox', { name: 'Reasoning Effort for OpenCode — quick — copy', exact: true })).toHaveValue('low');
  await page.getByRole('button', { name: 'Delete OpenCode — quick — copy', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Active preset' }).locator('option:checked')).toHaveText('OpenCode');
  await page.getByRole('button', { name: 'New draft', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await thought(page, 'Hello'); await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await page.getByText('Session style', { exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Session style', exact: true })).toHaveValue('Be warm and brief.');
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`visual review scenarios · ${colorScheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.screenshot({ path: testInfo.outputPath(`capture-${colorScheme}.png`) });
    await thought(page, 'found a crash reconnecting after a timeout');
    await thought(page, 'fix is in review — hold the next build until verified');
    await thought(page, 'can someone test reconnects this afternoon? especially Windows');
    await page.screenshot({ path: testInfo.outputPath(`capture-filled-${colorScheme}.png`) });
    await page.getByRole('button', { name: 'Build message', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`review-${colorScheme}.png`) });
    await expect(page.getByRole('separator')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Source thoughts' })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(640);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Presets', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`preset-${colorScheme}.png`) });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Back to thoughts', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Add a thought', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Edit thought 2', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`editing-${colorScheme}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Edit thought 2', exact: true })).toHaveCount(0);
  });
}

test('creates an arbitrary CLI template and edits its arguments without JSON', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'New command template', exact: true }).click();
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('My local writer');
  await expect(page.getByRole('combobox', { name: 'Output parser', exact: true })).toHaveCount(0);
  await expect(page.getByText('One response format for every command', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Command template', exact: true }).fill('my-writing-cli --custom-mode --model {{MODEL_ID}} --effort {{REASONING_EFFORT}}');
  await page.screenshot({ path: testInfo.outputPath('custom-template.png') });
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Presets', exact: true }).click();
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name for New preset', exact: true }).fill('My local writer');
  await page.getByRole('combobox', { name: 'Template for My local writer', exact: true }).selectOption({ label: 'My local writer' });
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Active preset' }).locator('option:checked')).toHaveText('My local writer');
  await thought(page, 'A thought for the custom template');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Edit template My local writer', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Command template', exact: true })).toHaveValue('my-writing-cli --custom-mode --model {{MODEL_ID}} --effort {{REASONING_EFFORT}}');
  await page.getByRole('textbox', { name: 'Command template', exact: true }).fill('my-writing-cli --different-mode');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('Out of date', { exact: true })).toBeVisible();
});

for (const size of [{ width: 640, height: 480 }, { width: 560, height: 420 }]) {
  test(`compact controls and placement settings fit at ${size.width}×${size.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await thought(page, 'Keep the capture and build controls compact.');
    const composer = await page.getByRole('textbox', { name: 'Add a thought', exact: true }).boundingBox();
    const build = await page.getByRole('button', { name: 'Build message', exact: true }).boundingBox();
    expect(composer!.y).toBe(build!.y);
    expect(build!.x).toBeGreaterThan(composer!.x + composer!.width);
    expect(build!.y + build!.height).toBeLessThan(size.height);
    await page.getByRole('button', { name: 'Build message', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    const toolbar = await page.locator('.message-toolbar').boundingBox();
    const copy = await page.getByRole('button', { name: 'Copy message', exact: true }).boundingBox();
    expect(copy!.y).toBeGreaterThanOrEqual(toolbar!.y);
    expect(copy!.y + copy!.height).toBeLessThanOrEqual(toolbar!.y + toolbar!.height);
    const rebuild = await page.getByRole('button', { name: 'Rebuild', exact: true }).boundingBox();
    expect(rebuild!.y + rebuild!.height).toBeLessThan(size.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    await page.screenshot({ path: testInfo.outputPath('compact-review.png') });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Placement', exact: true }).click();
    const defaults = page.getByRole('group', { name: 'Default placement', exact: true });
    await defaults.getByRole('radio', { name: 'Top right' }).check();
    await page.getByRole('textbox', { name: 'Default placement offset X' }).fill('-24');
    await page.getByRole('textbox', { name: 'Default placement width', exact: true }).fill('800');
    await page.getByRole('textbox', { name: 'Default placement height', exact: true }).fill('600');
    await page.getByRole('searchbox', { name: 'Search applications' }).fill('Safari');
    await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption('com.apple.Safari');
    await page.getByRole('button', { name: 'Add override' }).click();
    const offset = page.getByRole('textbox', { name: 'Safari placement offset X' });
    await expect(offset).toHaveValue('-24');
    await offset.fill('-48');
    await page.getByRole('textbox', { name: 'Safari placement offset Y' }).fill('16');
    await expect(page.getByRole('textbox', { name: 'Safari placement width', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Safari placement width', exact: true })).toHaveAttribute('placeholder', 'Default (800)');
    await page.getByRole('textbox', { name: 'Safari placement width', exact: true }).fill('960');
    await page.getByRole('textbox', { name: 'Safari placement height', exact: true }).fill('720');
    await page.getByRole('textbox', { name: 'Safari placement width', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('placement-settings.png') });
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Placement', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Safari placement offset X' })).toHaveValue('-48');
    await expect(page.getByRole('textbox', { name: 'Safari placement offset Y' })).toHaveValue('16');
    await expect(page.getByRole('textbox', { name: 'Default placement width', exact: true })).toHaveValue('800');
    await expect(page.getByRole('textbox', { name: 'Default placement height', exact: true })).toHaveValue('600');
    await expect(page.getByRole('textbox', { name: 'Safari placement width', exact: true })).toHaveValue('960');
    await expect(page.getByRole('textbox', { name: 'Safari placement height', exact: true })).toHaveValue('720');
    await page.getByRole('textbox', { name: 'Safari placement height', exact: true }).fill('');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Placement', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Safari placement height', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Safari placement height', exact: true })).toHaveAttribute('placeholder', 'Default (600)');
    await page.getByRole('button', { name: 'Remove placement for Safari' }).click();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByTestId('message')).toHaveText('Keep the capture and build controls compact.');
  });
}

test('custom argv transport requires an explicit prompt argument', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'New command template', exact: true }).click();
  await page.getByRole('textbox', { name: 'Template name', exact: true }).fill('Argument writer');
  await page.getByRole('textbox', { name: 'Command template', exact: true }).fill('any-cli');
  await page.getByRole('combobox', { name: 'Prompt transport', exact: true }).selectOption('argument');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Argument transport needs exactly one {{PROMPT}} variable.');
  await page.getByRole('textbox', { name: 'Command template', exact: true }).fill('any-cli {{PROMPT}}');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('diagnostics preview is opt-in and cancellation does not consume the composer', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Preview generated command before build' }).check();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Add a thought', exact: true });
  await composer.fill('Private literal {{MODEL_ID}} ; $(not-a-shell)');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Generated command preview' })).toBeVisible();
  await expect(page.getByTestId('command-preview')).toContainText('Offline demo');
  await expect(page.getByTestId('stdin-preview')).toContainText('Private literal {{MODEL_ID}}');
  await page.screenshot({ path: testInfo.outputPath('diagnostics-preview.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(composer).toHaveValue('Private literal {{MODEL_ID}} ; $(not-a-shell)');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await page.getByRole('button', { name: 'Run build', exact: true }).click();
  await expect(page.getByTestId('message')).toHaveText('Private literal {{MODEL_ID}} ; $(not-a-shell)');
});

test('failed response asks before displaying diagnostic output', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 560, height: 420 });
  await page.goto('/');
  await thought(page, 'Preserve the last successful message.');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByTestId('message')).toHaveText('Preserve the last successful message.');
  // Explicit browser-only fixtures: never launch a harness or expose a production switch.
  await page.evaluate(async () => {
    const path = '/src/native/client.ts';
    const { api } = await import(path);
    const fixture = window as typeof window & { diagnosticReads: number };
    fixture.diagnosticReads = 0;
    api.build = async (request: { runId: string; draftId: string }) => ({ runId: request.runId, draftId: request.draftId, kind: 'failed', durationMs: 1, code: 'ProtocolError', message: 'ProtocolError: no matching Ramble response.', diagnosticsAvailable: true });
    api.takeHarnessOutput = async (runId: string) => { fixture.diagnosticReads++; return { runId, stdout: 'unstructured <script>not executable</script>\nline 2', stderr: 'synthetic diagnostic detail', stdoutTruncated: false, stderrTruncated: false }; };
    api.discardHarnessOutput = async () => {};
  });
  await page.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(page.getByText(/Would you like to view the harness output/)).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { diagnosticReads: number }).diagnosticReads)).toBe(0);
  await expect(page.getByTestId('harness-stdout')).toHaveCount(0);
  await page.getByRole('button', { name: 'View harness output', exact: true }).click();
  await expect(page.getByTestId('harness-stdout')).toContainText('<script>not executable</script>');
  await expect(page.getByTestId('harness-stderr')).toHaveText('synthetic diagnostic detail');
  await expect(page.locator('[data-testid="harness-stdout"] script')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('failed-output.png') });
  await page.getByRole('button', { name: 'Close output', exact: true }).click();
  await expect(page.getByTestId('harness-stdout')).toHaveCount(0);
  await expect(page.getByTestId('message')).toHaveText('Preserve the last successful message.');
});

test('switches views at minimum size without losing pending edits or the message', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 420 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Draft views' })).toHaveCount(0);
  await expect(page.locator('.message-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View message', exact: true })).toHaveCount(0);
  await thought(page, 'Keep these thoughts');
  await page.getByRole('button', { name: 'Build message', exact: true }).click();
  await expect(page.getByTestId('message')).toHaveText('Keep these thoughts');
  const edit = page.getByRole('textbox', { name: 'Additional edit for this rebuild', exact: true });
  await edit.fill('Make it warmer');
  await page.getByRole('button', { name: 'Back to thoughts', exact: true }).click();
  await expect(page.locator('.message-toolbar')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Final message' })).toBeHidden();
  await page.getByRole('textbox', { name: 'Add a thought', exact: true }).fill('Unsubmitted note');
  await page.getByRole('button', { name: 'View message', exact: true }).click();
  await expect(edit).toHaveValue('Make it warmer');
  await expect(page.getByTestId('message')).toHaveText('Keep these thoughts');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(560);
  await page.getByRole('button', { name: 'Back to thoughts', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Add a thought', exact: true })).toHaveValue('Unsubmitted note');
  // Reserve the native traffic-light area, even in the browser fixture.
  await page.locator('main').evaluate(el => el.setAttribute('data-native-mac', 'true'));
  for (const control of await page.locator('.toolbar button, .toolbar select').all()) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(96);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(560);
  }

});
