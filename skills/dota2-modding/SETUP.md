# Setting up Dota 2 modding (instructions for an AI assistant)

A person asked you to set up Dota 2 modding from Dota 2 Mod Manager. Do these steps in order,
tell them what you did after each, and ask before installing anything on their computer.

Dota 2 runs on Windows, Linux and macOS, but Valve's compiler (the Workshop Tools) is Windows
only. On another system you can still do recolours and items from the game's files; say so if
they ask for custom models, sounds or animations.

## 1. Get the toolkit

You need Node.js 24 or newer (`node --version`) and git. If either is missing, ask before you
install it (https://nodejs.org, https://git-scm.com).

```
git clone --depth 1 https://github.com/dota2modmanager/dota2-mod-manager.git
cd dota2-mod-manager
```

Clone it where the person keeps projects; ask if you do not know. `npm ci` is **not** needed for
the modding commands: they run on Node's own modules. Run it only to build the app itself.

## 2. Install the skill

The skill is the folder `skills/dota2-modding` in that checkout.

- **Claude Code:** in the session, run
  `/plugin marketplace add dota2modmanager/dota2-mod-manager`, then
  `/plugin install dota2-modding@dota2modmanager`. Or copy the folder to
  `~/.claude/skills/dota2-modding` (all projects) or `.claude/skills/dota2-modding` (this one).
- **Another agent that reads Agent Skills (a folder with SKILL.md):** copy the folder into that
  agent's skills directory.
- **An agent without skills:** add this line to the AGENTS.md (or rules file) of the folder you
  work in: `For Dota 2 mods, read <checkout>/skills/dota2-modding/SKILL.md first and follow it.`

From now on, read `SKILL.md` at the start of any Dota 2 modding task.

## 3. Check the computer

```
npm run modkit -- check
```

It reports each tool as ok or MISSING with the fix. Go through the missing ones with the person:

| Tool | What for | How |
|---|---|---|
| Dota 2 | everything | Steam. If installed in an unusual place, pass `--game "<...>/dota 2 beta/game"` |
| Workshop Tools | compiling models, materials, textures, sounds, clips | the person does it: Steam > Dota 2 > Properties > DLC > tick "Dota 2 Workshop Tools" |
| Source2Viewer CLI (VRF) | decompiling the game's files | download from https://github.com/ValveResourceFormat/ValveResourceFormat/releases, unzip, put on PATH or set `VRF_CLI` |
| Blender 4.2+ | models, animations, renders | https://www.blender.org; for importing game models also the SourceIO add-on |
| Python 3.11+ with Pillow and numpy | textures, the helper scripts | https://www.python.org, then `python -m pip install pillow numpy` |

Only install what their mod needs. A recolour needs none of the last four.

## 4. Tell them it is ready

Say what works now and what is still missing, then offer examples of what they can ask for:

- "Make Necrophos' spells blood red."
- "Give me Terrorblade's arcana horns."
- "Make a Ghostface mask and a black hooded cloak for Necrophos."
- "Make Axe's idle animation flex his arms."
- "Replace Pudge's hook sound with my recording."

They install the finished mod by dragging the VPK into Dota 2 Mod Manager
(https://dota2modmanager.com).
