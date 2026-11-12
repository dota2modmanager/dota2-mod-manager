/* The script the rank look puts into the game's layouts (src/rank-look.ts says which and why):
 * Panorama JavaScript, written out with the player's levels and medal in it. Out of rank-look.ts
 * when it outgrew that file's budget.
 */
import { TIER_FROM, TIERS, type RankLook } from './rank-look.ts';

/**
 * The script the layouts include. It knows the levels and the medal, finds what is on its
 * panel every frame (hero cards, the player's own panel at the pick, the strategy badge) and
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
var D2MM_TIER_FROM = ${JSON.stringify(TIER_FROM)};
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
function d2mmTierOf(lvl) {
  var t = 0;
  while (t + 1 < D2MM_TIER_FROM.length && lvl >= D2MM_TIER_FROM[t + 1]) t++;
  return t;
}
function d2mmTier(panel, lvl) {
  var tier = D2MM_TIERS[d2mmTierOf(lvl)];
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
  var labels = d2mmLook("page names", function () { return d2mmClassed(page, "TabContentsHeroName").concat(d2mmClassed(page, "TitleExtraLarge")).filter(function (p) { return p.paneltype === "Label"; }); });
  var name = "";
  for (var l = 0; l < labels.length && !name; l++) name = labels[l].text;
  for (var key in D2MM_LEVELS) if (name && $.Localize("#npc_dota_hero_" + key).toLowerCase() === name.toLowerCase()) return D2MM_LEVELS[key];
  return name ? D2MM_EVERY : null;
}
// the portrait's badge is the game's own panel and puts its tier class back on every update, so
// the frame round the portrait is drawn on the overlay inside it, which the game leaves alone
// the unit the portrait shows, chosen as the game chooses it: the one being inspected, else the
// first selected, else the player's hero (in this script the game's own portrait unit answers -1)
function d2mmPortraitUnit() {
  var me = Players.GetLocalPlayer();
  var q = Players.GetQueryUnit(me);
  if (q !== undefined && q !== -1) return q;
  var sel = Players.GetSelectedEntities(me);
  if (sel && sel.length && sel[0] !== -1) return sel[0];
  return Players.GetPlayerHeroEntityIndex(me);
}
var D2MM_PORTRAIT = null;
function d2mmPortrait(frame, lvl) {
  var overlay = frame.FindChildTraverse("PortraitHeroBadgeOverlay");
  if (!overlay) return d2mmSay("portrait", "no PortraitHeroBadgeOverlay");
  var want = d2mmKnown(lvl) ? 'url("s2r://panorama/images/hud/portrait_hero_badge_frame_tier_' + (d2mmTierOf(lvl) + 1) + '_psd.vtex")' : null;
  if (want === D2MM_PORTRAIT) return;
  overlay.style.backgroundImage = want;
  D2MM_PORTRAIT = want;
  d2mmSay("portrait " + (want ? "level " + lvl : "the game's own"), "frame on the overlay");
  if (d2mmKnown(lvl)) d2mmTier(frame, lvl);
}
var D2MM_TICK = 0;
var D2MM_SEEN = {};
// the script runs every frame, so a badge the game opens on the real level is on the chosen one
// before the frame is drawn. The badges are found by the game's own finders, which are quick; what
// only a walk of the tree finds is walked for again once a second and kept in between
function d2mmLook(key, find) {
  var had = D2MM_SEEN[key];
  var gone = false;
  if (had) for (var i = 0; i < had.length; i++) if (had[i].IsValid && !had[i].IsValid()) gone = true;
  if (!had || gone || D2MM_TICK % 60 === 0) D2MM_SEEN[key] = find();
  return D2MM_SEEN[key];
}
// the panels with this class, copied into an array a script can join
function d2mmClassed(panel, cls) {
  var got = panel.FindChildrenWithClassTraverse(cls);
  var out = [];
  for (var i = 0; i < got.length; i++) out.push(got[i]);
  return out;
}
// which layout this copy of the script is in, so each does only its own part: the HUD and the
// lobby pages are trees of thousands of panels, and a search of them every frame in every copy
// (ten top bar players, ten pick players) cost the game a third of its frames
var D2MM_ROLES = { DOTAHeroGridNew: "grid", DOTAHudHeroPickingPlayer: "pick", DOTAHudPreGame: "pregame", TooltipContents: "tooltip",
  DOTATopBarPlayer: "bar", DOTAHUDInspect: "inspect", DOTAHeroPageNewV2: "page" };
function d2mmRole(me) {
  if (me.BHasClass("HeroCardTooltipContents")) return "tooltip";
  if (D2MM_ROLES[me.paneltype]) return D2MM_ROLES[me.paneltype];
  // the grid's own layout, as tests and older patches name its root
  if (d2mmClassed(me, "HeroCard").length) return "grid";
  return "hud";
}
var D2MM_ROLE = null;
// one panel found once and kept while it lives; one not there yet is looked for twice a second
var D2MM_KEPT = {};
function d2mmKeep(key, find) {
  var k = D2MM_KEPT[key];
  if (k && k.panel && (!k.panel.IsValid || k.panel.IsValid())) return k.panel;
  if (k && !k.panel && D2MM_TICK - k.at < 30) return null;
  var panel = find() || null;
  D2MM_KEPT[key] = { panel: panel, at: D2MM_TICK };
  return panel;
}
function d2mmApply() {
  var me = $.GetContextPanel();
  if (D2MM_ROLE === null) D2MM_ROLE = d2mmRole(me);
  D2MM_TICK++;
  // the game does not set a tile back, so the tiles are seen to twice a second or so
  if (D2MM_ROLE === "grid" && D2MM_TICK % 30 === 1) try {
    var cards = d2mmClassed(me, "HeroCard");
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
    if (D2MM_ROLE === "pick" && me.BHasClass("IsLocalPlayerPawn")) {
      var rank = me.FindChildTraverse("PlayerRank");
      if (rank && D2MM_RANK) rank.text = D2MM_RANK;
      var badge = me.FindChildTraverse("HeroBadge");
      var own = d2mmLevel(d2mmHeroOf(me.FindChildTraverse("HeroImage")));
      if (badge && d2mmKnown(own)) me.SetHasClass("ShowHeroBadge", true);
      if (badge) d2mmBadge(badge, own);
    }
  } catch (e) { d2mmSay("pick failed", e); }
  try {
    var strategy = D2MM_ROLE === "pregame" ? d2mmKeep("strategy", function () { return me.FindChildTraverse("StrategyHeroBadge"); }) : null;
    var mine = strategy ? d2mmLevel(Players.GetPlayerSelectedHero(Players.GetLocalPlayer())) : null;
    if (strategy) d2mmBadge(strategy, mine);
  } catch (e) { d2mmSay("strategy failed", e); }
  try {
    // the card that opens over a hero in the grid
    var tip = D2MM_ROLE !== "tooltip" ? null : me.BHasClass("HeroCardTooltipContents") ? me : d2mmKeep("tip", function () { return d2mmClassed(me, "HeroCardTooltipContents")[0]; });
    if (tip) {
      var tipLvl = d2mmLevel(d2mmHeroOf(tip.FindChildTraverse("HeroImage")));
      var tipBadge = tip.FindChildTraverse("HeroBadge");
      if (tipBadge) d2mmBadge(tipBadge, tipLvl);
    }
  } catch (e) { d2mmSay("hero card failed", e); }
  if (D2MM_ROLE === "hud" || D2MM_ROLE === "bar" || D2MM_ROLE === "inspect") try {
    // in a match, the player's own hero: the frame round the portrait, the top bar, and the card
    // that opens on a player. A hero is in a match once, so its name tells the player's own apart
    var own = String(Players.GetPlayerSelectedHero(Players.GetLocalPlayer()) || "").replace(/^npc_dota_hero_/, "");
    var played = own ? d2mmLevel(own) : null;
    // each layout says once what it found, so a match's console tells which step stopped
    var frame = own && D2MM_ROLE === "hud" ? d2mmKeep("unitbadge", function () { return me.FindChildTraverse("unitbadge"); }) : null;
    if (frame) {
      var unit = d2mmPortraitUnit();
      var hero = Players.GetPlayerHeroEntityIndex(Players.GetLocalPlayer());
      var owned = hero !== -1 && unit === hero;
      d2mmSay("match " + own + " level " + played + (owned ? " in the portrait" : " not in the portrait"),
        "unit " + unit + ", the player's hero " + hero);
      d2mmPortrait(frame, owned && d2mmKnown(played) ? played : null);
    }
    if (d2mmKnown(played)) {
      var bar = D2MM_ROLE === "bar" ? me : null;
      if (bar && d2mmHeroOf(d2mmKeep("bar hero", function () { return bar.FindChildTraverse("HeroImage"); })).replace(/^npc_dota_hero_/, "") === own) d2mmTier(bar, played);
    }
    var inspect = D2MM_ROLE === "inspect" ? me : null;
    var card = inspect && inspect.FindChildTraverse("HeroBadge");
    if (card) {
      var shown = inspect.FindChildTraverse("HeroName");
      var mineShown = own && shown && shown.text.toLowerCase() === $.Localize("#npc_dota_hero_" + own).toLowerCase();
      d2mmBadge(card, mineShown ? played : null);
    }
  } catch (e) { d2mmSay("match failed", e); }
  try {
    if (D2MM_ROLE === "page") {
      var page = d2mmPageHero(me);
      var chosen = d2mmKnown(page);
      // the page's own badge and the one on its progress tab
      var bigs = [me.FindChildTraverse("HeroBadge"), me.FindChildTraverse("HeroBadgeProgression")].filter(Boolean);
      for (var b = 0; b < bigs.length; b++) d2mmBadge(bigs[b], page);
      // the experience to the next level is the real level's, so it goes while a level is chosen
      var xp = d2mmLook("page experience", function () { return d2mmClassed(me, "CurrentLevelXPLabel").concat(d2mmClassed(me, "NextLevelXPLabel"), d2mmFind(me, function (p) { return p.id === "HeroLevelProgress"; })); });
      for (var x = 0; x < xp.length; x++) xp[x].visible = !chosen;
      var named = d2mmLook("page name", function () { return d2mmClassed(me, "TabContentsHeroName"); });
      d2mmSay("hero page " + (named.length ? named[0].text : ""), "level " + page + ", " + bigs.length + " badges, " + xp.length + " experience panels");
    }
  } catch (e) { d2mmSay("hero page failed", e); }
  $.Schedule(0, d2mmApply);
}
d2mmApply();
`;
}
