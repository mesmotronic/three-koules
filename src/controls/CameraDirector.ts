// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { MAX_ROCKETS, ViewMode } from '../core/Constants.js';
import type { GameObject } from '../game/GameObject.js';
import { CameraView, POSES, type Framing } from './CameraView.js';

/**
 * Places the cameras, and flies them between the game's points of view.
 *
 * The simulation is resolutely two dimensional — it was written for a
 * framebuffer — so none of this touches gameplay. What it does change is which
 * way is up: in the two following modes the camera turns with the ship, and a
 * player pressing "up" means "away from me" rather than "towards the top of
 * the sector". {@link headingOffset} carries that rotation back to the input
 * code so the controls stay honest.
 *
 * Split screen is a list of {@link CameraView}s, each with its own fraction of
 * the canvas. Usually there is one covering all of it; in a following view with
 * several players there is one per ship, tiled.
 *
 * They are deliberately separate cameras rather than a `THREE.ArrayCamera`.
 * That would let three draw every viewport in one pass, but it packs the camera
 * matrices into a uniform array whose length is compiled into every pipeline
 * reading it — and the array lives in a module-level singleton, so changing how
 * many cameras there are mid-session leaves already-built pipelines bound to a
 * buffer of the wrong size. Drawing each viewport in its own scissored pass
 * costs a little more and cannot break that way.
 */
export class CameraDirector {

	private readonly views: CameraView[] = [];

	mode: ViewMode = ViewMode.TOP;

	/** How the sector is framed, refreshed by the app each frame. */
	private readonly framing: Framing = {
		distance: 1000,
		lift: 0,
		statusFraction: 0,
		drift: true,
		elapsed: 0
	};

	/** Number of viewports currently tiled across the canvas. */
	private viewports = 1;

	/** The canvas's width over height, so viewports get a true aspect. */
	private canvasAspect = 1;

	/** The aspect the current layout was built for; NaN until it is built. */
	private tiledAspect = NaN;

	constructor() {

		for ( let i = 0; i < MAX_ROCKETS; i ++ ) this.views.push( new CameraView() );

		this.tile( 1 );

	}

	/** Tells the views what shape the canvas is. */
	setCanvasAspect( aspect: number ): void {

		if ( aspect === this.canvasAspect ) return;

		this.canvasAspect = aspect;
		this.tile();

	}

	/** How many viewports to draw this frame. */
	get viewportCount(): number {

		return this.viewports;

	}

	/** One of the viewports to draw, counted from zero. */
	viewAt( index: number ): CameraView {

		return this.views[ index ];

	}

	set distance( value: number ) {

		this.framing.distance = value;

	}

	set lift( value: number ) {

		this.framing.lift = value;

	}

	set statusFraction( value: number ) {

		this.framing.statusFraction = value;

	}

	set driftEnabled( value: boolean ) {

		this.framing.drift = value;

	}

	/** True while one camera covers the whole canvas. */
	get isSingleView(): boolean {

		return this.viewports === 1;

	}

	/** The camera the overlay projects against. */
	get primaryCamera(): CameraView[ 'camera' ] {

		return this.views[ 0 ].camera;

	}

	/**
	 * Rotation to add to a player's input so that "up" means "away from the
	 * camera". Zero in the two fixed views, where the sector is already square
	 * to the screen.
	 *
	 * @param player - Whose viewport to ask; each has its own heading.
	 */
	headingOffset( player: number ): number {

		if ( ! POSES[ this.mode ].rotating ) return 0;

		// With one shared viewport everyone steers relative to that one camera.
		const index = this.viewports === 1 ? 0 : Math.min( player, this.viewports - 1 );
		return this.views[ index ].heading - Math.PI;

	}

	/** Drops every camera straight onto its pose, with no flight. */
	snap(): void {

		for ( const view of this.views ) view.snap();

	}

	/**
	 * @param delta - Seconds since the last frame.
	 * @param elapsed - Total elapsed seconds, for the idle drift.
	 * @param mode - The point of view to show.
	 * @param players - Ships to follow, one per viewport where the mode does.
	 * @param count - How many of `players` are in the game.
	 */
	update(
		delta: number,
		elapsed: number,
		mode: ViewMode,
		players: readonly GameObject[],
		count: number
	): void {

		this.mode = mode;
		this.framing.elapsed = elapsed;

		// A view that turns with the ship gets one viewport per ship; the fixed
		// views are the same picture for everyone, so they share one. Asking the
		// pose table rather than a second list of modes keeps the two answers
		// from ever disagreeing.
		this.tile( POSES[ mode ].rotating ? count : 1 );

		for ( let i = 0; i < this.viewports; i ++ ) {

			const view = this.views[ i ];
			view.setMode( mode );
			view.update( delta, this.framing, players[ i ] ?? null );

		}

	}

	/**
	 * Tiles the canvas between viewports.
	 *
	 * Two players sit side by side; more fill a grid as square as the count
	 * allows. Viewports are fractions of the canvas, so a window resize needs
	 * nothing doing here — only a change of shape, which is why the aspect is
	 * read fresh rather than passed in.
	 *
	 * @param count - Viewports wanted; defaults to however many there already
	 * are, for a re-tile that only the canvas shape has prompted.
	 */
	private tile( count: number = this.viewports ): void {

		const clamped = Math.max( 1, Math.min( MAX_ROCKETS, count ) );

		// Called every frame, but the layout only ever changes when the player
		// count, the view or the window does.
		if ( clamped === this.viewports && this.canvasAspect === this.tiledAspect ) return;

		this.viewports = clamped;
		this.tiledAspect = this.canvasAspect;

		const columns = Math.ceil( Math.sqrt( clamped ) );
		const rows = Math.ceil( clamped / columns );

		for ( let i = 0; i < clamped; i ++ ) {

			const column = i % columns;
			// Viewport y counts up from the bottom, but players read a grid
			// from the top, so the row is flipped.
			const row = rows - 1 - Math.floor( i / columns );

			this.views[ i ].setViewport(
				column / columns,
				row / rows,
				1 / columns,
				1 / rows,
				this.canvasAspect
			);

		}

	}

}
