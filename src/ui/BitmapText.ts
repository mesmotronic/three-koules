// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { GLYPH_SIZE, glyphRows } from '../core/Font8x8.js';

/**
 * Draws interface text with the game's own 8x8 font.
 *
 * `stringColor()` blitted glyphs straight into the framebuffer at one device
 * pixel per font pixel. Reproducing that in the DOM means two things: the
 * colour has to be baked into the bitmap, because a mask would be resampled
 * and go soft; and the drawn size has to stay an integer multiple of eight
 * pixels, or the glyphs pick up uneven column widths. So the type steps
 * between whole scales as the viewport changes rather than scaling smoothly,
 * which is exactly how it behaved on a fixed-resolution display.
 */

/** Cache key is text, colour and scale, so a redraw is only ever a lookup. */
const _cache = new Map<string, string>();

/** Elements to refresh when the scale changes. */
const _bound = new Set<HTMLElement>();

/** Current integer pixels per font pixel. */
let _scale = 2;

/** Extra letter spacing, in font pixels. The original packed glyphs solid. */
const TRACKING = 0;

/** Used when an element is painted before it joins the document. */
const DEFAULT_COLOR = '#ffffff';

/**
 * Renders a run of text to a data URL.
 *
 * @param text - The string; characters outside CP437's low range draw a space.
 * @param color - Any CSS colour.
 * @param scale - Device pixels per font pixel.
 */
function render( text: string, color: string, scale: number ): string {

	const key = `${ scale }|${ color }|${ text }`;
	const cached = _cache.get( key );
	if ( cached !== undefined ) return cached;

	const advance = GLYPH_SIZE + TRACKING;
	const canvas = document.createElement( 'canvas' );

	canvas.width = Math.max( 1, text.length * advance * scale );
	canvas.height = GLYPH_SIZE * scale;

	const ctx = canvas.getContext( '2d' );
	if ( ctx === null ) return '';

	ctx.fillStyle = color;

	for ( let i = 0; i < text.length; i ++ ) {

		const rows = glyphRows( text.charCodeAt( i ) );
		const originX = i * advance * scale;

		for ( let y = 0; y < GLYPH_SIZE; y ++ ) {

			const bits = rows[ y ];
			if ( bits === 0 ) continue;

			// Coalesce each run of set bits into one rectangle rather than
			// filling pixel by pixel.
			let x = 0;

			while ( x < GLYPH_SIZE ) {

				if ( ( bits >> ( 7 - x ) & 1 ) === 0 ) { x ++; continue; }

				let run = 1;
				while ( x + run < GLYPH_SIZE && ( bits >> ( 7 - ( x + run ) ) & 1 ) === 1 ) run ++;

				ctx.fillRect( originX + x * scale, y * scale, run * scale, scale );
				x += run;

			}

		}

	}

	const url = canvas.toDataURL();

	// The cache is unbounded by design: the interface draws from a small, fixed
	// set of strings, and scores settle quickly once a game is under way.
	_cache.set( key, url );

	return url;

}

/**
 * Paints an element's text with the bitmap font.
 *
 * The element keeps its string as `data-text` so it can be redrawn at a new
 * scale, and as an accessible name so the text is still announced.
 */
export function setBitmapText( element: HTMLElement, text: string, color?: string ): void {

	// Text and scale are checked first: reading a computed style forces the
	// browser to resolve the style tree, and this is called for every score,
	// life pip and help caption on every frame, almost always to do nothing.
	const scale = String( _scale );

	if ( element.dataset.text === text && element.dataset.scale === scale && color === undefined ) {

		return;

	}

	// A detached element has no computed style to read, and the colour is baked
	// into the bitmap, so painting one early gives black on black.
	const resolved = color ?? ( element.isConnected ? getComputedStyle( element ).color : DEFAULT_COLOR );

	if ( element.dataset.text === text && element.dataset.color === resolved && element.dataset.scale === scale ) {

		return;

	}

	element.dataset.text = text;
	element.dataset.color = resolved;
	element.dataset.scale = scale;

	element.classList.add( 'bmp' );
	element.setAttribute( 'aria-label', text );
	element.textContent = '';

	if ( text.length === 0 ) {

		element.style.backgroundImage = '';
		element.style.width = '0';
		element.style.height = '0';
		return;

	}

	element.style.backgroundImage = `url(${ render( text, resolved, _scale ) })`;
	element.style.width = `${ text.length * ( GLYPH_SIZE + TRACKING ) * _scale }px`;
	element.style.height = `${ GLYPH_SIZE * _scale }px`;

	_bound.add( element );

}

/**
 * Redraws an element in whatever colour CSS now gives it.
 *
 * The colour is baked into the bitmap, so a class change that would recolour
 * ordinary text does nothing on its own — and {@link setBitmapText} returns
 * early when the string and scale are unchanged, so it will not notice either.
 * Calling this after a class change lets a widget keep its colours in the
 * stylesheet instead of naming palette tokens in script.
 */
export function repaintBitmapText( element: HTMLElement ): void {

	const text = element.dataset.text;
	if ( text === undefined ) return;

	delete element.dataset.color;
	setBitmapText( element, text, getComputedStyle( element ).color );

}

/**
 * The spinner arrows from `draw_menu()`, as five drawn lines each.
 *
 * These were never glyphs — the original ruled them with `Line()` on a seven
 * by seven grid, which is why they have that slightly lopsided, hand-plotted
 * look. Rasterising the same endpoints keeps it.
 */
const ARROWS: Readonly<Record<'left' | 'right', readonly number[][]>> = {
	left: [
		[ 0, 3, 6, 3 ],
		[ 3, 0, 0, 3 ],
		[ 4, 0, 1, 3 ],
		[ 3, 6, 0, 3 ],
		[ 4, 6, 1, 3 ]
	],
	// The original offset these by two, so they are shifted back to the origin.
	right: [
		[ 0, 3, 6, 3 ],
		[ 3, 0, 6, 3 ],
		[ 2, 0, 5, 3 ],
		[ 3, 6, 6, 3 ],
		[ 2, 6, 5, 3 ]
	]
};

/** Side of the arrow grid, in font pixels. */
export const ARROW_SIZE = 7;

/** Plots a line into a boolean grid, as the framebuffer routines did. */
function plotLine( grid: boolean[], x1: number, y1: number, x2: number, y2: number ): void {

	const dx = Math.abs( x2 - x1 );
	const dy = Math.abs( y2 - y1 );
	const sx = x1 < x2 ? 1 : - 1;
	const sy = y1 < y2 ? 1 : - 1;
	let error = dx - dy;
	let x = x1;
	let y = y1;

	for ( ; ; ) {

		if ( x >= 0 && x < ARROW_SIZE && y >= 0 && y < ARROW_SIZE ) grid[ y * ARROW_SIZE + x ] = true;
		if ( x === x2 && y === y2 ) break;

		const e2 = 2 * error;
		if ( e2 > - dy ) { error -= dy; x += sx; }
		if ( e2 < dx ) { error += dx; y += sy; }

	}

}

/** Paints an element as one of the spinner arrows. */
export function setBitmapArrow( element: HTMLElement, direction: 'left' | 'right', color: string ): void {

	const key = `arrow|${ direction }|${ color }|${ _scale }`;
	let url = _cache.get( key );

	if ( url === undefined ) {

		const grid: boolean[] = new Array( ARROW_SIZE * ARROW_SIZE ).fill( false );
		for ( const [ x1, y1, x2, y2 ] of ARROWS[ direction ] ) plotLine( grid, x1, y1, x2, y2 );

		const canvas = document.createElement( 'canvas' );
		canvas.width = canvas.height = ARROW_SIZE * _scale;

		const ctx = canvas.getContext( '2d' );
		if ( ctx === null ) return;

		ctx.fillStyle = color;

		for ( let y = 0; y < ARROW_SIZE; y ++ ) {

			for ( let x = 0; x < ARROW_SIZE; x ++ ) {

				if ( grid[ y * ARROW_SIZE + x ] ) ctx.fillRect( x * _scale, y * _scale, _scale, _scale );

			}

		}

		url = canvas.toDataURL();
		_cache.set( key, url );

	}

	element.classList.add( 'bmp' );
	element.style.backgroundImage = `url(${ url })`;
	element.style.width = `${ ARROW_SIZE * _scale }px`;
	element.style.height = `${ ARROW_SIZE * _scale }px`;

}

/**
 * Paints every element that carries its string in a `data-bmp` attribute.
 *
 * The menu's fixed title lines live in the markup rather than in script, so
 * they are picked up here once the palette has been published.
 */
export function paintStaticText( root: ParentNode = document ): void {

	for ( const element of root.querySelectorAll<HTMLElement>( '[data-bmp]' ) ) {

		setBitmapText( element, element.dataset.bmp ?? '' );

	}

}

/** Forgets an element, so a removed node is not redrawn or retained. */
export function releaseBitmapText( element: HTMLElement ): void {

	_bound.delete( element );

}

/** One line of text at the current scale, in CSS pixels. */
export function bitmapLineHeight(): number {

	return GLYPH_SIZE * _scale;

}

/**
 * Picks a whole-pixel scale for the viewport and redraws anything bound.
 *
 * @param playfieldSize - Side of the projected sector square, in CSS pixels.
 * @returns True if the scale changed and callers should re-lay out.
 */
export function updateBitmapScale( playfieldSize: number ): boolean {

	// The original's 8px type filled about one part in sixty of a 460 line
	// screen. Holding that ratio and rounding to whole pixels keeps the
	// interface in proportion without ever landing on a fractional scale.
	const wanted = Math.max( 1, Math.min( 4, Math.round( playfieldSize / 470 ) ) );

	if ( wanted === _scale ) return false;

	_scale = wanted;

	// Row spacing follows the type, as `YPOSITION` did at ten pixels a row.
	document.documentElement.style.setProperty( '--bmp-scale', String( _scale ) );

	for ( const element of _bound ) {

		const text = element.dataset.text;
		const color = element.dataset.color;

		if ( text === undefined ) continue;

		// Force a redraw at the new scale.
		delete element.dataset.scale;
		setBitmapText( element, text, color );

	}

	return true;

}
