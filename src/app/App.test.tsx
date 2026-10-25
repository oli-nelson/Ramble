import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { defaultSettings } from '../domain/defaults';
import { api } from '../native/client';
import { App } from './App';
import type { BuildOutcome, BuildRequest } from '../domain/types';

vi.mock('../native/client', () => ({
  demo: false,
  api: { getSettings: vi.fn(), saveSettings: vi.fn(), build: vi.fn(), copy: vi.fn(), hide: vi.fn(), hideAndRestoreFocus: vi.fn(), hideRestoreAndPaste: vi.fn(), quit: vi.fn(), setDirty: vi.fn(), cancel: vi.fn(), abandonRun: vi.fn(), previewBuild: vi.fn(), takeHarnessOutput: vi.fn(), discardHarnessOutput: vi.fn(), placementMessage: vi.fn() },
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
const nativeEvents = new Map<string, EventCallback<unknown>>();

async function nativeEvent(event: string) {
  await act(async () => { nativeEvents.get(event)?.({ event, id: 0, payload: undefined }); });
}

beforeEach(() => {
  nativeEvents.clear();
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    const handler = callback as EventCallback<unknown>;
    nativeEvents.set(event, handler);
    return () => { if (nativeEvents.get(event) === handler) nativeEvents.delete(event); };
  });
  vi.mocked(api.getSettings).mockResolvedValue({ settings: defaultSettings(), warning: null, readOnly: false });
  vi.mocked(api.setDirty).mockResolvedValue();
  vi.mocked(api.copy).mockResolvedValue();
  vi.mocked(api.hide).mockResolvedValue();
  vi.mocked(api.hideAndRestoreFocus).mockResolvedValue();
  vi.mocked(api.hideRestoreAndPaste).mockResolvedValue();
  vi.mocked(api.discardHarnessOutput).mockResolvedValue();
  vi.mocked(api.abandonRun).mockResolvedValue();
  vi.mocked(api.placementMessage).mockResolvedValue(null);
  vi.mocked(api.saveSettings).mockImplementation(async settings => ({ settings, readOnly: false, warning: null }));
  Element.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); });

async function capture() {
  render(<App />);
  const composer = await screen.findByRole('textbox', { name: 'Add a thought' });
  fireEvent.change(composer, { target: { value: '  literal 🦊 source\n$(touch nope)  ' } });
  return composer;
}

function success(request: BuildRequest, text = '  Final text\n```literal```  '): BuildOutcome {
  return { runId: request.runId, draftId: request.draftId, kind: 'succeeded', text, durationMs: 1 };
}

describe('native-facing UI', () => {
  it('shortcut summon starts a fresh Thoughts draft, while ordinary reopening preserves the message', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(api.build).mockImplementation(async request => success(request));
    const composer = await capture();
    fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    const previous = vi.mocked(api.build).mock.calls[0][0];
    fireEvent.change(screen.getByRole('textbox', { name: 'Additional edit for this rebuild' }), { target: { value: 'Old edit' } });
    await nativeEvent('ramble:focus');
    expect(screen.getByTestId('message')).toBeVisible();
    expect(api.abandonRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await nativeEvent('ramble:summon');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('message')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View message' })).toBeNull();
    expect(composer).toHaveValue(''); expect(composer).toHaveFocus();
    expect(document.querySelectorAll('.entry')).toHaveLength(0);
    expect(api.abandonRun).toHaveBeenCalledWith(previous.runId);
    fireEvent.change(composer, { target: { value: 'Fresh thoughts only' } });
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
    await screen.findByTestId('message');
    const next = vi.mocked(api.build).mock.calls[1][0];
    expect(next.draftId).not.toBe(previous.draftId);
    expect(next.source).toEqual(['Fresh thoughts only']); expect(next.revision).toBeNull();
    expect(next.style).toBe(defaultSettings().defaultStyle);
    expect(api.quit).not.toHaveBeenCalled();
  });

  it('summon resets and focuses even when Thoughts already contains an open inline edit', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const composer = await capture();
    fireEvent.click(screen.getByRole('button', { name: 'Submit thought' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit thought 1' }));
    await nativeEvent('ramble:summon');
    expect(screen.queryByRole('textbox', { name: 'Edit thought 1' })).toBeNull();
    expect(composer).toHaveValue(''); expect(composer).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Build message' })).toBeDisabled();
    fireEvent.change(composer, { target: { value: 'Unsubmitted text' } });
    await nativeEvent('ramble:summon');
    expect(composer).toHaveValue(''); expect(composer).toHaveFocus();
    expect(vi.mocked(listen).mock.calls.filter(([event]) => event === 'ramble:summon')).toHaveLength(1);
  });

  it('abandons old work, allows immediate typing, and joins cleanup before another generation', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let finish!: (outcome: BuildOutcome) => void;
    vi.mocked(api.build).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async request => success(request, 'New result'));
    const composer = await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    const old = vi.mocked(api.build).mock.calls[0][0];
    await nativeEvent('ramble:summon');
    expect(composer).toHaveFocus(); expect(composer).toHaveValue('');
    expect(api.abandonRun).toHaveBeenCalledWith(old.runId);
    fireEvent.change(composer, { target: { value: 'Discarded by another summon' } });
    await nativeEvent('ramble:summon');
    fireEvent.change(composer, { target: { value: 'Keep this new draft' } });
    expect(screen.getByRole('button', { name: 'Finishing cleanup…' })).toBeDisabled();
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
    expect(api.build).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ...success(old), kind: 'failed', text: undefined, diagnosticsAvailable: true, message: 'Old failure must not appear' }));
    expect(api.discardHarnessOutput).toHaveBeenCalledWith(old.runId);
    expect(screen.queryByText('Old failure must not appear')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View harness output' })).toBeNull();
    expect(composer).toHaveValue('Keep this new draft');
    fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    expect(await screen.findByTestId('message')).toHaveTextContent('New result');
    expect(vi.mocked(api.build).mock.calls[1][0].source).toEqual(['Keep this new draft']);
    expect(vi.mocked(api.build).mock.calls[1][0].draftId).not.toBe(old.draftId);
  });

  it('dismisses pending command previews and does not resurrect their late reply after summon', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let finish!: (preview: Awaited<ReturnType<typeof api.previewBuild>>) => void;
    vi.mocked(api.previewBuild).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const composer = await capture();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Preview generated command before build' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByRole('dialog', { name: 'Generated command preview' });
    await nativeEvent('ramble:summon');
    await act(async () => finish({ command: 'Old private preview', stdin: '' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Old private preview')).toBeNull();
    expect(composer).toHaveValue(''); expect(composer).toHaveFocus();
    expect(api.build).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not hide or paste into a fresh draft after a late copy reply (shift=%s)', async shiftKey => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(api.build).mockImplementation(async request => success(request));
    let finish!: () => void;
    vi.mocked(api.copy).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const composer = await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true, shiftKey });
    await nativeEvent('ramble:summon');
    fireEvent.change(composer, { target: { value: 'Do not hide this fresh draft' } });
    await act(async () => finish());
    expect(api.hide).not.toHaveBeenCalled();
    expect(screen.queryByText('Message copied.')).toBeNull();
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
    expect(api.hideRestoreAndPaste).not.toHaveBeenCalled();
    expect(composer).toHaveValue('Do not hide this fresh draft'); expect(composer).toHaveFocus();
  });

  it('asks before fetching failed harness output and renders private diagnostics only as text', async () => {
    vi.mocked(api.build).mockImplementationOnce(async r => success(r)).mockImplementationOnce(async r => ({ ...success(r), kind: 'failed', text: undefined, diagnosticsAvailable: true, message: 'ProtocolError: no matching response.' }));
    vi.mocked(api.takeHarnessOutput).mockImplementation(async runId => ({ runId, stdout: '<script>private stdout</script>', stderr: 'private stderr', stdoutTruncated: true, stderrTruncated: false }));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message'); fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));
    expect(await screen.findByText(/Would you like to view the harness output/)).toBeVisible();
    expect(api.takeHarnessOutput).not.toHaveBeenCalled();
    expect(screen.queryByTestId('harness-stdout')).toBeNull();
    expect(screen.getByTestId('message')).toHaveTextContent('Final text');
    fireEvent.click(screen.getByRole('button', { name: 'View harness output' }));
    expect(await screen.findByTestId('harness-stdout')).toHaveTextContent('<script>private stdout</script>');
    expect(screen.getByTestId('harness-stderr')).toHaveTextContent('private stderr');
    expect(document.querySelector('script')).toBeNull();
    expect(api.takeHarnessOutput).toHaveBeenCalledExactlyOnceWith(vi.mocked(api.build).mock.calls[1][0].runId);
    expect(api.copy).not.toHaveBeenCalled(); expect(api.saveSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close output' }));
    expect(screen.queryByTestId('harness-stdout')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View harness output' })).toBeNull();
  });

  it('discards declined output without reading it and clears it when starting a new draft', async () => {
    vi.mocked(api.build).mockImplementation(async r => ({ ...success(r), kind: 'failed', text: undefined, diagnosticsAvailable: true, message: 'ProtocolError: missing ramble_response.' }));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    const runId = vi.mocked(api.build).mock.calls[0][0].runId;
    expect(api.discardHarnessOutput).toHaveBeenCalledWith(runId);
    expect(api.takeHarnessOutput).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'View harness output' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.queryByText('ProtocolError: missing ramble_response.')).toBeNull();
  });

  it('does not reopen a closed output viewer when its private IPC reply arrives late', async () => {
    vi.mocked(api.build).mockImplementation(async r => ({ ...success(r), kind: 'failed', text: undefined, diagnosticsAvailable: true, message: 'ProtocolError: missing response.' }));
    let finish!: (output: Awaited<ReturnType<typeof api.takeHarnessOutput>>) => void;
    vi.mocked(api.takeHarnessOutput).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View harness output' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close output' }));
    await act(async () => finish({ runId: vi.mocked(api.build).mock.calls[0][0].runId, stdout: 'private late output', stderr: '', stdoutTruncated: false, stderrTruncated: false }));
    expect(screen.queryByText('private late output')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('edits an existing inactive preset without silently selecting it', async () => {
    await capture();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Edit preset' }), { target: { value: 'default-codex' } });
    expect(screen.getByRole('textbox', { name: 'Model ID for Codex' })).toHaveValue('gpt-6-luna');
    expect(screen.getByRole('combobox', { name: 'Reasoning Effort for Codex' })).toHaveValue('medium');
    fireEvent.change(screen.getByRole('combobox', { name: 'Reasoning Effort for Codex' }), { target: { value: 'low' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveSettings).mock.calls[0][0].selectedPresetId).toBe('default-opencode');
    expect(screen.getByRole('combobox', { name: 'Active preset' })).toHaveDisplayValue('OpenCode');
  });
  it('manages model/effort and duplication in Settings without toolbar preset buttons', async () => {
    await capture();
    expect(document.querySelector('.toolbar')!.textContent).not.toContain('New preset');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Developer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Model ID for OpenCode' }), { target: { value: 'provider/model' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Reasoning Effort for OpenCode' }), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate preset OpenCode' }));
    expect(screen.getByRole('textbox', { name: 'Model ID for OpenCode — copy' })).toHaveValue('provider/model');
    expect(screen.getByRole('combobox', { name: 'Reasoning Effort for OpenCode — copy' })).toHaveValue('high');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Active preset' })).toHaveDisplayValue('OpenCode — copy'));
    const saved = vi.mocked(api.saveSettings).mock.calls[0][0];
    expect(saved.presets[0].parameters).toEqual({ model: 'provider/model', reasoningEffort: 'high' });
  });

  it('previews a frozen native invocation only when enabled and launches only after confirmation', async () => {
    vi.mocked(api.previewBuild).mockResolvedValue({ command: '"writer" "<script>private</script> {{MODEL_ID}}"', stdin: 'Private stdin\n$(not-a-shell)' });
    vi.mocked(api.build).mockImplementation(async request => success(request));
    const composer = await capture();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Diagnostics' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Preview generated command before build' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    expect(await screen.findByTestId('command-preview')).toHaveTextContent('<script>private</script> {{MODEL_ID}}');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByTestId('stdin-preview')).toHaveTextContent('Private stdin');
    expect(api.build).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(composer).toHaveValue('  literal 🦊 source\n$(touch nope)  ');
    fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('command-preview');
    const request = vi.mocked(api.previewBuild).mock.calls[1][0];
    fireEvent.click(screen.getByRole('button', { name: 'Run build' }));
    await screen.findByTestId('message');
    expect(api.build).toHaveBeenCalledExactlyOnceWith(request);
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('handles preview failure without launching or losing source', async () => {
    vi.mocked(api.previewBuild).mockRejectedValue(Error('ExecutableMissing: choose a valid path.'));
    const composer = await capture();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Diagnostics' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Preview generated command before build' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ExecutableMissing');
    expect(screen.getByRole('button', { name: 'Run build' })).toBeDisabled();
    expect(api.build).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(composer).not.toHaveValue('');
  });
  it('submits immutable source and copies only the final literal message', async () => {
    vi.mocked(api.build).mockImplementation(async request => success(request));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    const request = vi.mocked(api.build).mock.calls[0][0];
    expect(api.previewBuild).not.toHaveBeenCalled();
    expect(request.source).toEqual(['  literal 🦊 source\n$(touch nope)  ']);
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    await waitFor(() => expect(api.copy).toHaveBeenCalledExactlyOnceWith('  Final text\n```literal```  '));
    expect(await screen.findByText('Message copied.')).toBeVisible();
    expect(api.hide).not.toHaveBeenCalled();
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
  });
  it('keeps the last result through protocol failure and surfaces copy failure with retry', async () => {
    vi.mocked(api.build).mockImplementationOnce(async r => success(r)).mockImplementationOnce(async r => ({ ...success(r), kind: 'failed', text: undefined, message: 'ProtocolError: malformed output' }));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message'); fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));
    expect(await screen.findByText('ProtocolError: malformed output')).toBeVisible();
    expect(screen.getByTestId('message').textContent).toBe('  Final text\n```literal```  ');
    vi.mocked(api.copy).mockRejectedValueOnce(Error('Denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await screen.findByText('Couldn’t copy the message. Please try Copy again.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(await screen.findByText('Message copied.')).toBeVisible();
  });
  it('edits during native work never corrupt the captured request or freshness', async () => {
    let finish!: (outcome: BuildOutcome) => void;
    vi.mocked(api.build).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const composer = await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    const request = vi.mocked(api.build).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Back to thoughts' }));
    expect(composer).toHaveFocus();
    fireEvent.change(composer, { target: { value: 'New pending thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'View build' }));
    await act(async () => finish(success(request)));
    expect(await screen.findByText('Out of date', { exact: true })).toBeVisible();
    expect(request.source).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Copy last message (out of date)' })).toBeEnabled();
  });
  it('displays startup errors rather than silently providing demo output', async () => {
    vi.mocked(api.getSettings).mockRejectedValueOnce(Error('Desktop service unavailable'));
    render(<App />); expect(await screen.findByRole('alert')).toHaveTextContent('Desktop service unavailable');
    expect(api.build).not.toHaveBeenCalled();
  });

  it('has no thoughts navigation bar and reopens the preserved message without rebuilding', async () => {
    vi.mocked(api.build).mockImplementation(async request => success(request));
    const composer = await capture();
    expect(screen.queryByRole('navigation', { name: 'Draft views' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View message' })).toBeNull();
    expect(document.querySelector('.message-toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    fireEvent.change(screen.getByRole('textbox', { name: 'Additional edit for this rebuild' }), { target: { value: 'Warmer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to thoughts' }));
    expect(composer).toHaveFocus();
    expect(document.querySelector('.message-toolbar')).toBeNull();
    fireEvent.change(composer, { target: { value: 'Pending source' } });
    fireEvent.click(screen.getByRole('button', { name: 'View message' }));
    expect(screen.getByTestId('message')).toHaveTextContent('Final text');
    expect(screen.getByRole('textbox', { name: 'Additional edit for this rebuild' })).toHaveValue('Warmer');
    expect(api.build).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to thoughts' }));
    expect(composer).toHaveValue('Pending source');
  });

  it.each([{ platform: 'Mac', modifier: 'metaKey', label: '⌘ Enter' }, { platform: 'Windows', modifier: 'ctrlKey', label: 'Ctrl+Enter' }])('copies then hides and returns focus, never quits, on $platform message shortcut', async ({ platform, modifier, label }) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform);
    vi.mocked(api.build).mockImplementation(async request => success(request));
    let finish!: () => void;
    vi.mocked(api.copy).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    expect(screen.getByText(`${label} to copy & hide`)).toBeVisible();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Additional edit for this rebuild' }), { key: 'Enter', [modifier]: true });
    expect(api.copy).toHaveBeenCalledExactlyOnceWith('  Final text\n```literal```  ');
    expect(api.hide).not.toHaveBeenCalled();
    expect(api.hideRestoreAndPaste).not.toHaveBeenCalled();
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(api.hideAndRestoreFocus).toHaveBeenCalledTimes(1);
    expect(api.hide).not.toHaveBeenCalled();
    expect(api.quit).not.toHaveBeenCalled();
    expect(api.build).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('message')).toHaveTextContent('Final text');
  });

  it('keeps the window open when shortcut copying fails and allows retry', async () => {
    vi.mocked(api.build).mockImplementation(async request => success(request));
    vi.mocked(api.copy).mockRejectedValueOnce(Error('Denied'));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(await screen.findByText('Couldn’t copy the message. Please try Copy again.')).toBeVisible();
    expect(api.hide).not.toHaveBeenCalled(); expect(api.quit).not.toHaveBeenCalled();
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(api.hideAndRestoreFocus).toHaveBeenCalledTimes(1));
  });

  it('copies the last successful result while rebuilding but does nothing without a result', async () => {
    let finish!: (outcome: BuildOutcome) => void;
    vi.mocked(api.build).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(api.copy).not.toHaveBeenCalled(); expect(api.hide).not.toHaveBeenCalled();
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
    await act(async () => finish(success(vi.mocked(api.build).mock.calls[0][0])));
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }));
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(api.hideAndRestoreFocus).toHaveBeenCalledTimes(1));
    expect(api.copy).toHaveBeenCalledExactlyOnceWith('  Final text\n```literal```  ');
    expect(api.cancel).not.toHaveBeenCalled(); expect(api.quit).not.toHaveBeenCalled();
    await act(async () => finish(success(vi.mocked(api.build).mock.calls[1][0])));
  });

  it('retains build shortcut in Thoughts and ignores message shortcuts in dialogs or key repeat', async () => {
    vi.mocked(api.build).mockImplementation(async request => success(request));
    const composer = await capture();
    expect(screen.getByText('Ctrl+Enter to build')).toBeVisible();
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
    await screen.findByTestId('message');
    expect(api.build).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, repeat: true });
    expect(api.copy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(api.copy).not.toHaveBeenCalled(); expect(api.hide).not.toHaveBeenCalled();
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
  });

  it('reports a hide failure after successful copying without quitting or losing the result', async () => {
    vi.mocked(api.build).mockImplementation(async request => success(request));
    vi.mocked(api.hideAndRestoreFocus).mockRejectedValueOnce(Error('Unavailable'));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(await screen.findByText('Message copied, but Ramble couldn’t hide. Press Escape to retry.')).toBeVisible();
    expect(screen.getByTestId('message')).toHaveTextContent('Final text');
    expect(api.quit).not.toHaveBeenCalled();
  });

  it('Escape returns focus without copying, pasting or quitting', async () => {
    await capture();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(api.hideAndRestoreFocus).toHaveBeenCalledTimes(1));
    expect(api.hide).not.toHaveBeenCalled();
    expect(api.copy).not.toHaveBeenCalled();
    expect(api.hideRestoreAndPaste).not.toHaveBeenCalled();
    expect(api.quit).not.toHaveBeenCalled();
  });

  it.each([{ platform: 'Mac', modifier: 'metaKey', label: '⇧⌘ Enter' }, { platform: 'Windows', modifier: 'ctrlKey', label: 'Ctrl+Shift+Enter' }])('shift shortcut copies then requests one guarded paste on $platform', async ({ platform, modifier, label }) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform);
    vi.mocked(api.build).mockImplementation(async request => success(request));
    let copied!: () => void; let pasted!: () => void;
    vi.mocked(api.copy).mockImplementation(() => new Promise(resolve => { copied = resolve; }));
    vi.mocked(api.hideRestoreAndPaste).mockImplementation(() => new Promise(resolve => { pasted = resolve; }));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    expect(screen.getByText(`${label} to paste`)).toBeVisible();
    const press = () => fireEvent.keyDown(window, { key: 'Enter', [modifier]: true, shiftKey: true });
    press(); press();
    expect(api.copy).toHaveBeenCalledExactlyOnceWith('  Final text\n```literal```  ');
    expect(api.hideRestoreAndPaste).not.toHaveBeenCalled();
    await act(async () => copied());
    expect(api.hideRestoreAndPaste).toHaveBeenCalledTimes(1);
    press(); fireEvent.keyDown(window, { key: 'Enter', [modifier]: true, shiftKey: true, repeat: true });
    expect(api.copy).toHaveBeenCalledTimes(1);
    expect(api.hideRestoreAndPaste).toHaveBeenCalledTimes(1);
    expect(api.hide).not.toHaveBeenCalled(); expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
    expect(api.quit).not.toHaveBeenCalled(); expect(api.build).toHaveBeenCalledTimes(1);
    await act(async () => pasted());
  });

  it('does not build from the Shift shortcut in Thoughts or paste without a successful result', async () => {
    let finish!: (outcome: BuildOutcome) => void;
    vi.mocked(api.build).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const composer = await capture();
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(api.build).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(api.copy).not.toHaveBeenCalled(); expect(api.hideRestoreAndPaste).not.toHaveBeenCalled();
    await act(async () => finish(success(vi.mocked(api.build).mock.calls[0][0])));
  });

  it('copy failure never hides or pastes; paste denial reports an error without retrying the gesture', async () => {
    vi.mocked(api.build).mockImplementation(async request => success(request));
    vi.mocked(api.copy).mockRejectedValueOnce(Error('Clipboard unavailable'));
    vi.mocked(api.hideRestoreAndPaste).mockRejectedValueOnce(Error('Enable Accessibility access in Settings.'));
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Build message' }));
    await screen.findByTestId('message');
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true, shiftKey: true });
    expect(await screen.findByText('Couldn’t copy the message. Please try Copy again.')).toBeVisible();
    expect(api.hideRestoreAndPaste).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true, shiftKey: true });
    expect(await screen.findByText('Message copied. Paste action failed: Enable Accessibility access in Settings.')).toBeVisible();
    expect(api.hideRestoreAndPaste).toHaveBeenCalledTimes(1);
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled(); expect(api.hide).not.toHaveBeenCalled();
    expect(screen.getByTestId('message')).toHaveTextContent('Final text');
  });

  it('Escape still cancels an inline edit or belongs to a dialog before it can hide the window', async () => {
    await capture(); fireEvent.click(screen.getByRole('button', { name: 'Submit thought' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit thought 1' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit thought 1' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Edit thought 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(api.hideAndRestoreFocus).not.toHaveBeenCalled();
    expect(api.hideRestoreAndPaste).not.toHaveBeenCalled();
  });
});
