import type { Command } from 'commander';

/** Every command of the tree, depth first, each with its path (`analyzr models list`). */
export function commandTree(cmd: Command, prefix = ''): { path: string; command: Command }[] {
  const at = prefix === '' ? cmd.name() : `${prefix} ${cmd.name()}`;
  return [{ path: at, command: cmd }, ...cmd.commands.flatMap((c) => commandTree(c, at))];
}

/**
 * The help of every command of the tree, one section each (`## analyzr models list`), at a
 * fixed width and without colors, so it reads the same on every terminal and in CI.
 */
export function helpTexts(program: Command): string {
  return commandTree(program)
    .map(({ path, command }) => {
      command.configureOutput({ getOutHelpWidth: () => 100, getOutHasColors: () => false });
      return `## ${path}\n\n${command.helpInformation()}`;
    })
    .join('\n');
}
