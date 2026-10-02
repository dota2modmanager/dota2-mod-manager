/* The window's own elements, which index.html writes and every module of the shell reaches by id.
 * Asserted rather than checked: the page is ours, and an id missing from it is a bug to see at once. */
export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
