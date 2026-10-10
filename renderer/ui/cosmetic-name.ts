// The original name remains the icon/favourite/save key. Only labels and search use Chinese.
let names: Record<string, string> = {};

export function setCosmeticNames(value: Record<string, string>): void { names = value; }

export function cosmeticName(name: string): string {
  return typeof window !== 'undefined' && window.I18N_LANG === 'zh-CN' && Object.hasOwn(names, name) ? names[name] : name;
}

export function cosmeticNameMatches(name: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${name} ${cosmeticName(name)}`.toLowerCase();
  return words.every((word) => text.includes(word));
}
