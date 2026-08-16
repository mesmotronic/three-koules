// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { GameMode, GamePlanMode, ObjectType } from '../core/Constants.js';
import { CP437 } from '../core/Font8x8.js';
import type { Game } from '../game/Game.js';
import { appearanceColor } from '../materials/BodyMaterials.js';
import { releaseBitmapText, setBitmapText } from './BitmapText.js';

const DIAMOND = String.fromCharCode( CP437.DIAMOND );

/**
 * The status line `draw_objects()` printed under the playfield.
 *
 * The original wrote `lives:` and `scores:` as two fixed width rows of five
 * columns whether or not those players existed. Here only the players in the
 * game are shown, each tagged with the colour of their ship.
 */
export class Hud {

	private readonly rows: HTMLElement[] = [];
	private lastSignature = '';

	constructor(
		private readonly levelEl: HTMLElement,
		private readonly playersEl: HTMLElement
	) {}

	update( game: Game ): void {

		const coop = game.gameplan === GamePlanMode.COOPERATIVE;
		const playing = game.gamemode === GameMode.GAME;

		setBitmapText( this.levelEl, coop && playing ? `SECTOR ${ game.plan.level + 1 }` : '' );
		this.levelEl.classList.add( 'shadowed' );

		// Rebuild only when the player count changes; the numbers are patched
		// in place every frame.
		const signature = `${ game.nrockets }`;

		if ( signature !== this.lastSignature ) {

			this.lastSignature = signature;

			for ( const element of this.playersEl.querySelectorAll<HTMLElement>( '.bmp' ) ) {

				releaseBitmapText( element );

			}

			this.playersEl.textContent = '';
			this.rows.length = 0;

			for ( let i = 0; i < game.nrockets; i ++ ) {

				const row = document.createElement( 'div' );
				row.className = 'player';

				const pip = document.createElement( 'span' );
				pip.className = 'pip';
				pip.style.color = `#${ appearanceColor( `rocket${ ( i % 5 ) as 0 | 1 | 2 | 3 | 4 }` ).getHexString() }`;

				const lives = document.createElement( 'span' );
				lives.className = 'bmp shadowed lives';

				const score = document.createElement( 'span' );
				score.className = 'bmp shadowed score';

				row.append( pip, lives, score );
				this.playersEl.append( row );
				this.rows.push( row );

			}

		}

		for ( let i = 0; i < this.rows.length; i ++ ) {

			const object = game.objects[ i ];
			const row = this.rows[ i ];
			const alive = object.live1 > 0 || object.type === ObjectType.CREATOR;

			row.classList.toggle( 'dead', ! alive );

			// CP437 entry 4 is a filled diamond, which is what the font offers
			// in place of the original's bare numeral count.
			const pips = DIAMOND.repeat( Math.max( 0, Math.min( 9, object.live1 ) ) );

			setBitmapText( row.children[ 1 ] as HTMLElement, pips );
			setBitmapText( row.children[ 2 ] as HTMLElement, String( object.score ).padStart( 6, ' ' ) );

		}

	}

}
