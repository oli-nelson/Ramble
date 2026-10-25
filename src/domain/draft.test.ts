import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaults';
import { canBuild, inputKey, isStale, makeEntry, newDraft, prepareBuild, reducer } from './draft';
import type { DraftState, Settings } from './types';

function setup() {
  const settings = defaultSettings();
  let state = newDraft(settings);
  const send = (action: Parameters<typeof reducer>[1]) => { state = reducer(state, action); return state; };
  const thought = (text: string) => { send({ type: 'composer', text }); send({ type: 'submit', entry: makeEntry(text) }); };
  const start = () => { const prepared = prepareBuild(state, settings); send({ type: 'start', ...prepared }); return prepared.snapshot; };
  const succeed = (text = 'Final message') => { if (state.run.kind !== 'running') throw Error('Not running'); send({ type: 'outcome', outcome: { runId: state.run.snapshot.request.runId, draftId: state.id, kind: 'succeeded', text, durationMs: 1 } }); };
  return { settings, get state() { return state; }, send, thought, start, succeed };
}

describe('draft transactions', () => {
  it('preserves literal multiline Unicode entries and commits composer exactly once', () => {
    const s = setup(); s.thought('  Hello 🦊\nworld  '); s.send({ type: 'composer', text: '$(touch nope) "last"' });
    const snapshot = s.start();
    expect(snapshot.request.source).toEqual(['  Hello 🦊\nworld  ', '$(touch nope) "last"']);
    expect(s.state.composer).toBe(''); expect(s.state.entries).toHaveLength(2); expect(canBuild(s.state)).toBe(false);
    expect(() => s.start()).toThrow();
  });
  it('rejects blank entries and building while an inline edit is open', () => {
    const s = setup(); expect(canBuild(s.state)).toBe(false); s.thought('  \n '); expect(s.state.entries).toHaveLength(0);
    s.thought('First'); s.send({ type: 'edit', entryId: s.state.entries[0].id });
    expect(() => s.start()).toThrow(); expect(canBuild(s.state)).toBe(false);
    s.send({ type: 'editText', text: 'Revised' }); s.send({ type: 'saveEdit', now: 20 });
    expect(s.state.entries[0].text).toBe('Revised'); expect(canBuild(s.state)).toBe(true);
  });
  it('edits preserve identity and deletion undo preserves order', () => {
    const s = setup(); ['one', 'two', 'three'].forEach(s.thought); const id = s.state.entries[1].id;
    s.send({ type: 'edit', entryId: id }); s.send({ type: 'editText', text: 'TWO' }); s.send({ type: 'saveEdit', now: 20 });
    expect(s.state.entries[1].id).toBe(id); s.send({ type: 'delete', entryId: id, now: 30 });
    expect(s.state.entries.map(e => e.text)).toEqual(['one', 'three']); s.send({ type: 'undo', now: 100 });
    expect(s.state.entries.map(e => e.text)).toEqual(['one', 'TWO', 'three']);
    s.send({ type: 'delete', entryId: id, now: 100 }); s.send({ type: 'undo', now: 10000 }); expect(s.state.entries).toHaveLength(2);
  });
  it('freezes input and marks results built against older source as stale', () => {
    const s = setup(); s.thought('Original'); const snapshot = s.start(); s.thought('Added while running'); s.send({ type: 'style', text: 'New style' }); s.succeed();
    expect(snapshot.request.source).toEqual(['Original']); expect(s.state.result!.text).toBe('Final message'); expect(isStale(s.state, s.settings)).toBe(true);
  });
  it('returning exactly to source/style/config clears stale state', () => {
    const s = setup(); s.thought('Original'); s.start(); s.succeed(); expect(isStale(s.state, s.settings)).toBe(false);
    s.send({ type: 'style', text: 'Short' }); expect(isStale(s.state, s.settings)).toBe(true);
    s.send({ type: 'style', text: s.settings.defaultStyle }); expect(isStale(s.state, s.settings)).toBe(false);
    s.send({ type: 'composer', text: 'Pending' }); expect(isStale(s.state, s.settings)).toBe(true);
    s.send({ type: 'composer', text: ' \n ' }); expect(isStale(s.state, s.settings)).toBe(false);
    s.settings.presets[0].name = 'Renamed'; s.settings.revision++; expect(isStale(s.state, s.settings)).toBe(false);
    s.settings.presets[0].parameters.model = 'different'; expect(isStale(s.state, s.settings)).toBe(true);
  });
  for (const kind of ['failed', 'cancelled', 'timedOut'] as const) {
    it(`${kind} retains the last successful message and pending instruction`, () => {
      const s = setup(); s.thought('Original'); s.start(); s.succeed('Good result'); s.send({ type: 'pendingEdit', text: 'Shorten' }); const snapshot = s.start();
      s.send({ type: 'outcome', outcome: { runId: snapshot.request.runId, draftId: s.state.id, kind, message: 'Synthetic failure', durationMs: 1 } });
      expect(s.state.result!.text).toBe('Good result'); expect(s.state.pendingEdit.text).toBe('Shorten'); expect(s.state.run.kind).toBe(kind);
    });
  }
  it('empty output is failure and never replaces the good message', () => {
    const s = setup(); s.thought('Original'); s.start(); s.succeed('Good'); s.start(); s.succeed('  ');
    expect(s.state.result!.text).toBe('Good'); expect(s.state.run.kind).toBe('failed');
  });
  it('revision includes previous text but not the previous result record', () => {
    const s = setup(); s.thought('Original'); s.start(); s.succeed('Prior refinement');
    s.send({ type: 'pendingEdit', text: 'Make the ask direct' }); s.send({ type: 'style', text: 'Friendly' }); const snapshot = s.start();
    expect(snapshot.request.revision).toEqual({ previousText: 'Prior refinement', instruction: 'Make the ask direct' }); expect(snapshot.request.style).toBe('Friendly');
    s.succeed(); expect(s.state.pendingEdit.text).toBe(''); expect(isStale(s.state, s.settings)).toBe(false);
    expect(s.start().request.revision).toBeNull();
  });
  it('preserves newer instruction typing, even if its text returns to the submitted value', () => {
    const s = setup(); s.thought('Original'); s.start(); s.succeed(); s.send({ type: 'pendingEdit', text: 'Shorten' }); s.start();
    s.send({ type: 'pendingEdit', text: '' }); s.send({ type: 'pendingEdit', text: 'Shorten' }); s.succeed(); expect(s.state.pendingEdit.text).toBe('Shorten');
  });
  it('session style does not mutate defaults; new drafts snapshot the saved default', () => {
    const s = setup(); s.send({ type: 'style', text: '' }); expect(s.settings.defaultStyle).not.toBe('');
    s.settings.defaultStyle = 'New default'; expect(s.state.style).toBe('');
    s.send({ type: 'reset', settings: s.settings, id: 'new' }); expect(s.state.style).toBe('New default');
  });
  it('ignores late results and prevents reset while running', () => {
    const s = setup(); s.thought('Original'); const snapshot = s.start(); const before = s.state;
    s.send({ type: 'reset', settings: s.settings, id: 'new' }); expect(s.state).toBe(before);
    s.send({ type: 'outcome', outcome: { runId: 'wrong', draftId: s.state.id, kind: 'succeeded', text: 'Wrong', durationMs: 1 } }); expect(s.state).toBe(before);
    s.succeed('Right'); s.send({ type: 'outcome', outcome: { runId: snapshot.request.runId, draftId: s.state.id, kind: 'succeeded', text: 'Late', durationMs: 1 } }); expect(s.state.result!.text).toBe('Right');
  });
  it('input key compares resolved presets rather than display identity', () => {
    const settings: Settings = defaultSettings(); const state: DraftState = newDraft(settings);
    const old = inputKey(state, settings); settings.presets.push({ ...settings.presets[0], id: 'variant', name: 'Variant' });
    expect(inputKey({ ...state, selectedPresetId: 'variant' }, settings)).toBe(old);
    settings.templates[0].adapterVersion++; expect(inputKey(state, settings)).not.toBe(old);
  });

  it('shortcut summon replaces an active draft and rejects late results from its old run', () => {
    const s = setup(); s.thought('Old draft'); const old = s.start();
    s.send({ type: 'pendingEdit', text: 'Old instruction' });
    s.settings.defaultStyle = 'Latest default'; s.settings.selectedPresetId = 'default-codex';
    s.send({ type: 'summon', settings: s.settings, id: 'fresh' });
    expect(s.state).toEqual(newDraft(s.settings, 'fresh'));
    s.thought('New draft'); const next = s.start();
    s.send({ type: 'outcome', outcome: { runId: old.request.runId, draftId: old.request.draftId, kind: 'succeeded', text: 'Old result', durationMs: 1 } });
    expect(s.state.result).toBeNull();
    expect(s.state.run.kind).toBe('running');
    expect(next.request.draftId).toBe('fresh');
    s.succeed('Fresh result'); expect(s.state.result!.text).toBe('Fresh result');
  });
});
