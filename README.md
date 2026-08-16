# three-koules

Koules, ported from SDL to [three.js](https://threejs.org/) with `WebGPURenderer`.

The original is Jan Hubicka's 1995 action game for Linux — bounce the koules out
of your sector before they bounce you out of yours. This is a port of the SDL
build (Lubomir Rintel's `lr-sdl` branch), not the Atari ST one, with the
simulation reproduced faithfully and the rendering rebuilt in three.js.

```bash
npm install
npm run dev
```

Needs a browser with WebGPU: current Chrome, Edge or Safari.

## What was kept

The whole game. Every object type, all one hundred sectors, both game plans,
five local players, the upgrade economy, the star wars scroller, the eleven
sector briefings and both endings.

The simulation is a line-by-line port and still ticks at the original's fixed
25 Hz. That includes the arithmetic: where the C truncated to `int` — spring
force, hole gravity, spawn budgets — the TypeScript calls `Math.trunc` in the
same places, because the game's feel depends on it. A few of the original's
oddities are reproduced deliberately and flagged in comments, most notably the
lunatic steering that `!rand () % 4` made effectively dead code.

| Original | Port |
| --- | --- |
| `koules.c` | [src/game/Game.ts](src/game/Game.ts) — physics, collisions, object lifecycle |
| `gameplan.c` | [src/game/GamePlan.ts](src/game/GamePlan.ts) — sectors, waves, scoring |
| `koules.h` | [src/core/Constants.ts](src/core/Constants.ts) |
| `cmap.c` | [src/core/Palette.ts](src/core/Palette.ts) — the 256 entry VGA palette |
| `framebuffer.c` | [src/materials/BodyMaterials.ts](src/materials/BodyMaterials.ts), [src/objects/Playfield.ts](src/objects/Playfield.ts) |
| `intro.c` | [src/objects/Crawl.ts](src/objects/Crawl.ts), [src/objects/IntroSequence.ts](src/objects/IntroSequence.ts) |
| `font.c` | [src/misc/StrokeFont.ts](src/misc/StrokeFont.ts) — the scroller's vector font |
| `xlib/font8x8.c` | [src/core/Font8x8.ts](src/core/Font8x8.ts) — the 8x8 interface font |
| `text.h` | [src/misc/TextData.ts](src/misc/TextData.ts) |
| `menu.c` | [src/ui/Menu.ts](src/ui/Menu.ts) |
| `rcfiles.c` | [src/core/Settings.ts](src/core/Settings.ts) — localStorage |
| `sound.c`, `koules.sndsrv.*` | [src/audio/SoundManager.ts](src/audio/SoundManager.ts) — Web Audio |
| `sdl/init.c`, `sdl/input.c` | [src/Koules.ts](src/Koules.ts), [src/controls/InputManager.ts](src/controls/InputManager.ts) |
| `joystick.h` | [`@mesmotronic/xpad`](https://www.npmjs.com/package/@mesmotronic/xpad) |

The seven sound effects are the original recordings: headerless 8 kHz 8-bit PCM
from `sounds/*.raw`, rewrapped as WAV in [public/sounds/](public/sounds/).

## What changed, and why

**The sector is a square.** The original played on a 640×460 screen. Here the
playfield is 640×640, inset and centred so it fits any viewport. Every gameplay
formula still uses the real dimensions, so the integer budgets that depend on
them stay honest.

**Objects are lit primitives.** `framebuffer.c` built each sprite once at
startup by walking a 32 step palette ramp outward from a highlight placed up and
to the left of centre. That highlight is now a directional light, and each
object's material samples its ramp for a base colour — mid-ramp for the normal
shading, higher up for the flatter `draw_reversed_ball_bitmap` look that thieves,
finders and lunatics used. Palette entries are decoded as sRGB rather than
treated as linear, which is what keeps the background the deep midnight blue it
was on a CRT.

**Particles are instanced sprites.** WebGPU rasterises point primitives at
exactly one pixel, so `THREE.Points` is not an option. The 4000 point pool is a
single `THREE.Sprite` driven by a `PointsNodeMaterial` reading instanced
attributes — one draw call for every spark on screen.

**Bloom is selective**, via a `bloomIntensity` channel on the scene's MRT.
Materials opt in; the backdrop and sector floor stay sharp. Toggleable in the
menu, along with the camera drift.

**The renderer interpolates.** The simulation is locked to 25 Hz as it always
was, and frames in between interpolate object positions, rotations and particles
so it stays smooth on a 120 Hz display.

**Both original fonts are the original fonts.** Koules used two, and neither is
substituted here.

Interface text — menus, the status line, the sector banner, the help captions,
the letter stamped on a pickup — is the 8x8 CP437 bitmap font. The SDL build
drew it with SDL_gfx's built-in `gfxPrimitivesFontdata`; Koules ships its own
copy of the same font for the X11 backend in `xlib/font8x8.c`, so the port
carries those 2048 bytes rather than taking a dependency. Strings are rendered
to canvases at a whole number of pixels per font pixel, which is why the type
steps between sizes as the window changes instead of scaling smoothly.

The scroller is not a bitmap font at all. `vgadrawtext()` built every glyph from
line segments and quarter arcs so it could be projected vertex by vertex, and
that is reproduced too: each stroke is expanded into a screen-space quad and
carries the original's distance-stepped thickness, which `gl_wide_line` produced
by plotting one, two or three pixels per step depending how far down the screen
it had got. The pay-off is the trapezoid — a line near the viewer is a third
wider at its baseline than at its cap, which no amount of scaling a texture
reproduces.

**Interface colours come from the game's palette**, published to CSS at startup
from the same table the objects use. White text with a black shadow one pixel
down and right, the menu's moving selection rectangle in `ball(2)` over a darker
`ball(20)`, and spinner arrows rasterised from the five line segments
`draw_menu()` ruled for each one.

**Joystick calibration is gone; pads go through
[`@mesmotronic/xpad`](https://github.com/mesmotronic/js-simple-xpad).** The
original read raw ADC counts and made you calibrate the centre and extents from
a menu before it could steer at all. Xpad hands over dead-zoned, normalised
axes, and folds the left stick, right stick and D-pad into a single `anyStick`
reading — which suits Koules, whose steering is one direction vector and whose
joystick support was digital anyway, so a player can use whichever input falls
to hand. Both original modes survive: accelerate on the button, or accelerate by
stick deflection. A pad unplugged mid-game falls back to that player's keyboard
bindings instead of leaving them inert, and the `CONTROL` screen says
`NOT CONNECTED` for a slot whose pad has gone.

**Four points of view.** The original only ever looked straight down, because
it was drawing into a framebuffer. Since this one has a real camera, it can
move: `TOP` is the original view, `ANGLED` tips the sector back about its x axis
so the near edge splays open, and `CHASE` and `PILOT` follow the ship from
behind and from inside it. Pick one from the switch opposite the scores, with
`1`–`4`, or step through with `V`. The camera flies between them, interpolating
position and orientation as a quaternion — the top-down and following views
disagree about which axis is up, and slerp is the only thing that crosses that
cleanly.

The two following views turn with the ship, so they also turn the controls:
pressing up means "away from the camera" rather than "towards the top of the
sector". That is the single concession the modes need — the simulation itself
never learns about any of it, and the two fixed views leave the input exactly
as the original had it. Following a ship only makes sense with one of them, so
`CHASE` and `PILOT` are offered in solo games until there is something sensible
to do about a split screen.

**Particles have depth.** They did not before: every point sat at z = 0, which
is invisible looking straight down and looks like wet paper from anywhere else.
Explosions now burst as spheres and spawn clouds collapse as shells, with the
in-plane velocities left exactly as they were, so the top-down view is
unchanged. Sparks are sized by distance with a ceiling on how large one may be
drawn, or a thrust plume emitted at the camera would fill the cockpit view.

**Touch play is new.** Where the finger lands becomes the centre of a virtual
stick and displacement from it steers, until the touch ends. That needs no
special case in the simulation: it feeds the same path as Ludvik Tesar's 1997
"accelerate by deflection" joystick mode. Solo games only — with two players
sharing a screen there is no telling whose thumb is whose.

**The sector is sized to the viewport**, not framed by a fixed margin. The
layout works out what the status line needs and gives the sector everything
else, so on a phone it fills about 97% of the width; on a tall screen it rides
above centre to leave the space below clear for a thumb.

**Networking is not ported.** `server.c`, `client.c` and `sock.c` implemented
1996-era UDP multiplayer for up to five machines. Local multiplayer for five
players is fully intact.

**One original bug is fixed.** In sector 100 `gameplan.c` assigned `object[i].x`
twice and never set `y`, stacking every player on one row. The ring the
arithmetic was plainly reaching for is used instead.

**`QUIT` returns to the title.** A browser tab cannot close itself.

## Controls

| | |
| --- | --- |
| Player 1 | arrow keys |
| Player 2 | `W` `A` `S` `D` |
| Players 3–5 | `IJKL`, numpad, `TFGH` — all rebindable |
| Pause | `P` |
| Help labels | `H` |
| Menu | `Esc` |
| Touch | Anywhere — that point becomes the stick's centre |
| View | `1`–`4`, or `V` to cycle |

Per player, `CONTROL` cycles eight-way keyboard, rotation keyboard, mouse and
gamepad. Progress, bindings and options persist in localStorage.

## Licence

GPL-2.0-or-later; the full text is in [COPYING](COPYING).

Koules is © 1995–1996 Jan Hubicka. This port is © 2026 Mesmotronic Limited and
carries the same licence, as a derivative work must. Every source file has an
SPDX header naming its copyright holders: files ported from the C name their
upstream authors alongside Mesmotronic, because the GPL requires those notices
to stay intact, and because the work deserves the credit. Beyond Hubicka that
means Lubomir Rintel for the SDL backend, Ludvik Tesar for the joystick
handling, Sujal M. Patel for the sound code, and Kamil Toman and Thomas Marsh
for the scripts.
