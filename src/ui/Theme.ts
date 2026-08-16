// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { ball, paletteHex } from '../core/Palette.js';

/**
 * Publishes the game's own palette entries to CSS.
 *
 * `menu.c` picked its colours by index, not by name, and every one of them is
 * reproducible from `cmap.c`. Deriving the stylesheet's custom properties from
 * the same table keeps a single source of truth and means the interface cannot
 * drift away from the objects it sits over.
 */
export function applyTheme( root: HTMLElement = document.documentElement ): void {

	const set = ( name: string, value: string ): void => root.style.setProperty( name, value );

	// `DrawWhiteMaskedText` wrote entry 255, with a black shadow one pixel down
	// and to the right; everything in the interface was drawn that way.
	set( '--koules-text', paletteHex( 255 ) );
	set( '--koules-shadow', paletteHex( 0 ) );

	// The menu's moving selection rectangle: a bright outline in `ball(2)` with
	// a second, darker one offset behind it in `ball(20)`.
	set( '--koules-select', paletteHex( ball( 2 ) ) );
	set( '--koules-select-shadow', paletteHex( ball( 20 ) ) );

	// The spinner arrows beside the player and level counters share the bright
	// half of that red ramp.
	set( '--koules-arrow', paletteHex( ball( 2 ) ) );

}
