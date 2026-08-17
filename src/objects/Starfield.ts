// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	AdditiveBlending,
	InstancedBufferAttribute,
	PointsNodeMaterial,
	Sprite
} from 'three/webgpu';
import { instancedBufferAttribute, shapeCircle, uniform } from 'three/tsl';

import { PALETTE_LINEAR } from '../core/Palette.js';
import { randMod } from '../core/Random.js';
import { setBloom } from '../materials/BodyMaterials.js';

/**
 * `drawstarbackground()` — the greyscale specks behind the crawl.
 *
 * The original scattered 700 single pixels in palette entries 192..223 and
 * left them there. Behind a camera that never moved, a flat sheet of them
 * behind the sector was the same thing; it stops being the same thing the
 * moment the camera tips. From the angled view the sheet slides away below
 * the horizon, and from inside a ship there is nothing overhead but black.
 *
 * So they are scattered over a sphere around the sector instead, far enough
 * out to read as sky from anywhere inside it. The radius is jittered rather
 * than exact: a true shell turns with the camera and looks painted on, while
 * a little spread in depth gives back the parallax the flat field had.
 */
export class Starfield extends Sprite {

	private readonly opacityScale: ReturnType<typeof uniform>;

	/**
	 * @param count - Number of stars.
	 * @param radius - How far out the shell sits, in playfield units. Kept
	 * well inside the cameras' far plane, with room for the furthest of them
	 * to be looking at the far side of it.
	 */
	constructor( count = 1400, radius = 2400 ) {

		const positions = new InstancedBufferAttribute( new Float32Array( count * 3 ), 3 );
		const colors = new InstancedBufferAttribute( new Float32Array( count * 3 ), 3 );
		const sizes = new InstancedBufferAttribute( new Float32Array( count ), 1 );

		for ( let i = 0; i < count; i ++ ) {

			const i3 = i * 3;

			// An even scatter over a sphere. Height is picked uniformly rather
			// than as an angle, which is what stops them bunching at the poles
			// — and the poles here are straight up and straight down through
			// the sector, where bunching would be plain to see.
			const height = randMod( 20001 ) / 10000 - 1;
			const angle = randMod( 62832 ) / 10000;
			const ring = Math.sqrt( Math.max( 0, 1 - height * height ) );
			const distance = radius * ( 0.75 + randMod( 50 ) / 100 );

			positions.array[ i3 + 0 ] = Math.cos( angle ) * ring * distance;
			positions.array[ i3 + 1 ] = Math.sin( angle ) * ring * distance;
			positions.array[ i3 + 2 ] = height * distance;

			// Palette entries 192..223, the greyscale ramp.
			const entry = ( 192 + randMod( 32 ) ) * 3;
			colors.array[ i3 + 0 ] = PALETTE_LINEAR[ entry + 0 ];
			colors.array[ i3 + 1 ] = PALETTE_LINEAR[ entry + 1 ];
			colors.array[ i3 + 2 ] = PALETTE_LINEAR[ entry + 2 ];

			sizes.array[ i ] = 1 + randMod( 100 ) / 60;

		}

		const opacityScale = uniform( 1 );

		const material = new PointsNodeMaterial( {
			positionNode: instancedBufferAttribute<'vec3'>( positions, 'vec3' ),
			colorNode: instancedBufferAttribute<'vec3'>( colors, 'vec3' ).mul( opacityScale ),
			sizeNode: instancedBufferAttribute<'float'>( sizes, 'float' ),
			opacityNode: shapeCircle(),
			vertexColors: true,
			sizeAttenuation: false,
			transparent: true,
			blending: AdditiveBlending,
			depthWrite: false
		} );

		setBloom( material, 0.35, shapeCircle() );

		super( material );

		this.opacityScale = opacityScale;
		this.count = count;
		this.frustumCulled = false;
		this.renderOrder = - 1;

	}

	/** Dims the field so the sector reads in front of it during play. */
	setBrightness( value: number ): void {

		this.opacityScale.value = value;

	}

}
