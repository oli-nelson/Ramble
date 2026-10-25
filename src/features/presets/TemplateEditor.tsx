import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { validateTemplate } from '../../domain/templates';
import type { CommandTemplate } from '../../domain/types';

export function TemplateEditor({ original, onSave, onClose }: { original?: CommandTemplate; onSave: (template: CommandTemplate) => Promise<void>; onClose: () => void }) {
  const [template, setTemplate] = useState<CommandTemplate>(() => original ? structuredClone(original) : {
    id: crypto.randomUUID(), version: 1, adapterVersion: 1, name: '', command: '', promptTransport: 'stdin', description: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <Modal title={original ? 'Edit command template' : 'New command template'} onClose={onClose} wide>
    <form onSubmit={async e => {
      e.preventDefault(); const error = validateTemplate(template);
      if (error) { setError(error); return; }
      setSaving(true); setError('');
      try { await onSave({ ...template, name: template.name.trim(), command: template.command.trim(), version: original ? original.version + 1 : 1 }); onClose(); }
      catch (e) { setError((e as Error).message); } finally { setSaving(false); }
    }}>
      <p className="description">One command, with values supplied by the selected preset. Use any installed CLI or script runtime.</p>
      <label>Template name<input autoFocus required maxLength={80} value={template.name} placeholder="My writing CLI" onChange={e => setTemplate({ ...template, name: e.target.value })} /></label>
      <label>Command template<textarea className="command-template" required rows={6} spellCheck={false} value={template.command} placeholder={'my-cli --model {{MODEL_ID}} --effort {{REASONING_EFFORT}} {{PROMPT}}'} onChange={e => setTemplate({ ...template, command: e.target.value })} /></label>
      <p className="hint">{'Variables: {{MODEL_ID}}, {{REASONING_EFFORT}}, {{PROMPT}}. Quote paths/arguments containing spaces. Values are injected after parsing and never interpreted as shell syntax.'}</p>
      <details className="advanced"><summary>Optional model / effort flags</summary><p className="hint">{'Use [[MODEL_ID --model {{MODEL_ID}} ]] or [[REASONING_EFFORT --effort {{REASONING_EFFORT}} ]] to omit the entire section when its preset field is blank. Escape a literal opening brace with a backslash. Pipes, redirects and shell expansion are not supported.'}</p></details>
      <label>Prompt transport<select value={template.promptTransport} onChange={e => setTemplate({ ...template, promptTransport: e.target.value as 'stdin' | 'argument' })}><option value="stdin">Standard input (stdin)</option><option value="argument">One prompt argument</option></select></label>
      <div className="notice"><strong>One response format for every command</strong><p>{'Ramble’s prompt requests {"ramble_response":"The finished message"}. Pass that prompt to the model and return this single-key JSON on stdout. No build ID or harness-specific parser is needed. Surrounding logs or JSON envelopes are supported; missing, malformed or conflicting responses fail.'}</p></div>
      <label>Notes <span className="optional">optional</span><textarea rows={2} value={template.description} onChange={e => setTemplate({ ...template, description: e.target.value })} /></label>
      <div className="notice"><strong>Trusted command configuration</strong><p>Runs with your permissions and CLI environment/authentication, not in a sandbox. Don’t save credentials here. Argument prompts can appear in process listings. Windows scripts need an executable runtime such as node.exe.</p></div>
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button></div>
    </form>
  </Modal>;
}
