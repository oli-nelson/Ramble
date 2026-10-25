import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowLeft, ArrowUp, Check, ChevronRight, Copy, FilePlus2, LoaderCircle, MessageSquareText, Minimize2, Pencil, RefreshCw, Settings2, Sparkles, Square, Trash2, Undo2, X } from 'lucide-react';
import darkMark from '../../doc/brand/svg/ramble-mark-dark.svg';
import lightMark from '../../doc/brand/svg/ramble-mark-light.svg';
import { canBuild, hasContent, isStale, makeEntry, newDraft, prepareBuild, reducer } from '../domain/draft';
import type { BuildPreview, CommandTemplate, HarnessOutput, Settings, SettingsEnvelope } from '../domain/types';
import { api, demo } from '../native/client';
import { Modal } from '../ui/Modal';
import { WipeIn } from '../ui/WipeIn';
import { actionEnter } from '../ui/actionEnter';
import { TemplateEditor } from '../features/presets/TemplateEditor';
import { SettingsDialog } from '../features/settings/SettingsDialog';

export function App() {
  const [initial, setInitial] = useState<SettingsEnvelope | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); api.getSettings().then(setInitial).catch(e => setError(e.message)); };
  useEffect(load, []);
  if (!initial) return <div className="startup"><img src={darkMark} alt="" /><h1>Ramble</h1>{error ? <><p role="alert">{error}</p><button onClick={load}>Retry</button></> : <p>Making room for your thoughts…</p>}</div>;
  return <Workspace initial={initial} />;
}

function Workspace({ initial }: { initial: SettingsEnvelope }) {
  const [envelope, setEnvelope] = useState(initial);
  const settings = envelope.settings;
  const compact = settings.compactMode;
  const [state, dispatch] = useReducer(reducer, settings, newDraft);
  const [modal, setModal] = useState<'settings' | 'template' | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<CommandTemplate | undefined>();
  const [settingsSection, setSettingsSection] = useState<'general' | 'placement'>('general');
  const [placementMessage, setPlacementMessage] = useState<string | null>(null);
  const [debugPreview, setDebugPreview] = useState(false);
  const [commandPreview, setCommandPreview] = useState<{ prepared: ReturnType<typeof prepareBuild>; preview?: BuildPreview; error?: string } | null>(null);
  const [dismissedOutput, setDismissedOutput] = useState<string | null>(null);
  const [harnessOutput, setHarnessOutput] = useState<{ runId: string; output?: HarnessOutput; error?: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: string; text: string; action: () => void } | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyInFlight = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState<'thoughts' | 'message'>('thoughts');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const latest = useRef({ state, settings });
  const draftId = useRef(state.id);
  const activeBuild = useRef<{ runId: string; completion: Promise<void> } | null>(null);
  const resetCleanup = useRef<Promise<unknown> | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const entries = useRef<HTMLDivElement>(null);
  const reviewScroll = useRef<HTMLDivElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const running = state.run.kind === 'running';
  const stale = isStale(state, settings);
  const pending = !!state.pendingEdit.text.trim();
  const dirty = hasContent(state) || state.style !== settings.defaultStyle;
  useLayoutEffect(() => { latest.current = { state, settings }; }, [state, settings]);

  const startNewDraft = useCallback(() => {
    const current = latest.current;
    const id = crypto.randomUUID();
    draftId.current = id; // Invalidate late IPC before React commits the new draft.
    const run = activeBuild.current;
    const runId = run?.runId ?? (current.state.run.kind === 'running' ? current.state.run.snapshot.request.runId : current.state.run.kind !== 'idle' ? current.state.run.runId : current.state.result?.snapshot.request.runId);
    setModal(null); setEditingTemplate(undefined); setSettingsSection('general');
    setConfirmation(null); setCommandPreview(null); setHarnessOutput(null); setDismissedOutput(null);
    setCopied(false); setToast(null); setElapsed(0); setView('thoughts');
    dispatch({ type: 'summon', settings: current.settings, id });
    setResetting(true);
    // Keep the composer usable immediately, but join the old build's cleanup
    // before another generation. Repeated summons also join the prior reset.
    const cleanup = Promise.allSettled([
      runId ? api.abandonRun(runId) : Promise.resolve(),
      run?.completion ?? Promise.resolve(),
      resetCleanup.current ?? Promise.resolve(),
    ]);
    resetCleanup.current = cleanup;
    void cleanup.then(results => {
      if (resetCleanup.current !== cleanup) return;
      resetCleanup.current = null; setResetting(false);
      if (draftId.current === id && results[0].status === 'rejected') {
        setToast({ text: 'The old build could not be abandoned. It has finished; your new draft is ready.', error: true });
      }
    });
  }, []);

  const notify = (text: string, error = false) => setToast({ text, error });
  const discardOutput = (runId: string) => { setDismissedOutput(runId); void api.discardHarnessOutput(runId).catch(e => notify(e.message, true)); };
  const viewOutput = async (runId: string) => {
    setDismissedOutput(runId); setHarnessOutput({ runId });
    try { const output = await api.takeHarnessOutput(runId); setHarnessOutput(current => current?.runId === runId ? { runId, output } : current); }
    catch (e) { setHarnessOutput(current => current?.runId === runId ? { runId, error: (e as Error).message } : current); }
  };
  const editTemplate = (template?: CommandTemplate) => { setEditingTemplate(template); setModal('template'); };
  const saveSettings = async (next: Settings) => {
    try {
      const saved = await api.saveSettings(next);
      setEnvelope(saved);
      if (saved.settings.selectedPresetId !== state.selectedPresetId) dispatch({ type: 'preset', id: saved.settings.selectedPresetId });
    } catch (error) {
      if ((error as Error).message.includes('SettingsConflict')) {
        const refreshed = await api.getSettings();
        setEnvelope(refreshed);
        if (!refreshed.settings.presets.some(p => p.id === state.selectedPresetId)) dispatch({ type: 'preset', id: refreshed.settings.selectedPresetId });
        throw new Error('Settings changed and have been refreshed. Review the updated settings and retry.');
      }
      throw error;
    }
  };
  const quit = useCallback(() => {
    const action = () => { api.quit().catch(e => notify(e.message, true)); };
    if (dirty || running) setConfirmation({ title: 'Quit Ramble?', text: 'Your thoughts and message are not saved. Any active build will be cancelled before quitting.', action }); else action();
  }, [dirty, running]);

  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  useEffect(() => {
    if (view === 'thoughts') composer.current?.focus(); else reviewHeading.current?.focus();
  }, [view, state.id]);
  // Reveal new content before its first animated paint, not after a smooth scroll
  // that can outlast the wipe. Ordinary view changes still preserve scroll state.
  useLayoutEffect(() => { entries.current?.scrollTo({ top: entries.current.scrollHeight, behavior: 'auto' }); }, [state.entries.length]);
  useLayoutEffect(() => { reviewScroll.current?.scrollTo({ top: 0, behavior: 'auto' }); }, [state.result?.snapshot.request.runId]);
  useEffect(() => {
    api.setDirty(dirty).catch(() => {});
    if (!demo && isTauri()) {
      const handler = (e: BeforeUnloadEvent) => { if (dirty || running) e.preventDefault(); };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, [dirty, running]);
  useEffect(() => {
    if (!state.deleted) return;
    const timer = setTimeout(() => dispatch({ type: 'expireUndo', now: Date.now() }), Math.max(0, state.deleted.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state.deleted]);
  useEffect(() => {
    if (state.run.kind !== 'running') return;
    const start = state.run.snapshot.startedAt;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(timer);
  }, [state.run]);
  useEffect(() => {
    if (!toast || toast.error) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => { setCopied(false); }, [state.result]);
  useEffect(() => {
    if (demo || !isTauri()) return;
    let disposed = false;
    const subscription = listen('ramble:summon', () => { if (!disposed) startNewDraft(); });
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, [startNewDraft]);
  useEffect(() => {
    if (demo || !isTauri()) return;
    let disposed = false;
    void api.placementMessage().then(message => { if (!disposed) setPlacementMessage(message); }).catch(() => {});
    const subscription = listen<string | null>('ramble:placement', event => setPlacementMessage(event.payload));
    return () => { disposed = true; void subscription.then(unlisten => unlisten()); };
  }, []);
  useEffect(() => {
    if (demo || !isTauri()) return;
    const subscriptions = [listen('ramble:settings', () => setModal('settings')), listen('ramble:quit', quit),
      listen('ramble:focus', () => { if (!document.querySelector('dialog[open]')) {
        if (view === 'thoughts') composer.current?.focus(); else reviewHeading.current?.focus();
      } })];
    return () => { subscriptions.forEach(p => p.then(unlisten => unlisten())); };
  }, [quit, view]);

  async function build() {
    if (resetCleanup.current || activeBuild.current || !canBuild(state) || commandPreview) return;
    try {
      const prepared = prepareBuild(state, settings);
      if (debugPreview) {
        setCommandPreview({ prepared });
        try {
          const preview = await api.previewBuild(prepared.snapshot.request);
          setCommandPreview(current => current?.prepared === prepared ? { prepared, preview } : current);
        } catch (e) { setCommandPreview(current => current?.prepared === prepared ? { prepared, error: (e as Error).message } : current); }
        return;
      }
      await launch(prepared);
    } catch (e) { notify((e as Error).message, true); }
  }
  async function launch(prepared: ReturnType<typeof prepareBuild>) {
       const request = prepared.snapshot.request;
       if (request.draftId !== draftId.current || resetCleanup.current || activeBuild.current) return;
       dispatch({ type: 'start', ...prepared });
       setView('message');
       const run = { runId: request.runId, completion: Promise.resolve() };
       activeBuild.current = run;
       run.completion = (async () => {
         try {
           const outcome = await api.build(request);
           if (draftId.current !== request.draftId) {
             await api.discardHarnessOutput(request.runId).catch(() => {});
             return;
           }
           dispatch({ type: 'outcome', outcome });
         } catch (e) {
           if (draftId.current === request.draftId) dispatch({ type: 'outcome', outcome: { runId: request.runId, draftId: request.draftId, kind: 'failed', message: (e as Error).message, durationMs: 0 } });
         } finally { if (activeBuild.current === run) activeBuild.current = null; }
       })();
       await run.completion;
  }
  async function copy(action: 'copy' | 'hide' | 'paste' = 'copy') {
     if (!state.result || copyInFlight.current) return;
     copyInFlight.current = true;
     const copiedDraft = draftId.current;
     setCopied(false);
     try {
     try { await api.copy(state.result.text); if (draftId.current !== copiedDraft) return; setCopied(true); notify(stale ? 'Copied the last message (out of date).' : 'Message copied.'); }
     catch { if (draftId.current === copiedDraft) notify('Couldn’t copy the message. Please try Copy again.', true); return; }
     if (action !== 'copy') {
       try { if (action === 'paste') await api.hideRestoreAndPaste(); else await api.hideAndRestoreFocus(); }
       catch (e) { if (draftId.current === copiedDraft) notify(action === 'paste' ? `Message copied. Paste action failed: ${(e as Error).message}` : 'Message copied, but Ramble couldn’t hide. Return to Thoughts and press Escape to hide.', true); }
     }
     } finally { copyInFlight.current = false; }
  }
  // A key pressed immediately after a result/view commit must see that commit,
  // not the previous result captured by a not-yet-refreshed passive listener.
  useLayoutEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (view === 'message') setView('thoughts');
        else if (state.inlineEdit) dispatch({ type: 'cancelEdit' });
        else api.hideAndRestoreFocus().catch(e => notify(e.message, true));
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (e.altKey || (e.shiftKey && view !== 'message')) return;
        e.preventDefault();
        if (!e.repeat) { if (view === 'message') void copy(e.shiftKey ? 'paste' : 'hide'); else void build(); }
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  function submit() {
    if (!state.composer.trim()) return;
    dispatch({ type: 'submit', entry: makeEntry(state.composer) });
    composer.current?.focus();
  }
  async function cancelBuild() {
    if (state.run.kind === 'running') {
      try { await api.cancel(state.run.snapshot.request.runId); }
      catch (e) { notify((e as Error).message, true); }
    }
  }
  const buildShortcut = navigator.userAgent.includes('Mac') ? '⌘ Enter' : 'Ctrl+Enter';
  const pasteShortcut = navigator.userAgent.includes('Mac') ? '⇧⌘ Enter' : 'Ctrl+Shift+Enter';
  const buildButton = <button className="primary build-button" disabled={resetting || !canBuild(state)} onClick={build} title={view === 'thoughts' ? `Build · ${buildShortcut}` : 'Rebuild from thoughts and style'}><RefreshCw size={18} />{resetting ? 'Finishing cleanup…' : state.result ? 'Rebuild' : 'Build message'}</button>;

  return <main className="app" data-compact={compact} data-native-mac={isTauri() && navigator.userAgent.includes('Mac')} style={{ '--thought-font-size': `${settings.thoughtFontSize}px`, '--message-font-size': `${settings.messageFontSize}px` } as CSSProperties}>
    <header className="toolbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region><picture data-tauri-drag-region><source srcSet={lightMark} media={settings.theme === 'light' ? 'all' : settings.theme === 'system' ? '(prefers-color-scheme: light)' : 'not all'} /><img src={darkMark} alt="" draggable={false} data-tauri-drag-region /></picture><h1 data-tauri-drag-region>Ramble</h1></div>
      <div className="preset-controls"><select aria-label="Active preset" value={state.selectedPresetId} disabled={saving} onChange={async e => {
        const id = e.target.value; setSaving(true);
        try { await saveSettings({ ...settings, selectedPresetId: id }); dispatch({ type: 'preset', id }); }
        catch (e) { notify((e as Error).message, true); } finally { setSaving(false); }
      }}>{settings.presets.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></div>
      <button className="icon-button toolbar-button" title="New draft" aria-label="New draft" disabled={running} onClick={() => {
        if (dirty) setConfirmation({ title: 'Start a new draft?', text: 'This discards your current thoughts, session style, and message. There is no draft history.', action: startNewDraft }); else startNewDraft();
      }}><FilePlus2 size={19} /></button>
      <div className="toolbar-spacer" data-tauri-drag-region />
      {compact && view === 'thoughts' && state.revealed && !running && <button className="icon-button" aria-label="View message" title="View message" onClick={() => setView('message')}><MessageSquareText size={18} /></button>}
      <button className="compact-toggle" role="switch" aria-label="Compact Mode" aria-checked={compact} title={compact ? 'Turn off Compact Mode' : 'Turn on Compact Mode'} disabled={saving || envelope.readOnly} onClick={async () => {
        setSaving(true);
        try { await saveSettings({ ...settings, compactMode: !compact }); }
        catch (e) { notify((e as Error).message, true); }
        finally { setSaving(false); }
      }}><Minimize2 size={16} /><span>Compact</span><span className="compact-toggle-track" aria-hidden="true"><i /></span></button>
      <button className="icon-button settings-button" title="Settings" aria-label="Settings" onClick={() => setModal('settings')}><Settings2 size={21} /></button>
    </header>

    {demo && <div className="demo-banner">Offline UI demo <span>· No AI calls · Build joins your thoughts · Settings reset on reload</span></div>}
    {envelope.warning && <div className="warning-banner" role="alert">{envelope.warning}<button onClick={() => setModal('settings')}>Open settings</button></div>}
    {placementMessage && <div className="warning-banner placement-banner" role="status"><span>{placementMessage}</span><button onClick={() => { setSettingsSection('placement'); setModal('settings'); }}>Placement settings</button><button className="icon-button" aria-label="Dismiss placement notice" onClick={() => setPlacementMessage(null)}><X size={14} /></button></div>}

    {view === 'message' && <div className="message-toolbar">
      <button className="back-button" aria-controls="thoughts-pane" onClick={() => setView('thoughts')}><ArrowLeft size={16} />Back to thoughts</button>
      <div className="message-toolbar-actions"><span className={`status ${stale || pending ? 'outdated' : ''} ${running ? 'building' : ''}`} role="status">{running ? <><LoaderCircle className="spin" size={13} />Building{!compact && <> · {elapsed.toFixed(1)}s</>}</> : state.result ? <><i />{stale ? 'Out of date' : pending ? 'Awaiting edit' : 'Ready'}</> : 'Not built yet'}</span>{compact && running && <button className="icon-button compact-cancel" aria-label="Cancel" title="Cancel build" onClick={cancelBuild}><Square size={15} /></button>}<button className="primary copy-button" disabled={!state.result} onClick={() => void copy()} title={`Copy message · ${buildShortcut} to copy & hide`} aria-label={stale ? 'Copy last message (out of date)' : 'Copy message'}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied' : 'Copy'}</button></div>
    </div>}
    <div className="workspace">
      <section id="thoughts-pane" className="capture-pane" aria-label="Source thoughts" hidden={view !== 'thoughts'}>
        <h2 className="sr-only">Capture thoughts</h2>
        <div className="entries" ref={entries}>
          {!state.entries.length && <div className="empty-state"><div className="empty-mark"><MessageSquareText size={30} /></div><h2>Start anywhere.</h2><p>A half-formed idea. A few details.<br />That thing you’re trying to say.</p><span>Drop your thoughts below. We’ll find the words.</span></div>}
          {state.entries.map((entry, index) => <WipeIn as="article" className={`entry ${state.inlineEdit?.entryId === entry.id ? 'editing' : ''}`} key={entry.id}>
            <span className="entry-number">{index + 1}</span>
            {state.inlineEdit?.entryId === entry.id ? <div className="inline-edit"><textarea aria-label={`Edit thought ${index + 1}`} autoFocus value={state.inlineEdit.text} onChange={e => dispatch({ type: 'editText', text: e.target.value })} onKeyDown={e => { if (e.key === 'Escape' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.stopPropagation(); dispatch({ type: 'cancelEdit' }); } else actionEnter(e, () => dispatch({ type: 'saveEdit', now: Date.now() })); }} /><div><button onClick={() => dispatch({ type: 'cancelEdit' })}>Cancel</button><button className="primary small" disabled={!state.inlineEdit.text.trim()} onClick={() => dispatch({ type: 'saveEdit', now: Date.now() })}>Save</button></div></div>
              : <><p><span className="wipe-in-content" data-wipe-content>{entry.text}</span></p><div className="entry-actions"><button className="icon-button" disabled={!!state.inlineEdit} aria-label={`Edit thought ${index + 1}`} onClick={() => dispatch({ type: 'edit', entryId: entry.id })}><Pencil size={16} /></button><button className="icon-button danger" disabled={!!state.inlineEdit} aria-label={`Delete thought ${index + 1}`} onClick={() => dispatch({ type: 'delete', entryId: entry.id, now: Date.now() })}><Trash2 size={16} /></button></div></>}
          </WipeIn>)}
        </div>
        {state.deleted && <div className="undo-bar" role="status"><span>Thought removed</span><button onClick={() => dispatch({ type: 'undo', now: Date.now() })}><Undo2 size={14} />Undo</button></div>}
        <div className="capture-controls"><div className="composer-build-row"><div className="composer"><textarea ref={composer} aria-label="Add a thought" placeholder="Add a thought…" value={state.composer} onChange={e => dispatch({ type: 'composer', text: e.target.value })} onKeyDown={e => actionEnter(e, submit)} /><button className="primary send-button" disabled={!state.composer.trim()} aria-label="Submit thought" title="Submit thought · Enter" onClick={submit}><ArrowUp size={21} /></button></div>{running ? <button className="build-button" onClick={() => setView('message')}><LoaderCircle size={16} className="spin" />View build</button> : buildButton}</div>
          <div className="composer-footer"><span>Shift+Enter for a new line <span className="dot">·</span> Enter to add</span>{state.revealed && !running && <button className="view-message-link" aria-controls="message-pane" onClick={() => setView('message')}>View message<ChevronRight size={13} /></button>}</div>
        </div>
      </section>

      <section id="message-pane" className="review-pane" aria-label="Final message" hidden={view !== 'message'}>
        <h2 className="sr-only" ref={reviewHeading} tabIndex={-1}>Message</h2>
        <div className="review-scroll" ref={reviewScroll}>
          {state.result ? <WipeIn key={state.result.snapshot.request.runId} className="message-text" data-testid="message"><span className="wipe-in-content" data-wipe-content>{state.result.text}</span></WipeIn> : <div className="empty-state preview-empty"><Sparkles size={26} /><h2>A clear message, coming up.</h2><p>Your original thoughts are safe in Thoughts.<br />Refine the style, rebuild, and make it yours.</p></div>}
           {running && !compact && <div className="run-notice"><LoaderCircle size={16} className="spin" /><span>Using {state.run.kind === 'running' && state.run.snapshot.presetName}. You can keep editing.</span><button onClick={cancelBuild}><Square size={12} />Cancel</button></div>}
          {state.run.kind !== 'idle' && state.run.kind !== 'running' && <div className={`run-error ${state.run.kind === 'cancelled' ? 'neutral' : ''}`} role="alert"><strong>{state.run.kind === 'cancelled' ? 'Build cancelled' : state.run.kind === 'timedOut' ? 'Build timed out' : 'Couldn’t build your message'}</strong><p>{state.run.message}</p><button onClick={() => setModal('settings')}>Check settings</button>{state.run.diagnosticsAvailable && state.run.runId && dismissedOutput !== state.run.runId && <div className="output-consent"><p>Would you like to view the harness output for diagnostics? It may contain private notes or secrets. Nothing is logged or saved.</p><button onClick={() => { if (state.run.kind !== 'idle' && state.run.kind !== 'running' && state.run.runId) void viewOutput(state.run.runId); }}>View harness output</button><button onClick={() => { if (state.run.kind !== 'idle' && state.run.kind !== 'running' && state.run.runId) discardOutput(state.run.runId); }}>Not now</button></div>}</div>}
          {stale && <p className="freshness-hint">Thoughts, style, or model changed. Copy still uses the last successful message.</p>}
          <details className="session-style"><summary><ChevronRight size={16} /><strong>Session style</strong><span className="pill">Draft only</span></summary><label className="sr-only" htmlFor="session-style">Session style</label><textarea id="session-style" rows={5} value={state.style} onChange={e => dispatch({ type: 'style', text: e.target.value })} onKeyDown={e => actionEnter(e, () => void build())} placeholder="Leave blank for baseline cleanup only." /><div className="style-actions"><button disabled={saving || envelope.readOnly} onClick={async () => {
            setSaving(true); try { await saveSettings({ ...settings, defaultStyle: state.style }); notify('Session style saved as the default for future drafts.'); } catch (e) { notify((e as Error).message, true); } finally { setSaving(false); }
          }}>Save as default</button><button onClick={() => {
            const action = () => dispatch({ type: 'style', text: settings.defaultStyle });
            if (state.style !== settings.defaultStyle) setConfirmation({ title: 'Reset session style?', text: 'This replaces your draft’s style with the saved default. Your message won’t be rebuilt automatically.', action });
          }}>Reset to saved default</button></div></details>
        </div>
        <div className="rebuild-controls"><div className="rebuild-row"><label className="sr-only" htmlFor="additional-edit">Additional edit for this rebuild</label><textarea id="additional-edit" rows={2} value={state.pendingEdit.text} disabled={!state.result} placeholder="Additional edit for this rebuild…" onChange={e => dispatch({ type: 'pendingEdit', text: e.target.value })} onKeyDown={e => actionEnter(e, () => void build())} />{running ? <button disabled className="primary build-button"><LoaderCircle className="spin" size={18} />Building</button> : buildButton}</div><p className="hint">{state.inlineEdit ? 'Save or cancel the open thought before building.' : pending ? 'Enter applies edits to the latest message; Shift+Enter adds a line.' : 'Enter rebuilds · Shift+Enter adds a line · Blank edits regenerate from thoughts + style.'}</p></div>
      </section>
    </div>
    <footer className="app-footer"><span><i />Private draft · Not saved on quit</span><span className="shortcut-hints"><span>{view === 'message' ? `${buildShortcut} to copy & hide` : `${buildShortcut} to build`}</span>{view === 'message' && <span>{pasteShortcut} to paste</span>}</span></footer>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.text}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {modal === 'settings' && <SettingsDialog settings={settings} readOnly={envelope.readOnly} onSave={saveSettings} onClose={() => { setModal(null); setSettingsSection('general'); }} onQuit={quit} onEditTemplate={editTemplate} initialSection={settingsSection} debugPreview={debugPreview} onDebugPreview={setDebugPreview} />}
    {harnessOutput && <Modal title="Harness output" onClose={() => setHarnessOutput(null)} wide><p className="description">Private diagnostic output from the failed build. May include prompts, notes or credentials. Shown as plain text, never logged or saved; closing this view discards it. Large streams show bounded excerpts.</p>{harnessOutput.output ? <>{(['stdout', 'stderr'] as const).map(stream => <section key={stream}><h3 className="field-heading">{stream}{harnessOutput.output![stream === 'stdout' ? 'stdoutTruncated' : 'stderrTruncated'] && ' · truncated excerpt'}</h3><pre className="command-preview" data-testid={`harness-${stream}`}>{harnessOutput.output![stream] || '(empty)'}</pre></section>)}</> : harnessOutput.error ? <p role="alert" className="error-text">{harnessOutput.error}</p> : <p role="status">Loading diagnostic output…</p>}<div className="modal-actions"><button className="primary" onClick={() => setHarnessOutput(null)}>Close output</button></div></Modal>}
    {commandPreview && <Modal title="Generated command preview" onClose={() => setCommandPreview(null)} wide><p className="description">{demo ? 'Offline demonstration, not a resolved native invocation.' : `This private preview has not launched a process. The replay command is quoted for ${navigator.userAgent.includes('Windows') ? 'PowerShell' : 'zsh/bash'}; stdin, if any, must be supplied separately. Ramble itself launches directly without a shell.`}</p>{commandPreview.preview ? <><h3 className="field-heading">Command line</h3><pre className="command-preview" data-testid="command-preview">{commandPreview.preview.command}</pre>{commandPreview.preview.stdin && <><h3 className="field-heading">Standard input (stdin)</h3><pre className="command-preview" data-testid="stdin-preview">{commandPreview.preview.stdin}</pre></>}</> : commandPreview.error ? <p role="alert" className="error-text">{commandPreview.error}</p> : <p role="status">Preparing command…</p>}<div className="modal-actions"><button type="button" onClick={() => setCommandPreview(null)}>Cancel</button><button className="primary" disabled={!commandPreview.preview} onClick={() => { const prepared = commandPreview.prepared; setCommandPreview(null); void launch(prepared); }}>Run build</button></div></Modal>}
    {modal === 'template' && <TemplateEditor original={editingTemplate} onClose={() => setModal(null)} onSave={async template => {
      if (editingTemplate) {
        await saveSettings({ ...settings, templates: settings.templates.map(t => t.id === template.id ? template : t), presets: settings.presets.map(p => p.templateId === template.id ? { ...p, templateVersion: template.version } : p) });
        notify('Template saved. Changes apply to the next build.');
      } else {
        await saveSettings({ ...settings, templates: [...settings.templates, template] });
        notify('Template saved. Add a preset in Settings → Presets.');
      }
    }} />}
    {confirmation && <Modal title={confirmation.title} onClose={() => setConfirmation(null)}><p className="description">{confirmation.text}</p><div className="modal-actions"><button autoFocus onClick={() => setConfirmation(null)}>Keep working</button><button className="primary" onClick={() => { confirmation.action(); setConfirmation(null); }}>Confirm</button></div></Modal>}
  </main>;
}
