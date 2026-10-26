/**
 * /ai/setup.md - the setup instructions for an AI assistant, at an address short enough to type.
 *
 * The ai-mods guide tells people to send their assistant one line with this link. The page is
 * skills/dota2-modding/SETUP.md from the repository, read at build time, so the site and the
 * skill cannot drift apart: change the file and the next deploy serves it. Plain text rather
 * than a rendered page, because the reader is a model fetching a URL.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../lib/paths';

export const GET: APIRoute = () => {
  const setup = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'dota2-modding', 'SETUP.md'), 'utf8');
  return new Response(setup, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
