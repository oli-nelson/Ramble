import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { TemplateEditor } from '../features/presets/TemplateEditor';
import { defaultSettings } from '../domain/defaults';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

it('Enter saves settings from a multiline style field; Shift, IME and repeats never save', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn(); const onQuit = vi.fn();
  render(<SettingsDialog settings={defaultSettings()} readOnly={false} onSave={onSave} onClose={onClose} onQuit={onQuit} onEditTemplate={vi.fn()} />);
  const style = screen.getByRole('textbox', { name: /Saved default style/ });
  fireEvent.change(style, { target: { value: 'Keep my voice\nand be concise' } });
  for (const flags of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) fireEvent.keyDown(style, { key: 'Enter', ...flags });
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.keyDown(style, { key: 'Enter' });
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ defaultStyle: 'Keep my voice\nand be concise' }));
  expect(onQuit).not.toHaveBeenCalled();
});

it('Enter validates number fields before saving settings', () => {
  const onSave = vi.fn();
  render(<SettingsDialog settings={defaultSettings()} readOnly={false} onSave={onSave} onClose={vi.fn()} onQuit={vi.fn()} onEditTemplate={vi.fn()} />);
  const size = screen.getByRole('spinbutton', { name: 'Thought font size (px)' });
  fireEvent.change(size, { target: { value: '29' } });
  fireEvent.keyDown(size, { key: 'Enter' });
  expect(size).toBeInvalid(); expect(onSave).not.toHaveBeenCalled();
});

it('Enter cannot bypass read-only settings', () => {
  const onSave = vi.fn();
  render(<SettingsDialog settings={defaultSettings()} readOnly onSave={onSave} onClose={vi.fn()} onQuit={vi.fn()} onEditTemplate={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole('textbox', { name: /Saved default style/ }), { key: 'Enter' });
  expect(onSave).not.toHaveBeenCalled();
});

it('Enter saves command templates from multiline fields without treating Shift+Enter as save', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn();
  render(<TemplateEditor original={defaultSettings().templates[0]} onSave={onSave} onClose={onClose} />);
  const command = screen.getByRole('textbox', { name: 'Command template' });
  fireEvent.change(command, { target: { value: 'writer\n{{PROMPT}}' } });
  for (const flags of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) fireEvent.keyDown(command, { key: 'Enter', ...flags });
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.keyDown(command, { key: 'Enter' });
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: 'writer\n{{PROMPT}}', version: 2 }));
});
