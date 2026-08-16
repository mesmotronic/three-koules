// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { GamePlanMode } from './Constants.js';
import { readJson, writeJson } from './Storage.js';

/** One finished run. */
export interface HighScore {
	score: number;
	/** Sector reached, one based, as the interface counts them. */
	sector: number;
}

/** How many runs each table remembers. */
const TABLE_SIZE = 8;

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
const keyFor = ( plan: GamePlanMode ): string =>
	plan === GamePlanMode.DEATHMATCH ? 'deathmatch' : 'cooperative';

/** The table for a game plan, best first. */
export function highScores( plan: GamePlanMode ): HighScore[] {

	return readJson<Tables>( STORAGE_KEY, {} )[ keyFor( plan ) ] ?? [];

}

/**
 * Files a whole game's worth of runs.
 *
 * Every ship at once rather than one at a time: they finish together, and a
 * five player game would otherwise read, parse, sort, serialise and write the
 * table five times over at the moment the menu is being rebuilt.
 */
export function submitScores( plan: GamePlanMode, runs: readonly HighScore[] ): void {

	// A run that never got going is not worth a row.
	const earned = runs.filter( run => run.score > 0 );
	if ( earned.length === 0 ) return;

	const tables = readJson<Tables>( STORAGE_KEY, {} );
	const key = keyFor( plan );
	const table = tables[ key ] ?? [];

	table.push( ...earned );
	// Ties keep the deeper run ahead: reaching sector 40 with the same score
	// as someone who stopped at 12 is the better game.
	table.sort( ( a, b ) => b.score - a.score || b.sector - a.sector );
	table.length = Math.min( table.length, TABLE_SIZE );

	tables[ key ] = table;
	writeJson( STORAGE_KEY, tables );

}
