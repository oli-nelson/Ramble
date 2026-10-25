import { expect, it } from 'vitest';
import fixtures from '../../tests/fixtures/contracts.json';
import builtins from './builtins.json';
import { defaultSettings } from './defaults';
import type { Anchor, BuildRequest, BuildOutcome, BuildPreview, HarnessOutput, PlacementContext, PlacementSettings, Settings } from './types';

it('shares exact default settings with the native schema', () => {
  const settings: Settings = defaultSettings();
  expect(settings).toEqual(builtins);
  expect(settings.templates.map(t => t.id)).toEqual(['opencode', 'codex', 'claude']);
  settings.presets[0].parameters.model = 'custom';
  expect(defaultSettings().presets[0].parameters.model).toBe('openai/gpt-6-luna');
});

it('agrees with the Rust request and terminal outcome fixtures', () => {
  const request: BuildRequest = fixtures.request;
  const outcome: BuildOutcome = { ...fixtures.outcome, kind: 'succeeded' };
  const preview: BuildPreview = fixtures.buildPreview;
  const diagnostic: HarnessOutput = fixtures.harnessOutput;
  expect(JSON.parse(JSON.stringify(diagnostic))).toEqual(fixtures.harnessOutput);
  expect(JSON.parse(JSON.stringify(preview))).toEqual(fixtures.buildPreview);
  expect(JSON.parse(JSON.stringify(request))).toEqual(fixtures.request);
  expect(JSON.parse(JSON.stringify(outcome))).toEqual(fixtures.outcome);
});

it('uses the actual Control key for the shared summon shortcut on both platforms', () => {
  expect(defaultSettings().hotkey).toBe('Control+Shift+Y');
});

it('uses the requested Luna models and medium effort in the default presets', () => {
  const settings = defaultSettings();
  expect(settings.presets[0].parameters).toEqual({ model: 'openai/gpt-6-luna', reasoningEffort: 'medium' });
  expect(settings.presets[1].parameters).toEqual({ model: 'gpt-6-luna', reasoningEffort: 'medium' });
});

it('agrees with the narrow native placement context contract', () => {
  const context: PlacementContext = fixtures.placementContext;
  expect(JSON.parse(JSON.stringify(context))).toEqual(fixtures.placementContext);
  expect(Object.keys(context).sort()).toEqual(['accessibilityGranted', 'accessibilityRequired', 'applications', 'lastApplication', 'message']);
});

it('agrees with native default sizes and per-axis app inheritance', () => {
  const preferences: PlacementSettings = { ...fixtures.placementSettings,
    default: { ...fixtures.placementSettings.default, anchor: fixtures.placementSettings.default.anchor as Anchor },
    overrides: fixtures.placementSettings.overrides.map(o => ({ ...o, rule: { ...o.rule, anchor: o.rule.anchor as Anchor } })) };
  expect(JSON.parse(JSON.stringify(preferences))).toEqual(fixtures.placementSettings);
  expect(preferences.overrides[0].rule.height).toBeNull();
  expect(defaultSettings().placement.default).toMatchObject({ width: 640, height: 480 });
});
