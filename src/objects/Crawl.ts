// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	DynamicDrawUsage,
	Mesh,
	MeshBasicNodeMaterial
} from 'three/webgpu';

import { paletteColor } from '../core/Palette.js';
import { setBloom } from '../materials/BodyMaterials.js';
import { layout } from '../misc/StrokeFont.js';

/** `TEXTW` — spacing between lines in text space. */
const TEXT_W = 200;

/** `i` advanced by one per frame at the crawl's 65 Hz cap. */
const SCROLL_RATE = 65;

/** The crawl's focal length, straight out of `font.c`. */
const FOCAL = 220;

/** Text space depth of the camera. Lines beyond this are behind the viewer. */
const EYE = 1000;

/**
 * The crawl's virtual screen, which is the original's 640x460 map.
 *
 * It matters that this stays 460 tall rather than adopting the square
 * playfield: the projection's constants were tuned against it, and a line
 * enters at a screen y of around 505 — off the bottom of a 460 tall screen,
 * but well inside a 640 tall one, where it would pop into view.
 */
const SCREEN_W = 640;
const SCREEN_H = 460;

/** Depth over which a line fades up as it enters at the near cull plane. */
const NEAR_FADE = 130;

/** Triangles per stroke, and floats per triangle vertex. */
const VERTS_PER_SEGMENT = 6;

const _color = new Color();

/**
 * The perspective scroller from `intro.c` and `font.c`.
 *
 * Every glyph vertex is projected on its own through `x * 220 / (1000 - y)`,
 * with the vertical converging on a vanishing point a third of the way down
 * the screen — a genuine 1/z crawl, hand rolled in 1995. Because the glyphs
 * are strokes rather than bitmaps, a line near the viewer leans away properly:
 * its baseline is a third wider than its cap height, which is the detail that
 * makes the effect read.
 *
 * Strokes are expanded into screen-space quads so they can carry the original's
 * distance-stepped thickness, which `gl_wide_line` produced by plotting one,
 * two or three pixels per step depending how far down the screen it had got.
 */
export class Crawl extends Mesh {

	private lines: readonly string[] = [];

	/** `i` — how far the crawl has advanced, in text space units. */
	private offset = 0;

	/** Highest line index currently visible; `actu` in the original. */
	actu = - 1;

	private running = false;

	/** Set once a line has appeared, so the first keypress cannot skip blind. */
	private skippable = false;

	/** Virtual screen to world units, from the current viewport. */
	private screenScale = 1;

	private positions: Float32Array;
	private colors: Float32Array;
	private capacity = 0;

	constructor() {

		const geometry = new BufferGeometry();
		const material = new MeshBasicNodeMaterial( {
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			depthTest: false,
			// A stroke's quad winds whichever way the stroke runs, so half of
			// them would be culled if only front faces were drawn.
			side: DoubleSide
		} );

		setBloom( material, 0.3 );

		super( geometry, material );

		this.positions = new Float32Array( 0 );
		this.colors = new Float32Array( 0 );

		this.visible = false;
		this.frustumCulled = false;
		this.renderOrder = 5;

		this.grow( 2048 );

	}

	get isRunning(): boolean {

		return this.running;

	}

	/** True once the player is allowed to skip. */
	get canSkip(): boolean {

		return this.skippable;

	}

	/**
	 * Fits the virtual screen to the viewport.
	 *
	 * The crawl covers the whole window rather than the inset sector, because
	 * that is what it did in 1995 and because a line has to enter from beyond
	 * the bottom edge. Whichever axis is tighter wins, so a portrait window
	 * scales the text down instead of running it off the sides.
	 */
	setViewport( halfWidth: number, halfHeight: number ): void {

		this.screenScale = Math.min( halfHeight / ( SCREEN_H / 2 ), halfWidth / ( SCREEN_W / 2 ) );

	}

	/**
	 * Begins a crawl. `intro.c` started every one of them at `i = -660`.
	 *
	 * @param skipImmediately - `starwars()` let any keypress out of the opening
	 * crawl straight away, while `outro()` waited for a line to appear first so
	 * that a key still held from the previous screen could not skip it blind.
	 */
	start( lines: readonly string[], skipImmediately = false ): void {

		this.lines = lines;
		this.offset = - 660;
		this.actu = - 1;
		this.running = true;
		this.skippable = skipImmediately;
		this.visible = true;

	}

	/** Ends the crawl early, as any keypress did. */
	stop(): void {

		this.running = false;
		this.visible = false;
		this.geometry.setDrawRange( 0, 0 );

	}

	/** Reallocates the vertex buffers to hold at least `segments` strokes. */
	private grow( segments: number ): void {

		this.capacity = segments;

		this.positions = new Float32Array( segments * VERTS_PER_SEGMENT * 3 );
		this.colors = new Float32Array( segments * VERTS_PER_SEGMENT * 3 );

		const position = new BufferAttribute( this.positions, 3 );
		const color = new BufferAttribute( this.colors, 3 );

		position.setUsage( DynamicDrawUsage );
		color.setUsage( DynamicDrawUsage );

		this.geometry.setAttribute( 'position', position );
		this.geometry.setAttribute( 'color', color );

	}

	/**
	 * Advances and rebuilds the crawl.
	 *
	 * @returns True while the crawl is still running.
	 */
	update( delta: number ): boolean {

		if ( ! this.running ) return false;

		this.offset += delta * SCROLL_RATE;

		// The original ran until the last line had passed the viewer.
		if ( this.offset >= ( this.lines.length + 10 ) * TEXT_W ) {

			this.stop();
			return false;

		}

		// `build` writes only as far as the buffers allow and reports what the
		// frame actually needed, so an overflow costs one extra pass and then
		// never recurs.
		let segments = this.build();

		if ( segments > this.capacity ) {

			this.grow( Math.ceil( segments * 1.3 ) );
			segments = this.build();

		}

		this.geometry.setDrawRange( 0, Math.min( segments, this.capacity ) * VERTS_PER_SEGMENT );
		this.geometry.getAttribute( 'position' ).needsUpdate = true;
		this.geometry.getAttribute( 'color' ).needsUpdate = true;

		return true;

	}

	/**
	 * Walks the visible lines, projecting every stroke.
	 *
	 * @returns How many strokes the frame needed, which may exceed capacity.
	 */
	private build(): number {

		const { positions, colors, screenScale } = this;
		let count = 0;

		for ( let y = 0; y < this.lines.length; y ++ ) {

			const depth = y * TEXT_W - this.offset;

			// `intro.c`'s visibility window.
			if ( ! ( depth + 2 * TEXT_W < EYE && depth + TEXT_W > - 1500 ) ) continue;

			// Palette entries 0..31 run black to yellow; a line fades up as it
			// approaches and is simply not drawn until it clears black.
			const shade = Math.trunc( ( ( 1200 + depth ) * 32 ) / 2500 );
			if ( shade <= 0 ) continue;

			this.actu = y;
			this.skippable = true;

			const text = this.lines[ y ];
			if ( text.length === 0 ) continue;

			const { segments, width } = layout( text );

			// A line is culled the moment it passes the near plane. On a wide
			// screen it is already off the bottom edge by then, but a narrow
			// one still has it in shot, so ease it in over the last stretch.
			const nearFade = Math.min( 1, ( EYE - 2 * TEXT_W - depth ) / NEAR_FADE );

			paletteColor( Math.min( 31, shade ), _color );
			const r = _color.r * nearFade;
			const g = _color.g * nearFade;
			const b = _color.b * nearFade;

			// `sizes[]` in `intro.c`: each line is centred on its own width.
			const originX = - width / 2;

			for ( let s = 0; s < segments.length; s += 4 ) {

				if ( count < this.capacity ) {

					const d1 = EYE - ( depth + segments[ s + 1 ] );
					const d2 = EYE - ( depth + segments[ s + 3 ] );

					const sy1 = SCREEN_H / 3 + ( SCREEN_W * FOCAL ) / d1;
					const sy2 = SCREEN_H / 3 + ( SCREEN_W * FOCAL ) / d2;

					const x1 = ( ( originX + segments[ s + 0 ] ) * FOCAL / d1 ) * screenScale;
					const x2 = ( ( originX + segments[ s + 2 ] ) * FOCAL / d2 ) * screenScale;
					const y1 = ( SCREEN_H / 2 - sy1 ) * screenScale;
					const y2 = ( SCREEN_H / 2 - sy2 ) * screenScale;

					// `gl_wide_line` plotted a second and third pixel as a
					// stroke got further down the screen, so nearer text is
					// visibly heavier. Measured at the stroke's midpoint.
					const mid = ( sy1 + sy2 ) / 2;
					let weight = 1;
					if ( mid > ( 3 * SCREEN_H ) / 5 ) weight = 2;
					if ( mid > ( 3 * SCREEN_H ) / 4 ) weight = 3;

					this.emit( count, x1, y1, x2, y2, ( weight * screenScale ) / 2, r, g, b, positions, colors );

				}

				count ++;

			}

		}

		return count;

	}

	/** Expands one stroke into a screen-space quad. */
	private emit(
		index: number,
		x1: number, y1: number, x2: number, y2: number,
		half: number,
		r: number, g: number, b: number,
		positions: Float32Array, colors: Float32Array
	): void {

		let dx = x2 - x1;
		let dy = y2 - y1;
		const length = Math.hypot( dx, dy );

		if ( length < 1e-6 ) {

			// A lone plotted point, as `SSetPixel` drew for i, j and full stops.
			dx = 1;
			dy = 0;

		} else {

			dx /= length;
			dy /= length;

		}

		// Extend the ends by the half width so joins between strokes close up.
		const ex = dx * half;
		const ey = dy * half;
		const nx = - dy * half;
		const ny = dx * half;

		const ax = x1 - ex + nx, ay = y1 - ey + ny;
		const bx = x2 + ex + nx, by = y2 + ey + ny;
		const cx = x2 + ex - nx, cy = y2 + ey - ny;
		const dxx = x1 - ex - nx, dyy = y1 - ey - ny;

		const o = index * VERTS_PER_SEGMENT * 3;

		positions[ o + 0 ] = ax; positions[ o + 1 ] = ay; positions[ o + 2 ] = 0;
		positions[ o + 3 ] = bx; positions[ o + 4 ] = by; positions[ o + 5 ] = 0;
		positions[ o + 6 ] = cx; positions[ o + 7 ] = cy; positions[ o + 8 ] = 0;
		positions[ o + 9 ] = ax; positions[ o + 10 ] = ay; positions[ o + 11 ] = 0;
		positions[ o + 12 ] = cx; positions[ o + 13 ] = cy; positions[ o + 14 ] = 0;
		positions[ o + 15 ] = dxx; positions[ o + 16 ] = dyy; positions[ o + 17 ] = 0;

		for ( let v = 0; v < VERTS_PER_SEGMENT; v ++ ) {

			colors[ o + v * 3 + 0 ] = r;
			colors[ o + v * 3 + 1 ] = g;
			colors[ o + v * 3 + 2 ] = b;

		}

	}

}
