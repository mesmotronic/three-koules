// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * A stand-in for C's `rand()`.
 *
 * Koules leaned on `rand() % n` everywhere, including in a few places where
 * the operator precedence produced surprising results (see `LUNATIC` steering
 * in `Physics`). Keeping the same shape of call makes those ports readable.
 */

const RAND_MAX = 2147483647;

/** `rand()` — a non negative integer up to `RAND_MAX`. */
export function rand(): number {

	return Math.floor( Math.random() * ( RAND_MAX + 1 ) );

}

/** `rand() % n`. */
export function randMod( n: number ): number {

	return n <= 0 ? 0 : Math.floor( Math.random() * n );

}

/**
 * `!(rand () % n)` — the "one chance in n, every tick" idiom the game used for
 * all of its spawn timers.
 */
export function chance( n: number ): boolean {

	return randMod( n ) === 0;

}
