// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2013 Lubomir Rintel
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	Color,
	MathUtils,
	Scene,
	Vector3,
	WebGPURenderer
} from 'three/webgpu';

import {
	ControlType,
	GAME_WIDTH,
	GameMode,
	ObjectType,
	TICK_MS,
	ViewMode
} from './core/Constants.js';
import { submitScores, type HighScore } from './core/HighScores.js';
import { loadSettings, saveSettings, type SettingsData } from './core/Settings.js';
import { CameraDirector } from './controls/CameraDirector.js';
import { TOP_FOV } from './controls/CameraView.js';
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
import { setBloomTagging } from './materials/BodyMaterials.js';
import { createBloomPipeline, type BloomPipeline } from './postprocessing/BloomPipeline.js';
import { HelpLabels, type Project } from './ui/HelpLabels.js';
import { Hud } from './ui/Hud.js';
import { Menu } from './ui/Menu.js';
import { SoundButton } from './ui/SoundButton.js';
import { ViewSelector } from './ui/ViewSelector.js';
import { briefings, introCrawl, outro2Crawl } from './misc/TextData.js';
import { bitmapLineHeight, paintStaticText, setBitmapText, updateBitmapScale } from './ui/BitmapText.js';
import { applyTheme } from './ui/Theme.js';

/** Gap above and below the status line, in CSS pixels. */
const HUD_GAP = 10;

/**
 * Ceiling on the drawing buffer's density.
 *
 * Viewports and scissor rectangles are given to the renderer in logical
 * pixels — it scales them by this itself — so nothing else in the layout has
 * to know about it.
 */
const MAX_PIXEL_RATIO = 2;

/** What the app is doing between simulation ticks. */
type Phase = 'idle' | 'crawl' | 'banner' | 'live';

const _projected = new Vector3();

/** Reused result of {@link Koules.project}; valid until the next call. */
const _screen = { x: 0, y: 0 };

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
	private readonly director = new CameraDirector();

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
	private readonly viewSelector: ViewSelector;
	private readonly soundButton: SoundButton;

	private readonly playfieldEl: HTMLElement;
	private readonly bannerEl: HTMLElement;
	private readonly hudEl: HTMLElement;

	// --- frame pacing ------------------------------------------------------

	private accumulator = 0;
	/** Previous frame's timestamp; negative until the loop has run once. */
	private lastTime = - 1;
	private elapsed = 0;

	private phase: Phase = 'idle';
	private paused = false;

	/** Crawls still to play before the simulation resumes. */
	private crawlQueue: readonly ( readonly string[] )[] = [];
	private introChoreography = false;

	private bannerTimer = 0;

	/** Set while the boss has been beaten and the ending is queued. */
	private endingQueued = false;

	/** True between starting a game and filing its score. */
	private runActive = false;

	/** Deepest sector this run reached, one based, for the score table. */
	private runSector = 1;

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
		this.renderer.shadowMap.enabled = true;
		container.append( this.renderer.domElement );

		this.scene.background = new Color( 0x04050a );

		// Walked once a frame from `drawViewports`, rather than once per call to
		// `render` — which, with split screen and a shadow pass, is up to eight
		// times over the same graph for the same answer.
		this.scene.matrixWorldAutoUpdate = false;

		this.input = new InputManager( this.renderer.domElement );
		this.intro = new IntroSequence( this.game.particles, sample => this.sound.play( sample ) );

		// --- scene graph ----------------------------------------------------

		this.scene.add( this.starfield, this.playfield, this.springs, this.particles, this.crawl, this.intro );

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
		this.soundButton = new SoundButton( required( 'sound' ), blocked => this.toggleSound( blocked ) );

		this.viewSelector = new ViewSelector( required( 'views' ), mode => {

			// `updateCamera` is the only thing that moves the director, so this
			// only has to record the intent.
			this.settings.view = mode;
			this.persist();

		} );

		this.menu = new Menu( required( 'menu' ), required( 'menu-items' ), this.game, this.settings, this.input, {
			onStart: () => this.startGame(),
			onQuit: () => this.quit(),
			onPersist: () => this.persist(),
			onSettingsChanged: () => this.applySettings(),
			onResume: () => this.setPaused( false ),
			onAbandon: () => this.toMenu()
		} );

		// --- wiring ---------------------------------------------------------

		this.game.onSound = sample => this.sound.play( sample );
		this.game.onPersist = () => this.persist();
		this.game.onWallImpact = () => this.playfield.pulse();

		this.applySettings();

		window.addEventListener( 'resize', this.onResize );

	}

	/** Brings up WebGPU and decodes the samples. */
	async init(): Promise<void> {

		await this.renderer.init();

		this.bloom = createBloomPipeline( this.renderer, this.scene, this.director.primaryCamera );
		this.bloom.setEnabled( this.settings.bloom );

		this.onResize();

		await this.sound.load();

	}

	/** Called from the start gate, once the browser will let audio through. */
	start(): void {

		this.input.connect();
		this.sound.resume();
		this.sound.unlockOnGesture();

		// `main()` ran the crawl before anything else.
		this.game.reset();
		this.game.gamemode = GameMode.MENU;
		this.game.sound = true;

		this.introChoreography = true;
		this.crawlQueue = [ introCrawl ];
		this.advance();

		this.lastTime = - 1;
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

		this.sound.enabled = settings.sound;

		// `draw_menu()` silenced the game whenever the menu was up, so a change
		// made mid-game takes effect and one made in the menu does not.
		game.sound = game.gamemode === GameMode.GAME && settings.sound;
		this.bloom?.setEnabled( settings.bloom );

		// The menu offers the point of view too, so the buttons follow it.
		this.viewSelector.mode = settings.view;

	}

	// ---------------------------------------------------------- state moves

	/** `start()` in `menu.c`. */
	private startGame(): void {

		const { game } = this;

		for ( let i = 0; i < game.nrockets; i ++ ) game.objects[ i ].score = 0;

		game.sound = this.settings.sound;
		game.gamemode = GameMode.GAME;
		this.runActive = true;
		this.runSector = game.plan.lastLevel + 1;
		this.director.snap();
		game.plan.init();
		game.plan.initObjects();

		this.menu.visible = false;
		this.processPending();

	}

	/**
	 * `quit()`. A browser tab cannot close itself, so the closest honest thing
	 * is to put the game back where it started: the opening crawl.
	 */
	private quit(): void {

		this.endRun();
		this.persist();

		this.game.reset();
		this.game.gamemode = GameMode.MENU;
		this.game.sound = true;
		this.menu.visible = false;

		this.introChoreography = true;
		this.crawlQueue = [ introCrawl ];
		this.bannerTimer = 0;
		this.advance();

	}


	/**
	 * The sound switch, and the browser's gesture requirement with it.
	 *
	 * A blocked context is not the same as sound being off, so a click on a
	 * button that was asking to be unblocked turns sound on rather than
	 * toggling a preference the player never set.
	 *
	 * @param wasBlocked - What the button was showing when it was clicked.
	 */
	private toggleSound( wasBlocked: boolean ): void {

		this.sound.resume();
		this.settings.sound = wasBlocked ? true : ! this.settings.sound;

		this.applySettings();
		this.persist();
		this.menu.refresh();

	}

	/** Opens or closes the pause screen. */
	private setPaused( paused: boolean ): void {

		this.paused = paused;

		if ( paused ) this.menu.showPause();
		else this.menu.toMain();

		this.menu.visible = paused;

	}

	/**
	 * Files the run that has just ended.
	 *
	 * A cooperative game has no ending short of sector one hundred, so a run is
	 * whatever the player played before walking away from it. Every ship's
	 * score is filed separately: in deathmatch they were competing, and in
	 * co-op they each earned their own.
	 */
	private endRun(): void {

		if ( ! this.runActive ) return;
		this.runActive = false;

		const { game } = this;
		const runs: HighScore[] = [];

		for ( let i = 0; i < game.nrockets; i ++ ) {

			runs.push( { score: game.objects[ i ].score, sector: this.runSector } );

		}

		submitScores( game.gameplan, runs );

	}

	/** Returns to the menu, leaving the field running as attract mode. */
	private toMenu(): void {

		this.endRun();

		// `draw_menu()` silenced the game the moment the menu appeared.
		this.paused = false;
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

	/**
	 * @param time - The frame's timestamp, from the renderer.
	 *
	 * Taken from the argument rather than read off `performance.now()`: under
	 * an XR session the loop is driven by the headset's own clock, and mixing
	 * the two would put a step in the delta on the first frame after entering
	 * or leaving one.
	 */
	private readonly animate = ( time: number ): void => {

		// The sentinel keeps the first frame from inheriting the whole gap
		// between construction and the loop actually starting.
		const delta = this.lastTime < 0 ? 0 : Math.min( 0.25, ( time - this.lastTime ) / 1000 );
		this.lastTime = time;
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

		// Points of view: 1 to 4 pick one, V steps through them.
		if ( game.gamemode === GameMode.GAME && this.phase === 'live' ) {

			for ( const [ index, code ] of [ 'Digit1', 'Digit2', 'Digit3', 'Digit4' ].entries() ) {

				if ( input.wasPressed( code ) ) this.viewSelector.choose( index as ViewMode );

			}

			if ( input.wasPressed( 'KeyV' ) ) this.viewSelector.cycle();

		}

		// `IsPressedP()` froze everything until the next keypress; now it opens
		// a proper screen instead, so sound and the view can be changed there.
		if ( input.wasPressed( 'KeyP' ) && game.gamemode === GameMode.GAME && this.phase === 'live' ) {

			this.setPaused( ! this.paused );

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

		} else if ( this.paused ) {

			// The pause screen is the menu, so it still needs driving even
			// though the sector behind it is stopped.
			this.menu.update( delta );
			return;

		} else if ( this.input.wasPressed( 'Escape' ) ) {

			this.toMenu();
			return;

		}

		this.stepClock( delta, () => {

			this.pollControls();
			game.tick();

			// Finishing resets the level counter, so the run's own high-water
			// mark is what the score table wants.
			if ( game.plan.level + 1 > this.runSector ) this.runSector = game.plan.level + 1;

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

			// In the following views the camera turns with the ship, so "up"
			// has to mean "away from the camera" or the controls stop making
			// sense. Each split-screen viewport has its own idea of which way
			// that is.
			const offset = this.director.headingOffset( i );

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
				control.heading = offset;

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
				control.heading = offset;
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
				control.heading = offset;

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

				// Rotation steering is already relative to the ship, so it needs
				// no help from the camera.
				control.type = ControlType.RKEYBOARD;
				control.mask = mask;
				control.heading = 0;

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
				control.heading = offset;

			}

		}

	}

	// --------------------------------------------------------------- camera

	private baseDistance = 1000;

	/**
	 * Hands the camera to the director.
	 *
	 * The overhead view is forced for a crawl and for the menu, and for nothing
	 * else. A crawl is laid out against this camera — `setViewport` sizes the
	 * scroller from the same distance and field of view — so a moved camera
	 * would fight the original's own projection; and the menu's overlay is
	 * placed against the projected square.
	 *
	 * A banner is not either of those. Forcing it overhead too meant the camera
	 * flew home and back for every sector title and every death, so a player who
	 * had chosen a view spent the pauses being taken out of it and returned.
	 * Now the choice is flown to as soon as the sector is announced, and dying
	 * leaves the camera where it was.
	 */
	private updateCamera( delta: number ): void {

		const { game } = this;
		const overhead = this.phase === 'crawl' || game.gamemode !== GameMode.GAME;

		this.director.driftEnabled = this.settings.cameraMotion && this.phase !== 'crawl';

		// The ships are handed over in place, with a count: following views take
		// one viewport each, and everything else shares one.
		this.director.update(
			delta,
			this.elapsed,
			overhead ? ViewMode.TOP : this.viewSelector.mode,
			game.objects,
			game.nrockets
		);

		this.particles.setFov( this.director.primaryCamera.fov );

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

		// Re-read on every resize, not just at startup: dragging the window to
		// a display of a different density changes it, as does browser zoom,
		// and both arrive as nothing but a resize. Capped at two — a phone
		// reporting three would triple the fill cost for a difference nobody
		// can see at this scale.
		this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, MAX_PIXEL_RATIO ) );
		this.renderer.setSize( width, height );

		const tan = Math.tan( MathUtils.degToRad( TOP_FOV ) / 2 );

		// Type steps in whole pixels, so settle its scale before measuring the
		// status line that depends on it.
		const provisional = Math.min( width, height );

		// `updateBitmapScale` redraws every string it has drawn before, so only
		// what it cannot reach needs saying here: text that has never been
		// painted, and the menu, whose spinner arrows are not strings and whose
		// selection rectangle has to be measured against the new type.
		if ( updateBitmapScale( provisional ) ) {

			paintStaticText();
			this.menu.rescale();

		}

		// Measured, not predicted: the scores wrap onto a third row with enough
		// players, and a stylesheet change would otherwise silently mis-size
		// the sector, the camera distance and the pointer mapping with it.
		const measured = this.hudEl.getBoundingClientRect().height;
		const hud = ( measured > 0 ? measured : bitmapLineHeight() * 2 ) + HUD_GAP * 2;
		const padding = Math.round( Math.min( width, height ) * ( provisional < 700 ? 0.015 : 0.04 ) );

		const size = Math.max( 160, Math.min( width - padding * 2, height - hud - padding * 2 ) );

		const pixelsPerUnit = size / GAME_WIDTH;
		this.baseDistance = ( height / 2 ) / ( pixelsPerUnit * tan );

		// Centre the sector and its status line together in the viewport. On a
		// tall screen it rides higher than centre, which leaves the space below
		// clear for a thumb without shrinking the sector.
		const slack = height - ( size + hud );
		const bias = width / height < 0.85 ? 0.3 : 0.5;

		this.rectSize = size;
		this.rectLeft = ( width - size ) / 2;
		this.rectTop = Math.max( padding, slack * bias );

		// World offset that puts the square where the layout wants it. A camera
		// below the axis renders the sector above centre, hence the negation.
		this.lift = ( height / 2 - ( this.rectTop + size / 2 ) ) / pixelsPerUnit;

		this.director.distance = this.baseDistance;
		this.director.lift = this.lift;

		// The angled view frames itself against the canvas, and only needs to
		// know how much of the bottom the scores are taking.
		this.director.statusFraction = Math.min( 0.4, hud / height );

		this.director.setCanvasAspect( width / height );

		// The crawl covers the whole window rather than the inset sector.
		const halfHeight = this.baseDistance * tan;
		this.crawl.setViewport( halfHeight * ( width / height ), halfHeight );

		this.playfieldEl.style.width = `${ size }px`;
		this.playfieldEl.style.height = `${ size }px`;
		// Offset with `top` rather than a transform: a transformed element
		// becomes the containing block for any fixed-position descendant, which
		// would trap the pause screen's full-canvas scrim inside the square.
		this.playfieldEl.style.top = `${ this.rectTop - ( height - size ) / 2 }px`;

		this.input.setPlayfieldRect( this.rectLeft, this.rectTop, size );
		this.particles.setFov( this.director.primaryCamera.fov );

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

		// From inside the ship you should not be able to see it.
		const hidden = this.director.mode === ViewMode.COCKPIT ? 0 : - 1;

		// Views are made as the sector needs them. The object array is 255 long
		// but a sector never holds more than thirty, and an unused view would
		// still have its world matrix recomposed every frame.
		const shown = inCrawl ? 0 : game.nobjects;

		for ( let i = 0; i < shown; i ++ ) {

			let view = this.views[ i ];

			if ( view === undefined ) {

				view = new ObjectView();
				this.views[ i ] = view;
				this.scene.add( view );

			}

			if ( i === hidden ) view.visible = false;
			else view.update( game.objects[ i ], i, alpha );

		}

		for ( let i = shown; i < this.views.length; i ++ ) this.views[ i ].visible = false;

		this.springs.visible = ! inCrawl;
		if ( ! inCrawl ) this.springs.update( game.objects, game.nobjects, alpha );

		this.particles.update( game.particles, this.paused ? 1 : alpha );

		this.hud.update( game );
		this.soundButton.update( this.settings.sound, this.sound.isRunning );
		this.viewSelector.visible = game.gamemode === GameMode.GAME && this.phase === 'live';
		// The annotations are placed against one projection, so they are only
		// offered when one camera covers the canvas.
		this.labels.update( this.director.isSingleView ? game : null, this.project, this.rectSize );
		this.updateStick();

		this.drawViewports();

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

	/**
	 * Draws every viewport.
	 *
	 * One view is the common case and goes straight through the bloom pipeline.
	 * Split screen scissors each player's slice of the canvas and draws it in
	 * turn; the post-processing graph is bound to a single camera, so the extra
	 * views are drawn plainly and give up the glow rather than the split.
	 *
	 * Whether the post-processing pass runs is decided here and nowhere else.
	 * Materials tagged for bloom write to a second render target that only that
	 * pass supplies, so a tagged material drawn straight to the canvas fails to
	 * compile; keeping the tag and the choice of path on the same line is what
	 * stops the two drifting apart.
	 */
	private drawViewports(): void {

		const { renderer, director } = this;
		const count = director.viewportCount;

		const post = count === 1 && this.settings.bloom ? this.bloom?.postProcessing ?? null : null;
		setBloomTagging( post !== null );

		// Recomposed once for the frame rather than once per `render()` call,
		// which for a four way split would mean walking every object, its eyes,
		// ring and decal, the starfield and the spring field eight times over.
		this.scene.updateMatrixWorld();

		// One request covers every viewport: the first to draw refreshes the
		// map and the others reuse it. Skipped while paused, where nothing has
		// moved since the last frame.
		if ( ! this.paused ) this.playfield.invalidateShadows();

		if ( count === 1 ) {

			renderer.setScissorTest( false );
			renderer.setViewport( 0, 0, this.viewWidth, this.viewHeight );

			if ( post !== null ) post.render();
			else renderer.render( this.scene, director.viewAt( 0 ).camera );

			return;

		}

		renderer.setScissorTest( true );

		for ( let i = 0; i < count; i ++ ) {

			const view = director.viewAt( i );

			const x = view.viewport.x * this.viewWidth;
			const y = view.viewport.y * this.viewHeight;
			const width = view.viewport.z * this.viewWidth;
			const height = view.viewport.w * this.viewHeight;

			renderer.setViewport( x, y, width, height );
			renderer.setScissor( x, y, width, height );
			renderer.render( this.scene, view.camera );

		}

		renderer.setScissorTest( false );

	}

	/**
	 * World point to pixels relative to the playfield overlay.
	 *
	 * Writes into a shared scratch rather than returning a fresh object: with
	 * help mode on this runs for every object and every tether, every frame.
	 */
	private readonly project: Project = ( x, y, z ) => {

		_projected.set( x, y, z ).project( this.director.primaryCamera );

		if ( _projected.z > 1 ) return null;

		_screen.x = ( _projected.x * 0.5 + 0.5 ) * this.viewWidth - this.rectLeft;
		_screen.y = ( - _projected.y * 0.5 + 0.5 ) * this.viewHeight - this.rectTop;

		return _screen;

	};

}

function required( id: string ): HTMLElement {

	const element = document.getElementById( id );
	if ( element === null ) throw new Error( `Missing element #${ id }` );

	return element;

}
