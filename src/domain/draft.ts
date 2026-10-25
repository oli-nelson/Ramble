import type { BuildOutcome, BuildSnapshot, DraftState, Entry, Settings } from './types';

export function newDraft(settings: Settings, id: string = crypto.randomUUID()): DraftState {
  return { id, entries: [], composer: '', inlineEdit: null, style: settings.defaultStyle,
    pendingEdit: { text: '', revision: 0 }, selectedPresetId: settings.selectedPresetId,
    result: null, run: { kind: 'idle' }, revealed: false, deleted: null };
}

// Canonical, in-memory comparison includes literal text and resolved semantic config.
// No timestamps, IDs, display names, settings revision, or consumed edits.
export function inputKey(state: DraftState, settings: Settings): string {
  const preset = settings.presets.find(p => p.id === state.selectedPresetId);
  const template = settings.templates.find(t => t.id === preset?.templateId);
  return JSON.stringify({ promptVersion: 3,
    source: [...state.entries.map(e => e.text), ...(state.composer.trim() ? [state.composer] : [])],
    style: state.style,
    config: preset && template ? { templateId: template.id, templateVersion: template.version,
      adapterVersion: template.adapterVersion, executable: preset.parameters.executable || '',
      command: template.command, promptTransport: template.promptTransport,
      model: preset.parameters.model || '', reasoningEffort: preset.parameters.reasoningEffort || '' } : null });
}
export const isStale = (s: DraftState, settings: Settings) => !!s.result && inputKey(s, settings) !== s.result.snapshot.inputKey;
export const hasContent = (s: DraftState) => !!(s.entries.length || s.composer || s.inlineEdit || s.result || s.pendingEdit.text);
export const canBuild = (s: DraftState) => s.run.kind !== 'running' && !s.inlineEdit && !!(s.entries.length || s.composer.trim());

export type Action =
  | { type: 'composer'; text: string }
  | { type: 'submit'; entry: Entry }
  | { type: 'edit'; entryId: string }
  | { type: 'editText'; text: string }
  | { type: 'saveEdit'; now: number }
  | { type: 'cancelEdit' }
  | { type: 'delete'; entryId: string; now: number }
  | { type: 'undo'; now: number }
  | { type: 'expireUndo'; now: number }
  | { type: 'style'; text: string }
  | { type: 'pendingEdit'; text: string }
  | { type: 'preset'; id: string }
  | { type: 'start'; snapshot: BuildSnapshot; composerEntry: Entry | null }
  | { type: 'outcome'; outcome: BuildOutcome }
  | { type: 'summon'; settings: Settings; id: string }
  | { type: 'reset'; settings: Settings; id: string };

export function reducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {
    case 'composer': return { ...state, composer: action.text };
    case 'submit': return state.composer.trim() ? { ...state, entries: [...state.entries, action.entry], composer: '' } : state;
    case 'edit': {
      const entry = state.entries.find(e => e.id === action.entryId);
      return entry ? { ...state, inlineEdit: { entryId: entry.id, text: entry.text } } : state;
    }
    case 'editText': return state.inlineEdit ? { ...state, inlineEdit: { ...state.inlineEdit, text: action.text } } : state;
    case 'saveEdit': return state.inlineEdit?.text.trim() ? { ...state,
      entries: state.entries.map(e => e.id === state.inlineEdit!.entryId ? { ...e, text: state.inlineEdit!.text, updatedAt: action.now } : e), inlineEdit: null } : state;
    case 'cancelEdit': return { ...state, inlineEdit: null };
    case 'delete': {
      if (state.inlineEdit) return state;
      const index = state.entries.findIndex(e => e.id === action.entryId);
      return index < 0 ? state : { ...state, entries: state.entries.filter(e => e.id !== action.entryId),
        deleted: { entry: state.entries[index], index, expiresAt: action.now + 6000 } };
    }
    case 'undo': {
      if (!state.deleted || action.now > state.deleted.expiresAt) return { ...state, deleted: null };
      const entries = [...state.entries];
      entries.splice(state.deleted.index, 0, state.deleted.entry);
      return { ...state, entries, deleted: null };
    }
    case 'expireUndo': return state.deleted && action.now >= state.deleted.expiresAt ? { ...state, deleted: null } : state;
    case 'style': return { ...state, style: action.text };
    case 'pendingEdit': return { ...state, pendingEdit: { text: action.text, revision: state.pendingEdit.revision + 1 } };
    case 'preset': return { ...state, selectedPresetId: action.id };
    case 'reset': return state.run.kind === 'running' ? state : newDraft(action.settings, action.id);
    case 'summon': return newDraft(action.settings, action.id);
    case 'start': return canBuild(state) ? { ...state, revealed: true,
      entries: action.composerEntry ? [...state.entries, action.composerEntry] : state.entries,
      composer: '', run: { kind: 'running', snapshot: action.snapshot } } : state;
    case 'outcome': {
      const { outcome } = action;
      if (state.run.kind !== 'running' || outcome.runId !== state.run.snapshot.request.runId || outcome.draftId !== state.id) return state;
      const snapshot = state.run.snapshot;
      if (outcome.kind === 'succeeded' && outcome.text?.trim()) {
        const consume = !!snapshot.request.revision && state.pendingEdit.revision === snapshot.pendingRevision && state.pendingEdit.text === snapshot.request.revision.instruction;
        return { ...state, run: { kind: 'idle' }, result: { text: outcome.text, snapshot, completedAt: Date.now() },
          pendingEdit: consume ? { text: '', revision: state.pendingEdit.revision + 1 } : state.pendingEdit };
      }
      return { ...state, run: { kind: outcome.kind === 'succeeded' ? 'failed' : outcome.kind,
        runId: outcome.runId, diagnosticsAvailable: outcome.diagnosticsAvailable,
        message: outcome.message || (outcome.kind === 'cancelled' ? 'Build cancelled. Your last message is unchanged.' : 'No valid message was returned. Please retry.') } };
    }
  }
}

export const makeEntry = (text: string): Entry => ({ id: crypto.randomUUID(), text, createdAt: Date.now(), updatedAt: Date.now() });
export function prepareBuild(state: DraftState, settings: Settings): { snapshot: BuildSnapshot; composerEntry: Entry | null } {
  if (!canBuild(state)) throw new Error('Save or cancel the inline edit, and provide at least one thought.');
  const composerEntry = state.composer.trim() ? makeEntry(state.composer) : null;
  const preset = settings.presets.find(p => p.id === state.selectedPresetId);
  if (!preset) throw new Error('Select a valid preset.');
  return { composerEntry, snapshot: {
    request: { runId: crypto.randomUUID(), draftId: state.id,
      source: [...state.entries.map(e => e.text), ...(composerEntry ? [composerEntry.text] : [])],
      style: state.style, presetId: preset.id, expectedSettingsRevision: settings.revision,
      revision: state.result && state.pendingEdit.text.trim() ? { previousText: state.result.text, instruction: state.pendingEdit.text } : null },
    inputKey: inputKey(state, settings), pendingRevision: state.pendingEdit.revision, presetName: preset.name, startedAt: Date.now(),
  } };
}
