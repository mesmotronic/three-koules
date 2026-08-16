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
 * left them there. Here they get depth as well, so the camera's drift gives a
 * little parallax against the sector.
 */
export class Starfield extends Sprite {

	private readonly opacityScale: ReturnType<typeof uniform>;

	/**
	 * @param count - Number of stars.
	 * @param spread - Half-width of the volume they fill, in playfield units.
	 * @param depth - How far behind the playfield the volume sits.
	 */
	constructor( count = 1400, spread = 1800, depth = 900 ) {

		const positions = new InstancedBufferAttribute( new Float32Array( count * 3 ), 3 );
		const colors = new InstancedBufferAttribute( new Float32Array( count * 3 ), 3 );
		const sizes = new InstancedBufferAttribute( new Float32Array( count ), 1 );

		for ( let i = 0; i < count; i ++ ) {

			const i3 = i * 3;

			positions.array[ i3 + 0 ] = randMod( spread * 2 ) - spread;
			positions.array[ i3 + 1 ] = randMod( spread * 2 ) - spread;
			positions.array[ i3 + 2 ] = - depth - randMod( depth );

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

		setBloom( material, 0.35 );

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
