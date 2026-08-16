import {
	AdditiveBlending,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	PointsNodeMaterial,
	Sprite
} from 'three/webgpu';
import { instancedBufferAttribute, shapeCircle, uniform } from 'three/tsl';

import { GAME_HEIGHT, GAME_WIDTH, MAX_POINT } from '../core/Constants.js';
import type { ParticleSystem } from '../game/ParticleSystem.js';
import { setBloom } from '../materials/BodyMaterials.js';

/** Apparent particle diameter, in playfield units. */
const PARTICLE_SIZE = 2.2;

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

		const pixelScale = uniform( 1 );

		const material = new PointsNodeMaterial( {
			positionNode: instancedBufferAttribute<'vec3'>( positions, 'vec3' ),
			colorNode: instancedBufferAttribute<'vec3'>( colors, 'vec3' ),
			// The per-point size is 0 or 1, so this both scales and hides.
			sizeNode: instancedBufferAttribute<'float'>( sizes, 'float' ).mul( pixelScale ),
			opacityNode: shapeCircle(),
			vertexColors: true,
			// Sizes are handed over in pixels, computed from the projected
			// playfield, which keeps sparks crisp at any viewport size.
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

	/** @param pixelsPerUnit - Logical pixels covered by one playfield unit. */
	setPixelsPerUnit( pixelsPerUnit: number ): void {

		this.pixelScale.value = Math.max( 1, PARTICLE_SIZE * pixelsPerUnit );

	}

	/** Pulls the simulation's points into the instance buffers. */
	update( particles: ParticleSystem, alpha: number ): void {

		const positions = this.positions.array as Float32Array;
		const colors = this.colors.array as Float32Array;
		const sizes = this.sizes.array as Float32Array;

		particles.writeInstances( alpha, positions, colors, sizes );

		// Playfield space has y pointing down and the origin in a corner.
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
