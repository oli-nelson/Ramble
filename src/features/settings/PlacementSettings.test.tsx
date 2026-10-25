import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../domain/defaults';
import type { PlacementSettings as Preferences } from '../../domain/types';
import { api } from '../../native/client';
import { PlacementSettings } from './PlacementSettings';

vi.mock('../../native/client', () => ({
  demo: false,
  api: { placementContext: vi.fn(), requestPlacementAccess: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.placementContext).mockResolvedValue({
    applications: [{ id: 'com.example.editor', name: 'Editor' }, { id: 'com.example.browser', name: 'Browser' }],
    lastApplication: { id: 'com.example.chat', name: 'Chat' },
    accessibilityRequired: true, accessibilityGranted: false, message: null,
  });
  vi.mocked(api.requestPlacementAccess).mockResolvedValue(false);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Editor({ readOnly = false }: { readOnly?: boolean }) {
  const [value, setValue] = useState<Preferences>(defaultSettings().placement);
  return <><PlacementSettings value={value} onChange={setValue} readOnly={readOnly} /><output data-testid="preferences">{JSON.stringify(value)}</output></>;
}

it('requests permission only after the explicit Enable access action', async () => {
  render(<Editor />);
  await screen.findByText('Accessibility access needed on macOS');
  expect(api.requestPlacementAccess).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh access' }));
  await waitFor(() => expect(api.placementContext).toHaveBeenCalledTimes(2));
  expect(api.requestPlacementAccess).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enable access' }));
  await waitFor(() => expect(api.requestPlacementAccess).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(api.placementContext).toHaveBeenCalledTimes(3));
});

it('edits all anchors and signed offsets while rejecting invalid numbers', async () => {
  render(<Editor />);
  await screen.findByText('Accessibility access needed on macOS');
  const rule = screen.getByRole('group', { name: 'Default placement' });
  expect(within(rule).getAllByRole('radio')).toHaveLength(9);
  fireEvent.click(within(rule).getByRole('radio', { name: 'Top right' }));
  const x = screen.getByRole('textbox', { name: 'Default placement offset X' });
  fireEvent.change(x, { target: { value: '-' } });
  expect(x).toBeInvalid();
  fireEvent.change(x, { target: { value: '-24.5' } });
  expect(x).toBeValid();
  fireEvent.change(screen.getByRole('textbox', { name: 'Default placement offset Y' }), { target: { value: '+16' } });
  expect(JSON.parse(screen.getByTestId('preferences').textContent!).default).toEqual({ anchor: 'topRight', offsetX: -24.5, offsetY: 16, width: 640, height: 480 });
  fireEvent.change(x, { target: { value: '4097' } });
  expect(x).toBeInvalid();
  expect(JSON.parse(screen.getByTestId('preferences').textContent!).default.offsetX).toBe(-24.5);
});

it('searches running apps, inherits the default, prevents duplicates and removes overrides', async () => {
  render(<Editor />);
  await screen.findByRole('button', { name: 'Use last focused app: Chat' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Default placement offset X' }), { target: { value: '-32' } });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search applications' }), { target: { value: 'editor' } });
  const picker = screen.getByRole('combobox', { name: 'Application' });
  const search = screen.getByRole('searchbox', { name: 'Search applications' });
  search.focus();
  expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
  expect(picker).toHaveFocus();
  expect(within(picker).queryByRole('option', { name: 'Browser' })).toBeNull();
  fireEvent.change(picker, { target: { value: 'com.example.editor' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
  expect(screen.getByRole('textbox', { name: 'Editor placement offset X' })).toHaveValue('-32');
  fireEvent.click(screen.getByRole('button', { name: 'Use last focused app: Chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use last focused app: Chat' }));
  expect(screen.getByRole('alert')).toHaveTextContent('An override for Chat already exists');
  expect(JSON.parse(screen.getByTestId('preferences').textContent!).overrides).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Remove placement for Editor' }));
  expect(screen.queryByRole('region', { name: 'Placement for Editor' })).toBeNull();
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('textbox', { name: 'Default placement offset X' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add override' })).toBeDisabled();
});

it('preserves read-only settings and surfaces context failures', async () => {
  vi.mocked(api.placementContext).mockRejectedValueOnce(Error('Desktop unavailable'));
  render(<Editor readOnly />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Desktop unavailable');
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Default placement offset X' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Default placement width' })).toBeDisabled();
  expect(api.requestPlacementAccess).not.toHaveBeenCalled();
});

it('edits dimensions independently, validates limits and lets app sizes inherit defaults', async () => {
  render(<Editor />);
  await screen.findByRole('button', { name: 'Use last focused app: Chat' });
  const preferences = () => JSON.parse(screen.getByTestId('preferences').textContent!) as Preferences;
  const width = screen.getByRole('textbox', { name: 'Default placement width' });
  const height = screen.getByRole('textbox', { name: 'Default placement height' });
  expect(width).toHaveValue('640'); expect(height).toHaveValue('480');
  for (const value of ['559', '4097', 'NaN', '-']) {
    fireEvent.change(width, { target: { value } }); expect(width).toBeInvalid();
    expect(preferences().default.width).toBe(640);
  }
  fireEvent.change(width, { target: { value: '800' } }); expect(width).toBeValid();
  fireEvent.change(height, { target: { value: '419' } }); expect(height).toBeInvalid();
  fireEvent.change(height, { target: { value: '600.5' } }); expect(height).toBeValid();
  fireEvent.click(screen.getByRole('button', { name: 'Use last focused app: Chat' }));
  const appWidth = screen.getByRole('textbox', { name: 'Chat placement width' });
  const appHeight = screen.getByRole('textbox', { name: 'Chat placement height' });
  expect(appWidth).toHaveValue(''); expect(appWidth).toHaveAttribute('placeholder', 'Default (800)');
  expect(preferences().overrides[0].rule.width).toBeNull();
  fireEvent.change(appWidth, { target: { value: '960' } });
  expect(preferences().overrides[0].rule.width).toBe(960);
  expect(preferences().overrides[0].rule.height).toBeNull();
  fireEvent.change(height, { target: { value: '700' } });
  expect(appHeight).toHaveAttribute('placeholder', 'Default (700)');
  fireEvent.change(appWidth, { target: { value: '' } });
  expect(preferences().overrides[0].rule.width).toBeNull();
  fireEvent.change(width, { target: { value: '' } });
  expect(preferences().default.width).toBeNull();
  fireEvent.click(screen.getByRole('switch'));
  expect(width).toBeDisabled(); expect(appHeight).toBeDisabled();
});
