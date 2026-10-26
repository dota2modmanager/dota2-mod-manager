# Sounds

A hero's sounds are sound events: named entries in a compiled `.vsndevts_c` file, each with a type,
volume, pitch and the `.vsnd` files it plays. Abilities, attacks and clips ask for events by name.
You change what an event plays, layer your sound on top of it, or add an event a clip of yours
asks for. You cannot make the game ask for an event it does not know.

## Which file

| Sound | File |
|---|---|
| Abilities, attack, death, in a match | `soundevents/game_sounds_heroes/game_sounds_<hero>.vsndevts_c` |
| Voice lines, and everything on the hero page and in the hero picker | `soundevents/voscripts/game_sounds_vo_<hero>.vsndevts_c` |
| Items that change a sound | `soundevents/game_sounds_items.vsndevts_c` and the item's own files |

The hero picker and the hero page load only the voice file. The Scream set's telephone ring sat in
the hero's main file and never played in the menu; moved to the voice file, it did.

```
npm run modkit -- sounds <hero>                         every event: type and files
npm run modkit -- sounds <hero> --vo                    the voice file
npm run modkit -- sounds <hero> --show Hero_Necrolyte.DeathPulse
```

An event of type `dota_null_start` plays nothing (Necrophos' `Hero_Necrolyte.Death`). To give it
a sound, copy a real event with `--like`.

## Make the sound

- WAV, 16-bit PCM, 44100 Hz, mono for anything heard in the world (stereo only for interface
  sounds). `modkit sounds` refuses other formats.
- Peak around -1 dB (0.89), a short fade at the end against a click.
- Loudness against Valve's: a ring at the same peak as a scream sounded louder to the user. Lower
  the quieter-meant sound's peak (the Scream ring went to 0.40) and squeeze a scream that gets
  lost with a soft limiter (`np.tanh(x * 2.5) / np.tanh(2.5)`).
- Sources: your own recordings, synthesis (the Scream set made its death rattle and knife sounds
  from numpy: formant-filtered sawtooth, band-passed noise, a convolution reverb), or files with a
  licence that allows it. Film quotes and commercial sound effects are not yours to share; say so
  in the credits ([sharing.md](sharing.md)).
- Decode an MP3 with Blender's `aud` module or ffmpeg into a WAV first.

## Change the events

```
npm run modkit -- sounds necrolyte --addon my_mod --out work/mod \
  --layer Hero_Necrolyte.DeathPulse=work/scream.wav@0.9 \
  --replace Hero_Necrolyte.Death=work/death.wav --like Hero_Necrolyte.DeathPulse

npm run modkit -- sounds necrolyte --vo --addon my_mod --out work/mod \
  --add Hero_Necrolyte.Scream.ring=work/ring.wav --like necrolyte_necr_spawn_01
```

- `--layer` keeps Valve's sound and plays yours with it: a new event `<event>.mod_<file>` and
  `soundevent_layer2` on the original (Valve's immortals layer the same way).
- `--replace` makes the event play only yours.
- `--add` makes a new event for an `AE_CL_PLAYSOUND` on one of your clips
  ([animations.md](animations.md)). Copy a voice line (`dota_update_vo_switch`) for the menu.
- `@0.9` sets the volume of your part.

The command writes the whole events file as KV3 text into the addon and compiles it with Valve's
resourcecompiler, with your WAVs next to it. The compiler measures each sound's length and lists
the files the events use. Run both commands into the same `--out`; then `modkit pack`.

## Traps

- **Never write an events file back as binary.** The Scream set's first version rewrote
  `game_sounds_necrolyte.vsndevts_c` with a KV3 writer. The game dropped the whole file in silence:
  every Necrophos sound was gone, Valve's included, and the console said nothing. Compiled from
  text, all 19 events played.
- **A copied event drags its layers along.** Copy Valve's event and its `soundevent_layer2` comes
  with it: your sound then also plays the immortal's layer. `modkit sounds` removes the copy's
  layers and its `vsnd_duration`.
- **An events file has no RERL block**, unlike most resources: tools that rewrite references fail
  on it.
- **One attack sound for two attacks.** The attack event plays on both attack clips; you cannot
  give one of them a different sound through the event.

## Check that it plays

Ears first: ask the user. Without them, record the speakers' output (WASAPI loopback, e.g. the
Python package `soundcard`) while the event plays and find your sound in the recording by cross
correlation. Correlation misses sounds with `pitch_rand` or 3D placement; for those, start the
hero demo with `sv_cheats 1`, play the event from the console with `snd_sos_start_soundevent
<event>` and measure the recording's level. Check the menu the same way against a pack without
your changes.
