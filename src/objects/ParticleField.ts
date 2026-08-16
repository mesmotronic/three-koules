// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	AdditiveBlending,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	PointsNodeMaterial,
	Sprite
} from 'three/webgpu';
import { float, instancedBufferAttribute, positionView, shapeCircle, uniform, viewportSize } from 'three/tsl';

import { GAME_HEIGHT, GAME_WIDTH, MAX_POINT } from '../core/Constants.js';
import type { ParticleSystem } from '../game/ParticleSystem.js';
import { setBloom } from '../materials/BodyMaterials.js';

/** Apparent particle diameter, in playfield units. */
const PARTICLE_SIZE = 2.2;

/**
 * Largest a spark may be drawn, in logical pixels.
 *
 * Perspective sizing is what makes the point pool read as a volume from an
 * angle, but a thrust plume emitted at the camera in the cockpit view would
 * otherwise fill the screen with dinner plates. The cap costs nothing at any
 * normal distance and only bites when a spark is nearly touching the lens.
 */
const MAX_PIXELS = 26;

/**
 * The point pool, drawn as instanced sprites.
 *
 * WebGPU only rasterises point primitives one pixel wide, so `THREE.Points` is
 * not an option for anything that needs to be seen. The supported route — and
 * the one `webgpu_instance_points` demonstrates — is a single `Sprite` driven
 * by a `PointsNodeMaterial` reading instanced attributes, which is one draw
 * call for all four thousand sparks.
 */
export class ParticleField extends Sprite {

	private readonly positions: InstancedBufferAttribute;
	private readonly colors: InstancedBufferAttribute;
	private readonly sizes: InstancedBufferAttribute;

	/** Playfield units to logical pixels, refreshed on resize. */
	private readonly pixelScale: ReturnType<typeof uniform>;

	constructor() {

		const positions = new InstancedBufferAttribute( new Float32Array( MAX_POINT * 3 ), 3 );
		const colors = new InstancedBufferAttribute( new Float32Array( MAX_POINT * 3 ), 3 );
		const sizes = new InstancedBufferAttribute( new Float32Array( MAX_POINT ), 1 );

		positions.setUsage( DynamicDrawUsage );
		colors.setUsage( DynamicDrawUsage );
		sizes.setUsage( DynamicDrawUsage );

		// Half the vertical field of view, as a tangent. Perspective sizing is
		// done here rather than by `sizeAttenuation`, whose built-in formula
		// leaves the field of view out and offers nowhere to clamp.
		const pixelScale = uniform( 1 );

		const distance = positionView.z.negate().max( 1 );
		const apparent = float( PARTICLE_SIZE )
			.mul( viewportSize.y.mul( 0.5 ) )
			.div( distance )
			.mul( pixelScale )
			.clamp( 1, MAX_PIXELS );

		const material = new PointsNodeMaterial( {
			positionNode: instancedBufferAttribute<'vec3'>( positions, 'vec3' ),
			colorNode: instancedBufferAttribute<'vec3'>( colors, 'vec3' ),
			// The per-point size is 0 or 1, so this both scales and hides.
			sizeNode: instancedBufferAttribute<'float'>( sizes, 'float' ).mul( apparent ),
			opacityNode: shapeCircle(),
			vertexColors: true,
			sizeAttenuation: false,
			transparent: true,
			blending: AdditiveBlending,
			depthWrite: false
		} );

		setBloom( material, 1.0 );

		super( material );

		this.positions = positions;
		this.colors = colors;
		this.sizes = sizes;
		this.pixelScale = pixelScale;

		this.count = MAX_POINT;
		this.frustumCulled = false;
		this.renderOrder = 2;

	}

	/**
	 * Keeps a spark the same apparent size whatever the camera is doing.
	 *
	 * @param fov - Vertical field of view, in degrees.
	 */
	setFov( fov: number ): void {

		this.pixelScale.value = 1 / Math.tan( ( fov * Math.PI ) / 360 );

	}

	/** Pulls the simulation's points into the instance buffers. */
	update( particles: ParticleSystem, alpha: number ): void {

		const positions = this.positions.array as Float32Array;
		const colors = this.colors.array as Float32Array;
		const sizes = this.sizes.array as Float32Array;

		particles.writeInstances( alpha, positions, colors, sizes );

		// Playfield space has y pointing down and the origin in a corner; z is
		// already in world terms and passes straight through.
		for ( let i = 0; i < MAX_POINT; i ++ ) {

			const i3 = i * 3;
			positions[ i3 + 0 ] -= GAME_WIDTH / 2;
			positions[ i3 + 1 ] = GAME_HEIGHT / 2 - positions[ i3 + 1 ];

		}

		this.positions.needsUpdate = true;
		this.colors.needsUpdate = true;
		this.sizes.needsUpdate = true;

	}

}
