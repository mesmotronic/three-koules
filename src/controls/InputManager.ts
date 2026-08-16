// SPDX-FileCopyrightText: © 2013 Lubomir Rintel
// SPDX-FileCopyrightText: © 1997 Ludvik Tesar
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { Xpad } from '@mesmotronic/xpad';

/**
 * Keyboard, pointer and gamepad polling.
 *
 * Replaces `sdl/input.c` and `joystick.h`. The original asked the joystick
 * driver for raw ADC counts and made the player calibrate the centre and
 * extents from a menu before it could steer; pads report normalised axes, so
 * calibration is gone entirely.
 *
 * Pads go through Xpad, which applies a dead zone and folds the left stick,
 * right stick and D-pad into one `anyStick` reading. That suits Koules, whose
 * steering is a single direction vector and whose original joystick support was
 * digital anyway — a player can use whichever input falls to hand.
 */
export class InputManager {

	/**
	 * The two joystick slots the original supported, as pads 0 and 1.
	 *
	 * Xpad keys off the raw `navigator.getGamepads()` index rather than the
	 * nth connected pad, so a slot keeps its identity across a disconnect.
	 */
	private readonly pads: readonly Xpad[] = [ new Xpad( 0 ), new Xpad( 1 ) ];

	/** Codes currently held. */
	private readonly held = new Set<string>();

	/** Codes that went down this frame, cleared by {@link endFrame}. */
	private readonly edges = new Set<string>();

	/** When set, the next keydown is captured for rebinding instead. */
	private capture: ( ( code: string ) => void ) | null = null;

	/** Pointer position in playfield units, and whether it is over the field. */
	pointerX = 0;
	pointerY = 0;
	pointerInside = false;
	pointerDown = false;

	/**
	 * Virtual stick for touch play.
	 *
	 * Wherever the finger lands becomes the centre, and displacement from it
	 * steers exactly as a physical stick would — which maps straight onto the
	 * "accelerate by deflection" mode Ludvik Tesar added in 1997, so the touch
	 * path needs no special case in the simulation.
	 */
	stickActive = false;
	stickX = 0;
	stickY = 0;

	/** Where the finger went down and where it is now, in CSS pixels. */
	stickOriginX = 0;
	stickOriginY = 0;
	stickCurrentX = 0;
	stickCurrentY = 0;

	/** Displacement giving full deflection, set from the playfield size. */
	stickRadius = 64;

	/** The pointer currently driving the stick, if any. */
	private stickPointer = - 1;

	/** Projected playfield rect in CSS pixels, kept in step by the app. */
	private rectLeft = 0;
	private rectTop = 0;
	private rectSize = 1;

	private bound = false;

	constructor( private readonly domElement: HTMLElement = document.body ) {}

	connect(): void {

		if ( this.bound ) return;
		this.bound = true;

		window.addEventListener( 'keydown', this.onKeyDown, { passive: false } );
		window.addEventListener( 'keyup', this.onKeyUp );
		window.addEventListener( 'blur', this.onBlur );

		this.domElement.addEventListener( 'pointermove', this.onPointerMove );
		this.domElement.addEventListener( 'pointerdown', this.onPointerDown );
		window.addEventListener( 'pointerup', this.onPointerUp );

	}

	/**
	 * Releases the keyboard and pointer listeners.
	 *
	 * The pads are left in place: Xpad binds `gamepadconnected` in its
	 * constructor and offers no way to unbind, and the two instances live for
	 * the lifetime of the page anyway.
	 */
	dispose(): void {

		if ( ! this.bound ) return;
		this.bound = false;

		window.removeEventListener( 'keydown', this.onKeyDown );
		window.removeEventListener( 'keyup', this.onKeyUp );
		window.removeEventListener( 'blur', this.onBlur );

		this.domElement.removeEventListener( 'pointermove', this.onPointerMove );
		this.domElement.removeEventListener( 'pointerdown', this.onPointerDown );
		window.removeEventListener( 'pointerup', this.onPointerUp );

	}

	// --------------------------------------------------------------- queries

	/** `IsPressed()`. */
	isPressed( code: string ): boolean {

		return this.held.has( code );

	}

	/** True only on the frame a key went down. */
	wasPressed( code: string ): boolean {

		return this.edges.has( code );

	}

	/** `Pressed()` — is anything at all held? */
	get anyHeld(): boolean {

		return this.held.size > 0 || this.pointerDown;

	}

	/** True on the frame any key or pointer button went down. */
	get anyEdge(): boolean {

		return this.edges.size > 0;

	}

	/** Grabs the next keypress for rebinding, as `keys_keys()` did. */
	captureNextKey( handler: ( code: string ) => void ): void {

		this.capture = handler;

	}

	cancelCapture(): void {

		this.capture = null;

	}

	get isCapturing(): boolean {

		return this.capture !== null;

	}

	/** Called by the app after every frame's input has been consumed. */
	endFrame(): void {

		this.edges.clear();

	}

	/** Tells the pointer mapping where the playfield square landed on screen. */
	setPlayfieldRect( left: number, top: number, size: number ): void {

		this.rectLeft = left;
		this.rectTop = top;
		this.rectSize = Math.max( 1, size );

		// Full deflection at a fifth of the sector's width: far enough that
		// fine steering is possible, close enough for a thumb.
		this.stickRadius = Math.max( 40, this.rectSize * 0.2 );

	}

	/**
	 * Refreshes both pads. Call once per rendered frame.
	 *
	 * Deliberately not called from the fixed timestep loop: that can run zero
	 * or several times a frame, and a pad only has one reading to give.
	 */
	update(): void {

		for ( const pad of this.pads ) pad.update();

	}

	/** The pad bound to a joystick slot, whether or not it is plugged in. */
	gamepad( slot: number ): Xpad | null {

		return this.pads[ slot ] ?? null;

	}

	/** Whether the pad in this joystick slot is currently plugged in. */
	hasGamepad( slot: number ): boolean {

		return this.pads[ slot ]?.connected === true;

	}

	// ---------------------------------------------------------------- events

	private readonly onKeyDown = ( event: KeyboardEvent ): void => {

		// Arrows and space scroll the page; the game wants them.
		if ( SWALLOWED.has( event.code ) ) event.preventDefault();

		if ( this.capture !== null ) {

			// Escape backs out of rebinding rather than being bound.
			if ( event.code !== 'Escape' ) {

				const handler = this.capture;
				this.capture = null;
				handler( event.code );
				return;

			}

			this.capture = null;

		}

		if ( event.repeat ) return;

		this.held.add( event.code );
		this.edges.add( event.code );

	};

	private readonly onKeyUp = ( event: KeyboardEvent ): void => {

		this.held.delete( event.code );

	};

	/** Losing focus mid-thrust would otherwise leave a key stuck down. */
	private readonly onBlur = (): void => {

		this.held.clear();
		this.pointerDown = false;

	};

	private readonly onPointerMove = ( event: PointerEvent ): void => {

		if ( event.pointerId === this.stickPointer ) {

			this.stickCurrentX = event.clientX;
			this.stickCurrentY = event.clientY;
			this.updateStick();
			return;

		}

		const x = ( ( event.clientX - this.rectLeft ) / this.rectSize );
		const y = ( ( event.clientY - this.rectTop ) / this.rectSize );

		this.pointerInside = x >= 0 && x <= 1 && y >= 0 && y <= 1;

		// Reported in playfield units, matching `MouseX() * DIV`.
		this.pointerX = x * 640;
		this.pointerY = y * 640;

	};

	private readonly onPointerDown = ( event: PointerEvent ): void => {

		// A tap counts as a keypress, so it can skip a crawl or dismiss a
		// banner the same way the space bar does.
		this.edges.add( 'Pointer' );

		if ( event.pointerType === 'touch' && this.stickPointer === - 1 ) {

			this.stickPointer = event.pointerId;
			this.stickOriginX = this.stickCurrentX = event.clientX;
			this.stickOriginY = this.stickCurrentY = event.clientY;
			this.updateStick();
			return;

		}

		this.onPointerMove( event );
		this.pointerDown = true;

	};

	private readonly onPointerUp = ( event: PointerEvent ): void => {

		if ( event.pointerId === this.stickPointer ) {

			this.stickPointer = - 1;
			this.stickActive = false;
			this.stickX = 0;
			this.stickY = 0;
			return;

		}

		this.pointerDown = false;

	};

	/** Recomputes the stick vector, clamped to the unit circle. */
	private updateStick(): void {

		const dx = ( this.stickCurrentX - this.stickOriginX ) / this.stickRadius;
		const dy = ( this.stickCurrentY - this.stickOriginY ) / this.stickRadius;
		const length = Math.hypot( dx, dy );

		if ( length > 1 ) {

			this.stickX = dx / length;
			this.stickY = dy / length;

		} else {

			this.stickX = dx;
			this.stickY = dy;

		}

		this.stickActive = true;

	}

	/** True when the device reports a touchscreen. */
	get hasTouch(): boolean {

		return navigator.maxTouchPoints > 0;

	}

}

/** Keys whose default browser behaviour gets in the way of playing. */
const SWALLOWED = new Set( [
	'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'Space', 'Tab', 'Enter',
	'Numpad4', 'Numpad5', 'Numpad6', 'Numpad8'
] );
