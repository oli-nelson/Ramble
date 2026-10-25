import { Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usesVariable } from '../../domain/templates';
import type { Preset, Settings } from '../../domain/types';

export function PresetSettings({ value, onChange, readOnly }: { value: Settings; onChange: (settings: Settings) => void; readOnly: boolean }) {
  const [editorId, setEditorId] = useState(value.selectedPresetId);
  const shownId = value.presets.some(p => p.id === editorId) ? editorId : value.selectedPresetId;
  const update = (preset: Preset) => onChange({ ...value, presets: value.presets.map(p => p.id === preset.id ? preset : p) });
  const add = (original?: Preset) => {
    const template = value.templates.find(t => t.id === (original?.templateId ?? 'opencode')) ?? value.templates[0];
    const base = value.presets.find(p => p.id === `default-${template.id}`);
    const preset: Preset = { id: crypto.randomUUID(), name: original ? `${original.name} — copy` : 'New preset', templateId: template.id, templateVersion: template.version, parameters: { ...(original?.parameters ?? base?.parameters) } };
    onChange({ ...value, presets: [...value.presets, preset], selectedPresetId: preset.id });
    setEditorId(preset.id);
  };
  return <div className="preset-settings">
    <div className="placement-overrides-heading"><h3>Your presets</h3><button type="button" className="small" disabled={readOnly} onClick={() => add()}><Plus size={14} />New preset</button></div>
    <p className="hint">Save settings to apply model/effort changes to the next build. Active runs keep their original configuration.</p>
    <label className="preset-picker">Edit preset<select value={shownId} onChange={e => setEditorId(e.target.value)}>{value.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <datalist id="reasoning-efforts">{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(effort => <option value={effort} key={effort} />)}</datalist>
    {value.presets.filter(p => p.id === shownId).map(p => {
      const template = value.templates.find(t => t.id === p.templateId)!;
      const parameter = (key: 'model' | 'reasoningEffort' | 'executable', text: string) => {
        const parameters = { ...p.parameters };
        if (text) parameters[key] = text; else delete parameters[key];
        update({ ...p, parameters });
      };
      return <section className="preset-card" key={p.id} aria-label={`Preset ${p.name}`}>
        <div className="preset-card-heading"><strong>{p.name}</strong><button type="button" className="small" aria-pressed={value.selectedPresetId === p.id} disabled={readOnly} onClick={() => onChange({ ...value, selectedPresetId: p.id })}>{value.selectedPresetId === p.id ? 'Selected' : 'Select preset'}</button><button type="button" className="icon-button" disabled={readOnly} aria-label={`Duplicate preset ${p.name}`} onClick={() => add(p)}><Copy size={15} /></button><button type="button" className="icon-button danger" disabled={readOnly || p.id.startsWith('default-')} aria-label={`Delete ${p.name}`} onClick={() => onChange({ ...value, presets: value.presets.filter(q => q.id !== p.id), selectedPresetId: value.selectedPresetId === p.id ? 'default-opencode' : value.selectedPresetId })}><Trash2 size={15} /></button></div>
        <fieldset disabled={readOnly} className="preset-fields">
          <div className="form-row"><label>Model ID<input aria-label={`Model ID for ${p.name}`} maxLength={4096} placeholder="CLI default" value={p.parameters.model ?? ''} onChange={e => parameter('model', e.target.value)} /></label><label>Reasoning Effort<input aria-label={`Reasoning Effort for ${p.name}`} list="reasoning-efforts" maxLength={4096} placeholder="CLI default" value={p.parameters.reasoningEffort ?? ''} onChange={e => parameter('reasoningEffort', e.target.value)} /></label></div>
          <div className="form-row"><label>Preset name<input aria-label={`Name for ${p.name}`} required maxLength={80} value={p.name} onChange={e => update({ ...p, name: e.target.value })} /></label><label>Template<select aria-label={`Template for ${p.name}`} value={p.templateId} disabled={p.id.startsWith('default-')} onChange={e => { const t = value.templates.find(t => t.id === e.target.value)!; const base = value.presets.find(p => p.id === `default-${t.id}`); update({ ...p, templateId: t.id, templateVersion: t.version, parameters: { ...base?.parameters } }); }}>{value.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
          <p className="hint">Supported effort values depend on your CLI and model. Blank fields use its defaults.</p>
          {!usesVariable(template.command, 'MODEL_ID') && p.parameters.model && <p className="hint">{'This template does not use {{MODEL_ID}}; the saved model has no effect until you add it.'}</p>}
          {!usesVariable(template.command, 'REASONING_EFFORT') && p.parameters.reasoningEffort && <p className="hint">{'This template does not use {{REASONING_EFFORT}}; the saved effort has no effect until you add it.'}</p>}
          {p.templateId === 'opencode' && <p className="hint">OpenCode’s starting template uses provider/model#effort. Enter a model without a #variant when setting effort separately; effort needs a Model ID.</p>}
          <details className="advanced"><summary>Executable override</summary><label>Executable path<input aria-label={`Executable path for ${p.name}`} value={p.parameters.executable ?? ''} placeholder="Use the template’s executable" onChange={e => parameter('executable', e.target.value)} /></label></details>
        </fieldset>
      </section>;
    })}
  </div>;
}
