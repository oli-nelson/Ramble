import type { Settings } from './types';
import builtins from './builtins.json';

// Both Rust and the webview consume this bundled, native-validated resource.
export const DEFAULT_STYLE = builtins.defaultStyle;
export const defaultSettings = (): Settings => structuredClone(builtins) as Settings;
