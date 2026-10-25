import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { api, demo } from '../../native/client';
import type { CommandTemplate, Settings } from '../../domain/types';
import { PlacementSettings } from './PlacementSettings';
import { PresetSettings } from './PresetSettings';
import { actionEnter } from '../../ui/actionEnter';

export function SettingsDialog({ settings, readOnly, onSave, onClose, onQuit, onEditTemplate, initialSection = 'general', debugPreview = false, onDebugPreview }: {
  settings: Settings; readOnly: boolean; onSave: (settings: Settings) => Promise<void>; onClose: () => void; onQuit: () => void; onEditTemplate: (template?: CommandTemplate) => void; initialSection?: 'general' | 'placement';
  debugPreview?: boolean; onDebugPreview?: (enabled: boolean) => void;
}) {
  const [local, setLocal] = useState(settings);
  const [tab, setTab] = useState<'general' | 'placement' | 'presets' | 'templates' | 'privacy' | 'diagnostics'>(initialSection);
  const [error, setError] = useState('');
  const [inspection, setInspection] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setLocal(settings); }, [settings]);
  const sections = ['general', 'placement', 'presets', 'templates', 'privacy', 'diagnostics'] as const;
  const edit = async (template?: CommandTemplate) => { setBusy(true); try { await onSave(local); onEditTemplate(template); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <Modal title="Settings" onClose={onClose} wide>
    <nav className="tabs" aria-label="Settings sections">{sections.map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</nav>
    <form onKeyDown={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) actionEnter(e, () => { if (!busy && !readOnly) e.currentTarget.requestSubmit(); }); }} onSubmit={async e => {
      e.preventDefault(); if (busy || readOnly) return; setBusy(true); setError('');
      try { await onSave(local); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>
      <div className="settings-body">
        {tab === 'general' && <>
          <label>Global shortcut<input value={local.hotkey} onChange={e => setLocal({ ...local, hotkey: e.target.value })} required /><span className="hint">Default: Control+Shift+Y on both platforms (the actual Control key on macOS, not Command). The old shortcut stays active if a new one fails.</span></label>
          <div className="form-row"><label>Appearance<select value={local.theme} onChange={e => setLocal({ ...local, theme: e.target.value as Settings['theme'] })}><option value="system">Follow system</option><option value="dark">Dark graphite</option><option value="light">Light ivory</option></select></label>
            <label>Build timeout (seconds)<input type="number" min={5} max={600} value={local.timeoutSeconds} onChange={e => setLocal({ ...local, timeoutSeconds: Number(e.target.value) })} /></label></div>
          <div className="form-row"><label>Thought font size (px)<input type="number" min={12} max={28} step={1} required value={local.thoughtFontSize} onChange={e => setLocal({ ...local, thoughtFontSize: Number(e.target.value) })} /></label><label>Message font size (px)<input type="number" min={12} max={28} step={1} required value={local.messageFontSize} onChange={e => setLocal({ ...local, messageFontSize: Number(e.target.value) })} /></label></div>
          <label>Saved default style<textarea rows={5} value={local.defaultStyle} onChange={e => setLocal({ ...local, defaultStyle: e.target.value })} /><span className="hint">For future drafts. Enter saves settings; Shift+Enter adds a line. The current session style won’t change.</span></label>
          <p className="hint">Escape returns from Message to Thoughts; in Thoughts it hides Ramble. Quit discards your draft.</p>
        </>}
        {tab === 'placement' && <>{local.compactMode && <p className="notice">Compact Mode keeps the current window size on summon. Saved placement widths/heights apply again when Compact Mode is off.</p>}<PlacementSettings value={local.placement} onChange={placement => setLocal({ ...local, placement })} readOnly={readOnly} /></>}
        {tab === 'presets' && <PresetSettings value={local} onChange={setLocal} readOnly={readOnly || busy} />}
        {tab === 'templates' && <>
          <p className="description">One editable command string per template. Changes apply to all its presets on their next build.</p>
          <button type="button" className="small" disabled={readOnly || busy} onClick={() => edit()}><Plus size={15} />New command template</button>
          {local.templates.map(t => <div className="template-row" key={t.id}><div><strong>{t.name}</strong><span className="hint template-summary">{t.command}</span><span className="hint">{t.promptTransport} · Ramble JSON response</span></div><button type="button" className="icon-button" aria-label={`Edit template ${t.name}`} disabled={readOnly || busy} onClick={() => edit(t)}><Pencil size={16} /></button><button type="button" className="icon-button danger" aria-label={`Delete template ${t.name}`} disabled={['opencode', 'codex', 'claude'].includes(t.id) || readOnly} onClick={() => {
            if (local.presets.some(p => p.templateId === t.id)) { setError('Remove the presets using this template before deleting it.'); return; }
            setLocal({ ...local, templates: local.templates.filter(q => q.id !== t.id) });
          }}><Trash2 size={16} /></button></div>)}
        </>}
        {tab === 'privacy' && <div className="privacy-copy"><h3>Your thoughts stay in this session.</h3><p>Source, unsent text, session style, revision instructions, and messages are held in memory only. Hiding preserves them; quitting or a crash does not.</p><p>Only settings and named presets are saved locally. Ramble does not log drafts, collect telemetry, store API keys, or read your clipboard.</p><p>External CLIs may send content to remote models and retain it under their own policies. Prompts sent as arguments can appear in process listings. Clipboard history tools may retain copied messages.</p>{demo && <div className="notice">Offline UI demo: text is joined, not rewritten. Settings are temporary. No model or subprocess is invoked.</div>}</div>}
        {tab === 'diagnostics' && <div className="diagnostics-settings"><h3>Build diagnostics</h3><p className="hint">These options apply immediately, are temporary, and reset when Ramble restarts.</p><label className="debug-toggle"><input type="checkbox" checked={debugPreview} onChange={e => onDebugPreview?.(e.target.checked)} />Preview generated command before build</label><p className="hint">Show the resolved executable, arguments, and any stdin prompt in a popup before Build/Rebuild launches a process. Choose Run build to continue or Cancel. Private text is displayed in memory only, never logged or saved. The browser demo uses a labeled offline preview.</p><h3 className="field-heading">Executable discovery</h3><p className="hint">Check the saved active preset without launching its CLI or contacting a provider. Save any preset/template edits first.</p><button type="button" className="small" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const info = await api.inspect(settings.selectedPresetId); setInspection(`${info.resolvedPath || 'Executable not found in the GUI search path.'} ${info.limitation}`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Check saved preset executable</button>{inspection && <p role="status" className="notice">{inspection}</p>}</div>}
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      {readOnly && <p role="alert" className="error-text">Settings are read-only to protect an unreadable or newer settings file.</p>}
      <div className="modal-actions"><button type="button" className="danger quit-button" onClick={onQuit}>Quit Ramble</button><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || readOnly}><Check size={16} />{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  </Modal>;
}
