# Pitfalls

Every trap below cost at least one round trip through the game. Find the symptom, check the cause
before trying a fix.

## Effects and colours

| What you see | Cause | Fix |
|---|---|---|
| Recoloured effects come out purple and orange | One recolour pass with a fixed `from` turns every hue by the same angle; Necrophos' greens run from yellow-green to teal | Two passes: to the target hue at full saturation, then from that hue at half saturation ([recolor.md](recolor.md)) |
| Red turns pink | The pass kept the source's low saturation | The second pass with `from` doubles saturation |
| One part stays the old colour | The colour is in a texture or a colour warp, not in the particle | Recolour the texture under Valve's name; swap a shared warp for an existing one in your colour |
| Every hero's effect changed colour | You shipped a recompiled shared texture or warp | Never pack a texture the game has unless you changed it on purpose (`modkit pack` leaves them out) |
| A red glow turns orange or yellow on grass | Additive red over green ground adds up to yellow | Lower the glow's overbright, drop the green from its colours, remove wide additive layers |
| The screen fills with red fog | A MOD2X effect multiplies the ground by twice its colour; pure red zeroes green and blue | Let some green and blue through (a soft red, as Valve's originals are tinted) and shrink the effect |
| Black squares around an effect | You switched an additive effect to alpha blending; its texture has no alpha | Keep additive, change colours instead |
| A square on the ground under a projected effect | A texture compiled from PNG through your own vmat lost its alpha | Rebuild Valve's texture under its own name from a `.vtex` with DXT5 and all four channels ([recolor.md](recolor.md)) |
| Aghanim's blue sparks on a red hero | Valve's shared Scepter effect, the same on every hero | Leave it: changing it changes every hero |

## Models and materials

| What you see | Cause | Fix |
|---|---|---|
| A part sits 180 degrees off or slides at the neck | FBX exported with bone axes X then Y | Export with primary Y, secondary X (`scripts/export_fbx.py`): Valve's bone frames come through exactly |
| "could not be made content-relative" when compiling | An image left inside the FBX's material | Strip material nodes and images; the vmdl maps the bare material name to a vmat |
| A part drawn black or metallic | `F_MASKS_1` on with a mask missing | Give every mask a texture, black for the ones you do not paint |
| Dotted line of another colour across a hidden part | The cut in the translucency map missed texels where two UV islands lie close and their margins cancelled out | Cut the part's own triangles always, plus a margin into empty space only (`scripts/uv_cut.py`) |
| Lips or ears stick out through a mask | Vertices pinned to the body's position; the push-in left them out | Pin only the seam at the neck; push everything else inside the mask |
| You see through the hood when the head goes back | The game draws no back faces and the body's head is hidden | Fill the inside: a copy of Valve's head under the mask, joined to the hood ([custom-models.md](custom-models.md)) |
| A cloak crumples when the arms move | Weights copied from the body gave arm bones thousands of cloak vertices | Upper arm weight to clavicle and spine, forearm and hand to the spine; only sleeves follow the arms |
| A belt wraps around the hands | The belt was fitted to hip vertices with the arms' hands among them (bind pose) | Fit without the arm vertices |
| An edited mesh tears when moved along normals | Decimated geometry | Rebuild the mesh, do not push vertices of a decimated one |
| Item effects hang in the air | They are bound to attachment points of the item's own model, which your model lacks | Leave them out, or hang them on a particle the hero always has ([items-from-game.md](items-from-game.md)) |

## Animations

| What you see | Cause | Fix |
|---|---|---|
| The hero stands in the bind pose | The game rejected the animation blocks: KV3 types 26/27 copied wrong, or a bad compile | Rebuild with `modkit clips` from a fresh compile; run the doctor |
| Online the wrong animations play from some ability on | Sequence numbers differ from Valve's model (a clip added, or a clip renamed by the decompile) | `modkit clips` restores Valve's list; the doctor reports it |
| An item's clip plays at random without the item | The decompile dropped activity modifiers | `scripts/prepare_vmdl.py` puts them back from `modkit model` |
| Fingers of one hand twitch with the weapon | Bones compiled in another order | `move_last` the bone `modkit clips` names, compile again |
| The head turns backwards while running | The turns layer: missing `m_bMulti`, poses compiled whole, or the compiler's extra `turns` clip | `modkit clips` copies Valve's fetch, flags and poses, and stills the extra clip |
| A part on a `beard_`/`cape_` bone ignores your clip | Cloth simulation bones; the game does not read their tracks | Use a free bone outside the cloth (Necrophos: `scarf_0_L`, `scarf_0_R`) |
| A held weapon sits turned round | Its model's own rest pose for the shared bone differs from the hero's | Compute the grip from the weapon's armature |
| The spawn motion is not visible | The respawn flash covers its first 0.4 s | Keep the hero still or hidden for those frames |
| A gesture does not show in the bench | The camera is high and behind | Render it from the front; use `--idle-seconds` for the inspect view |

## Sounds

| What you hear | Cause | Fix |
|---|---|---|
| Every sound of the hero is gone, Valve's too | The events file was written back as binary; the game dropped it in silence | Compile events from KV3 text (`modkit sounds`) |
| Your sound plays with an immortal's on top | The copied event kept Valve's `soundevent_layer2` | Remove layers from copies (`modkit sounds` does) |
| A menu sound never plays | The hero page loads only the voice file | Put menu events in `game_sounds_vo_<hero>` (`modkit sounds --vo`) |
| Valve's voice line talks over your entrance | The entrance clip has its own `AE_CL_SPEECH` | Replace it with your events (`"sounds"` in `prepare_vmdl.py`) |

## Process

| What happened | Cause | Rule |
|---|---|---|
| Old pictures shown as new | A render script wrote to a relative path outside the project | Give scripts absolute output paths |
| The user still saw an old version | They had an earlier build installed | After a rebuild, tell them to import the new VPK in the app |
| A fix for one thing broke another | Several fixes tried in a row on a guess | One cause at a time, each in a test build |
| A "broken" effect was normal | Never compared with the unmodded hero | Run the bench without `--vpk` first |
| A confident report turned out wrong | The bench's attack verdict on a dark model | Look at the frames; the verdict is a hint |
