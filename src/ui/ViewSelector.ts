// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { FOLLOWING_VIEWS, VIEW_LABELS, ViewMode } from '../core/Constants.js';
import { setBitmapText } from './BitmapText.js';

const MODES: readonly ViewMode[] = [ ViewMode.TOP, ViewMode.ANGLED, ViewMode.CHASE, ViewMode.COCKPIT ];

/**
 * The point-of-view switch, sat opposite the scores.
 *
 * Deliberately built from the same parts as the rest of the interface — the
 * game's 8x8 font, and the menu's red selection rectangle around the current
 * choice — so a control the original never had still looks like it belongs.
 * Number keys 1 to 4 pick a view directly and V cycles.
 */
export class ViewSelector {

	private readonly buttons: HTMLElement[] = [];
	private current: ViewMode = ViewMode.TOP;
	private available = true;

	constructor(
		private readonly root: HTMLElement,
		private readonly onSelect: ( mode: ViewMode ) => void
	) {

		for ( const mode of MODES ) {

			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'view';
			button.dataset.mode = String( mode );

			const label = document.createElement( 'span' );
			label.className = 'bmp shadowed';
			setBitmapText( label, VIEW_LABELS[ mode ] );

			button.append( label );
			button.addEventListener( 'click', () => this.choose( mode ) );

			this.root.append( button );
			this.buttons.push( button );

		}

		this.refresh();

	}

	get mode(): ViewMode {

		return this.current;

	}

	set visible( value: boolean ) {

		this.root.classList.toggle( 'visible', value );

	}

	/**
	 * Marks the following views usable or not.
	 *
	 * They track one ship, so they are offered only in a solo game until
	 * there is something sensible to do about a split screen.
	 */
	setSoloGame( solo: boolean ): void {

		this.available = solo;

		if ( ! solo && FOLLOWING_VIEWS.includes( this.current ) ) {

			this.choose( ViewMode.ANGLED );
			return;

		}

		this.refresh();

	}

	/** True if this mode can be chosen right now. */
	private allows( mode: ViewMode ): boolean {

		return this.available || ! FOLLOWING_VIEWS.includes( mode );

	}

	choose( mode: ViewMode ): void {

		if ( ! this.allows( mode ) ) return;

		this.current = mode;
		this.refresh();
		this.onSelect( mode );

	}

	/** Steps to the next usable view, for the V key. */
	cycle(): void {

		for ( let step = 1; step <= MODES.length; step ++ ) {

			const next = MODES[ ( MODES.indexOf( this.current ) + step ) % MODES.length ];
			if ( this.allows( next ) ) { this.choose( next ); return; }

		}

	}

	/** Repaints after a scale change, since the labels are bitmaps. */
	rescale(): void {

		for ( const [ index, button ] of this.buttons.entries() ) {

			const label = button.firstElementChild as HTMLElement | null;
			if ( label !== null ) setBitmapText( label, VIEW_LABELS[ MODES[ index ] ] );

		}

	}

	private refresh(): void {

		for ( const [ index, button ] of this.buttons.entries() ) {

			const mode = MODES[ index ];
			button.classList.toggle( 'selected', mode === this.current );
			button.classList.toggle( 'unavailable', ! this.allows( mode ) );

		}

	}

}
