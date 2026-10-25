import { useEffect, useId, useRef, useState } from 'react';
import { Monitor, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, demo } from '../../native/client';
import type { Anchor, PlacementContext, PlacementRule, PlacementSettings as Preferences } from '../../domain/types';
import { actionEnter } from '../../ui/actionEnter';

const anchors: { id: Anchor; name: string; glyph: string }[] = [
  { id: 'topLeft', name: 'Top left', glyph: '↖' }, { id: 'top', name: 'Top center', glyph: '↑' }, { id: 'topRight', name: 'Top right', glyph: '↗' },
  { id: 'left', name: 'Center left', glyph: '←' }, { id: 'center', name: 'Center', glyph: '·' }, { id: 'right', name: 'Center right', glyph: '→' },
  { id: 'bottomLeft', name: 'Bottom left', glyph: '↙' }, { id: 'bottom', name: 'Bottom center', glyph: '↓' }, { id: 'bottomRight', name: 'Bottom right', glyph: '↘' },
];

function Offset({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled: boolean }) {
  const hintId = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return <label>{label}<input aria-label={label} aria-describedby={hintId} inputMode="decimal" disabled={disabled} value={text} onChange={e => {
    const text = e.target.value; setText(text); const number = Number(text);
    const valid = text.trim() !== '' && Number.isFinite(number) && Math.abs(number) <= 4096;
    e.currentTarget.setCustomValidity(valid ? '' : 'Enter an offset between -4096 and 4096 points.');
    if (valid) onChange(number);
  }} /><span id={hintId} className="hint">{label.endsWith('X') ? 'Positive → right' : 'Positive ↓ down'}</span></label>;
}

function Dimension({ label, value, minimum, fallback, onChange, disabled }: { label: string; value: number | null; minimum: number; fallback: string; onChange: (n: number | null) => void; disabled: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  return <label>{label}<input aria-label={label} inputMode="decimal" disabled={disabled} placeholder={fallback} value={text} onChange={e => {
    const text = e.target.value; setText(text); const number = text.trim() === '' ? null : Number(text);
    const valid = number === null || Number.isFinite(number) && number >= minimum && number <= 4096;
    e.currentTarget.setCustomValidity(valid ? '' : `Enter ${minimum}–4096 logical points, or leave blank.`);
    if (valid) onChange(number);
  }} /></label>;
}

function RuleEditor({ label, rule, onChange, disabled, inherited }: { label: string; rule: PlacementRule; onChange: (rule: PlacementRule) => void; disabled: boolean; inherited?: PlacementRule }) {
  const id = useId();
  return <fieldset className="placement-rule" aria-label={label} disabled={disabled}><legend>{label}</legend>
    <div className="rule-controls"><div className="anchor-grid" role="radiogroup" aria-label={`${label} anchor`}>
      {anchors.map(a => <label className="anchor-cell" key={a.id} title={a.name}><input type="radio" name={id} aria-label={a.name} value={a.id} checked={rule.anchor === a.id} onChange={() => onChange({ ...rule, anchor: a.id })} /><span aria-hidden="true">{a.glyph}</span></label>)}
    </div><div className="rule-offsets"><Offset label={`${label} offset X`} value={rule.offsetX} onChange={offsetX => onChange({ ...rule, offsetX })} disabled={disabled} /><Offset label={`${label} offset Y`} value={rule.offsetY} onChange={offsetY => onChange({ ...rule, offsetY })} disabled={disabled} /></div></div>
    <div className="rule-dimensions"><Dimension label={`${label} width`} value={rule.width} minimum={560} fallback={inherited?.width ? `Default (${inherited.width})` : 'Keep current size'} onChange={width => onChange({ ...rule, width })} disabled={disabled} /><Dimension label={`${label} height`} value={rule.height} minimum={420} fallback={inherited?.height ? `Default (${inherited.height})` : 'Keep current size'} onChange={height => onChange({ ...rule, height })} disabled={disabled} /></div>
    <p className="hint">Size in logical points, applied on summon before anchoring. {inherited ? 'Blank dimensions inherit the default size.' : 'Blank dimensions keep the current size.'} Width ≥ 560; height ≥ 420; maximum 4096.</p>
    <p className="hint">{anchors.find(a => a.id === rule.anchor)?.name} of Ramble aligns with the same point on the focused window, then applies these offsets in logical points.</p>
  </fieldset>;
}

export function PlacementSettings({ value, onChange, readOnly }: { value: Preferences; onChange: (settings: Preferences) => void; readOnly: boolean }) {
  const [context, setContext] = useState<PlacementContext | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const applicationPicker = useRef<HTMLSelectElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); setError(''); try { setContext(await api.placementContext()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { void refresh(); }, []);
  const applications = [...(context?.applications ?? [])];
  if (context?.lastApplication && !applications.some(a => a.id === context.lastApplication!.id)) applications.unshift(context.lastApplication);
  const filtered = applications.filter(a => `${a.name} ${a.id}`.toLowerCase().includes(query.toLowerCase()));
  const add = (id: string) => {
    const app = applications.find(a => a.id === id); if (!app) return;
    if (value.overrides.some(o => o.applicationId === app.id)) { setError(`An override for ${app.name} already exists below.`); return; }
    setError(''); onChange({ ...value, overrides: [...value.overrides, { applicationId: app.id, applicationName: app.name, rule: { ...value.default, width: null, height: null } }] }); setSelected('');
  };
  const disabled = readOnly || !value.enabled;
  return <div className="placement-settings">
    <div className="placement-toggle"><div><h3>Follow the focused window</h3><p className="hint">Capture the window behind Ramble when you press the summon shortcut.</p></div><button type="button" role="switch" aria-label="Position relative to focused window" aria-checked={value.enabled} disabled={readOnly} onClick={() => onChange({ ...value, enabled: !value.enabled })}>{value.enabled ? 'On' : 'Off'}</button></div>
    <RuleEditor label="Default placement" rule={value.default} disabled={disabled} onChange={rule => onChange({ ...value, default: rule })} />
    <p className="hint placement-explanation">Placement is clamped to the target display’s usable area, keeping Ramble away from the menu bar, Dock, and taskbar. If Ramble is already focused, the shortcut simply refocuses it without moving it.</p>
    {context?.accessibilityRequired && <div className="notice permission-notice"><strong>{context.accessibilityGranted ? 'Accessibility access enabled' : 'Accessibility access needed on macOS'}</strong><p>Ramble reads only the focused app’s identity and window position/size—not window titles or contents. Access also enables the explicit copy-and-paste shortcut to send one Command-V after returning focus. Ordinary copy/close and Escape need no access. Without access, placement uses a display fallback. Permission is requested only when you click Enable access.</p><div className="permission-actions">{!context.accessibilityGranted && <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await api.requestPlacementAccess(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Enable access</button>}<button type="button" disabled={busy} onClick={refresh}>Refresh access</button></div><p className="hint">Enable Ramble in System Settings → Privacy &amp; Security → Accessibility. A restart may be needed after granting access.</p></div>}
    <div className="placement-overrides-heading"><h3>Application overrides</h3><button type="button" className="small" disabled={busy} onClick={refresh}><RefreshCw size={13} />Refresh apps</button></div>
    <p className="hint">Choose an open application; no bundle IDs or executable paths to type. The rule stays saved when that app closes.</p>
    <div className="application-picker"><label>Search applications<input type="search" placeholder="Safari, Slack, Visual Studio Code…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => actionEnter(e, () => applicationPicker.current?.focus())} disabled={disabled} /></label><label>Application<select ref={applicationPicker} value={selected} disabled={disabled || busy} onChange={e => setSelected(e.target.value)}><option value="">Choose an open application…</option>{filtered.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button type="button" className="small" disabled={disabled || !selected} onClick={() => add(selected)}><Plus size={14} />Add override</button></div>
    {context?.lastApplication && <button type="button" className="use-last-app" disabled={disabled} onClick={() => add(context.lastApplication!.id)}><Monitor size={14} />Use last focused app: {context.lastApplication.name}</button>}
    {value.overrides.length === 0 && <p className="hint empty-overrides">All applications currently use the default placement.</p>}
    {value.overrides.map((override, index) => <section key={override.applicationId} className="placement-override" aria-label={`Placement for ${override.applicationName}`}>
      <div className="override-heading"><div><strong>{override.applicationName}</strong><span className="hint">{override.applicationId}</span></div><button type="button" className="icon-button danger" disabled={readOnly} aria-label={`Remove placement for ${override.applicationName}`} onClick={() => onChange({ ...value, overrides: value.overrides.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>
      <RuleEditor label={`${override.applicationName} placement`} disabled={disabled} rule={override.rule} inherited={value.default} onChange={rule => onChange({ ...value, overrides: value.overrides.map((o,i) => i === index ? { ...o, rule } : o) })} />
    </section>)}
    {context?.message && <p className="notice">Last summon: {context.message}</p>}
    {demo && <p className="hint">Offline preview: the application list is example data; no desktop permissions or windows are accessed.</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </div>;
}
