// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * What `rcfiles.c` did with `$HOME`, in localStorage.
 *
 * Every read can fail and every write can fail, and in both cases the game has
 * to carry on regardless: a browser in private mode throws on `getItem`, a full
 * quota throws on `setItem`, and a record left by an older build may not parse.
 * None of that is worth interrupting a game for, so the policy is the same
 * wherever it applies — fall back to the default, and let a failed write mean
 * the setting simply is not kept.
 */

/** Reads a stored record, or the fallback if there is not a usable one. */
export function readJson<T>( key: string, fallback: T ): T {

	try {

		const raw = localStorage.getItem( key );
		if ( raw === null ) return fallback;

		const parsed = JSON.parse( raw ) as unknown;

		// A record of the wrong shape is no better than none: everything stored
		// here is an object, so anything else is from a different build.
		return typeof parsed === 'object' && parsed !== null ? parsed as T : fallback;

	} catch {

		return fallback;

	}

}

/** Stores a record, giving up silently if the browser will not have it. */
export function writeJson( key: string, value: unknown ): void {

	try {

		localStorage.setItem( key, JSON.stringify( value ) );

	} catch {

		// Private browsing, quota exhausted — progress is simply not kept.

	}

}
