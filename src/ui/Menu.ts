// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 1997 Ludvik Tesar
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { DIFFICULTIES, GamePlanMode, MAX_ROCKETS } from '../core/Constants.js';
import { highScores } from '../core/HighScores.js';
import type { SettingsData } from '../core/Settings.js';
import type { InputManager } from '../controls/InputManager.js';
import type { Game } from '../game/Game.js';
import { releaseBitmapText, setBitmapArrow, setBitmapText } from './BitmapText.js';

/** One row of the menu. */
interface MenuItem {
	label(): string;
	activate?(): void;
	/** Rows with a spinner respond to left and right as well as enter. */
	spinner?: {
		get(): number;
		set( value: number ): void;
		min(): number;
		max(): number;
	};
}

/**
 * Which screen the menu is showing; `nmain_menu` and friends in `menu.c`.
 *
 * `pause` and `scores` are new. They are built from the same rows, selector
 * and key handling as the rest, so a screen the original never had still
 * behaves exactly like one it did.
 */
type Screen = 'main' | 'control' | 'mode' | 'difficulty' | 'pause' | 'scores';

/** The control schemes a player can cycle through. */
type Scheme =
	| { kind: 'keyboard' }
	| { kind: 'rotation' }
	| { kind: 'mouse' }
	| { kind: 'gamepad'; slot: 0 | 1; deflection: boolean };

const REPEAT_DELAY = 0.34;
const REPEAT_INTERVAL = 0.055;

export interface MenuHooks {
	onStart(): void;
	onQuit(): void;
	onPersist(): void;
	onSettingsChanged(): void;
	/** Leave the pause screen and let the game run on. */
	onResume(): void;
	/** Give up the current run and return to the main menu. */
	onAbandon(): void;
}

/**
 * The GUI menuing system from `menu.c`, rendered as a DOM overlay.
 *
 * Behaviour is unchanged — the same screens, the same spinners, the same
 * per-player control cycling — but the selector is CSS rather than an animated
 * rectangle, and the attract-mode game carries on in WebGPU behind it.
 */
export class Menu {

	private screen: Screen = 'main';
	private selected = 0;
	private items: MenuItem[] = [];

	/** Non-null while the player is rebinding a scheme's keys. */
	private rebinding: { player: number; slot: number } | null = null;

	private repeatTimer = 0;
	private repeatDirection = 0;

	/** Labels currently in the DOM, so rebuilds only happen when needed. */
	private rendered: string[] = [];

	/** Which pads were plugged in last frame, so the labels can keep up. */
	private padMask = - 1;

	/** The animated selection rectangle. */
	private readonly selector: HTMLElement;

	constructor(
		private readonly root: HTMLElement,
		private readonly list: HTMLElement,
		private readonly game: Game,
		private readonly settings: SettingsData,
		private readonly input: InputManager,
		private readonly hooks: MenuHooks
	) {

		const selector = root.querySelector<HTMLElement>( '#menu-selector' );
		if ( selector === null ) throw new Error( 'Missing #menu-selector' );
		this.selector = selector;

		this.list.addEventListener( 'click', this.onClick );
		this.build();

	}

	get visible(): boolean {

		return this.root.classList.contains( 'visible' );

	}

	set visible( value: boolean ) {

		this.root.classList.toggle( 'visible', value );
		if ( value ) this.render();

	}

	/** Opens the pause screen over the running sector. */
	showPause(): void {

		this.screen = 'pause';
		this.rebinding = null;
		this.input.cancelCapture();
		this.build();

	}

	/** Returns to the top level, as escape did. */
	toMain(): void {

		this.screen = 'main';
		this.rebinding = null;
		this.input.cancelCapture();
		this.build();

	}

	// ------------------------------------------------------------- screens

	private build(): void {

		const previous = this.items.length;

		switch ( this.screen ) {

			case 'main': this.items = this.mainItems(); break;
			case 'control': this.items = this.controlItems(); break;
			case 'mode': this.items = this.modeItems(); break;
			case 'difficulty': this.items = this.difficultyItems(); break;
			case 'pause': this.items = this.pauseItems(); break;
			case 'scores': this.items = this.scoreItems(); break;

		}

		if ( this.items.length !== previous || this.selected >= this.items.length ) {

			this.selected = this.screen === 'mode' ? 1 : ( this.screen === 'difficulty' ? 2 : 0 );

		}

		// The score table is mostly headings and figures, so the selection has
		// to find the first row that actually does something.
		if ( ! this.isSelectable( this.selected ) ) this.selected = this.nextSelectable( this.selected, 1 );

		this.root.classList.toggle( 'paused', this.screen === 'pause' );

		this.rendered = [];
		this.render();

	}

	private mainItems(): MenuItem[] {

		const { settings, game } = this;

		return [
			{ label: () => 'START GAME', activate: () => this.hooks.onStart() },
			{
				label: () => `${ settings.nrockets } PLAYER${ settings.nrockets === 1 ? '' : 'S' }`,
				spinner: {
					get: () => settings.nrockets,
					set: v => { settings.nrockets = v; game.nrockets = v; },
					min: () => 1,
					max: () => MAX_ROCKETS
				}
			},
			{
				label: () => `LEVEL ${ String( game.plan.lastLevel + 1 ).padStart( 3, '0' ) }`,
				spinner: {
					get: () => game.plan.lastLevel,
					set: v => { game.plan.lastLevel = v; settings.lastLevel = v; },
					min: () => 0,
					max: () => game.plan.maxLevel
				}
			},
			{ label: () => 'HIGH SCORES', activate: () => { this.screen = 'scores'; this.build(); } },
			{ label: () => 'CONTROL', activate: () => { this.screen = 'control'; this.build(); } },
			{ label: () => 'GAME MODE', activate: () => { this.screen = 'mode'; this.build(); } },
			{ label: () => 'DIFFICULTY', activate: () => { this.screen = 'difficulty'; this.build(); } },
			{
				label: () => settings.sound ? 'SOUND ON' : 'SOUND OFF',
				activate: () => { settings.sound = ! settings.sound; this.changed(); }
			},
			{
				label: () => settings.bloom ? 'BLOOM ON' : 'BLOOM OFF',
				activate: () => { settings.bloom = ! settings.bloom; this.changed(); }
			},
			{
				label: () => settings.cameraMotion ? 'CAMERA MOTION ON' : 'CAMERA MOTION OFF',
				activate: () => { settings.cameraMotion = ! settings.cameraMotion; this.changed(); }
			},
			{ label: () => 'QUIT', activate: () => this.hooks.onQuit() }
		];

	}

	/** The pause screen, shown over the running sector. */
	private pauseItems(): MenuItem[] {

		const { settings } = this;

		return [
			{ label: () => 'RESUME', activate: () => this.hooks.onResume() },
			{
				label: () => settings.sound ? 'SOUND ON' : 'SOUND OFF',
				activate: () => { settings.sound = ! settings.sound; this.changed(); }
			},
			{
				label: () => settings.bloom ? 'BLOOM ON' : 'BLOOM OFF',
				activate: () => { settings.bloom = ! settings.bloom; this.changed(); }
			},
			{
				label: () => settings.cameraMotion ? 'CAMERA MOTION ON' : 'CAMERA MOTION OFF',
				activate: () => { settings.cameraMotion = ! settings.cameraMotion; this.changed(); }
			},
			{ label: () => 'ABANDON GAME', activate: () => this.hooks.onAbandon() }
		];

	}

	/** The score table for whichever plan is selected. */
	private scoreItems(): MenuItem[] {

		const table = highScores( this.settings.gameplan );
		const heading = this.settings.gameplan === GamePlanMode.DEATHMATCH ? 'DEATH MATCH' : 'COOPERATIVE';

		const items: MenuItem[] = [
			{ label: () => heading },
			{ label: () => ' ' }
		];

		if ( table.length === 0 ) {

			items.push( { label: () => 'NO SCORES YET' } );

		} else {

			for ( const [ index, entry ] of table.entries() ) {

				// Fixed columns, so the table lines up in a monospaced font.
				const rank = String( index + 1 ).padStart( 2, ' ' );
				const score = String( entry.score ).padStart( 7, ' ' );
				const sector = String( entry.sector ).padStart( 3, ' ' );

				items.push( { label: () => `${ rank }.${ score }   SECTOR ${ sector }` } );

			}

		}

		items.push( { label: () => ' ' } );
		items.push( { label: () => 'BACK', activate: () => this.toMain() } );

		return items;

	}

	private modeItems(): MenuItem[] {

		return [
			{
				label: () => 'DEATH MATCH(DOOM)',
				activate: () => { this.settings.gameplan = GamePlanMode.DEATHMATCH; this.applyAndReturn(); }
			},
			{
				label: () => 'COOPERATIVE',
				activate: () => { this.settings.gameplan = GamePlanMode.COOPERATIVE; this.applyAndReturn(); }
			}
		];

	}

	private difficultyItems(): MenuItem[] {

		return DIFFICULTIES.map( ( difficulty, index ) => ( {
			label: () => difficulty.name,
			activate: () => { this.settings.difficulty = index; this.applyAndReturn(); }
		} ) );

	}

	private controlItems(): MenuItem[] {

		const items: MenuItem[] = [
			{ label: () => 'BACK TO MAIN MENU', activate: () => { this.hooks.onPersist(); this.toMain(); } }
		];

		for ( let i = 0; i < this.settings.nrockets; i ++ ) {

			items.push( {
				label: () => {

					const scheme = this.schemeOf( i );
					const live = scheme.kind !== 'gamepad' || this.input.hasGamepad( scheme.slot );

					return `PLAYER ${ i + 1 }:${ describeScheme( scheme, live ) }`;

				},
				activate: () => this.cycleScheme( i )
			} );

			items.push( {
				label: () => usesKeyboard( this.schemeOf( i ) ) ? 'CHANGE KEYS' : ' ',
				activate: () => {

					if ( ! usesKeyboard( this.schemeOf( i ) ) ) return;
					this.rebinding = { player: i, slot: 0 };
					this.captureNext();

				}
			} );

		}

		return items;

	}

	private applyAndReturn(): void {

		this.changed();
		this.screen = 'main';
		this.build();

	}

	/**
	 * Pushes a settings change through to the game.
	 *
	 * `onSettingsChanged` owns the whole settings-to-simulation mapping, so
	 * nothing is copied across here; doing it twice only invites the two
	 * copies to disagree.
	 */
	private changed(): void {

		this.hooks.onSettingsChanged();
		this.hooks.onPersist();

	}

	// ------------------------------------------------------ control schemes

	private schemeOf( player: number ): Scheme {

		const { settings } = this;

		if ( settings.mousePlayer === player ) return { kind: 'mouse' };

		for ( const slot of [ 0, 1 ] as const ) {

			if ( settings.gamepadPlayer[ slot ] === player ) {

				return { kind: 'gamepad', slot, deflection: settings.gamepadMul[ slot ] > 0 };

			}

		}

		return settings.rotation[ player ] ? { kind: 'rotation' } : { kind: 'keyboard' };

	}

	/**
	 * `control_change()` — steps a player through the schemes on offer.
	 *
	 * The original threaded this through a chain of gotos that skipped devices
	 * already claimed by another player. The same rule holds here, expressed as
	 * a list built fresh each time so a pad plugged in mid-menu shows up.
	 */
	private cycleScheme( player: number ): void {

		const { settings } = this;

		const available: Scheme[] = [ { kind: 'keyboard' }, { kind: 'rotation' } ];

		if ( settings.mousePlayer === - 1 || settings.mousePlayer === player ) {

			available.push( { kind: 'mouse' } );

		}

		for ( const slot of [ 0, 1 ] as const ) {

			const owner = settings.gamepadPlayer[ slot ];
			if ( ! this.input.hasGamepad( slot ) ) continue;
			if ( owner !== - 1 && owner !== player ) continue;

			available.push( { kind: 'gamepad', slot, deflection: false } );
			available.push( { kind: 'gamepad', slot, deflection: true } );

		}

		const current = this.schemeOf( player );
		const index = available.findIndex( s => sameScheme( s, current ) );
		const next = available[ ( index + 1 ) % available.length ];

		// Release whatever this player held before claiming the next device.
		if ( settings.mousePlayer === player ) settings.mousePlayer = - 1;
		for ( const slot of [ 0, 1 ] as const ) {

			if ( settings.gamepadPlayer[ slot ] === player ) settings.gamepadPlayer[ slot ] = - 1;

		}

		settings.rotation[ player ] = 0;

		switch ( next.kind ) {

			case 'rotation': settings.rotation[ player ] = 1; break;
			case 'mouse': settings.mousePlayer = player; break;
			case 'gamepad':
				settings.gamepadPlayer[ next.slot ] = player;
				// Zero means "accelerate on the fire button"; anything above
				// means "accelerate by how far the stick is pushed".
				settings.gamepadMul[ next.slot ] = next.deflection ? 1.5 : 0;
				break;
			default: break;

		}

		this.hooks.onPersist();
		this.render();

	}

	/** `keys_keys()` — grabs one key at a time until the scheme is bound. */
	private captureNext(): void {

		const state = this.rebinding;
		if ( state === null ) return;

		this.input.captureNextKey( code => {

			const keys = this.settings.keys[ state.player ];
			keys[ state.slot ] = code;

			const needed = this.settings.rotation[ state.player ] ? 3 : 4;
			state.slot ++;

			if ( state.slot >= needed ) {

				this.rebinding = null;
				this.hooks.onPersist();

			} else {

				this.captureNext();

			}

			this.render();

		} );

	}

	// -------------------------------------------------------------- driving

	/** Called once a frame while the menu is up. */
	update( delta: number ): void {

		if ( ! this.visible ) return;

		if ( this.rebinding !== null ) {

			// Escape during rebinding cancels; `InputManager` swallows the key.
			if ( ! this.input.isCapturing ) this.rebinding = null;
			this.render();
			return;

		}

		const { input } = this;

		// Plugging a pad in or pulling it out while the control screen is open
		// changes what the rows say and what cycling will offer.
		if ( this.screen === 'control' ) {

			const mask = ( input.hasGamepad( 0 ) ? 1 : 0 ) | ( input.hasGamepad( 1 ) ? 2 : 0 );

			if ( mask !== this.padMask ) {

				this.padMask = mask;
				this.render();

			}

		}

		if ( input.wasPressed( 'Escape' ) ) {

			if ( this.screen === 'pause' ) this.hooks.onResume();
			else if ( this.screen === 'main' ) this.hooks.onQuit();
			else { this.hooks.onPersist(); this.toMain(); }

			return;

		}

		if ( input.wasPressed( 'ArrowUp' ) || input.wasPressed( 'KeyW' ) ) this.moveSelection( - 1 );
		if ( input.wasPressed( 'ArrowDown' ) || input.wasPressed( 'KeyS' ) ) this.moveSelection( 1 );

		if ( input.wasPressed( 'Enter' ) || input.wasPressed( 'Space' ) || input.wasPressed( 'NumpadEnter' ) ) {

			this.items[ this.selected ]?.activate?.();
			return;

		}

		this.updateSpinner( delta );

	}

	/**
	 * Moves the selection, skipping rows that do nothing.
	 *
	 * The score table is built from the same rows as everything else, and most
	 * of its lines are just text; landing on one would be a dead end.
	 */
	private moveSelection( direction: number ): void {

		this.selected = this.nextSelectable( this.selected, direction );
		this.render();

	}

	/** True if a row responds to being chosen. */
	private isSelectable( index: number ): boolean {

		const item = this.items[ index ];
		return item !== undefined && ( item.activate !== undefined || item.spinner !== undefined );

	}

	/** The next row in that direction that responds, wrapping round. */
	private nextSelectable( from: number, direction: number ): number {

		const count = this.items.length;

		for ( let i = 1; i <= count; i ++ ) {

			const next = ( from + direction * i + count * i ) % count;
			if ( this.isSelectable( next ) ) return next;

		}

		return from;

	}

	/** Held left or right ramps up, as `increase()`/`decrease()` did. */
	private updateSpinner( delta: number ): void {

		const spinner = this.items[ this.selected ]?.spinner;
		const left = this.input.isPressed( 'ArrowLeft' ) || this.input.isPressed( 'KeyA' );
		const right = this.input.isPressed( 'ArrowRight' ) || this.input.isPressed( 'KeyD' );
		const direction = right ? 1 : ( left ? - 1 : 0 );

		if ( spinner === undefined || direction === 0 ) {

			this.repeatDirection = 0;
			this.repeatTimer = 0;
			return;

		}

		if ( direction !== this.repeatDirection ) {

			this.repeatDirection = direction;
			this.repeatTimer = REPEAT_DELAY;
			this.step( spinner, direction );
			return;

		}

		this.repeatTimer -= delta;

		if ( this.repeatTimer <= 0 ) {

			this.repeatTimer = REPEAT_INTERVAL;
			this.step( spinner, direction );

		}

	}

	private step( spinner: NonNullable<MenuItem[ 'spinner' ]>, direction: number ): void {

		const value = Math.min( spinner.max(), Math.max( spinner.min(), spinner.get() + direction ) );

		if ( value === spinner.get() ) return;

		spinner.set( value );

		// Changing the player count changes how many control rows exist.
		if ( this.screen === 'control' ) this.build();
		else this.render();

		this.changed();

	}

	// -------------------------------------------------------------- drawing

	private render(): void {

		if ( this.rebinding !== null ) {

			const rotation = this.settings.rotation[ this.rebinding.player ] === 1;
			const names = rotation
				? [ 'ACCELERATION', 'ROTATE LEFT', 'ROTATE RIGHT' ]
				: [ 'UP', 'DOWN', 'LEFT', 'RIGHT' ];

			this.setRows( [
				`PLAYER:${ this.rebinding.player + 1 }`,
				`KEY:${ names[ this.rebinding.slot ] ?? '' }`,
				'ESC TO CANCEL'
			], - 1 );

			return;

		}

		this.setRows( this.items.map( item => item.label() ), this.selected );

	}

	/**
	 * Paints the rows and moves the selection rectangle onto the current one.
	 *
	 * The original drew every string twice — black one pixel down and right,
	 * then white on top — and marked the selection with two nested rectangles
	 * rather than by recolouring the text. Both are reproduced here.
	 */
	private setRows( labels: string[], selected: number ): void {

		const changed = labels.length !== this.rendered.length ||
			labels.some( ( label, i ) => label !== this.rendered[ i ] );

		if ( changed ) {

			for ( const element of this.list.querySelectorAll<HTMLElement>( '.bmp' ) ) {

				releaseBitmapText( element );

			}

			this.list.textContent = '';

			const arrow = getComputedStyle( this.root ).getPropertyValue( '--koules-arrow' ).trim() || '#eb8282';

			for ( const [ index, label ] of labels.entries() ) {

				const li = document.createElement( 'li' );
				li.dataset.index = String( index );

				const text = document.createElement( 'span' );
				text.className = 'bmp shadowed label';
				setBitmapText( text, label, this.textColor() );

				if ( this.items[ index ]?.spinner !== undefined && selected >= 0 ) {

					const less = document.createElement( 'span' );
					less.className = 'spinner';
					less.dataset.step = '-1';
					setBitmapArrow( less, 'left', arrow );

					const more = document.createElement( 'span' );
					more.className = 'spinner';
					more.dataset.step = '1';
					setBitmapArrow( more, 'right', arrow );

					li.append( less, text, more );

				} else {

					li.append( text );

				}

				this.list.append( li );

			}

			this.rendered = labels;

		} else {

			// Only the text changed — repaint in place rather than rebuilding.
			const rows = this.list.children;

			for ( const [ index, label ] of labels.entries() ) {

				const text = rows[ index ]?.querySelector<HTMLElement>( '.label' );
				if ( text !== null && text !== undefined ) setBitmapText( text, label, this.textColor() );

			}

		}

		this.moveSelector( selected );

	}

	private textColor(): string {

		return getComputedStyle( this.root ).getPropertyValue( '--koules-text' ).trim() || '#ffffff';

	}

	/** `fit_selector()` — slides the rectangle onto the chosen row. */
	private moveSelector( selected: number ): void {

		const row = selected >= 0 ? this.list.children[ selected ] as HTMLElement | undefined : undefined;
		const label = row?.querySelector<HTMLElement>( '.label' );

		if ( label === null || label === undefined ) {

			this.selector.classList.remove( 'visible' );
			return;

		}

		// Measured against the selector's own containing block rather than via
		// `offsetLeft`, whose parent is the row and so would always read zero.
		const origin = this.selector.parentElement;
		if ( origin === null ) return;

		const from = origin.getBoundingClientRect();
		const box = label.getBoundingClientRect();

		// The original padded the text box by two pixels left and top and one
		// right, then drew the second rectangle a pixel further on again.
		const pad = 2;

		this.selector.style.transform = `translate(${ box.left - from.left - pad }px, ${ box.top - from.top - pad }px)`;
		this.selector.style.width = `${ box.width + pad * 2 }px`;
		this.selector.style.height = `${ box.height + pad * 2 }px`;
		this.selector.classList.add( 'visible' );

	}

	/** Repaints everything at a new bitmap scale. */
	rescale(): void {

		this.rendered = [];
		this.render();

	}

	private readonly onClick = ( event: MouseEvent ): void => {

		const target = event.target as HTMLElement | null;
		if ( target === null ) return;

		const row = target.closest( 'li' );
		if ( row === null ) return;

		const index = Number( row.dataset.index );
		if ( ! Number.isFinite( index ) ) return;

		this.selected = index;

		const step = target.dataset.step;

		if ( step !== undefined ) {

			const spinner = this.items[ index ]?.spinner;
			if ( spinner !== undefined ) this.step( spinner, Number( step ) );
			return;

		}

		this.render();
		this.items[ index ]?.activate?.();

	};


}

function sameScheme( a: Scheme, b: Scheme ): boolean {

	if ( a.kind !== b.kind ) return false;
	if ( a.kind === 'gamepad' && b.kind === 'gamepad' ) return a.slot === b.slot && a.deflection === b.deflection;

	return true;

}

function usesKeyboard( scheme: Scheme ): boolean {

	return scheme.kind === 'keyboard' || scheme.kind === 'rotation';

}

function describeScheme( scheme: Scheme, connected = true ): string {

	switch ( scheme.kind ) {

		case 'keyboard': return 'KEYBOARD';
		case 'rotation': return 'ROTATION KEYBOARD';
		case 'mouse': return 'MOUSE';
		case 'gamepad': {

			const name = `GAMEPAD ${ scheme.slot === 0 ? 'A' : 'B' }`;
			// An unplugged pad falls back to the keyboard in play, so say so
			// here rather than letting the player think they are bound.
			return connected ? `${ name } ${ scheme.deflection ? 'deflection' : 'button' }` : `${ name } NOT CONNECTED`;

		}

		default: return 'KEYBOARD';

	}

}
