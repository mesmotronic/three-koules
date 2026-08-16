// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 1997 Ludvik Tesar
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { GamePlanMode, MAX_ROCKETS } from './Constants.js';

/**
 * `rcfiles.c` in localStorage.
 *
 * The original kept two dotfiles in `$HOME`: one for control bindings and one
 * for level progress. Both are folded into a single record here.
 */
export interface SettingsData {
	/** `keys[player][0..3]` — up, down, left, right as `KeyboardEvent.code`. */
	keys: string[][];
	/** `rotation[player]` — asteroids style steering instead of eight way. */
	rotation: number[];
	/** `mouseplayer` — which player steers with the pointer, or -1. */
	mousePlayer: number;
	/** `joystickplayer[]` — gamepad index per slot, or -1. */
	gamepadPlayer: number[];
	/** `joystickmul[]` — 0 accelerates on button, >0 on stick deflection. */
	gamepadMul: number[];
	nrockets: number;
	difficulty: number;
	gameplan: GamePlanMode;
	sound: boolean;
	bloom: boolean;
	cameraMotion: boolean;
	lastLevel: number;
	maxLevel: number;
}

const STORAGE_KEY = 'three-koules/settings';

/** The original bound arrows for player one and WASD for player two. */
export const DEFAULT_KEYS: readonly string[][] = [
	[ 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight' ],
	[ 'KeyW', 'KeyS', 'KeyA', 'KeyD' ],
	[ 'KeyI', 'KeyK', 'KeyJ', 'KeyL' ],
	[ 'Numpad8', 'Numpad5', 'Numpad4', 'Numpad6' ],
	[ 'KeyT', 'KeyG', 'KeyF', 'KeyH' ]
];

export function createDefaultSettings(): SettingsData {

	return {
		keys: DEFAULT_KEYS.map( k => k.slice() ),
		rotation: new Array( MAX_ROCKETS ).fill( 0 ),
		mousePlayer: - 1,
		gamepadPlayer: [ - 1, - 1 ],
		gamepadMul: [ 1.5, 1.5 ],
		nrockets: 1,
		difficulty: 2,
		gameplan: GamePlanMode.COOPERATIVE,
		sound: true,
		bloom: true,
		cameraMotion: true,
		lastLevel: 0,
		maxLevel: 0
	};

}

/** `load_rc()`. Any malformed or partial record falls back to the defaults. */
export function loadSettings(): SettingsData {

	const defaults = createDefaultSettings();

	try {

		const raw = localStorage.getItem( STORAGE_KEY );
		if ( raw === null ) return defaults;

		const stored = JSON.parse( raw ) as Partial<SettingsData>;
		const merged = { ...defaults, ...stored };

		// Guard the array shapes: a record written by an older build may be
		// short, and the input code indexes these without bounds checks.
		merged.keys = defaults.keys.map( ( fallback, i ) => {

			const row = stored.keys?.[ i ];
			return Array.isArray( row ) && row.length === 4 ? row : fallback;

		} );
		merged.rotation = defaults.rotation.map( ( _, i ) => stored.rotation?.[ i ] ?? 0 );
		merged.gamepadPlayer = [ stored.gamepadPlayer?.[ 0 ] ?? - 1, stored.gamepadPlayer?.[ 1 ] ?? - 1 ];
		merged.gamepadMul = [ stored.gamepadMul?.[ 0 ] ?? 1.5, stored.gamepadMul?.[ 1 ] ?? 1.5 ];

		return merged;

	} catch {

		return defaults;

	}

}

/** `save_rc()`. Silently gives up when storage is unavailable or full. */
export function saveSettings( settings: SettingsData ): void {

	try {

		localStorage.setItem( STORAGE_KEY, JSON.stringify( settings ) );

	} catch {

		// Private browsing, quota exhausted — progress is simply not kept.

	}

}
