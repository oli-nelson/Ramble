export interface CommandTemplate {
  id: string;
  version: number;
  adapterVersion: number;
  name: string;
  command: string;
  promptTransport: 'stdin' | 'argument';
  description: string;
}
export interface Preset {
  id: string;
  name: string;
  templateId: string;
  templateVersion: number;
  parameters: { model?: string; reasoningEffort?: string; executable?: string };
}
export interface Settings {
  schemaVersion: 8;
  revision: number;
  defaultStyle: string;
  templates: CommandTemplate[];
  presets: Preset[];
  selectedPresetId: string;
  hotkey: string;
  timeoutSeconds: number;
  theme: 'system' | 'dark' | 'light';
  thoughtFontSize: number;
  messageFontSize: number;
  compactMode: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  placement: PlacementSettings;
}
export type Anchor = 'topLeft' | 'top' | 'topRight' | 'left' | 'center' | 'right' | 'bottomLeft' | 'bottom' | 'bottomRight';
export interface PlacementRule { anchor: Anchor; offsetX: number; offsetY: number; width: number | null; height: number | null }
export interface Application { id: string; name: string }
export interface ApplicationOverride { applicationId: string; applicationName: string; rule: PlacementRule }
export interface PlacementSettings { enabled: boolean; default: PlacementRule; overrides: ApplicationOverride[] }
export interface PlacementContext { applications: Application[]; lastApplication: Application | null; accessibilityRequired: boolean; accessibilityGranted: boolean; message: string | null }
export interface SettingsEnvelope { settings: Settings; warning: string | null; readOnly: boolean }
export interface Entry { id: string; text: string; createdAt: number; updatedAt: number }
export interface BuildRequest {
  runId: string;
  draftId: string;
  source: string[];
  style: string;
  presetId: string;
  expectedSettingsRevision: number;
  revision: { previousText: string; instruction: string } | null;
}
export interface BuildPreview { command: string; stdin: string }
export interface HarnessOutput { runId: string; stdout: string; stderr: string; stdoutTruncated: boolean; stderrTruncated: boolean }
export interface BuildSnapshot {
  request: BuildRequest;
  inputKey: string;
  pendingRevision: number;
  presetName: string;
  startedAt: number;
}
export type BuildOutcome = {
  runId: string;
  draftId: string;
  kind: 'succeeded' | 'failed' | 'cancelled' | 'timedOut';
  text?: string | null;
  code?: string | null;
  message?: string | null;
  durationMs: number;
  diagnosticsAvailable?: boolean;
};
export interface BuildResult { text: string; snapshot: BuildSnapshot; completedAt: number }
export interface DraftState {
  id: string;
  entries: Entry[];
  composer: string;
  inlineEdit: { entryId: string; text: string } | null;
  style: string;
  pendingEdit: { text: string; revision: number };
  selectedPresetId: string;
  result: BuildResult | null;
  run: { kind: 'idle' } | { kind: 'running'; snapshot: BuildSnapshot } | { kind: 'failed' | 'cancelled' | 'timedOut'; message: string; runId?: string; diagnosticsAvailable?: boolean };
  revealed: boolean;
  deleted: { entry: Entry; index: number; expiresAt: number } | null;
}
