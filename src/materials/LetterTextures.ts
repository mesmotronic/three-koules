// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { CanvasTexture, NearestFilter, SRGBColorSpace, type Texture } from 'three/webgpu';

import { Letter } from '../core/Constants.js';
import { GLYPH_SIZE, glyphRows } from '../core/Font8x8.js';

/**
 * The single character `koules.c` stamped over a lettered koule.
 *
 * `DrawBlackMaskedText` masked one 8x8 glyph into the framebuffer over the
 * ball, so the same font supplies it here. Drawn several times its native size
 * and left unfiltered, it keeps the blocky edges rather than turning into a
 * smooth letterform that would not belong.
 */

/** Pixels per font pixel in the decal texture. */
const SCALE = 8;
const SIZE = GLYPH_SIZE * SCALE;
const _cache = new Map<string, Texture>();

export function letterTexture( letter: Letter ): Texture | null {

	if ( letter === Letter.NONE ) return null;

	const existing = _cache.get( letter );
	if ( existing !== undefined ) return existing;

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = SIZE;

	const ctx = canvas.getContext( '2d' );
	if ( ctx === null ) return null;

	ctx.clearRect( 0, 0, SIZE, SIZE );

	const rows = glyphRows( letter.charCodeAt( 0 ) );

	// The black pass first, offset by one font pixel, then white over it.
	for ( const [ offset, color ] of [ [ 1, 'rgba(0, 0, 0, 0.85)' ], [ 0, '#ffffff' ] ] as const ) {

		ctx.fillStyle = color;

		for ( let y = 0; y < GLYPH_SIZE; y ++ ) {

			for ( let x = 0; x < GLYPH_SIZE; x ++ ) {

				if ( ( rows[ y ] >> ( 7 - x ) & 1 ) === 0 ) continue;

				ctx.fillRect( ( x + offset ) * SCALE, ( y + offset ) * SCALE, SCALE, SCALE );

			}

		}

	}

	const texture = new CanvasTexture( canvas );
	texture.colorSpace = SRGBColorSpace;
	texture.minFilter = NearestFilter;
	texture.magFilter = NearestFilter;

	_cache.set( letter, texture );
	return texture;

}
