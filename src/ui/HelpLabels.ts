// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { GAME_WIDTH, Letter, ObjectType, toWorldX, toWorldY } from '../core/Constants.js';

/**
 * Projects a world point to overlay pixels, or null if it is behind the camera.
 *
 * The returned point is a shared scratch and is only valid until the next call.
 */
export type Project = ( x: number, y: number, z: number ) => { x: number; y: number } | null;
import type { Game } from '../game/Game.js';
import type { GameObject } from '../game/GameObject.js';
import { HELP_TEXT } from '../misc/TextData.js';
import { releaseBitmapText, setBitmapText } from './BitmapText.js';

/** `help()` — the caption drawn beside an object with help mode on. */
function captionFor( object: GameObject ): string | null {

	switch ( object.type ) {

		case ObjectType.BALL: return HELP_TEXT.ball;
		case ObjectType.BBALL: return HELP_TEXT.bball;
		case ObjectType.HOLE: return HELP_TEXT.hole;
		case ObjectType.EHOLE: return HELP_TEXT.ehole;
		case ObjectType.INSPECTOR: return HELP_TEXT.inspector;
		case ObjectType.LUNATIC: return HELP_TEXT.lunatic;
		case ObjectType.APPLE: return HELP_TEXT.apple;
		case ObjectType.ROCKET: return HELP_TEXT.rocket;

		case ObjectType.LBALL:
			switch ( object.letter ) {

				case Letter.ACCEL: return HELP_TEXT.accel;
				case Letter.GUMM: return HELP_TEXT.gumm;
				case Letter.THIEF: return HELP_TEXT.thief;
				case Letter.FINDER: return HELP_TEXT.finder;
				case Letter.TTOOL: return HELP_TEXT.ttool;
				default: return HELP_TEXT.ball;

			}

		default: return null;

	}

}

/**
 * The H key's annotations, projected onto the playfield overlay.
 *
 * `koules.c` drew these into the framebuffer beside each object and refused to
 * draw any that would have run off the edge of the map, which is reproduced by
 * simply hiding a label whose anchor leaves the square.
 */
export class HelpLabels {

	private readonly labels: HTMLElement[] = [];

	constructor( private readonly container: HTMLElement ) {}

	/**
	 * @param game - Source of the objects to annotate.
	 * @param project - World point to overlay-relative pixels, or null if the
	 * point is behind the camera.
	 * @param size - Side of the projected playfield square, in pixels.
	 */
	update( game: Game | null, project: Project, size: number ): void {

		if ( game === null || ! game.helpmode ) {

			if ( this.labels.length > 0 ) this.clear();
			return;

		}

		let used = 0;

		for ( let i = 0; i < game.nobjects; i ++ ) {

			const object = game.objects[ i ];
			if ( ! object.live ) continue;

			const caption = captionFor( object );
			if ( caption === null ) continue;

			const point = project( toWorldX( object.x ), toWorldY( object.y ), 0 );

			if ( point === null ) continue;
			if ( point.x < 0 || point.y < 0 || point.x > size || point.y > size ) continue;

			const label = this.labelAt( used ++ );
			setBitmapText( label, caption );
			label.style.display = '';
			// Offset past the object's silhouette, as the original did. One
			// transform rather than two offsets, so a moving label costs a
			// single composited write instead of re-running layout.
			const x = point.x + ( object.radius / GAME_WIDTH ) * size + 4;
			label.style.transform = `translate(${ x }px, ${ point.y }px) translateY(-50%)`;

		}

		// Tethers get their own caption at the midpoint of the line.
		for ( let i = 0; i < game.nobjects; i ++ ) {

			const object = game.objects[ i ];
			if ( ! object.live || object.lineto === - 1 ) continue;

			const other = game.objects[ object.lineto ];
			if ( ! other.live ) continue;

			const point = project(
				toWorldX( ( object.x + other.x ) / 2 ),
				toWorldY( ( object.y + other.y ) / 2 ),
				0
			);

			if ( point === null ) continue;
			if ( point.x < 0 || point.y < 0 || point.x > size || point.y > size ) continue;

			const label = this.labelAt( used ++ );
			setBitmapText( label, HELP_TEXT.spring );
			label.style.display = '';
			label.style.transform = `translate(${ point.x + 4 }px, ${ point.y }px) translateY(-50%)`;

		}

		for ( let i = used; i < this.labels.length; i ++ ) this.labels[ i ].style.display = 'none';

	}

	private labelAt( index: number ): HTMLElement {

		let label = this.labels[ index ];

		if ( label === undefined ) {

			label = document.createElement( 'span' );
			label.className = 'bmp shadowed';
			this.labels[ index ] = label;
			this.container.append( label );

		}

		return label;

	}

	private clear(): void {

		for ( const label of this.labels ) releaseBitmapText( label );

		this.container.textContent = '';
		this.labels.length = 0;

	}

}
