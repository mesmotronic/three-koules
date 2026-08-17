// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	AdditiveBlending,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	PointsNodeMaterial,
	Sprite
} from 'three/webgpu';
import {
	float,
	instancedBufferAttribute,
	positionView,
	screenDPR,
	shapeCircle,
	uniform,
	viewportSize
} from 'three/tsl';

import { MAX_POINT } from '../core/Constants.js';
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

		// `viewportSize` is in physical pixels but a point's size is read as
		// logical ones — three scales it by the device ratio itself — so the
		// ratio has to come back out here. Left in, a spark is as many times
		// too large as the display is dense, and most of them then flatten
		// against the ceiling below.
		const logicalHeight = viewportSize.y.mul( 0.5 ).div( screenDPR );

		const distance = positionView.z.negate().max( 1 );
		const apparent = float( PARTICLE_SIZE )
			.mul( logicalHeight )
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

		setBloom( material, 1.0, shapeCircle() );

		super( material );

		this.positions = positions;
		this.colors = colors;
		this.sizes = sizes;
		this.pixelScale = pixelScale;

		// Set per frame from the live prefix; nothing is alive to begin with.
		this.count = 0;
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

	/**
	 * Pulls the simulation's points into the instance buffers.
	 *
	 * The pool is a ring, so the live points are always a prefix of it up to
	 * the high-water mark. Drawing and uploading only that prefix is the
	 * difference between a hundred kilobytes a frame and almost nothing when
	 * the field is quiet.
	 */
	update( particles: ParticleSystem, alpha: number ): void {

		const live = particles.writeInstances(
			alpha,
			this.positions.array as Float32Array,
			this.colors.array as Float32Array,
			this.sizes.array as Float32Array
		);

		this.count = live;

		if ( live === 0 ) return;

		for ( const attribute of [ this.positions, this.colors, this.sizes ] ) {

			attribute.clearUpdateRanges();
			attribute.addUpdateRange( 0, live * attribute.itemSize );
			attribute.needsUpdate = true;

		}

	}

}
