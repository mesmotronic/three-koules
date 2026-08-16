// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2013 Lubomir Rintel
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	Color,
	MathUtils,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGPURenderer
} from 'three/webgpu';

import {
	ControlType,
	GAME_HEIGHT,
	GAME_WIDTH,
	GameMode,
	MAX_ROCKETS,
	ObjectType,
	TICK_MS
} from './core/Constants.js';
import { loadSettings, saveSettings, type SettingsData } from './core/Settings.js';
import { InputManager } from './controls/InputManager.js';
import { Game } from './game/Game.js';
import { Crawl } from './objects/Crawl.js';
import { IntroSequence } from './objects/IntroSequence.js';
import { ObjectView } from './objects/ObjectView.js';
import { ParticleField } from './objects/ParticleField.js';
import { Playfield } from './objects/Playfield.js';
import { SpringField } from './objects/SpringField.js';
import { Starfield } from './objects/Starfield.js';
import { SoundManager } from './audio/SoundManager.js';
import { createBloomPipeline, type BloomPipeline } from './postprocessing/BloomPipeline.js';
import { HelpLabels } from './ui/HelpLabels.js';
import { Hud } from './ui/Hud.js';
import { Menu } from './ui/Menu.js';
import { briefings, introCrawl, outro2Crawl } from './misc/TextData.js';
import { bitmapLineHeight, paintStaticText, setBitmapText, updateBitmapScale } from './ui/BitmapText.js';
import { applyTheme } from './ui/Theme.js';

/** Vertical field of view. Wide enough to give depth, tight enough to read. */
const FOV = 35;

/** Gap above and below the status line, in CSS pixels. */
const HUD_GAP = 10;

/** What the app is doing between simulation ticks. */
type Phase = 'idle' | 'crawl' | 'banner' | 'live';

const _projected = new Vector3();

/**
 * The Koules application: window, renderer, clock and state machine.
 *
 * Stands in for `sdl/init.c`'s `main()` and the frame pacing in `koules.c`'s
 * `game()`. The simulation still advances in fixed 25 Hz steps exactly as it
 * did on a 1995 Linux box; the renderer runs as fast as the display allows and
 * interpolates between the last two ticks.
 */
export class Koules {

	private readonly renderer: WebGPURenderer;
	private readonly scene = new Scene();
	private readonly camera = new PerspectiveCamera( FOV, 1, 1, 6000 );

	private readonly game = new Game();
	private readonly input: InputManager;
	private readonly sound = new SoundManager();
	private readonly settings: SettingsData;

	private readonly playfield = new Playfield();
	private readonly starfield = new Starfield();
	private readonly particles = new ParticleField();
	private readonly springs = new SpringField();
	private readonly crawl = new Crawl();
	private readonly intro: IntroSequence;
	private readonly views: ObjectView[] = [];

	private bloom: BloomPipeline | null = null;

	private readonly menu: Menu;
	private readonly hud: Hud;
	private readonly labels: HelpLabels;

	private readonly playfieldEl: HTMLElement;
	private readonly bannerEl: HTMLElement;
	private readonly hudEl: HTMLElement;

	// --- frame pacing ------------------------------------------------------

	private accumulator = 0;
	private lastTime = 0;
	private elapsed = 0;

	private phase: Phase = 'idle';
	private paused = false;

	/** Crawls still to play before the simulation resumes. */
	private crawlQueue: readonly ( readonly string[] )[] = [];
	private introChoreography = false;

	private bannerTimer = 0;

	/** Set while the boss has been beaten and the ending is queued. */
	private endingQueued = false;

	// --- projection --------------------------------------------------------

	private viewWidth = 1;
	private viewHeight = 1;
	private rectLeft = 0;
	private rectTop = 0;
	private rectSize = 1;

	/** World units the sector sits above the viewport centre. */
	private lift = 0;

	private readonly stickEl: HTMLElement;
	private readonly stickBaseEl: HTMLElement;
	private readonly stickKnobEl: HTMLElement;

	constructor( container: HTMLElement ) {

		this.settings = loadSettings();

		this.renderer = new WebGPURenderer( { antialias: true } );
		this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		container.append( this.renderer.domElement );

		this.scene.background = new Color( 0x04050a );

		this.input = new InputManager( this.renderer.domElement );
		this.intro = new IntroSequence( this.game.particles, sample => this.sound.play( sample ) );

		// --- scene graph ----------------------------------------------------

		this.scene.add( this.starfield, this.playfield, this.springs, this.particles, this.crawl, this.intro );

		for ( let i = 0; i < this.game.objects.length; i ++ ) {

			const view = new ObjectView();
			this.views.push( view );
			this.scene.add( view );

		}

		// --- overlay --------------------------------------------------------

		this.playfieldEl = required( 'playfield' );
		this.bannerEl = required( 'banner' );
		this.hudEl = required( 'hud' );
		this.stickEl = required( 'stick' );
		this.stickBaseEl = required( 'stick-base' );
		this.stickKnobEl = required( 'stick-knob' );

		// Publish the game's palette to CSS, then paint the markup that declares
		// its own text, before anything measures the result.
		applyTheme();
		paintStaticText();

		this.hud = new Hud( required( 'hud-level' ), required( 'hud-players' ) );
		this.labels = new HelpLabels( required( 'labels' ) );

		this.menu = new Menu( required( 'menu' ), required( 'menu-items' ), this.game, this.settings, this.input, {
			onStart: () => this.startGame(),
			onQuit: () => this.quit(),
			onPersist: () => this.persist(),
			onSettingsChanged: () => this.applySettings()
		} );

		// --- wiring ---------------------------------------------------------

		this.game.onSound = sample => this.sound.play( sample );
		this.game.onPersist = () => this.persist();
		this.game.onWallImpact = () => this.playfield.pulse();

		this.applySettings();
		this.menu.syncGame();

		window.addEventListener( 'resize', this.onResize );

	}

	/** Brings up WebGPU and decodes the samples. */
	async init(): Promise<void> {

		await this.renderer.init();

		this.bloom = createBloomPipeline( this.renderer, this.scene, this.camera );
		this.bloom.setEnabled( this.settings.bloom );

		this.onResize();

		await this.sound.load();

	}

	/** Called from the start gate, once the browser will let audio through. */
	start(): void {

		this.input.connect();
		this.sound.resume();

		// `main()` ran the crawl before anything else.
		this.game.reset();
		this.game.gamemode = GameMode.MENU;
		this.game.sound = true;

		this.introChoreography = true;
		this.crawlQueue = [ introCrawl ];
		this.advance();

		this.lastTime = performance.now();
		this.renderer.setAnimationLoop( this.animate );

	}

	dispose(): void {

		this.renderer.setAnimationLoop( null );
		this.input.dispose();
		this.sound.dispose();
		window.removeEventListener( 'resize', this.onResize );

	}

	// ------------------------------------------------------------- settings

	private persist(): void {

		this.settings.lastLevel = this.game.plan.lastLevel;
		this.settings.maxLevel = this.game.plan.maxLevel;
		saveSettings( this.settings );

	}

	private applySettings(): void {

		const { game, settings } = this;

		game.nrockets = settings.nrockets;
		game.difficulty = settings.difficulty;
		game.gameplan = settings.gameplan;
		game.plan.lastLevel = settings.lastLevel;
		game.plan.maxLevel = settings.maxLevel;

		for ( let i = 0; i < MAX_ROCKETS; i ++ ) game.rotation[ i ] = settings.rotation[ i ];

		this.sound.enabled = settings.sound;
		this.bloom?.setEnabled( settings.bloom );

	}

	// ---------------------------------------------------------- state moves

	/** `start()` in `menu.c`. */
	private startGame(): void {

		const { game } = this;

		for ( let i = 0; i < game.nrockets; i ++ ) game.objects[ i ].score = 0;

		game.sound = this.settings.sound;
		game.gamemode = GameMode.GAME;
		game.plan.init();
		game.plan.initObjects();

		this.menu.visible = false;
		this.processPending();

	}

	/** `quit()`. A browser tab cannot close itself, so this drops to the gate. */
	private quit(): void {

		this.persist();
		this.dispose();
		document.getElementById( 'gate' )?.classList.remove( 'hidden' );

	}

	/** Returns to the menu, leaving the field running as attract mode. */
	private toMenu(): void {

		// `draw_menu()` silenced the game the moment the menu appeared.
		this.game.gamemode = GameMode.MENU;
		this.game.sound = false;
		this.menu.toMain();
		this.menu.visible = true;
		this.phase = 'live';

	}

	/** Picks up whatever `GamePlan` left for the app to present. */
	private processPending(): void {

		const pending = this.game.pending;
		if ( pending === null ) return;

		this.game.pending = null;

		this.crawlQueue = pending.intros
			.map( key => briefings[ key ] )
			.filter( ( lines ): lines is readonly string[] => lines !== undefined );

		this.bannerTimer = pending.banner.length > 0 ? 1 : 0;
		setBitmapText( this.bannerEl.querySelector( 'span' )!, pending.banner );

		this.advance();

	}

	/** Runs the next crawl, then the banner, then hands back to the game. */
	private advance(): void {

		if ( this.crawlQueue.length > 0 ) {

			const [ next, ...rest ] = this.crawlQueue;
			this.crawlQueue = rest;

			// The opening crawl can be skipped from the first frame; sector
			// briefings wait for a line, so a held key cannot blow past them.
			this.crawl.start( next, this.introChoreography );
			if ( this.introChoreography ) this.intro.start();

			this.setBanner( false );
			this.menu.visible = false;
			this.phase = 'crawl';
			return;

		}

		this.intro.stop();
		this.introChoreography = false;

		if ( this.bannerTimer > 0 ) {

			this.setBanner( true );
			this.phase = 'banner';
			return;

		}

		this.setBanner( false );

		if ( this.game.gamemode === GameMode.MENU ) this.toMenu();
		else this.phase = 'live';

	}

	private setBanner( visible: boolean, text?: string ): void {

		if ( text !== undefined ) setBitmapText( this.bannerEl.querySelector( 'span' )!, text );
		this.bannerEl.classList.toggle( 'visible', visible );

	}

	// ------------------------------------------------------------- the loop

	private readonly animate = (): void => {

		const now = performance.now();
		const delta = Math.min( 0.25, ( now - this.lastTime ) / 1000 );
		this.lastTime = now;
		this.elapsed += delta;

		// Pads are sampled once per frame, before anything reads them.
		this.input.update();
		this.readGlobalKeys();

		switch ( this.phase ) {

			case 'crawl': this.updateCrawl( delta ); break;
			case 'banner': this.updateBanner( delta ); break;
			case 'live': this.updateLive( delta ); break;
			default: break;

		}

		this.updateCamera( delta );
		this.render( delta );

		this.input.endFrame();

	};

	private readGlobalKeys(): void {

		const { input, game } = this;

		if ( input.isCapturing ) return;

		// `IsPressedH()` toggled the annotations.
		if ( input.wasPressed( 'KeyH' ) ) game.helpmode = ! game.helpmode;

		// `IsPressedP()` froze everything until the next keypress.
		if ( input.wasPressed( 'KeyP' ) && game.gamemode === GameMode.GAME && this.phase === 'live' ) {

			this.paused = ! this.paused;
			this.setBanner( this.paused, 'PAUSE' );

		}

	}

	private updateCrawl( delta: number ): void {

		const running = this.crawl.update( delta );
		this.intro.update( delta, this.crawl.actu );

		// Points keep flying while the crawl plays; the creator clouds that
		// assemble the ring and the ship are made of them.
		this.stepClock( delta, () => this.game.particles.update() );

		const skipped = this.crawl.canSkip && this.input.anyEdge;

		if ( ! running || skipped ) {

			this.crawl.stop();
			this.advance();

		}

	}

	private updateBanner( delta: number ): void {

		this.bannerTimer -= delta;

		if ( this.bannerTimer <= 0 ) {

			this.bannerTimer = 0;
			this.setBanner( false );
			this.phase = 'live';

		}

	}

	private updateLive( delta: number ): void {

		const { game } = this;

		if ( game.gamemode === GameMode.MENU ) {

			// The setter re-renders, so only poke it on an actual change.
			if ( ! this.menu.visible ) this.menu.visible = true;
			this.menu.update( delta );

			// Choosing START GAME queues a briefing; the simulation must not
			// take a step until that has played.
			if ( this.phase !== 'live' ) return;

		} else if ( this.input.wasPressed( 'Escape' ) ) {

			this.toMenu();
			return;

		}

		if ( this.paused ) return;

		this.stepClock( delta, () => {

			this.pollControls();
			game.tick();

			if ( game.finished && ! this.endingQueued ) {

				this.endingQueued = true;
				this.crawlQueue = [ outro2Crawl ];

			}

		} );

		if ( game.pending !== null ) {

			this.processPending();

		} else if ( this.endingQueued ) {

			this.endingQueued = false;
			game.finished = false;
			this.bannerTimer = 0;
			this.advance();

		}

	}

	/** Drains the fixed timestep accumulator, capped so a stall cannot spiral. */
	private stepClock( delta: number, step: () => void ): void {

		this.accumulator += delta * 1000;

		let steps = 0;

		while ( this.accumulator >= TICK_MS && steps < 5 ) {

			this.accumulator -= TICK_MS;
			steps ++;
			step();

		}

		if ( this.accumulator > TICK_MS * 5 ) this.accumulator = 0;

	}

	/** How far through the current tick the renderer should interpolate. */
	private get alpha(): number {

		return Math.min( 1, this.accumulator / TICK_MS );

	}

	// ---------------------------------------------------------------- input

	/** `process_keys()`'s GAME branch: fills in one control record per player. */
	private pollControls(): void {

		const { game, input, settings } = this;

		if ( game.gamemode !== GameMode.GAME ) return;

		for ( let i = 0; i < game.nrockets; i ++ ) {

			const control = game.controls[ i ];
			const object = game.objects[ i ];

			if ( object.type !== ObjectType.ROCKET ) continue;

			// --- touch --------------------------------------------------------

			// Wherever the finger landed is the centre of the stick, and the
			// displacement from it is the deflection. Solo play only: with two
			// players sharing a screen there is no way to tell whose thumb is
			// whose. It takes priority so a tap always steers.
			if ( i === 0 && game.nrockets === 1 && input.stickActive ) {

				control.type = ControlType.JOYSTICK1;
				control.jx = - input.stickX;
				control.jy = - input.stickY;
				control.mask = 0;

				// Matches the original's JOYMUL2, so a full push is full thrust.
				object.joymulx = 1.5;
				object.joymuly = 1.5;
				object.joythresh = 0.1;

				continue;

			}

			// --- pointer ------------------------------------------------------

			if ( settings.mousePlayer === i ) {

				control.type = ControlType.MOUSE;
				control.mx = input.pointerX;
				control.my = input.pointerY;
				control.mask = input.pointerDown ? 1 : 0;
				continue;

			}

			// --- gamepad ------------------------------------------------------

			const slot = settings.gamepadPlayer.indexOf( i );
			const pad = slot === - 1 ? null : input.gamepad( slot );

			// An unplugged pad drops through to the keyboard rather than
			// leaving the player inert, which is what the original did when
			// its joystick device stopped answering.
			if ( pad !== null && pad.connected ) {

				const { anyStick, anyButton } = pad.state;

				// The old driver reported raw counts relative to a calibrated
				// centre, so the original worked in `centre - reading`. Xpad is
				// already centred, dead-zoned and normalised; only the sign has
				// to be flipped to keep the same convention.
				control.type = ControlType.JOYSTICK1;
				control.jx = - anyStick.x;
				control.jy = - anyStick.y;
				control.mask = anyButton > 0 ? 1 : 0;

				// Zero multiplier is the original's "accelerate on the fire
				// button"; anything above is "accelerate by deflection".
				const mul = settings.gamepadMul[ slot ] ?? 1.5;
				object.joymulx = mul;
				object.joymuly = mul;
				object.joythresh = 0.1;

				continue;

			}

			// --- keyboard -----------------------------------------------------

			const keys = settings.keys[ i ] ?? [];
			const up = input.isPressed( keys[ 0 ] ?? '' );
			const down = input.isPressed( keys[ 1 ] ?? '' );
			const left = input.isPressed( keys[ 2 ] ?? '' );
			const right = input.isPressed( keys[ 3 ] ?? '' );

			if ( settings.rotation[ i ] ) {

				// Asteroids steering: keys 0..2 are thrust, left and right.
				let mask = 0;
				if ( down ) mask |= 1;
				if ( left ) mask |= 2;
				if ( up ) mask |= 4;

				control.type = ControlType.RKEYBOARD;
				control.mask = mask;

			} else {

				// Eight way steering; the mask is a direction, not a bitfield.
				let mask = 0;

				if ( left && up ) mask = 1;
				else if ( right && up ) mask = 2;
				else if ( down && right ) mask = 3;
				else if ( down && left ) mask = 4;
				else if ( left ) mask = 5;
				else if ( right ) mask = 6;
				else if ( up ) mask = 7;
				else if ( down ) mask = 8;

				control.type = ControlType.KEYBOARD;
				control.mask = mask;

			}

		}

	}

	// --------------------------------------------------------------- camera

	private baseDistance = 1000;

	/**
	 * A slow drift and breath, so the static top-down view has some life.
	 *
	 * Held perfectly still during a crawl: the scroller reproduces the
	 * original's own projection, and moving the camera would fight it.
	 */
	private updateCamera( delta: number ): void {

		void delta;

		const still = this.phase === 'crawl' || ! this.settings.cameraMotion;
		const t = this.elapsed;

		const swayX = still ? 0 : Math.sin( t * 0.13 ) * 9 + Math.sin( t * 0.31 ) * 2.5;
		const swayY = still ? 0 : Math.cos( t * 0.17 ) * 7;
		const breath = still ? 1 : 1 + Math.sin( t * 0.09 ) * 0.014;

		this.camera.position.set( swayX, - this.lift + swayY, this.baseDistance * breath );
		this.camera.lookAt( swayX * 0.35, - this.lift + swayY * 0.35, 0 );

	}

	/**
	 * Sizes the sector to the viewport and locks the overlay to it.
	 *
	 * Rather than framing the square with a fixed margin, this works out how
	 * much room the status line needs and gives the sector everything else. On
	 * a phone that reclaims most of the letterboxing; on a desktop the square
	 * still stops short of the edges because the window is wider than it is
	 * tall and the height runs out first.
	 */
	private readonly onResize = (): void => {

		const width = window.innerWidth;
		const height = window.innerHeight;

		this.viewWidth = width;
		this.viewHeight = height;

		this.renderer.setSize( width, height );

		const aspect = width / height;
		const tan = Math.tan( MathUtils.degToRad( FOV ) / 2 );

		// Type steps in whole pixels, so settle its scale before measuring the
		// status line that depends on it.
		const provisional = Math.min( width, height );

		if ( updateBitmapScale( provisional ) ) {

			paintStaticText();
			this.menu.rescale();

		}

		const hud = bitmapLineHeight() * 2 + HUD_GAP * 2;
		const padding = Math.round( Math.min( width, height ) * ( provisional < 700 ? 0.015 : 0.04 ) );

		const size = Math.max( 160, Math.min( width - padding * 2, height - hud - padding * 2 ) );

		const pixelsPerUnit = size / GAME_WIDTH;
		this.baseDistance = ( height / 2 ) / ( pixelsPerUnit * tan );
		this.camera.aspect = aspect;
		this.camera.updateProjectionMatrix();

		// Centre the sector and its status line together in the viewport. On a
		// tall screen it rides higher than centre, which leaves the space below
		// clear for a thumb without shrinking the sector.
		const slack = height - ( size + hud );
		const bias = aspect < 0.85 ? 0.3 : 0.5;

		this.rectSize = size;
		this.rectLeft = ( width - size ) / 2;
		this.rectTop = Math.max( padding, slack * bias );

		// World offset that puts the square where the layout wants it. A camera
		// below the axis renders the sector above centre, hence the negation.
		this.lift = ( height / 2 - ( this.rectTop + size / 2 ) ) / pixelsPerUnit;

		// The crawl covers the whole window rather than the inset sector.
		const halfHeight = this.baseDistance * tan;
		this.crawl.setViewport( halfHeight * aspect, halfHeight );

		this.playfieldEl.style.width = `${ size }px`;
		this.playfieldEl.style.height = `${ size }px`;
		this.playfieldEl.style.transform = `translate(0px, ${ this.rectTop - ( height - size ) / 2 }px)`;

		this.input.setPlayfieldRect( this.rectLeft, this.rectTop, size );
		this.particles.setPixelsPerUnit( pixelsPerUnit );

	};

	// -------------------------------------------------------------- drawing

	private render( delta: number ): void {

		const { game } = this;
		const alpha = this.paused || this.phase !== 'live' ? 1 : this.alpha;

		const inCrawl = this.phase === 'crawl';

		// The crawl owned the whole screen in the original; the sector and its
		// status line are put away while it plays.
		this.playfield.visible = ! inCrawl;
		this.playfield.update( delta );
		this.hudEl.style.visibility = inCrawl ? 'hidden' : '';
		this.starfield.setBrightness( inCrawl ? 1 : 0.45 );

		for ( let i = 0; i < this.views.length; i ++ ) {

			if ( inCrawl || i >= game.nobjects ) {

				this.views[ i ].visible = false;
				continue;

			}

			this.views[ i ].update( game.objects[ i ], i, alpha, toWorldX, toWorldY );

		}

		this.springs.visible = ! inCrawl;
		if ( ! inCrawl ) this.springs.update( game.objects, game.nobjects, alpha );

		this.particles.update( game.particles, this.paused ? 1 : alpha );

		this.hud.update( game );
		this.labels.update( game, this.project, this.rectSize );
		this.updateStick();

		if ( this.bloom !== null ) this.bloom.postProcessing.render();
		else this.renderer.render( this.scene, this.camera );

	}

	/** Shows where the virtual stick is anchored and how far it is pushed. */
	private updateStick(): void {

		const { input } = this;
		const showing = input.stickActive && this.phase === 'live' && this.game.gamemode === GameMode.GAME;

		this.stickEl.classList.toggle( 'visible', showing );
		if ( ! showing ) return;

		// The ring shows exactly how far the finger has to travel for full
		// deflection, so the control reads honestly rather than approximately.
		const radius = input.stickRadius;

		this.stickEl.style.transform = `translate(${ input.stickOriginX }px, ${ input.stickOriginY }px)`;
		this.stickBaseEl.style.width = `${ radius * 2 }px`;
		this.stickBaseEl.style.height = `${ radius * 2 }px`;
		this.stickKnobEl.style.width = `${ radius * 0.44 }px`;
		this.stickKnobEl.style.height = `${ radius * 0.44 }px`;
		this.stickKnobEl.style.transform =
			`translate(-50%, -50%) translate(${ input.stickX * radius }px, ${ input.stickY * radius }px)`;

	}

	/** World point to pixels relative to the playfield overlay. */
	private readonly project = ( x: number, y: number, z: number ): { x: number; y: number } | null => {

		_projected.set( x, y, z ).project( this.camera );

		if ( _projected.z > 1 ) return null;

		return {
			x: ( _projected.x * 0.5 + 0.5 ) * this.viewWidth - this.rectLeft,
			y: ( - _projected.y * 0.5 + 0.5 ) * this.viewHeight - this.rectTop
		};

	};

}

/** Playfield space has its origin in a corner and y pointing down. */
const toWorldX = ( x: number ): number => x - GAME_WIDTH / 2;
const toWorldY = ( y: number ): number => GAME_HEIGHT / 2 - y;

function required( id: string ): HTMLElement {

	const element = document.getElementById( id );
	if ( element === null ) throw new Error( `Missing element #${ id }` );

	return element;

}
