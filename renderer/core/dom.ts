/* One helper, shared. Kept apart from anything that renders so a module needing a
 * selector does not have to import a view. */
export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
