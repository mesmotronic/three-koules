// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Constants ported from `koules.h`, `gameplan.c` and `sdl/init.c`.
 *
 * The original ran a 640x460 playfield at DIV = 1. This port keeps the same
 * unit scale but squares the field off (see {@link GAME_WIDTH}) so it can be
 * inset responsively into any viewport. Every gameplay formula below is
 * reproduced verbatim, including the integer truncation the C relied on.
 */

// -------------------------------------------------------------- playfield

/** Original `GAMEWIDTH`. */
export const GAME_WIDTH = 640;
/** Original `GAMEHEIGHT` was 460; squared off for the inset presentation. */
export const GAME_HEIGHT = 640;

/** `koules.c` drove the simulation from a 1000000/25 usec timer. */
export const TICK_RATE = 25;
export const TICK_MS = 1000 / TICK_RATE;

// ----------------------------------------------------------- object types

export const enum ObjectType {
	NONE = 0,
	ROCKET = 1,
	BALL = 2,
	LBALL = 3,
	CREATOR = 4,
	HOLE = 5,
	BBALL = 6,
	APPLE = 7,
	INSPECTOR = 8,
	EHOLE = 9,
	LUNATIC = 10
}

// --------------------------------------------------------------- geometry

export const BALL_RADIUS = 8;
export const BBALL_RADIUS = 16;
export const APPLE_RADIUS = 32;
export const INSPECTOR_RADIUS = 14;
export const HOLE_RADIUS = 12;
export const ROCKET_RADIUS = 14;

/** `EYE_RADIUS` at DIV = 1. */
export const EYE_RADIUS = 5;
/** Distance of each eye from the rocket centre. */
export const EYE_RADIUS1 = 10;
/** `LUNATIC_RADIUS` aliased `EYE_RADIUS` in the original. */
export const LUNATIC_RADIUS = EYE_RADIUS;

export const SPRING_SIZE = 4 * BBALL_RADIUS;
export const SPRING_STRENGTH = BBALL_RADIUS / 2;

/**
 * Playfield space to world space.
 *
 * The simulation keeps the original's screen coordinates: origin in a corner,
 * y pointing down. The scene is centred on the origin with y pointing up, so
 * everything that draws crosses this boundary and should cross it here.
 */
export const toWorldX = ( x: number ): number => x - GAME_WIDTH / 2;
export const toWorldY = ( y: number ): number => GAME_HEIGHT / 2 - y;

/** `radius()` from `koules.c`. */
export function radiusOf( type: ObjectType ): number {

	switch ( type ) {

		case ObjectType.EHOLE:
		case ObjectType.HOLE: return HOLE_RADIUS;
		case ObjectType.ROCKET: return ROCKET_RADIUS;
		case ObjectType.BALL:
		case ObjectType.LBALL: return BALL_RADIUS;
		case ObjectType.BBALL: return BBALL_RADIUS;
		case ObjectType.APPLE: return APPLE_RADIUS;
		case ObjectType.INSPECTOR: return INSPECTOR_RADIUS;
		case ObjectType.LUNATIC: return LUNATIC_RADIUS;
		default: return 0;

	}

}

// ------------------------------------------------------------------ rules

export const MAX_OBJECT = 255;
export const MAX_POINT = 4000;
export const MAX_ROCKETS = 5;

/** Acceleration granted by a green "A" koule. */
export const A_ADD = 0.13;
/** Mass granted by a blue "M" koule. */
export const M_ADD = 0.8;

export const enum Letter {
	NONE = ' ',
	ACCEL = 'A',
	GUMM = 'M',
	THIEF = 'T',
	FINDER = 'G',
	TTOOL = 'S'
}

/** Return values of `create_letter()`. */
export const enum LetterRoll {
	NONE = 0,
	ACCEL = 1,
	GUMM = 2,
	THIEF = 3,
	FINDER = 4,
	TTOOL = 5
}

export const enum GamePlanMode {
	DEATHMATCH = 0,
	COOPERATIVE = 1
}

/** In-game points of view. Only {@link ViewMode.TOP} is square to the screen. */
export const enum ViewMode {
	/** Straight down the axis, as the original always was. */
	TOP = 0,
	/** Tipped back about x, so the near edge of the sector splays open. */
	ANGLED = 1,
	/** Behind and above the ship, turning with it. */
	CHASE = 2,
	/** From the ship itself. */
	COCKPIT = 3
}

export const VIEW_LABELS: Readonly<Record<ViewMode, string>> = {
	// Named for what it is rather than where it is: this is the one the game
	// was played in for thirty years, and the others are the novelty.
	[ ViewMode.TOP ]: 'CLASSIC',
	[ ViewMode.ANGLED ]: 'ANGLED',
	[ ViewMode.CHASE ]: 'CHASE',
	[ ViewMode.COCKPIT ]: 'PILOT'
};

export const enum GameMode {
	MENU = 1,
	KEYS = 2,
	GAME = 3,
	JOY = 4,
	WAIT = 5,
	PREGAME = 6
}

export const enum ControlType {
	REMOTE = 0,
	KEYBOARD = 1,
	RKEYBOARD = 2,
	JOYSTICK1 = 3,
	JOYSTICK2 = 4,
	MOUSE = 5
}

export const enum Sample {
	START = 0,
	END = 1,
	COLIZE = 2,
	DESTROY_BALL = 3,
	DESTROY_ROCKET = 4,
	CREATOR1 = 5,
	CREATOR2 = 6
}

// -------------------------------------------------- level introduction gates

export const HOLE_LEVEL = 5;
export const EHOLE_LEVEL = 20;
export const SPRING_LEVEL = 30;
export const THIEF_LEVEL = 40;
export const FINDER_LEVEL = 50;
export const TTOOL_LEVEL = 60;
export const INSPECTOR_LEVEL = 70;
export const LUNATIC_LEVEL = 80;
export const BBBALL_LEVEL = 90;

/** `BBALLLEVEL` depended on the player count. */
export function bballLevel( nrockets: number ): number {

	return nrockets === 1 ? 12 : 10;

}

/** The Dark Applepolisher waits on the last sector. */
export const FINAL_LEVEL = 99;

// ------------------------------------------------------------- difficulty

export interface Difficulty {
	readonly name: string;
	readonly rocketSpeed: number;
	readonly ballSpeed: number;
	readonly bballSpeed: number;
	readonly slowdown: number;
	readonly gumm: number;
	readonly ballM: number;
	readonly lballM: number;
	readonly bballM: number;
	readonly appleM: number;
	readonly rocketM: number;
}

/** `init_objects()` difficulty table; index 0 is the hardest. */
export const DIFFICULTIES: readonly Difficulty[] = [
	{ name: 'NIGHTMARE', rocketSpeed: 0.8, ballSpeed: 1.2, bballSpeed: 1.2, slowdown: 0.9, gumm: 20, ballM: 3, lballM: 3, bballM: 8, appleM: 40, rocketM: 2 },
	{ name: 'HARD', rocketSpeed: 1.0, ballSpeed: 1.2, bballSpeed: 1.2, slowdown: 0.9, gumm: 20, ballM: 3, lballM: 3, bballM: 8, appleM: 40, rocketM: 4 },
	{ name: 'MEDIUM', rocketSpeed: 1.2, ballSpeed: 1.2, bballSpeed: 1.2, slowdown: 0.8, gumm: 20, ballM: 3, lballM: 3, bballM: 8, appleM: 34, rocketM: 4 },
	{ name: 'EASY', rocketSpeed: 2.0, ballSpeed: 1.2, bballSpeed: 1.2, slowdown: 0.8, gumm: 20, ballM: 3, lballM: 3, bballM: 8, appleM: 24, rocketM: 5 },
	{ name: 'VERY EASY', rocketSpeed: 2.0, ballSpeed: 1.2, bballSpeed: 1.2, slowdown: 0.8, gumm: 15, ballM: 3, lballM: 3, bballM: 8, appleM: 24, rocketM: 7 }
];

/** Masses that never varied with difficulty. */
export const INSPECTOR_M = 2;
export const LUNATIC_M = 3.14;

// ----------------------------------------------------------------- colours

/** `rocketcolor[]` — palette bases for players one through five. */
export const ROCKET_COLOR: readonly number[] = [ 96, 160, 64, 96, 128 ];

export const RAD = ( deg: number ): number => ( deg / 180 ) * Math.PI;

/** One keypress of yaw for a rotation-keyboard player. */
export const ROT_STEP = RAD( 10 );
