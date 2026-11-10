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
| Your new effect never shows; `console.log` says "invalid particle definition" | It uses `C_INIT_CreateWithinSphere`, which compiles but the game no longer takes | `C_INIT_CreateWithinSphereTransform` with a transform input; copy operators from a recent Valve file ([recolor.md](recolor.md)) |
| Particles stay round the hero after a cast | A continuous emitter in a child of a long-lived effect | An instantaneous burst with short lives |
| An ability no longer reads as itself | Swapped-in models at the old size and number cover the hero and the effect | Fewer and smaller, and keep the plain effect's signature part (its dark cloud) as a child |
| A model swapped into an effect wears the old one's skin | `m_hOverrideMaterial` on the renderer | Remove it |

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
| A vmat that names the game's compiled textures (`.vtex`) fails: "Error calling CompileImmediately" | The compiler wants the source image of every texture, and the game has only compiled ones | Decompile the textures to PNG into your addon, or use a different material; cube maps do not come back as one source |
| A compiled material copied from an item and recoloured by its parameters stays the old colour | `TextureColor` and the like only seed a texture when a source vmat compiles; in a compiled one the colour is already in the texture | Recolour the textures, or build your own material |
| Glass or water on a blade draws flat white in the game | `hero_fluid.vfx` is mostly refraction of bright cube maps; tint and colour barely reach it | Your own `hero.vfx` material: deep colour in the texture, glowing cracks through the self-illum mask, a tight highlight and a cold rim |
| A part that reads in a front render is a blob of colour in the game | The game's camera looks down from high behind: a bag on the back is a ball of one colour, fur trims are stripes | Render at the game's angle (about 60 degrees down) before you call a look done; give the top and the back something that reads (a bright accent, a dark band across a large area of one colour) |
| Hard dark strokes across a cloth | Faces in the folds given a darker material: the material edges follow the mesh, not the light | Fold with the shape alone; a darker material only where a whole region is in shadow (underneath) |
| Item effects hang in the air | They are bound to attachment points of the item's own model, which your model lacks | Leave them out, or hang them on a particle the hero always has ([items-from-game.md](items-from-game.md)) |

## Animations

| What you see | Cause | Fix |
|---|---|---|
| The hero stands in the bind pose | The game rejected the animation blocks: KV3 types 26/27 copied wrong, or a bad compile | Rebuild with `modkit clips` from a fresh compile; run the doctor |
| Online the wrong animations play from some ability on | Sequence numbers differ from Valve's model (a clip added, or a clip renamed by the decompile) | `modkit clips` restores Valve's list; the doctor reports it |
| Online in a lobby the hero idles or runs hunched at full health; demo mode looks right | The mod took the activity off a plain sequence (`idle_anim`) so an item's would win; the server picks by Valve's model, the client finds no idle under that number | Keep Valve's activities, make the plain sequence play the item's clips ([items-from-game.md](items-from-game.md)), a fix checked in a lobby; the doctor reports it |
| Every few idles the hero stands up in the bind pose for a second, the weapon on the ground | One idle adds a layer through a weight list that gives every bone weight 0; the decompile loses the list and the layer runs at full weight | `modkit clips` puts Valve's weight lists back ("weight list(s) as Valve's") |
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
