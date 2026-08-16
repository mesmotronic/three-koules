// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { GAME_HEIGHT, GAME_WIDTH, MAX_POINT } from '../core/Constants.js';
import { PALETTE_LINEAR } from '../core/Palette.js';

/**
 * The `Point` ring buffer from `koules.c`.
 *
 * Every spark in Koules — thrust, explosions, the swirl that precedes a spawn
 * — is one of 4000 slots in a fixed pool. New points overwrite the oldest, so
 * a big explosion during heavy thrust genuinely does eat other effects, and
 * that budget is part of how the game looks.
 *
 * The original stored positions as 24.8 fixed point and shifted down to plot a
 * single pixel. Here they are plain playfield units; callers divide their
 * velocities by 256 to match.
 */
export class ParticleSystem {

	/** Playfield-space position, and the previous tick's for interpolation. */
	readonly x = new Float32Array( MAX_POINT );
	readonly y = new Float32Array( MAX_POINT );
	readonly px = new Float32Array( MAX_POINT );
	readonly py = new Float32Array( MAX_POINT );

	/**
	 * Height above the sector plane.
	 *
	 * The simulation is flat and stays flat — z never feeds back into
	 * gameplay, and the bounds check ignores it. It exists so that an
	 * explosion is a sphere rather than a disc, which costs nothing looking
	 * straight down and is the whole difference from any other angle.
	 */
	readonly z = new Float32Array( MAX_POINT );
	readonly pz = new Float32Array( MAX_POINT );

	/** Velocity in playfield units per tick. */
	readonly vx = new Float32Array( MAX_POINT );
	readonly vy = new Float32Array( MAX_POINT );
	readonly vz = new Float32Array( MAX_POINT );

	/** Ticks of life remaining; zero means the slot is free. */
	readonly time = new Int16Array( MAX_POINT );
	/** Life the point was born with, used to fade it out. */
	readonly life = new Int16Array( MAX_POINT );

	/** Palette index, 0..255. */
	readonly color = new Uint8Array( MAX_POINT );

	/** `npoint` — the ring cursor. */
	private cursor = 0;

	/**
	 * `addpoint()`. Velocities are in playfield units per tick.
	 *
	 * @param z - Starting height above the plane.
	 * @param vz - Vertical velocity; zero keeps the point in the plane.
	 */
	add( x: number, y: number, vx: number, vy: number, color: number, time: number, z = 0, vz = 0 ): void {

		const i = this.cursor;

		this.x[ i ] = this.px[ i ] = x;
		this.y[ i ] = this.py[ i ] = y;
		this.z[ i ] = this.pz[ i ] = z;
		this.vx[ i ] = vx;
		this.vy[ i ] = vy;
		this.vz[ i ] = vz;
		this.time[ i ] = time;
		this.life[ i ] = time;
		this.color[ i ] = color & 0xff;

		this.cursor = ( i + 1 ) % MAX_POINT;

	}

	/** `clearpoints()`. */
	clear(): void {

		this.time.fill( 0 );

	}

	/**
	 * `points()` — advance every live point by one tick.
	 *
	 * Points that leave the playfield die immediately, which is why explosions
	 * near a wall look clipped rather than bouncing.
	 */
	update(): void {

		const { x, y, z, px, py, pz, vx, vy, vz, time } = this;

		for ( let i = 0; i < MAX_POINT; i ++ ) {

			if ( time[ i ] <= 0 ) continue;

			time[ i ] --;

			px[ i ] = x[ i ];
			py[ i ] = y[ i ];
			pz[ i ] = z[ i ];

			// Height is damped rather than bounded: sparks settle back toward
			// the plane instead of drifting into the camera.
			z[ i ] = ( z[ i ] + vz[ i ] ) * 0.94;

			const nx = x[ i ] + vx[ i ];
			const ny = y[ i ] + vy[ i ];

			if ( nx > 0 && nx < GAME_WIDTH && ny > 0 && ny < GAME_HEIGHT ) {

				x[ i ] = nx;
				y[ i ] = ny;

			} else {

				time[ i ] = 0;

			}

		}

	}

	/**
	 * Writes interpolated points into instanced attribute buffers.
	 *
	 * @param alpha - Fraction through the current simulation tick.
	 * @param positions - vec3 per point, z left at zero.
	 * @param colors - vec3 per point, pre-multiplied by the fade.
	 * @param sizes - float per point; zero hides a dead slot.
	 * @returns The highest slot index in use, so the draw can be trimmed.
	 */
	writeInstances( alpha: number, positions: Float32Array, colors: Float32Array, sizes: Float32Array ): number {

		const { x, y, z, px, py, pz, time, life, color } = this;
		let count = 0;

		for ( let i = 0; i < MAX_POINT; i ++ ) {

			const t = time[ i ];

			if ( t <= 0 ) {

				sizes[ i ] = 0;
				continue;

			}

			const i3 = i * 3;

			positions[ i3 + 0 ] = px[ i ] + ( x[ i ] - px[ i ] ) * alpha;
			positions[ i3 + 1 ] = py[ i ] + ( y[ i ] - py[ i ] ) * alpha;
			positions[ i3 + 2 ] = pz[ i ] + ( z[ i ] - pz[ i ] ) * alpha;

			// Ease the last fifth of a point's life out rather than letting it
			// pop. The original simply stopped plotting the pixel.
			const remaining = ( t - alpha ) / Math.max( 1, life[ i ] );
			const fade = remaining > 0.2 ? 1 : Math.max( 0, remaining * 5 );

			const p = color[ i ] * 3;
			colors[ i3 + 0 ] = PALETTE_LINEAR[ p + 0 ] * fade;
			colors[ i3 + 1 ] = PALETTE_LINEAR[ p + 1 ] * fade;
			colors[ i3 + 2 ] = PALETTE_LINEAR[ p + 2 ] * fade;

			sizes[ i ] = 1;
			count = i + 1;

		}

		return count;

	}

}
