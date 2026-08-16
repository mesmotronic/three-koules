// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { CP437 } from '../core/Font8x8.js';
import { repaintBitmapText, setBitmapText } from './BitmapText.js';

/**
 * The sound switch, sat in the corner of the screen.
 *
 * The game starts straight into its opening crawl, and a browser will not let
 * an audio context run until the player has interacted with the page — so
 * without something visible saying so, the first minute is silent for no
 * apparent reason. This is that something: it shows struck through until sound
 * is actually audible, and pulses while the only thing standing in the way is
 * a click.
 *
 * It is not a second setting. It reads and writes the same `sound` preference
 * the menu does, so the two can never disagree.
 */
export class SoundButton {

	private readonly glyph: HTMLElement;
	private muted = true;
	private waiting = false;

	/**
	 * @param root - The button element.
	 * @param onToggle - Asked to change the sound setting. It is told whether
	 * the button was inviting a click to unblock the browser, because that is
	 * a request to turn sound on rather than to toggle it: the page's own
	 * gesture handler will have started the context on `pointerdown`, moments
	 * before this `click`, and a plain toggle would read that as "already on"
	 * and switch it straight back off.
	 */
	constructor(
		private readonly root: HTMLElement,
		onToggle: ( wasBlocked: boolean ) => void
	) {

		this.glyph = document.createElement( 'span' );
		this.glyph.className = 'bmp';
		this.root.append( this.glyph );

		this.root.addEventListener( 'click', () => onToggle( this.waiting ) );

		// CP437 has a pair of beamed quavers at 0x0E, so the icon comes from the
		// same font as everything else rather than from an SVG. The stylesheet
		// picks its colour, as it does for the strike and the pulse.
		setBitmapText( this.glyph, String.fromCharCode( CP437.NOTES ) );

	}

	/**
	 * @param wanted - The player's sound setting.
	 * @param running - Whether the audio context has been let out of the
	 * browser's gesture requirement yet.
	 */
	update( wanted: boolean, running: boolean ): void {

		// Sound is only heard when it is both switched on and unblocked; the
		// button invites a gesture when that is the only thing missing.
		const audible = wanted && running;
		const blocked = wanted && ! running;

		if ( audible === ! this.muted && blocked === this.waiting ) return;

		this.muted = ! audible;
		this.waiting = blocked;

		this.root.classList.toggle( 'muted', this.muted );
		this.root.classList.toggle( 'waiting', blocked );

		// The class change alone cannot recolour a baked bitmap.
		repaintBitmapText( this.glyph );

		this.root.setAttribute( 'aria-pressed', String( audible ) );
		this.root.setAttribute( 'aria-label', audible ? 'Sound on' : 'Sound off' );
		this.root.title = blocked ? 'Click to enable sound' : ( audible ? 'Sound on' : 'Sound off' );

	}

}
