import { invoke, isTauri } from '@tauri-apps/api/core';
import { defaultSettings } from '../domain/defaults';
import type { BuildOutcome, BuildPreview, BuildRequest, HarnessOutput, PlacementContext, Settings, SettingsEnvelope } from '../domain/types';

export const demo = import.meta.env.MODE === 'demo';
let demoSettings = defaultSettings();
let demoRun: { id: string; controller: AbortController } | null = null;

async function native<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Open Ramble as a desktop app, or use npm run dev:demo for an offline UI demonstration.');
  return invoke<T>(command, args).catch((e: unknown) => { throw new Error(typeof e === 'string' ? e : 'The desktop operation failed. Please retry.'); });
}
export const api = {
  takeHarnessOutput: (runId: string): Promise<HarnessOutput> => demo ? Promise.reject(new Error('No native harness output exists in the offline demo.')) : native('take_harness_output', { runId }),
  discardHarnessOutput: async (runId: string): Promise<void> => { if (!demo) await native('discard_harness_output', { runId }); },
  previewBuild: (request: BuildRequest): Promise<BuildPreview> => demo ? Promise.resolve({ command: 'Offline demo — no executable is resolved or launched. Native command preview requires the desktop app.', stdin: JSON.stringify(request, null, 2) }) : native('preview_build', { request }),
  getSettings: (): Promise<SettingsEnvelope> => demo ? Promise.resolve({ settings: demoSettings, warning: null, readOnly: false }) : native('get_settings'),
  saveSettings: async (settings: Settings): Promise<SettingsEnvelope> => {
    if (!demo) return native('update_settings', { expectedRevision: settings.revision, settings });
    if (settings.revision !== demoSettings.revision) throw new Error('Settings changed. Reopen settings and retry.');
    demoSettings = { ...settings, revision: settings.revision + 1 };
    return { settings: demoSettings, warning: null, readOnly: false };
  },
  build: async (request: BuildRequest): Promise<BuildOutcome> => {
    if (!demo) return native('start_build', { request });
    if (demoRun) throw new Error('A build is already running.');
    const controller = new AbortController();
    demoRun = { id: request.runId, controller };
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 700);
      controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    demoRun = null;
    return { runId: request.runId, draftId: request.draftId, durationMs: 700,
      ...(controller.signal.aborted ? { kind: 'cancelled' as const } : { kind: 'succeeded' as const,
        // Deliberately not an AI rewrite. This path is never included in production behavior.
        text: request.source.join('\n\n') }) };
  },
  cancel: async (runId: string): Promise<void> => { if (demo) demoRun?.id === runId && demoRun.controller.abort(); else await native('cancel_build', { runId }); },
  abandonRun: async (runId: string): Promise<void> => { if (demo) demoRun?.id === runId && demoRun.controller.abort(); else await native('abandon_build', { runId }); },
  copy: async (text: string): Promise<void> => { if (demo) await navigator.clipboard.writeText(text); else await native('copy_result', { text }); },
  hide: async (): Promise<void> => { if (!demo) await native('hide_window'); },
  hideAndRestoreFocus: async (): Promise<void> => { if (!demo) await native('hide_and_restore_focus'); },
  hideRestoreAndPaste: async (): Promise<void> => { if (!demo) await native('hide_restore_and_paste'); },
  quit: async (): Promise<void> => { if (!demo) await native('request_quit'); },
  setDirty: async (dirty: boolean): Promise<void> => { if (!demo && isTauri()) await native('set_draft_dirty', { dirty }); },
  inspect: (presetId: string): Promise<{ resolvedPath: string | null; limitation: string }> => demo ? Promise.resolve({ resolvedPath: null, limitation: 'Offline demonstration: no subprocesses or models are used.' }) : native('inspect_preset', { presetId }),
  placementMessage: (): Promise<string | null> => demo ? Promise.resolve(null) : native('get_placement_message'),
  placementContext: (): Promise<PlacementContext> => demo ? Promise.resolve({
    applications: [{ id: 'com.microsoft.VSCode', name: 'Visual Studio Code' }, { id: 'com.apple.Safari', name: 'Safari' }, { id: 'com.tinyspeck.slackmacgap', name: 'Slack' }],
    lastApplication: { id: 'com.microsoft.VSCode', name: 'Visual Studio Code' }, accessibilityRequired: false, accessibilityGranted: true, message: null,
  }) : native('get_placement_context'),
  requestPlacementAccess: (): Promise<boolean> => demo ? Promise.resolve(false) : native('request_placement_access'),
};
