// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 1997 Ludvik Tesar
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	A_ADD,
	ControlType,
	DIFFICULTIES,
	GAME_HEIGHT,
	GAME_WIDTH,
	GameMode,
	GamePlanMode,
	INSPECTOR_M,
	LUNATIC_M,
	Letter,
	MAX_OBJECT,
	MAX_ROCKETS,
	M_ADD,
	ObjectType,
	RAD,
	ROCKET_COLOR,
	ROCKET_RADIUS,
	ROT_STEP,
	SPRING_SIZE,
	SPRING_STRENGTH,
	Sample,
	radiusOf
} from '../core/Constants.js';
import { chance, rand, randMod } from '../core/Random.js';
import { rocket as rocketRamp } from '../core/Palette.js';
import { GameObject } from './GameObject.js';
import { GamePlan } from './GamePlan.js';
import { ParticleSystem } from './ParticleSystem.js';

/** One player's steering input for the current tick, from `struct control`. */
export interface PlayerControl {
	type: ControlType;
	/** Gamepad stick, already centred. */
	jx: number;
	jy: number;
	/** Pointer position in playfield units. */
	mx: number;
	my: number;
	/** Direction bitmask, or button state, depending on {@link type}. */
	mask: number;
	/**
	 * Rotation to add to the resulting heading.
	 *
	 * Zero reproduces the original exactly, where a direction meant a direction
	 * in the sector. The camera-following views set it so that the player's
	 * input is read relative to where the camera is pointing.
	 */
	heading: number;
}

/** A narrative interlude the app must play before the simulation resumes. */
export interface Presentation {
	/** Scroller texts to run in order, keyed into `TextData`. */
	readonly intros: readonly string[];
	/** Centre-screen banner, e.g. `SECTOR 12`. */
	readonly banner: string;
}

/**
 * The Koules simulation: `koules.c` plus the object lifecycle from
 * `gameplan.c`, with rendering, input polling and timing lifted out.
 *
 * Ticks at a fixed 25 Hz exactly as the original did. Nothing in here touches
 * three.js — the renderer reads this state and interpolates between ticks.
 */
export class Game {

	readonly objects: GameObject[] = Array.from( { length: MAX_OBJECT }, () => new GameObject() );
	readonly particles = new ParticleSystem();
	readonly plan = new GamePlan( this );

	/** `controls[]` — filled in by the input layer before each tick. */
	readonly controls: PlayerControl[] = Array.from( { length: MAX_ROCKETS }, () => ( {
		type: ControlType.KEYBOARD, jx: 0, jy: 0, mx: 0, my: 0, mask: 0, heading: 0
	} ) );

	nobjects = 8;
	nrockets = 1;

	gamemode: GameMode = GameMode.MENU;
	gameplan: GamePlanMode = GamePlanMode.COOPERATIVE;
	difficulty = 2;

	/** Do koules spit tethers at players? Enabled past `SPRING_LEVEL`. */
	dosprings = false;
	/** One spit in `randsprings` collisions; falls with the level number. */
	randsprings = 40;

	sound = true;
	/** `helpmode` — the H key annotates every object on the field. */
	helpmode = false;

	// Live creature census, refreshed each tick by `updateValues()`.
	aBalls = 0;
	aBballs = 0;
	aRockets = 0;
	aHoles = 0;
	aEholes = 0;
	aApples = 0;
	aInspectors = 0;
	aLunatics = 0;

	// Difficulty derived tunables, set by `applyDifficulty()`.
	rocketSpeed = 1.2;
	ballSpeed = 1.2;
	bballSpeed = 1.2;
	slowdown = 0.8;
	gumm = 20;
	ballM = 3;
	lballM = 3;
	bballM = 8;
	appleM = 34;
	rocketM = 4;

	/** Set when the app must play an interlude before the next tick. */
	pending: Presentation | null = null;

	/** Raised for one tick when the run is over and the outro should play. */
	finished = false;

	/** Hooks supplied by the app. */
	onSound: ( sample: Sample ) => void = () => {};
	onPersist: () => void = () => {};
	/** Raised when something is destroyed against the sector wall. */
	onWallImpact: () => void = () => {};

	// --------------------------------------------------------------- tables

	/** `M()` — mass, which varies with difficulty. */
	massOf( type: ObjectType ): number {

		switch ( type ) {

			case ObjectType.APPLE: return this.appleM;
			case ObjectType.INSPECTOR: return INSPECTOR_M;
			case ObjectType.LUNATIC: return LUNATIC_M;
			case ObjectType.HOLE:
			case ObjectType.EHOLE: return this.bballM;
			case ObjectType.ROCKET: return this.rocketM;
			case ObjectType.BALL:
			case ObjectType.LBALL: return this.ballM;
			case ObjectType.BBALL: return this.bballM;
			default: return 0;

		}

	}

	/** `color()` — the palette ramp base an object explodes in. */
	static colorOf( type: ObjectType, index: number, letter: Letter ): number {

		switch ( type ) {

			case ObjectType.EHOLE: return 128;
			case ObjectType.HOLE: return 64;
			case ObjectType.ROCKET: return ROCKET_COLOR[ index ] ?? 64;
			case ObjectType.BALL: return 64;
			case ObjectType.LBALL:
				switch ( letter ) {

					case Letter.ACCEL: return 128;
					case Letter.GUMM: return 160;
					case Letter.THIEF: return 192;
					case Letter.FINDER: return 96;
					case Letter.TTOOL: return 96;
					// The C fell through to BBALL for an unknown letter.
					default: return 128;

				}

			case ObjectType.BBALL: return 128;
			case ObjectType.APPLE: return 64;
			case ObjectType.INSPECTOR: return 160;
			case ObjectType.LUNATIC: return 96;
			default: return 0;

		}

	}

	/** `init_objects()`'s difficulty switch. */
	applyDifficulty(): void {

		const d = DIFFICULTIES[ this.difficulty ] ?? DIFFICULTIES[ 2 ];

		this.rocketSpeed = d.rocketSpeed;
		this.ballSpeed = d.ballSpeed;
		this.bballSpeed = d.bballSpeed;
		this.slowdown = d.slowdown;
		this.gumm = d.gumm;
		this.ballM = d.ballM;
		this.lballM = d.lballM;
		this.bballM = d.bballM;
		this.appleM = d.appleM;
		this.rocketM = d.rocketM;

	}

	// ------------------------------------------------------------- geometry

	/** Scratch output of {@link normalize}, standing in for C's pointer args. */
	private nx = 0;
	private ny = 0;

	/** `normalize()` — rescale a vector to `size`, keeping its direction. */
	private normalize( x: number, y: number, size: number ): void {

		let length = Math.sqrt( x * x + y * y );
		if ( length === 0 ) length = 1;

		this.nx = ( x * size ) / length;
		this.ny = ( y * size ) / length;

	}

	/**
	 * `find_possition()` — a spawn point clear of everything already in play.
	 *
	 * Gives up after 10000 rejections, which is how a very full field quietly
	 * stops spawning rather than locking up.
	 */
	findSpawn( radius: number ): { x: number; y: number } | null {

		for ( let attempt = 0; attempt <= 10000; attempt ++ ) {

			const x1 = randMod( GAME_WIDTH - 60 ) + 30;
			const y1 = randMod( GAME_HEIGHT - 60 ) + 30;
			let clear = true;

			for ( let i = 0; i < this.nobjects; i ++ ) {

				const o = this.objects[ i ];
				const xp = x1 - o.x;
				const yp = y1 - o.y;
				const reach = radius + o.radius;

				if ( xp * xp + yp * yp < reach * reach ) {

					clear = false;
					break;

				}

			}

			if ( clear ) return { x: x1, y: y1 };

		}

		return null;

	}

	// ------------------------------------------------------------- particles

	/**
	 * `explosion()` — a ring of sparks sized to the object that died.
	 *
	 * The angular step is `2 / radius^2`, so the spark count grows with the
	 * object's area: a koule scatters ~200 points, the boss ~3200.
	 *
	 * The ring is given an elevation as well as a bearing, turning the
	 * original's disc into a sphere. The in-plane velocity is untouched, so it
	 * looks exactly as it always did from directly above.
	 */
	explosion( x: number, y: number, type: ObjectType, letter: Letter, index: number ): void {

		const radius = radiusOf( type );
		if ( radius <= 0 ) return;

		const base = Game.colorOf( type, index, letter );
		const step = ( RAD( 360 ) * 1 ) / radius / radius / Math.PI;

		for ( let a = 0; a < RAD( 360 ); a += step ) {

			// The original's speeds were 24.8 fixed point per tick.
			const speed = ( randMod( 3096 ) + 10 ) / 256;
			const elevation = ( randMod( 2000 ) / 1000 - 1 ) * speed * 0.7;

			this.particles.add(
				x, y,
				Math.sin( a ) * speed,
				Math.cos( a ) * speed,
				base + randMod( 16 ),
				randMod( 100 ) + 10,
				0,
				elevation
			);

		}

	}

	/**
	 * `creators_points()` — the inward collapsing cloud that precedes a spawn.
	 *
	 * Points are seeded uniformly across a disc filling the playfield and given
	 * exactly the velocity needed to converge on the spawn site in 50 ticks.
	 */
	private creatorPoints( radius: number, x1: number, y1: number, base: number ): void {

		const time = 50;
		const midX = GAME_WIDTH / 2;
		const midY = GAME_HEIGHT / 2;
		const r1 = Math.min( midX, midY );
		const r2 = r1 * r1;

		// `(r * radius / r1) / r * 0.9` reduces to a constant; the original
		// computed it per point via a square root that always cancelled out.
		const shrink = ( radius / r1 ) * 0.9;

		let z = Math.trunc( ( radius * radius * Math.PI ) );

		while ( z -- > 0 ) {

			let x = 0;
			let y = 0;

			do {

				x = randMod( GAME_WIDTH );
				y = randMod( GAME_HEIGHT );

			} while ( ( x - midX ) * ( x - midX ) + ( y - midY ) * ( y - midY ) > r2 );

			const x2 = x1 + ( x - midX ) * shrink;
			const y2 = y1 + ( y - midY ) * shrink;

			// Seeded off the plane and given exactly the velocity to arrive on
			// it, so the cloud collapses as a shell rather than a ring.
			const z = ( randMod( 2000 ) / 1000 - 1 ) * radius * 3;

			this.particles.add(
				x, y,
				( x2 - x ) / time,
				( y2 - y ) / time,
				base + randMod( 16 ),
				time,
				z,
				- z / time
			);

		}

	}

	// ------------------------------------------------------------- lifecycle

	/** `creator()` — schedule a new creature, announced by a particle swirl. */
	creator( type: ObjectType ): void {

		const base = Game.colorOf( type, 0, Letter.NONE );

		let i = this.nrockets;
		while ( i < this.nobjects && ( this.objects[ i ].live || this.objects[ i ].type === ObjectType.CREATOR ) ) i ++;

		if ( i >= MAX_OBJECT ) return;

		const spot = this.findSpawn( radiusOf( type ) );
		if ( spot === null ) return;

		const o = this.objects[ i ];
		o.teleport( spot.x, spot.y );

		if ( i >= this.nobjects ) this.nobjects = i + 1;

		o.live = 0;
		o.live1 = 1;
		o.lineto = - 1;
		o.ctype = type;
		o.fx = 0;
		o.fy = 0;
		o.time = 50;
		o.rotation = 0;
		o.type = ObjectType.CREATOR;
		o.M = this.massOf( type );
		o.radius = radiusOf( type );
		o.accel = this.rocketSpeed;
		o.letter = Letter.NONE;

		this.creatorPoints( o.radius, o.x, o.y, base );
		this.effect( Sample.CREATOR1 );

	}

	/** `creator_rocket()` — respawn a player somewhere safe. */
	creatorRocket( i: number ): void {

		const o = this.objects[ i ];
		const spot = this.findSpawn( ROCKET_RADIUS );
		if ( spot === null ) return;

		o.teleport( spot.x, spot.y );

		// Present in the original; `live1` only tracked `live` with sound on.
		if ( this.sound ) o.live1 = o.live;

		o.live = 0;
		o.thief = 0;
		o.ctype = ObjectType.ROCKET;
		o.lineto = - 1;
		o.fx = 0;
		o.fy = 0;
		o.time = 50;
		o.rotation = 0;
		o.type = ObjectType.CREATOR;
		o.M = this.rocketM;
		o.radius = ROCKET_RADIUS;
		o.accel = this.rocketSpeed;
		o.letter = Letter.NONE;

		this.creatorPoints( ROCKET_RADIUS, o.x, o.y, Game.colorOf( ObjectType.ROCKET, i, Letter.NONE ) );

	}

	/** `rocket_destroyed()` — deathmatch scoring for the survivors. */
	private rocketDestroyed( player: number ): void {

		if ( this.gamemode !== GameMode.GAME ) return;
		if ( this.gameplan !== GamePlanMode.DEATHMATCH ) return;
		if ( this.nrockets === 1 ) return;

		let alive = 0;
		let winner = 0;

		for ( let i = 0; i < this.nrockets; i ++ ) {

			const o = this.objects[ i ];

			if ( o.type === ObjectType.ROCKET && o.live && i !== player ) {

				o.score += 100;
				alive ++;
				winner = i;

			}

		}

		if ( alive === 1 ) this.objects[ winner ].score += 50;

	}

	/**
	 * `destroy()` — an object has left the sector, or fallen into a hole.
	 *
	 * Koules do not simply die: most of the time they leave a lettered pickup
	 * behind instead, which is where all of the player's upgrades come from.
	 */
	destroy( i: number ): void {

		const o = this.objects[ i ];

		// Nudge back inside and reverse, so the death throes stay on screen.
		if ( o.x - o.radius < 0 ) { o.x = o.radius + 1; o.fx *= - 1; }
		if ( o.y - o.radius < 0 ) { o.y = o.radius + 1; o.fy *= - 1; }
		if ( o.x + o.radius > GAME_WIDTH ) { o.x = GAME_WIDTH - o.radius - 1; o.fx *= - 1; }
		if ( o.y + o.radius > GAME_HEIGHT ) { o.y = GAME_HEIGHT - o.radius - 1; o.fy *= - 1; }

		switch ( o.type ) {

			case ObjectType.LBALL:

				this.effect( Sample.DESTROY_BALL );
				o.live = 0;
				this.explosion( o.x, o.y, o.type, o.letter, i );

				// A thief that dies past the finder level comes back reformed.
				if ( o.letter === Letter.THIEF && this.plan.allowFinder() ) {

					o.live = 1;
					o.letter = Letter.FINDER;

				}

				break;

			case ObjectType.APPLE:

				this.effect( Sample.DESTROY_ROCKET );
				o.live = 0;
				this.explosion( o.x, o.y, o.type, o.letter, i );
				break;

			case ObjectType.BALL:
			case ObjectType.EHOLE:
			case ObjectType.BBALL:
			case ObjectType.INSPECTOR:
			case ObjectType.LUNATIC: {

				this.effect( Sample.DESTROY_BALL );

				const roll = this.plan.createLetter();

				if ( roll !== 0 ) {

					o.type = ObjectType.LBALL;
					o.M = this.lballM;
					o.letter = [ Letter.NONE, Letter.ACCEL, Letter.GUMM, Letter.THIEF, Letter.FINDER, Letter.TTOOL ][ roll ] ?? Letter.NONE;

				} else {

					o.live = 0;
					this.explosion( o.x, o.y, o.type, o.letter, i );

				}

				break;

			}

			case ObjectType.ROCKET:

				this.effect( Sample.DESTROY_ROCKET );
				o.live1 --;
				o.live --;
				this.explosion( o.x, o.y, o.type, o.letter, i );
				this.rocketDestroyed( i );

				if ( o.live ) {

					o.fx = 0;
					o.fy = 0;
					o.rotation = 0;
					o.type = ObjectType.ROCKET;
					o.accel = this.rocketSpeed;
					this.creatorRocket( i );

				}

				break;

			default:
				break;

		}

	}

	/** `check_limit()` — anything touching the sector wall is destroyed. */
	private checkLimit(): void {

		for ( let i = 0; i < this.nobjects; i ++ ) {

			const o = this.objects[ i ];
			if ( ! o.live ) continue;

			if (
				o.x - o.radius < 0 || o.x + o.radius >= GAME_WIDTH ||
				o.y - o.radius <= 0 || o.y + o.radius >= GAME_HEIGHT
			) {

				this.onWallImpact();
				this.destroy( i );

			}

		}

	}

	/** `update_values()` — recount the creatures the level logic reacts to. */
	private updateValues(): void {

		this.aHoles = 0;
		this.aRockets = 0;
		this.aBalls = 0;
		this.aBballs = 0;
		this.aApples = 0;
		this.aEholes = 0;
		this.aInspectors = 0;
		this.aLunatics = 0;

		for ( let i = 0; i < this.nobjects; i ++ ) {

			const o = this.objects[ i ];

			// Creatures still materialising count too, so the level logic does
			// not queue up a second wave while the first is still arriving.
			if ( o.live ) this.census( o.type );
			if ( o.type === ObjectType.CREATOR ) this.census( o.ctype );

		}

	}

	private census( type: ObjectType ): void {

		switch ( type ) {

			case ObjectType.HOLE: this.aHoles ++; break;
			case ObjectType.EHOLE: this.aEholes ++; break;
			case ObjectType.ROCKET: this.aRockets ++; break;
			case ObjectType.LBALL:
			case ObjectType.BALL: this.aBalls ++; break;
			case ObjectType.BBALL: this.aBballs ++; break;
			case ObjectType.APPLE: this.aApples ++; break;
			case ObjectType.INSPECTOR: this.aInspectors ++; break;
			case ObjectType.LUNATIC: this.aLunatics ++; break;
			default: break;

		}

	}

	// ----------------------------------------------------------------- input

	/**
	 * `accel()` — thrust, plus the exhaust plume behind it.
	 *
	 * @param howmuch - 0..1. Anything above 1 is, per the original, cheating.
	 */
	accel( i: number, howmuch: number ): void {

		const o = this.objects[ i ];

		// Thrusting cancels spawn invulnerability.
		o.time = 0;
		o.fx += howmuch * Math.sin( o.rotation ) * o.accel;
		o.fy += howmuch * Math.cos( o.rotation ) * o.accel;

		for ( let y = 0; y < 5; y ++ ) {

			const p = RAD( randMod( 45 ) - 22 );

			this.particles.add(
				o.x,
				o.y,
				( ( o.fx - howmuch * Math.sin( o.rotation + p ) * o.accel * 10 ) * randMod( 512 ) ) / 256,
				( ( o.fy - howmuch * Math.cos( o.rotation + p ) * o.accel * 10 ) * randMod( 512 ) ) / 256,
				rocketRamp( randMod( 16 ) ),
				10,
				0,
				( randMod( 200 ) / 1000 - 0.1 ) * o.accel
			);

		}

	}

	/** `sprocess_keys()` — turn this tick's control state into thrust. */
	private processControls(): void {

		if ( this.gamemode !== GameMode.GAME ) return;

		for ( let i = 0; i < MAX_ROCKETS; i ++ ) {

			const o = this.objects[ i ];
			if ( ! o.live || o.type !== ObjectType.ROCKET ) continue;

			const c = this.controls[ i ];

			switch ( c.type ) {

				case ControlType.JOYSTICK1: {

					o.rotation = Game.headingFrom( c.jx, c.jy ) + c.heading;

					// Deflection sets the throttle; the fire button pins it open.
					let a = Math.hypot( c.jx * o.joymulx, c.jy * o.joymuly );
					if ( a > 1 || c.mask !== 0 ) a = 1;
					if ( a > o.joythresh ) this.accel( i, a );

					break;

				}

				case ControlType.MOUSE: {

					let dx = o.x - c.mx;
					const dy = o.y - c.my;
					if ( dx === 0 ) dx = 0.001;

					o.rotation = Game.headingFrom( dx, dy ) + c.heading;
					if ( c.mask ) this.accel( i, 1 );

					break;

				}

				case ControlType.RKEYBOARD:

					if ( c.mask & 1 ) o.rotation += ROT_STEP;
					if ( c.mask & 2 ) o.rotation -= ROT_STEP;
					if ( c.mask & 4 ) this.accel( i, 1 );

					break;

				case ControlType.KEYBOARD: {

					// Eight way steering: the mask is a direction, not a bitfield.
					const heading = [ 0, - 135, 135, 45, - 45, - 90, 90, 180, 0 ][ c.mask ];

					if ( c.mask >= 1 && c.mask <= 8 ) {

						o.rotation = RAD( heading ) + c.heading;
						this.accel( i, 1 );

					}

					break;

				}

				default:
					break;

			}

		}

	}

	/**
	 * The quadrant unwrap the original repeated for mice and joysticks.
	 *
	 * Returns a heading in the game's convention, where 0 points down the
	 * screen and angles increase anticlockwise.
	 */
	static headingFrom( x: number, y: number ): number {

		const a = Math.atan( Math.abs( y ) / Math.abs( x === 0 ? 0.001 : x ) );

		if ( x < 0 && y >= 0 ) return a + RAD( 90 );
		if ( x < 0 && y < 0 ) return RAD( 90 ) - a;
		if ( x >= 0 && y < 0 ) return a + RAD( 270 );

		return RAD( 270 ) - a;

	}

	// --------------------------------------------------------------- physics

	/**
	 * `update_forces()` — springs, hole gravity, koule steering and drag.
	 *
	 * Koules home in on the nearest player that is not still materialising,
	 * which is why a fresh respawn briefly goes unnoticed.
	 */
	private updateForces(): void {

		for ( let i = 0; i < this.nobjects; i ++ ) {

			const o = this.objects[ i ];
			if ( ! o.live ) continue;

			// --- spit tethers -------------------------------------------------

			if ( o.lineto !== - 1 ) {

				if ( ! this.objects[ o.lineto ].live || o.lineto === i ) {

					o.lineto = - 1;

				} else {

					const other = this.objects[ o.lineto ];
					let xp = o.x - other.x;
					let yp = o.y - other.y;

					// Integer maths throughout, as in the C.
					let force = Math.trunc( Math.sqrt( xp * xp + yp * yp ) );

					// In co-op the tether always pulls; in deathmatch it only
					// bites once stretched past twice its rest length.
					if ( force >= 2 * SPRING_SIZE || this.gameplan === GamePlanMode.COOPERATIVE ) {

						force = force - SPRING_SIZE;
						if ( force < 0 ) force *= 3;
						force = Math.trunc( force / SPRING_STRENGTH );

						this.normalize( xp, yp, ( force * this.ballSpeed ) / o.M );
						xp = this.nx;
						yp = this.ny;
						o.fx -= xp;
						o.fy -= yp;

						this.normalize( xp, yp, ( force * this.ballSpeed ) / other.M );
						xp = this.nx;
						yp = this.ny;
						other.fx += xp;
						other.fy += yp;

					}

				}

			}

			// --- spawn invulnerability ---------------------------------------

			if ( o.type === ObjectType.ROCKET && o.time ) o.time --;

			// --- magnetic holes drag players in ------------------------------

			if ( o.type === ObjectType.ROCKET && ! o.time ) {

				for ( let r = 0; r < this.nobjects; r ++ ) {

					const h = this.objects[ r ];
					if ( ! h.live || h.time || h.type !== ObjectType.EHOLE ) continue;

					const xp = h.x - o.x;
					const yp = h.y - o.y;
					const distance = Math.trunc( Math.sqrt( xp * xp + yp * yp ) );

					let gravity = ( this.ballSpeed * ( this.gameplan === GamePlanMode.COOPERATIVE ? 200 : 50 ) ) / distance;
					if ( ! ( gravity <= ( this.ballSpeed * 4 ) / 5 ) ) gravity = ( this.ballSpeed * 4 ) / 5;

					this.normalize( xp, yp, gravity );
					o.fx += this.nx;
					o.fy += this.ny;

				}

			}

			// --- koules hunt the nearest player -------------------------------

			if (
				o.type === ObjectType.BALL || o.type === ObjectType.LBALL ||
				o.type === ObjectType.BBALL || o.type === ObjectType.LUNATIC
			) {

				let d = 640 * 640;
				let target = - 1;

				for ( let r = 0; r < this.nrockets; r ++ ) {

					const p = this.objects[ r ];
					if ( ! p.live || p.time ) continue;

					const xp = p.x - o.x;
					const yp = p.y - o.y;

					if ( xp * xp + yp * yp < d ) {

						d = xp * xp + yp * yp;
						target = r;

					}

				}

				let xp: number;
				let yp: number;

				if ( target !== - 1 ) {

					xp = this.objects[ target ].x - o.x;
					yp = this.objects[ target ].y - o.y;

				} else {

					// With nobody in range they drift back to the middle.
					xp = GAME_WIDTH / 2 - o.x;
					yp = GAME_HEIGHT / 2 - o.y;

				}

				// `!rand () % 4` in the original parsed as `(!rand ()) % 4`, so
				// lunatics only ever jinked on the one-in-2^31 tick where rand
				// returned zero. Reproduced rather than repaired.
				if ( o.type === ObjectType.LUNATIC && rand() === 0 ) {

					xp = rand();
					yp = rand() + 1;

				}

				this.normalize( xp, yp, o.type === ObjectType.BBALL ? this.bballSpeed : this.ballSpeed );
				o.fx += this.nx;
				o.fy += this.ny;

			}

			// --- drag ---------------------------------------------------------

			o.fx *= this.slowdown;
			o.fy *= this.slowdown;

		}

	}

	/** Debounce so a pile-up plays one clack rather than thirty. */
	private colizeTime = 0;

	/**
	 * `colisions()` — the pairwise pass that is the whole game.
	 *
	 * Momentum is traded through the ratio of the two masses, so a heavy
	 * player shrugs koules off while a light one gets bullied.
	 */
	private collisions(): void {

		let colize = false;

		for ( let i = 0; i < this.nobjects; i ++ ) {

			const oi = this.objects[ i ];
			if ( ! oi.live ) continue;

			for ( let y = i + 1; y < this.nobjects; y ++ ) {

				const oy = this.objects[ y ];
				if ( ! oy.live ) continue;

				let xp = oy.x - oi.x;
				let yp = oy.y - oi.y;
				const reach = oy.radius + oi.radius;

				if ( xp * xp + yp * yp >= reach * reach ) continue;

				colize = true;

				// --- holes swallow anything but the boss ----------------------

				if ( oi.type === ObjectType.HOLE || oi.type === ObjectType.EHOLE ) {

					if ( oy.type !== ObjectType.APPLE ) this.destroy( y );
					if ( oi.type === ObjectType.EHOLE ) this.destroy( i );
					continue;

				}

				if ( oy.type === ObjectType.HOLE || oy.type === ObjectType.EHOLE ) {

					if ( oi.type !== ObjectType.APPLE ) this.destroy( i );
					if ( oy.type === ObjectType.EHOLE ) this.destroy( y );
					continue;

				}

				// --- player pickups and theft ---------------------------------

				if ( oi.type === ObjectType.ROCKET ) {

					// Two armed thieves just swap their loot.
					if ( oy.thief === 1 && oi.thief === 1 ) {

						const tmp = oi.M;
						oi.M = oy.M;
						oy.M = tmp;
						oi.thief = 0;
						oy.thief = 0;

					}

					if ( oy.type === ObjectType.BBALL && oi.thief === 1 ) {

						oi.M += oy.M - this.ballM;
						oi.thief = 0;
						oy.M = this.ballM;

					} else if ( oy.type === ObjectType.ROCKET && oi.thief === 1 ) {

						oi.M += oy.M - this.rocketM;
						oi.accel += oy.accel - this.rocketSpeed;
						oi.thief = 0;
						oy.M = this.rocketM;
						oy.accel = this.rocketSpeed - A_ADD;

					}

					if ( oy.thief === 1 ) {

						oy.M += oi.M - this.rocketM;
						oy.accel += oi.accel - this.rocketSpeed;
						oy.thief = 0;
						oi.M = this.rocketM;
						oi.accel = this.rocketSpeed - A_ADD;

					}

					if ( this.gameplan === GamePlanMode.COOPERATIVE ) oi.score ++;

					switch ( oy.letter ) {

						case Letter.ACCEL:
							oi.accel += A_ADD;
							oi.score += 10;
							break;

						case Letter.GUMM:
							oi.M += M_ADD;
							oi.score += 10;
							break;

						case Letter.THIEF:
							oi.M = this.rocketM;
							oi.accel = this.rocketSpeed - A_ADD;
							oi.score -= 30;
							break;

						case Letter.FINDER:
							oi.accel += A_ADD * randMod( 5 );
							oi.M += M_ADD * randMod( 10 );
							oi.score += 30;
							break;

						case Letter.TTOOL:
							oi.thief = 1;
							oi.score += 30;
							break;

						default:
							break;

					}

					oy.letter = Letter.NONE;
					if ( oy.type === ObjectType.LBALL ) oy.type = ObjectType.BALL;

					// Cornered koules spit a tether onto whoever touched them.
					if ( oy.type === ObjectType.BALL && this.dosprings && chance( this.randsprings ) ) {

						oy.lineto = i;

					}

					if (
						this.gameplan === GamePlanMode.DEATHMATCH && oy.type === ObjectType.ROCKET &&
						this.dosprings && chance( 2 * this.randsprings )
					) {

						oy.lineto = i;

					}

				}

				// --- momentum -------------------------------------------------

				let gummfactor: number;

				if ( oy.type === ObjectType.LUNATIC ) gummfactor = - this.rocketM / LUNATIC_M;
				else if ( oi.type === ObjectType.LUNATIC ) gummfactor = - LUNATIC_M / this.rocketM;
				else gummfactor = oi.M / oy.M;

				this.normalize( xp, yp, gummfactor * this.gumm );
				xp = this.nx;
				yp = this.ny;
				oy.fx += xp;
				oy.fy += yp;

				this.normalize( xp, yp, ( 1 / gummfactor ) * this.gumm );
				xp = this.nx;
				yp = this.ny;
				oi.fx -= xp;
				oi.fy -= yp;

				// Freshly spawned players cannot be shoved around.
				if ( oi.type === ObjectType.ROCKET && oi.time ) { oi.fx = 0; oi.fy = 0; }
				if ( oy.type === ObjectType.ROCKET && oy.time ) { oy.fx = 0; oy.fy = 0; }

				// Inspectors are immovable and bounce players hard.
				if ( oy.type === ObjectType.INSPECTOR && oi.type === ObjectType.ROCKET ) {

					oy.fx = 0;
					oy.fy = 0;
					oi.fx *= - 2;
					oi.fy *= - 2;

				}

			}

		}

		if ( colize && ! this.colizeTime ) {

			this.effect( Sample.COLIZE );
			this.colizeTime = 4;

		}

		if ( this.colizeTime ) this.colizeTime --;

	}

	/** `move_objects()` — integrate, and hatch any creator whose time is up. */
	private moveObjects(): void {

		for ( let i = 0; i < this.nobjects; i ++ ) {

			const o = this.objects[ i ];

			if ( o.type === ObjectType.CREATOR ) {

				o.time --;

				if ( o.time <= 0 ) {

					this.effect( Sample.CREATOR2 );
					o.live = o.live1;
					o.type = o.ctype;
					// A hatching player gets a long grace period.
					if ( o.type === ObjectType.ROCKET ) o.time = 200;
					o.radius = radiusOf( o.ctype );
					o.M = this.massOf( o.ctype );

				}

			} else if ( o.live ) {

				o.x += o.fx;
				o.y += o.fy;

			}

		}

	}

	// ----------------------------------------------------------------- clock

	/** `Effect()` — sound is muted outside of a running game. */
	effect( sample: Sample ): void {

		if ( this.sound ) this.onSound( sample );

	}

	/** One 25 Hz simulation step: the body of `game()`'s main loop. */
	tick(): void {

		for ( let i = 0; i < this.nobjects; i ++ ) {

			this.objects[ i ].snapshot();
			this.objects[ i ].teleported = false;

		}

		this.processControls();
		this.updateValues();
		this.plan.updateGame();
		this.updateForces();
		this.collisions();
		this.moveObjects();
		this.checkLimit();
		this.particles.update();

	}

	/** Clears the field so the menu's attract mode starts from nothing. */
	reset(): void {

		this.nobjects = 0;
		this.particles.clear();

		for ( const o of this.objects ) {

			o.live = 0;
			o.type = ObjectType.NONE;
			o.lineto = - 1;

		}

	}

}
