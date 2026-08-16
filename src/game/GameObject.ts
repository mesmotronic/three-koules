// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 1997 Ludvik Tesar
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { Letter, ObjectType } from '../core/Constants.js';

/**
 * The `Object` struct from `koules.h`.
 *
 * Everything in Koules — players, koules, black holes, the boss — is one of
 * these, distinguished only by {@link type}. Positions are in playfield units
 * with y pointing down, matching the original's screen space.
 */
export class GameObject {

	/** Current {@link ObjectType}. `CREATOR` while materialising. */
	type = ObjectType.NONE;

	/** Set while a rocket holds a stolen thief toolkit. */
	thief = 0;

	/** What a `CREATOR` will become once its timer expires. */
	ctype = ObjectType.NONE;

	/** Lives remaining; 0 removes the object from play. */
	live = 0;

	/**
	 * Doubles as a spawn timer and an invulnerability window.
	 *
	 * A rocket ignores gravity and refuses to be pushed while this is set,
	 * which is what makes respawns survivable.
	 */
	time = 0;

	score = 0;

	/** Index of the object this one is tethered to by a spit, or -1. */
	lineto = - 1;

	x = 0;
	y = 0;

	/** Velocity. Named for the force accumulator it started life as. */
	fx = 0;
	fy = 0;

	/** Facing, in radians. 0 points down the screen, as in the original. */
	rotation = 0;

	/** Backup of {@link live} across a respawn; the HUD reads this. */
	live1 = 0;

	/** Mass. Collisions trade momentum through the ratio of two masses. */
	M = 0;

	radius = 0;

	/** Thrust magnitude, grown by collecting acceleration koules. */
	accel = 0;

	/** Which pickup this koule carries, if any. */
	letter: Letter = Letter.NONE;

	// Gamepad calibration, from Ludvik Tesar's "accelerate by deflection".
	joymulx = 0;
	joymuly = 0;
	joythresh = 0;

	// -------------------------------------------------------- interpolation

	/**
	 * Position at the previous simulation tick.
	 *
	 * The simulation is locked to 25 Hz exactly as the original was, so the
	 * renderer interpolates between the last two ticks to stay smooth on a
	 * high refresh display.
	 */
	px = 0;
	py = 0;
	prot = 0;

	/** True when the renderer should snap rather than interpolate. */
	teleported = true;

	/** Records the current pose as the interpolation origin for next tick. */
	snapshot(): void {

		this.px = this.x;
		this.py = this.y;
		this.prot = this.rotation;

	}

	/** Moves the object without letting the renderer smear it across the map. */
	teleport( x: number, y: number ): void {

		this.x = this.px = x;
		this.y = this.py = y;
		this.teleported = true;

	}

}
