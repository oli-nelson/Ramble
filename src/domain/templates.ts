import type { CommandTemplate } from './types';

export const variables = ['MODEL_ID', 'REASONING_EFFORT', 'PROMPT'] as const;
type Variable = typeof variables[number];
type Part = { text: string } | { variable: Variable };
type Node = { parts: Part[] } | { variable: Variable; children: Node[] };

// Quotes group arguments, not shell programs. Tokenize BEFORE injecting values.
export function parseCommand(command: string): Node[] {
  if (new TextEncoder().encode(command).length > 65536 || command.includes('\0')) throw Error('Command is too long or contains NUL.');
  let i = 0;
  const variable = (name: string): Variable => {
    if (!variables.includes(name as Variable)) throw Error(`Unknown variable: ${name}. Use {{MODEL_ID}}, {{REASONING_EFFORT}} or {{PROMPT}}.`);
    return name as Variable;
  };
  function read(nested = false, depth = 0): Node[] {
    if (depth > 4) throw Error('Optional sections are nested too deeply.');
    const nodes: Node[] = [];
    while (i < command.length) {
      while (/\s/.test(command[i] ?? '') && i < command.length) i++;
      if (i === command.length) break;
      if (command.startsWith(']]', i)) {
        if (!nested) throw Error('Unexpected optional-section closing marker.');
        i += 2; return nodes;
      }
      if (command.startsWith('[[', i)) {
        i += 2;
        if (command[i] === '!') i++;
        const name = command.slice(i).match(/^[A-Z_]+(?=\s)/)?.[0];
        if (!name) throw Error('Optional sections start with [[MODEL_ID or [[REASONING_EFFORT followed by a space.');
        const guard = variable(name); i += name.length;
        if (guard === 'PROMPT') throw Error('PROMPT cannot be optional.');
        nodes.push({ variable: guard, children: read(true, depth + 1) });
      } else {
        const parts: Part[] = []; let text = ''; let quote = '';
        const flush = () => { if (text) { parts.push({ text }); text = ''; } };
        while (i < command.length) {
          const c = command[i];
          if (!quote && /\s/.test(c)) break;
          if (c === '\\' && i + 1 < command.length && /[\s\\'"{\[\]]/.test(command[i + 1])) { text += command[i + 1]; i += 2; continue; }
          if (c === '"' || c === "'") {
            if (!quote) { quote = c; i++; continue; }
            if (quote === c) { quote = ''; i++; continue; }
          }
          if (command.startsWith('{{', i)) {
            const end = command.indexOf('}}', i + 2);
            if (end < 0) throw Error('Unclosed variable.');
            flush(); parts.push({ variable: variable(command.slice(i + 2, end)) }); i = end + 2; continue;
          }
          text += c; i++;
        }
        if (quote) throw Error('Unclosed quote in command.');
        flush(); nodes.push({ parts });
      }
      if (nodes.length > 128) throw Error('Too many command arguments.');
    }
    if (nested) throw Error('Unclosed optional section; end it with a space and ]].');
    return nodes;
  }
  const nodes = read();
  if (!nodes.length || !('parts' in nodes[0]) || !nodes[0].parts.length || nodes[0].parts.some(p => 'variable' in p)) throw Error('Start the command with a literal executable name or quoted path.');
  const executable = nodes[0].parts.map(p => 'text' in p ? p.text : '').join('');
  if (!executable.trim() || new TextEncoder().encode(executable).length > 4096 || /[\n\r]/.test(executable)) throw Error('Invalid executable name or path.');
  return nodes;
}

export const usesVariable = (command: string, name: Variable): boolean => {
  try {
    const uses = (nodes: Node[]): boolean => nodes.some(n => 'parts' in n ? n.parts.some(p => 'variable' in p && p.variable === name) : n.variable === name || uses(n.children));
    return uses(parseCommand(command));
  } catch { return false; }
};

export function validateTemplate(template: CommandTemplate): string | null {
  if (!template.name.trim() || !template.command.trim()) return 'Enter a name and command template.';
  try {
    const count = (nodes: Node[], optional = false): number => nodes.reduce((total, n) => {
      if ('children' in n) return total + count(n.children, true);
      const prompts = n.parts.filter(p => 'variable' in p && p.variable === 'PROMPT').length;
      if (optional && prompts) throw Error('PROMPT cannot be optional.');
      return total + prompts;
    }, 0);
    const prompts = count(parseCommand(template.command));
    if (template.promptTransport === 'stdin' && prompts) return 'Stdin sends the prompt directly. Remove {{PROMPT}} from the command.';
    if (template.promptTransport === 'argument' && prompts !== 1) return 'Argument transport needs exactly one {{PROMPT}} variable.';
  } catch (e) { return (e as Error).message; }
  return null;
}
