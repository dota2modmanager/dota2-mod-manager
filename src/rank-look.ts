/* The rank medal and the Dota Plus hero levels the player sees on their own screen: a medal and
 * stars of their choosing, and a level from 1 to 30 for any hero, with the tier badge that level
 * earns. Nobody else sees any of it. The game draws other players' medals from the same classes,
 * so the medal is everyone's in this player's game, while the levels are only on the player's own
 * hero cards and on their own pick.
 *
 * The medal is a picture a style puts on a panel by class: `.RankTier3 .RankTierImage` gets
 * rank3_psd, `.RankPips2 .RankPipImage` gets pip2_psd. So the app reads the two styles that carry
 * those rules back as CSS (ValveResourceFormat), and adds a copy of each rule with the chosen
 * picture in it at the end, where it wins. A rule drawn small (`.Minimal`, the mini folder) gets the
 * small picture, so the medal keeps its size.
 *
 * A level is a number the client asks Steam for, so no style can change it. A script can: Panorama
 * runs the JavaScript a layout includes, and the script writes the number into the label and sets
 * the tier class on the badge every half second. It goes into five layouts, by adding one
 * include to the tree in their LaCo block (as src/menu-background.ts does): the hero grid of the
 * menu and the pick screen, the player's own panel at the pick, the strategy screen, the hero
 * page with its badge, progress tab and experience bar, and the card that opens over a hero.
 *
 * Tried in the game on 2026-11-04: the profile medal, the hero grid and the pick badge took them.
 */
import { readKv3, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock } from './resource.ts';
import { children } from './menu-background.ts';

/** A medal: the tier (0 not calibrated, 8 Immortal), the stars of tiers 1 to 7, and an Immortal's leaderboard place. */
export interface Medal { tier: number; stars: number; top: 0 | 5000 | 100 | 10 }

/** What the player picked: a medal or the game's own, a level per hero, and one for every hero not named. */
export interface RankLook { medal: Medal | null; levels: Record<string, number>; every: number | null }

/** The two styles that hold the medal's rules, as compiled in the pak and as the compiler's source. */
export const STYLES = ['panorama/styles/dotastyles', 'panorama/styles/avatar_rank_tier'].map((p) => ({ compiled: `${p}.vcss_c`, source: `${p}.css` }));
/** The layouts the levels script goes into: the hero grid, the player's panel at the pick, the strategy screen, the hero page, the card over a hero. */
export const LAYOUTS = ['panorama/layout/hero_grid_new.vxml_c', 'panorama/layout/hud/dota_hud_hero_picking_player.vxml_c', 'panorama/layout/hud/dota_hud_pregame.vxml_c', 'panorama/layout/dashboard_page_hero_new_v2.vxml_c', 'panorama/layout/tooltips/tooltip_hero_card.vxml_c'];
/** The script, as the compiler's source and as the layouts name it. */
export const SCRIPT = { source: 'panorama/scripts/d2mm_rank_look.js', compiled: 'panorama/scripts/d2mm_rank_look.vjs_c', ref: 'panorama/scripts/d2mm_rank_look.vjs' };

/** The badge tiers in order, as the game's classes name them; a level's tier is (level - 1) / 5. */
export const TIERS = ['BronzeTier', 'SilverTier', 'GoldTier', 'PlatinumTier', 'MasterTier', 'GrandmasterTier'];
/** The tier a level from 1 to 30 earns, 0 (bronze) to 5 (grandmaster). */
export const tierOf = (level: number): number => Math.min(5, Math.max(0, Math.floor((level - 1) / 5)));

const HERO = /^[a-z0-9_]{2,40}$/;
const whole = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** What the window sent, kept to what the game has: tiers 0 to 8, stars 1 to 5, levels 1 to 30. */
export function clampLook(raw: unknown): RankLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const m = (r.medal && typeof r.medal === 'object' ? r.medal : null) as Record<string, unknown> | null;
  const tier = m ? whole(m.tier, 0, 8) : null;
  const top = m && [5000, 100, 10].includes(Number(m.top)) ? Number(m.top) as Medal['top'] : 0;
  const medal: Medal | null = tier === null ? null : { tier, stars: whole(m!.stars, 1, 5) ?? 1, top: tier === 8 ? top : 0 };
  const levels: Record<string, number> = {};
  const given = r.levels && typeof r.levels === 'object' ? r.levels as Record<string, unknown> : {};
  for (const [hero, v] of Object.entries(given)) {
    const n = whole(v, 1, 30);
    if (HERO.test(hero) && n !== null) levels[hero] = n;
  }
  return { medal, levels, every: whole(r.every, 1, 30) };
}

/** Whether there is anything to build. */
export const lookIsEmpty = (look: RankLook): boolean => !look.medal && look.every === null && !Object.keys(look.levels).length;

/** The medal's picture, as the rules name one; `mini` for a rule that draws it small. */
export function medalImage(m: Medal, mini: boolean): string {
  const name = m.tier === 8 && m.top ? `rank8${{ 5000: 'a', 100: 'b', 10: 'c' }[m.top]}${mini ? '_mini' : ''}_psd` : `${mini ? 'mini/' : ''}rank${m.tier}_psd`;
  return `s2r://panorama/images/rank_tier_icons/${name}.vtex`;
}

const MARK = '/* d2mm: rank medal */';
const MEDAL_URL = /rank_tier_icons\/(?:mini\/)?rank\d/;
const PIP_URL = /rank_tier_icons\/pip\d/;
const SMALL = /rank_tier_icons\/mini\/|_mini_psd|\.Minimal/;

/**
 * The CSS ValveResourceFormat read out of a style, with the medal's rules at its end: every rule
 * that puts a medal on, copied with the chosen one, and every rule that puts stars on, copied with
 * the chosen stars (none for tiers 0 and 8). The tool's banner goes, and rules this added before
 * are replaced rather than stacked.
 */
export function withMedal(css: string, medal: Medal): string {
  const own = css.replace(/^\s*\/\*[^\n]*Source 2 Viewer[^\n]*\*\/\s*/, '');
  const at = own.indexOf(MARK);
  const base = (at >= 0 ? own.slice(0, at) : own).replace(/\s+$/, '');
  const stars = medal.tier >= 1 && medal.tier <= 7;
  const out: string[] = [];
  for (const m of base.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@') || sel.includes('/*')) continue;
    if (MEDAL_URL.test(m[2])) out.push(`${sel}\n{\n\tbackground-image: url("${medalImage(medal, SMALL.test(sel) || SMALL.test(m[2]))}");\n}`);
    // every rule on the stars, the one that hides them for an uncalibrated rank too
    else if (PIP_URL.test(m[2]) || /\.RankPipImage\b/.test(sel)) {
      out.push(`${sel}\n{\n\t${stars ? `background-image: url("s2r://panorama/images/rank_tier_icons/pip${medal.stars}_psd.vtex");\n\tvisibility: visible;` : 'visibility: collapse;'}\n}`);
    }
  }
  return `${base}\n\n${MARK}\n${out.join('\n\n')}\n`;
}

/**
 * The script the layouts include. It knows the levels and the medal, finds what is on its
 * panel each half second (hero cards, the player's own panel at the pick, the strategy badge) and
 * writes them in. Each part is in a try of its own: a panel a patch renamed stops that part only,
 * and says so once in the game's console. `ids` names the chosen heroes by the number the game
 * gives them, for the panels that know a hero only by it.
 */
export function levelsScript(look: RankLook, ids: Record<number, string> = {}): string {
  const m = look.medal;
  // the medal's name in the game's own language, as the pick screen writes it: "Divine V"
  const rank = m ? `$.Localize("#DOTARankTierName${m.tier}")${m.tier >= 1 && m.tier <= 7 ? ` + $.Localize("#DOTARankPipsName${m.stars}")` : ''}` : 'null';
  return `"use strict";
var D2MM_LEVELS = ${JSON.stringify(look.levels)};
var D2MM_EVERY = ${look.every === null ? 'null' : look.every};
var D2MM_IDS = ${JSON.stringify(ids)};
var D2MM_RANK = ${rank};
var D2MM_TIERS = ${JSON.stringify(TIERS)};
var D2MM_SAID = {};
// one line per thing in the game's console (-condebug writes it to dota/console.log), so a part
// that finds nothing can be told from one that is not there
function d2mmSay(what, text) {
  if (D2MM_SAID[what]) return;
  D2MM_SAID[what] = true;
  $.Msg("d2mm rank look: " + what + ": " + text);
}
function d2mmLevel(hero) {
  var n = D2MM_LEVELS[String(hero || "").replace(/^npc_dota_hero_/, "")];
  return n === undefined ? D2MM_EVERY : n;
}
// a hero image names its hero by name in one place and only by number in another
function d2mmHeroOf(img) {
  if (!img) return "";
  return img.heroname || D2MM_IDS[img.heroid] || "";
}
function d2mmKnown(lvl) { return lvl !== null && lvl !== undefined; }
// the panels under this one that pass the test, walked by hand: what the game's own finders
// return is not always an array a script can join
function d2mmFind(panel, test, out) {
  out = out || [];
  for (var i = 0; i < panel.GetChildCount(); i++) {
    var ch = panel.GetChild(i);
    if (!ch) continue;
    if (test(ch)) out.push(ch);
    d2mmFind(ch, test, out);
  }
  return out;
}
function d2mmTier(panel, lvl) {
  var tier = D2MM_TIERS[Math.min(5, Math.floor((lvl - 1) / 5))];
  panel.SetHasClass("NoTier", false);
  for (var t = 0; t < D2MM_TIERS.length; t++) panel.SetHasClass(D2MM_TIERS[t], D2MM_TIERS[t] === tier);
}
// the game binds these labels to a dialog variable and binds it again when its number comes, so
// the number goes into the variable on the label itself, where the lookup starts, and the text
function d2mmText(label, name, lvl) {
  label.SetDialogVariableInt(name, lvl);
  label.text = String(lvl);
}
var D2MM_BADGES = [];
// a badge redraws itself, the medal model on the hero page included, from the level it is given,
// as the game's own post-game screen gives it one; the game gives it the real level again when
// the hero changes, and a badge whose hero has no level of its own gets that back
function d2mmBadge(badge, lvl) {
  if (badge.herolevel === undefined) return d2mmBadgeByHand(badge, lvl);
  var rec = null;
  for (var r = 0; r < D2MM_BADGES.length; r++) if (D2MM_BADGES[r].panel === badge) rec = D2MM_BADGES[r];
  if (!rec) { rec = { panel: badge, mine: null, real: badge.herolevel }; D2MM_BADGES.push(rec); }
  if (badge.herolevel !== rec.mine) rec.real = badge.herolevel;
  if (d2mmKnown(lvl)) {
    if (badge.herolevel !== lvl) badge.herolevel = lvl;
    rec.mine = lvl;
  } else if (rec.mine !== null) {
    badge.herolevel = rec.real;
    rec.mine = null;
  }
}
// for a badge without the level to give it: the number and the tier class written in
function d2mmBadgeByHand(badge, lvl) {
  if (!d2mmKnown(lvl)) return;
  d2mmSay("badge", "has no herolevel, written by hand");
  var all = [badge].concat(d2mmFind(badge, function (p) { return p.BHasClass("LevelStyle") || p.BHasClass("ModelStyle"); }));
  for (var a = 0; a < all.length; a++) {
    d2mmTier(all[a], lvl);
    all[a].SetDialogVariableInt("hero_level", lvl);
    for (var c = 0; c < all[a].GetChildCount(); c++) {
      var ch = all[a].GetChild(c);
      if (ch.paneltype === "Label") d2mmText(ch, "hero_level", lvl);
    }
  }
}
// the hero page names its hero only in words, so the hero is the one whose name it shows
function d2mmPageHero(page) {
  var shown = d2mmFind(page, function (p) { return p.paneltype === "Label" && (p.BHasClass("TabContentsHeroName") || p.BHasClass("TitleExtraLarge")) && p.text; });
  var name = shown.length ? shown[0].text : "";
  for (var key in D2MM_LEVELS) if (name && $.Localize("#npc_dota_hero_" + key).toLowerCase() === name.toLowerCase()) return D2MM_LEVELS[key];
  return name ? D2MM_EVERY : null;
}
function d2mmApply() {
  var me = $.GetContextPanel();
  try {
    var cards = d2mmFind(me, function (p) { return p.BHasClass("HeroCard"); });
    if (cards.length) {
      var first = cards[0].FindChildTraverse("HeroImage");
      d2mmSay("hero grid", cards.length + " cards, the first " + (first ? first.heroname + " #" + first.heroid : "without an image"));
    }
    for (var i = 0; i < cards.length; i++) {
      var lvl = d2mmLevel(d2mmHeroOf(cards[i].FindChildTraverse("HeroImage")));
      if (!d2mmKnown(lvl)) continue;
      var label = cards[i].FindChildTraverse("HeroBadgeLevel");
      if (label) d2mmText(label, "hero_badge_level", lvl);
      cards[i].SetDialogVariableInt("hero_badge_level", lvl);
      d2mmTier(cards[i], lvl);
      var parts = ["HeroBadgeStatus", "HeroBadgeIcon"];
      for (var p = 0; p < parts.length; p++) { var part = cards[i].FindChildTraverse(parts[p]); if (part) d2mmTier(part, lvl); }
    }
  } catch (e) { d2mmSay("hero grid failed", e); }
  try {
    if (me.BHasClass("IsLocalPlayerPawn")) {
      var rank = me.FindChildTraverse("PlayerRank");
      if (rank && D2MM_RANK) rank.text = D2MM_RANK;
      var badge = me.FindChildTraverse("HeroBadge");
      var own = d2mmLevel(d2mmHeroOf(me.FindChildTraverse("HeroImage")));
      if (badge && d2mmKnown(own)) me.SetHasClass("ShowHeroBadge", true);
      if (badge) d2mmBadge(badge, own);
    }
  } catch (e) { d2mmSay("pick failed", e); }
  try {
    var strategy = me.FindChildTraverse("StrategyHeroBadge");
    var mine = strategy ? d2mmLevel(Players.GetPlayerSelectedHero(Players.GetLocalPlayer())) : null;
    if (strategy) d2mmBadge(strategy, mine);
  } catch (e) { d2mmSay("strategy failed", e); }
  try {
    // the card that opens over a hero in the grid
    var tip = me.BHasClass("HeroCardTooltipContents") ? me : d2mmFind(me, function (p) { return p.BHasClass("HeroCardTooltipContents"); })[0];
    if (tip) {
      var tipLvl = d2mmLevel(d2mmHeroOf(tip.FindChildTraverse("HeroImage")));
      var tipBadge = tip.FindChildTraverse("HeroBadge");
      if (tipBadge) d2mmBadge(tipBadge, tipLvl);
    }
  } catch (e) { d2mmSay("hero card failed", e); }
  try {
    if (me.paneltype === "DOTAHeroPageNewV2") {
      var page = d2mmPageHero(me);
      var chosen = d2mmKnown(page);
      // the page's own badge and the one on its progress tab
      var bigs = d2mmFind(me, function (p) { return p.id === "HeroBadge" || p.id === "HeroBadgeProgression"; });
      for (var b = 0; b < bigs.length; b++) d2mmBadge(bigs[b], page);
      // the experience to the next level is the real level's, so it goes while a level is chosen
      var xp = d2mmFind(me, function (p) { return p.id === "HeroLevelProgress" || p.BHasClass("CurrentLevelXPLabel") || p.BHasClass("NextLevelXPLabel"); });
      for (var x = 0; x < xp.length; x++) xp[x].visible = !chosen;
      var named = d2mmFind(me, function (p) { return p.paneltype === "Label" && p.BHasClass("TabContentsHeroName"); });
      d2mmSay("hero page " + (named.length ? named[0].text : ""), "level " + page + ", " + bigs.length + " badges, " + xp.length + " experience panels");
    }
  } catch (e) { d2mmSay("hero page failed", e); }
  $.Schedule(0.5, d2mmApply);
}
d2mmApply();
`;
}

type Obj = Extract<Kv3Node, { kind: 'object' }>;
const str = (value: string): Kv3Node => ({ kind: 'string', value });
const obj = (o: Record<string, Kv3Node>): Obj => ({ kind: 'object', members: new Map(Object.entries(o)) });
const eType = (n: Kv3Node): string | undefined => {
  const v = n.kind === 'object' ? n.members.get('eType') : undefined;
  return v?.kind === 'string' ? v.value : undefined;
};

/** Whether any node under this one names `ref`. */
function names(n: Kv3Node, ref: string): boolean {
  if (n.kind === 'string') return n.value === ref;
  if (n.kind === 'object') return [...n.members.values()].some((v) => names(v, ref));
  if (n.kind === 'array') return n.items.some((v) => names(v, ref));
  return false;
}

/**
 * A compiled layout that also includes the script: one SCRIPTS node put in front of its panel,
 * the way the compiler writes `<scripts><include src="..."/></scripts>`. A layout that has it
 * already is left as it is.
 */
export function withScript(layout: Buffer): Buffer {
  const laco = resourceBlock(layout, 'LaCo');
  const kv: Kv3Block = readKv3(laco.data);
  const ast = kv.root.kind === 'object' ? kv.root.members.get('m_AST') : undefined;
  const root = ast?.kind === 'object' ? ast.members.get('m_pRoot') : undefined;
  if (root?.kind !== 'object') throw new Error('layout without a tree');
  if (names(root, SCRIPT.ref)) return layout;
  const list = children(root);
  const node = obj({ eType: str('SCRIPTS'), child: obj({ eType: str('INCLUDE'), child: obj({ eType: str('REFERENCE_COMPILED'), name: str(SCRIPT.ref) }) }) });
  const panel = list.findIndex((c) => eType(c) === 'PANEL');
  list.splice(panel >= 0 ? panel : list.length, 0, node);
  return laco.replace(writeKv3(kv));
}
