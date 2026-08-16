// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { CP437 } from '../core/Font8x8.js';
import { setBitmapText } from './BitmapText.js';

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
	private painted = '';

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
		this.paint();

	}

	/** Repaints after a scale change, since the glyph is a bitmap. */
	rescale(): void {

		this.painted = '';
		this.paint();

	}

	/**
	 * Draws the icon in the colour the current state calls for.
	 *
	 * The colour is baked into the bitmap, so a CSS class change cannot
	 * recolour it the way it would ordinary text — the glyph has to be redrawn.
	 * CP437 has a pair of beamed quavers at 0x0E, so the icon comes from the
	 * same font as everything else rather than from an SVG.
	 */
	private paint(): void {

		const style = getComputedStyle( document.documentElement );
		const token = this.muted ? '--koules-select' : '--koules-text';
		const color = style.getPropertyValue( token ).trim() || '#ffffff';

		if ( color === this.painted ) return;
		this.painted = color;

		setBitmapText( this.glyph, String.fromCharCode( CP437.NOTES ), color );

	}

	/**
	 * @param audible - Whether sound would actually be heard right now.
	 * @param blocked - Whether the only obstacle is the browser waiting for a
	 * gesture, in which case the button invites one.
	 */
	update( audible: boolean, blocked: boolean ): void {

		if ( audible === ! this.muted && blocked === this.waiting ) return;

		this.muted = ! audible;
		this.waiting = blocked;

		this.root.classList.toggle( 'muted', this.muted );
		this.root.classList.toggle( 'waiting', blocked );
		this.paint();
		this.root.setAttribute( 'aria-pressed', String( audible ) );
		this.root.setAttribute( 'aria-label', audible ? 'Sound on' : 'Sound off' );
		this.root.title = blocked ? 'Click to enable sound' : ( audible ? 'Sound on' : 'Sound off' );

	}

}
