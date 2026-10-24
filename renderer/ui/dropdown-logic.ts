/* Pure decision logic for the custom dropdown menu: keyboard step navigation,
 * list option resolution, and vertical placement based on viewport clearance. */

export interface DropdownOption {
  value: string;
  label: string;
  icon?: string;
}

export function resolveOptions(options: DropdownOption[], first?: string): DropdownOption[] {
  return first !== undefined ? [{ value: '', label: first }, ...options] : options;
}

export function findOptionIndex(options: DropdownOption[], value: string): number {
  return options.findIndex((o) => o.value === value);
}

export function stepIndex(current: number, count: number, dir: 1 | -1, loop: boolean = true): number {
  if (count <= 0) return -1;
  if (dir === 1) {
    if (current < 0) return 0;
    if (current < count - 1) return current + 1;
    return loop ? 0 : count - 1;
  }
  if (current < 0) return count - 1;
  if (current > 0) return current - 1;
  return loop ? count - 1 : 0;
}

export function shouldOpenUpward(
  rect: { top: number; bottom: number },
  windowHeight: number,
  menuHeight: number = 240,
): boolean {
  const spaceBelow = windowHeight - rect.bottom;
  const spaceAbove = rect.top;
  return spaceBelow < menuHeight && spaceAbove > spaceBelow;
}
