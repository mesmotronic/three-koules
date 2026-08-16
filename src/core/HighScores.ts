// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { GamePlanMode } from './Constants.js';

/** One finished run. */
export interface HighScore {
	score: number;
	/** Sector reached, one based, as the interface counts them. */
	sector: number;
	/** Milliseconds since the epoch, so the table can show a date. */
	at: number;
}

/** How many runs each table remembers. */
export const TABLE_SIZE = 8;

const STORAGE_KEY = 'three-koules/scores';

type Tables = Record<string, HighScore[]>;

/**
 * The score table Koules never had.
 *
 * A cooperative game has no ending short of sector one hundred — dying just
 * replays the sector for a hundred point penalty — so a run is taken to end
 * when the player leaves it, whether that is by finishing, quitting to the
 * menu, or abandoning from the pause screen. Deathmatch keeps its own table,
 * since its scores mean something quite different.
 */
function load(): Tables {

	try {

		const raw = localStorage.getItem( STORAGE_KEY );
		if ( raw === null ) return {};

		const parsed = JSON.parse( raw ) as Tables;
		return typeof parsed === 'object' && parsed !== null ? parsed : {};

	} catch {

		return {};

	}

}

function save( tables: Tables ): void {

	try {

		localStorage.setItem( STORAGE_KEY, JSON.stringify( tables ) );

	} catch {

		// Private browsing or a full quota; the run simply is not remembered.

	}

}

const keyFor = ( plan: GamePlanMode ): string =>
	plan === GamePlanMode.DEATHMATCH ? 'deathmatch' : 'cooperative';

/** The table for a game plan, best first. */
export function highScores( plan: GamePlanMode ): HighScore[] {

	return load()[ keyFor( plan ) ] ?? [];

}

/**
 * Files a run, if it earned a place.
 *
 * @returns The row's index in the table, or -1 if it did not make it.
 */
export function submitScore( plan: GamePlanMode, score: number, sector: number ): number {

	// A run that never got going is not worth a row.
	if ( score <= 0 ) return - 1;

	const tables = load();
	const key = keyFor( plan );
	const table = tables[ key ] ?? [];
	const entry: HighScore = { score, sector, at: Date.now() };

	table.push( entry );
	// Ties keep the deeper run ahead: reaching sector 40 with the same score
	// as someone who stopped at 12 is the better game.
	table.sort( ( a, b ) => b.score - a.score || b.sector - a.sector );
	table.length = Math.min( table.length, TABLE_SIZE );

	tables[ key ] = table;
	save( tables );

	return table.indexOf( entry );

}

/** Best score on record, for the menu to show at a glance. */
export function bestScore( plan: GamePlanMode ): number {

	return highScores( plan )[ 0 ]?.score ?? 0;

}
