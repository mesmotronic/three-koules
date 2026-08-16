// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { Color, SRGBColorSpace } from 'three/webgpu';

/**
 * The 256 entry VGA palette from `cmap.c`, reproduced exactly.
 *
 * Koules encoded every object's shading as a 32 step ramp inside this palette:
 * `framebuffer.c` picked a base index per object type and added 0..31 based on
 * distance from a fixed highlight. The port keeps the palette because it still
 * drives the particle colours (which are raw palette indices) and because the
 * ramp bases are the most faithful source for the 3D material colours.
 *
 *   0.. 31  black to yellow, used by the star wars scroller
 *  32.. 63  background ramp
 *  64.. 95  red koules
 *  96..127  yellow rockets
 * 128..159  green rockets
 * 160..191  blue rockets
 * 192..255  greyscale, used for stars, thieves and finders
 */

/** `back(x)` — background ramp base. */
export const back = ( x: number ): number => 32 + x;
/** `ball(x)` — red koule ramp base. */
export const ball = ( x: number ): number => 64 + x;
/** `rocket(x)` — yellow thrust ramp base. */
export const rocket = ( x: number ): number => 96 + x;

/** `col()` — scale a 6 bit VGA component and clamp. */
function col( p: number, scale: number ): number {

	p *= scale;

	if ( p > 63 ) return 63;
	if ( p < 0 ) return 0;

	return Math.trunc( p );

}

/**
 * Builds the palette as linear float RGB triplets.
 *
 * @param offset - `setcustompalette()`'s brightness offset, used by fades.
 * @param scale - `setcustompalette()`'s multiplier, used by fades.
 */
export function createPalette( offset = 0, scale = 1 ): Float32Array {

	const pal = new Float32Array( 256 * 3 );
	const set = ( i: number, r: number, g: number, b: number ): void => {

		pal[ i * 3 + 0 ] = col( r, scale ) / 63;
		pal[ i * 3 + 1 ] = col( g, scale ) / 63;
		pal[ i * 3 + 2 ] = col( b, scale ) / 63;

	};

	// 32..63 — background. The original computed 0..63 here but immediately
	// overwrote the low half with the scroller ramp further down.
	for ( let i = 32; i < 64; i ++ ) {

		set( i, offset, offset, ( i & 31 ) * 2 + offset );

	}

	// 64..95 — red koules, hot pink at the highlight fading to black.
	for ( let i = 64; i < 96; i ++ ) {

		const r = ( 32 - ( i - 63 ) ) * 2;
		const gb = i < 72 ? Math.trunc( ( ( 8 - ( i - 63 ) ) * 32 ) / 5 ) : 0;
		set( i, r + offset, gb + offset, gb + offset );

	}

	// 96..127 — yellow.
	for ( let i = 96; i < 128; i ++ ) {

		const rg = ( 32 - ( i - 95 ) ) * 2;
		const b = i < 104 ? ( 8 - ( i - 95 ) ) * 8 : 0;
		set( i, rg + offset, rg + offset, b + offset );

	}

	// 128..159 — green.
	for ( let i = 128; i < 160; i ++ ) {

		const g = ( 32 - ( i - 127 ) ) * 2;
		const rb = i < 136 ? ( 8 - ( i - 127 ) ) * 8 : 0;
		set( i, rb + offset, g + offset, rb + offset );

	}

	// 160..191 — blue.
	for ( let i = 160; i < 192; i ++ ) {

		const b = ( 32 - ( i - 159 ) ) * 2;
		const rg = i < 168 ? Math.trunc( ( ( 8 - ( i - 159 ) ) * 8 ) / 2 ) : 0;
		set( i, rg + offset, rg + offset, b + offset );

	}

	// 0..31 — scroller ramp, black through to yellow.
	for ( let i = 0; i < 32; i ++ ) {

		set( i, i * 2 + offset, i * 2 + offset, offset );

	}

	// 192..223 — greyscale. 224..255 were never written by the original and
	// stayed black apart from the white sentinel at 255.
	for ( let i = 0; i < 32; i ++ ) {

		set( 192 + i, i * 2 + offset, i * 2 + offset, i * 2 + offset );

	}

	set( 0, 0, 0, 0 );
	set( 255, 64 + offset, 64 + offset, 64 + offset );

	return pal;

}

/** The unfaded palette, shared by everything that needs a colour lookup. */
export const PALETTE = createPalette();

const _color = new Color();

/**
 * Looks up a palette entry as a {@link Color}.
 *
 * A VGA DAC value is what the monitor displayed, not a linear intensity, so
 * the entry is decoded from sRGB into the renderer's working space. Skipping
 * this is what makes a naive palette port look washed out: the background ramp
 * tops out at 29% blue, which reads as a deep midnight on a CRT but as bright
 * cobalt if fed straight to a linear pipeline.
 */
export function paletteColor( index: number, target = _color ): Color {

	const i = ( index & 0xff ) * 3;
	return target.setRGB( PALETTE[ i ], PALETTE[ i + 1 ], PALETTE[ i + 2 ], SRGBColorSpace );

}

/**
 * A palette entry as a CSS colour.
 *
 * These are the values the DAC drove the monitor with, so they go to CSS
 * unconverted — the browser will treat them as sRGB, which is what they are.
 */
export function paletteHex( index: number ): string {

	const i = ( index & 0xff ) * 3;
	const byte = ( v: number ): string => Math.round( v * 255 ).toString( 16 ).padStart( 2, '0' );

	return `#${ byte( PALETTE[ i ] ) }${ byte( PALETTE[ i + 1 ] ) }${ byte( PALETTE[ i + 2 ] ) }`;

}

/**
 * The palette again, decoded to linear RGB.
 *
 * Anything writing colours straight into a vertex buffer — the particle pool,
 * the starfield — reads from here rather than doing the conversion per point
 * every frame.
 */
export const PALETTE_LINEAR = ( (): Float32Array => {

	const out = new Float32Array( 256 * 3 );
	const color = new Color();

	for ( let i = 0; i < 256; i ++ ) {

		paletteColor( i, color );
		out[ i * 3 + 0 ] = color.r;
		out[ i * 3 + 1 ] = color.g;
		out[ i * 3 + 2 ] = color.b;

	}

	return out;

} )();
