// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { VIEW_LABELS, ViewMode } from '../core/Constants.js';
import { setBitmapText } from './BitmapText.js';

const MODES: readonly ViewMode[] = [ ViewMode.TOP, ViewMode.ANGLED, ViewMode.CHASE, ViewMode.COCKPIT ];

/**
 * The point-of-view switch, sat opposite the scores.
 *
 * Deliberately built from the same parts as the rest of the interface — the
 * game's 8x8 font, and the menu's red selection rectangle around the current
 * choice — so a control the original never had still looks like it belongs.
 * Number keys 1 to 4 pick a view directly and V cycles.
 *
 * Every view is offered whatever the player count: the following ones tile a
 * viewport per ship rather than picking one to favour.
 */
export class ViewSelector {

	private readonly buttons: HTMLElement[] = [];
	private current: ViewMode = ViewMode.TOP;

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

			button.append( label );
			button.addEventListener( 'click', () => this.choose( mode ) );

			this.root.append( button );
			this.buttons.push( button );

			// Painted only once the label is in the document: the bitmap takes
			// its colour from the computed style, and a detached element has
			// none to give.
			setBitmapText( label, VIEW_LABELS[ mode ] );

		}

		this.refresh();

	}

	get mode(): ViewMode {

		return this.current;

	}

	/**
	 * Shows a view chosen somewhere else, without reporting it back.
	 *
	 * The menu offers the same four, so the buttons have to be able to follow
	 * a choice made there. {@link choose} is for a press on these buttons, and
	 * says so; this only catches them up.
	 */
	set mode( value: ViewMode ) {

		if ( value === this.current ) return;

		this.current = value;
		this.refresh();

	}

	set visible( value: boolean ) {

		this.root.classList.toggle( 'visible', value );

	}

	/** Records a deliberate choice, and tells the app to remember it. */
	choose( mode: ViewMode ): void {

		this.current = mode;
		this.refresh();
		this.onSelect( mode );

	}

	/** Steps to the next view, for the V key. */
	cycle(): void {

		this.choose( MODES[ ( MODES.indexOf( this.current ) + 1 ) % MODES.length ] );

	}

	private refresh(): void {

		for ( const [ index, button ] of this.buttons.entries() ) {

			button.classList.toggle( 'selected', MODES[ index ] === this.current );

		}

	}

}
