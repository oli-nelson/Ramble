import { expect, it } from 'vitest';
import { defaultSettings } from './defaults';
import { parseCommand, usesVariable, validateTemplate } from './templates';
import { inputKey, newDraft } from './draft';
import type { CommandTemplate } from './types';

const custom = (): CommandTemplate => ({ id: 'custom', version: 1, adapterVersion: 1, name: 'Any CLI', command: 'my-cli', promptTransport: 'stdin', description: '' });

it('accepts command strings, quoted paths and optional model/effort sections', () => {
  const t = custom(); t.command = '"/my tools/writer" --custom-option "quoted \\"text\\" ; $(not-a-shell)"';
  expect(validateTemplate(t)).toBeNull(); expect(usesVariable(t.command, 'MODEL_ID')).toBe(false);
  for (const template of defaultSettings().templates) {
    expect(validateTemplate(template)).toBeNull();
    expect(usesVariable(template.command, 'MODEL_ID')).toBe(true);
    expect(usesVariable(template.command, 'REASONING_EFFORT')).toBe(true);
  }
});

it('validates syntax and prompt transport before native invocation', () => {
  const t = custom(); t.promptTransport = 'argument';
  expect(validateTemplate(t)).toContain('exactly one');
  t.command = 'my-cli {{PROMPT}}'; expect(validateTemplate(t)).toBeNull();
  t.promptTransport = 'stdin'; expect(validateTemplate(t)).toContain('Remove {{PROMPT}}');
  for (const command of ['my-cli {{UNKNOWN}}', 'my-cli "unclosed', 'my-cli {{PROMPT', 'my-cli [[MODEL_ID --model {{MODEL_ID}}', 'my-cli [[MODEL_ID {{PROMPT}} ]]', '{{MODEL_ID}} run', 'my-cli \0']) {
    t.command = command; expect(validateTemplate(t)).not.toBeNull();
  }
  t.command = 'my-cli "\\{{literal}}"'; expect(validateTemplate(t)).toBeNull();
  expect(parseCommand('"C:\\Tools\\writer.exe" ""')[0]).toEqual({ parts: [{ text: 'C:\\Tools\\writer.exe' }] });
});

it('command text, model and reasoning effort participate in freshness comparisons', () => {
  const settings = defaultSettings(); const draft = newDraft(settings); const key = inputKey(draft, settings);
  settings.templates[0].command += ' --another-option';
  expect(inputKey(draft, settings)).not.toBe(key);
  settings.templates[0].command = defaultSettings().templates[0].command;
  expect(inputKey(draft, settings)).toBe(key);
  settings.presets[0].parameters.reasoningEffort = 'high'; expect(inputKey(draft, settings)).not.toBe(key);
  settings.presets[0].parameters.reasoningEffort = 'medium'; expect(inputKey(draft, settings)).toBe(key);
  settings.presets[0].parameters.model = 'provider/model'; expect(inputKey(draft, settings)).not.toBe(key);
});
