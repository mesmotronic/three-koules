// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	APPLE_RADIUS,
	BBBALL_LEVEL,
	EHOLE_LEVEL,
	FINAL_LEVEL,
	FINDER_LEVEL,
	GAME_HEIGHT,
	GAME_WIDTH,
	GameMode,
	GamePlanMode,
	HOLE_LEVEL,
	INSPECTOR_LEVEL,
	LUNATIC_LEVEL,
	Letter,
	LetterRoll,
	ObjectType,
	RAD,
	SPRING_LEVEL,
	Sample,
	THIEF_LEVEL,
	TTOOL_LEVEL,
	bballLevel,
	radiusOf
} from '../core/Constants.js';
import { chance, randMod } from '../core/Random.js';
import type { Game, Presentation } from './Game.js';

/**
 * `gameplan.c` — level construction, wave spawning and win/lose bookkeeping.
 *
 * Koules has no level data at all: every sector is generated from its number.
 * Creature budgets, spawn rates and which mechanics are switched on are all
 * functions of `level`, which is what lets it run to a hundred sectors.
 */
export class GamePlan {

	/** Current sector, zero based. */
	level = 0;

	/** Highest sector reached, offered in the menu as a starting point. */
	maxLevel = 0;

	/** Sector the player last started, persisted between sessions. */
	lastLevel = 0;

	/** Countdown before the level advances, restarts or ends. */
	private ktime = 0;
	/** What {@link ktime} is counting down to. */
	private kmode = 0;

	/** Grace period before a sector starts topping itself up. */
	private gtime = 0;

	/** Deathmatch only: the koules are gone and the nasty stuff starts. */
	private secondpart = 0;

	/** `nos` — set when the level is being replayed after a wipeout. */
	private replaying = false;

	constructor( private readonly game: Game ) {}

	/** `gameplan_init()`. */
	init(): void {

		this.level = this.lastLevel;

	}

	/** `allow_finder()` — thieves only reform once the player has met one. */
	allowFinder(): boolean {

		return this.level > FINDER_LEVEL || this.game.gameplan === GamePlanMode.DEATHMATCH;

	}

	/**
	 * `create_letter()` — decides what a dying koule leaves behind.
	 *
	 * Three quarters of the time it is a plain acceleration or weight pickup,
	 * or nothing at all. The rarer letters unlock progressively, and their
	 * odds keep improving the deeper the sector.
	 */
	createLetter(): LetterRoll {

		const { game } = this;

		if ( game.gameplan === GamePlanMode.COOPERATIVE ) {

			const i = randMod( 4 );
			if ( i < 3 ) return i as LetterRoll;

			if ( this.level > THIEF_LEVEL && randMod( 400 ) < this.level - THIEF_LEVEL + 40 ) return LetterRoll.THIEF;
			if ( this.level > TTOOL_LEVEL && randMod( 600 ) < this.level - TTOOL_LEVEL + 40 ) return LetterRoll.TTOOL;
			if ( this.level > FINDER_LEVEL && this.gtime < 0 && randMod( 700 ) < this.level - FINDER_LEVEL + 40 ) return LetterRoll.FINDER;

			return LetterRoll.NONE;

		}

		// Deathmatch hands out letters far more freely.
		if ( randMod( 100 ) >= 80 ) return LetterRoll.NONE;

		const tirage = randMod( 100 );

		if ( tirage < 30 ) return LetterRoll.ACCEL;
		if ( tirage < 60 ) return LetterRoll.GUMM;
		if ( tirage < 70 ) return LetterRoll.TTOOL;
		if ( tirage < 80 ) return LetterRoll.THIEF;

		return LetterRoll.FINDER;

	}

	// ------------------------------------------------------- level assembly

	/**
	 * `init_objects()` — rebuild the field for {@link level}.
	 *
	 * Leaves a {@link Presentation} on the game for the app to play before the
	 * simulation resumes; the original blocked inside `effect()` instead.
	 */
	initObjects(): void {

		const { game } = this;

		game.applyDifficulty();
		game.particles.clear();
		this.build();
		game.pending = this.presentation();

	}

	/** `init_objects1()`. */
	private build(): void {

		const { game } = this;

		game.dosprings = false;
		this.lastLevel = this.level;
		if ( this.maxLevel < this.level ) this.maxLevel = this.level;
		game.onPersist();

		if ( game.gamemode !== GameMode.GAME ) {

			game.nobjects = 0;
			return;

		}

		if ( game.gameplan === GamePlanMode.DEATHMATCH ) this.buildDeathmatch();
		else this.buildCooperative();

		this.ktime = 0;

	}

	private buildDeathmatch(): void {

		const { game } = this;
		const { objects, nrockets } = game;

		// Spits are always on in deathmatch — that is most of the fun.
		game.dosprings = true;
		game.randsprings = 40;

		if ( nrockets !== 1 ) {

			game.nobjects = Math.trunc( Math.trunc( Math.trunc( nrockets * 3 * GAME_WIDTH / 640 ) * GAME_HEIGHT / 460 ) ) + 3;

			for ( let i = 0; i < game.nobjects; i ++ ) objects[ i ].live = 0;

			for ( let i = 0; i < game.nobjects; i ++ ) {

				const o = objects[ i ];
				const type = i < nrockets ? ObjectType.ROCKET : ObjectType.BALL;

				o.live = 1;
				o.lineto = - 1;
				o.live1 = 1;
				o.thief = 0;
				o.time = i < nrockets ? 99 : 0;
				o.fx = 0;
				o.fy = 0;
				o.rotation = 0;
				o.type = type;

				if ( ! this.place( i, type ) ) return;

				o.M = game.massOf( type );
				o.radius = radiusOf( type );
				o.accel = game.rocketSpeed;
				o.letter = Letter.NONE;
				this.secondpart = 0;

			}

			const nholes = Math.trunc( nrockets / 3 ) + 1;
			for ( let i = 0; i < nholes; i ++ ) game.creator( ObjectType.HOLE );
			game.creator( ObjectType.INSPECTOR );
			game.creator( ObjectType.EHOLE );

		} else {

			// Solo deathmatch is a duel with a single tethered lunatic.
			game.nobjects = 2;

			for ( let i = 0; i < game.nobjects; i ++ ) objects[ i ].live = 0;

			for ( let i = 0; i < game.nobjects; i ++ ) {

				const o = objects[ i ];
				const type = i < nrockets ? ObjectType.ROCKET : ObjectType.LUNATIC;

				o.live = 1;
				o.lineto = i !== 0 ? 0 : - 1;
				o.live1 = 1;
				o.thief = 0;
				o.time = i < nrockets ? 99 : 0;
				o.fx = 0;
				o.fy = 0;
				o.rotation = 0;
				o.type = type;

				if ( ! this.place( i, type ) ) return;

				o.M = game.massOf( type );
				o.radius = radiusOf( type );
				o.accel = game.rocketSpeed;
				o.letter = Letter.NONE;
				this.secondpart = 0;

			}

		}

	}

	private buildCooperative(): void {

		const { game } = this;
		const { objects, nrockets } = game;

		if ( this.level !== FINAL_LEVEL ) {

			if ( this.level > SPRING_LEVEL ) game.dosprings = true;
			game.randsprings = 40 - Math.trunc( this.level / 3 );

			let n = Math.trunc( 3 + Math.sqrt( this.level ) * Math.trunc( ( nrockets + 1 ) / 2 ) + 2 * nrockets );
			n = Math.trunc( ( n * ( Math.trunc( Math.trunc( GAME_WIDTH / 640 ) * GAME_HEIGHT / 460 ) + 2 ) ) / 3 );
			if ( n > 30 ) n = 30;
			game.nobjects = n;

			for ( let i = 0; i < game.nobjects; i ++ ) objects[ i ].live = 0;

			const nbballs = nrockets + Math.trunc( this.level / BBBALL_LEVEL );
			this.gtime = 100 + Math.trunc( 1000 / ( this.level + 1 ) );

			for ( let i = 0; i < game.nobjects; i ++ ) {

				const o = objects[ i ];
				const type = i < nrockets
					? ObjectType.ROCKET
					: ( i < nbballs ? ObjectType.BBALL : ObjectType.BALL );

				o.live = i < nrockets ? 5 : 1;
				o.live1 = i < nrockets ? 5 : 1;
				o.lineto = - 1;
				o.thief = 0;
				o.time = i < nrockets ? 100 : 0;
				o.fx = 0;
				o.fy = 0;
				o.rotation = 0;
				o.type = type;
				o.M = game.massOf( type );

				// Early sectors hand the player extra mass so the first koules
				// cannot simply shove them into a wall; it tapers off by 25.
				if ( i < nrockets ) {

					if ( this.level < 5 ) o.M *= 1 + ( 5 - this.level ) / 15;
					if ( this.level < 25 ) o.M *= 1 + this.level / 120;

				}

				o.radius = radiusOf( type );
				o.accel = game.rocketSpeed;

				if ( ! this.place( i, type ) ) return;

				o.letter = Letter.NONE;

			}

		} else {

			// Sector 100: the Dark Applepolisher, dead centre.
			game.nobjects = nrockets + 10;

			for ( let i = 0; i < game.nobjects; i ++ ) objects[ i ].live = 0;

			const apple = objects[ nrockets ];
			apple.type = ObjectType.APPLE;
			apple.M = game.appleM;
			apple.lineto = - 1;
			apple.thief = 0;
			apple.radius = APPLE_RADIUS;
			apple.live = 1;
			apple.live1 = 1;
			apple.fx = 0;
			apple.fy = 0;
			apple.teleport( GAME_WIDTH / 2, GAME_HEIGHT / 2 );

			for ( let i = 0; i < nrockets; i ++ ) {

				const o = objects[ i ];

				o.live = 5;
				o.live1 = 5;
				o.time = 100;
				o.thief = 0;
				o.lineto = - 1;
				o.fx = 0;
				o.fy = 0;
				o.rotation = 0;
				o.type = ObjectType.ROCKET;
				o.accel = game.rocketSpeed;
				o.M = game.massOf( ObjectType.ROCKET );
				o.radius = radiusOf( ObjectType.ROCKET );
				o.letter = Letter.NONE;

				// The original assigned `x` twice here and never set `y`, which
				// stacked every player on one row. Corrected to the ring the
				// arithmetic was plainly reaching for.
				o.teleport(
					GAME_WIDTH / 2 + Math.sin( ( i * RAD( 360 ) ) / nrockets ) * GAME_HEIGHT / 3,
					GAME_HEIGHT / 2 + Math.cos( ( i * RAD( 360 ) ) / nrockets ) * GAME_HEIGHT / 3
				);

			}

			for ( let i = nrockets + 1; i < game.nobjects; i ++ ) {

				const o = objects[ i ];

				o.live = 1;
				o.live1 = 1;
				o.lineto = - 1;
				o.time = 0;
				o.thief = 0;
				o.fx = 0;
				o.fy = 0;
				o.rotation = 0;
				o.type = ObjectType.BALL;
				o.accel = game.ballSpeed;
				o.M = game.massOf( ObjectType.BALL );
				o.radius = radiusOf( ObjectType.BALL );
				o.letter = Letter.NONE;

				if ( ! this.place( i, ObjectType.BALL ) ) return;

			}

		}

	}

	/** `find_possition()` applied to one object; false aborts level assembly. */
	private place( index: number, type: ObjectType ): boolean {

		const spot = this.game.findSpawn( radiusOf( type ) );
		if ( spot === null ) return false;

		this.game.objects[ index ].teleport( spot.x, spot.y );
		return true;

	}

	// ------------------------------------------------------- interlude texts

	/**
	 * `effect()` — which scroller texts precede this sector.
	 *
	 * Skipped entirely when the sector is being replayed after a wipeout, so
	 * the player is not made to sit through the same briefing twice.
	 */
	private presentation(): Presentation {

		const { game } = this;
		const intros: string[] = [];

		if ( game.gamemode === GameMode.GAME ) {

			game.effect( this.replaying ? Sample.END : Sample.START );

		}

		if ( game.gameplan === GamePlanMode.COOPERATIVE && ! this.replaying ) {

			const level = this.level;

			if ( level === 0 ) intros.push( 'intro' );
			if ( level === HOLE_LEVEL + 1 ) intros.push( 'hole' );
			if ( level === INSPECTOR_LEVEL ) intros.push( 'inspector' );
			if ( level === bballLevel( game.nrockets ) + 1 ) intros.push( 'bball' );
			if ( level === BBBALL_LEVEL ) intros.push( 'bbball' );
			if ( level === EHOLE_LEVEL ) intros.push( 'maghole' );
			if ( level === SPRING_LEVEL + 1 ) intros.push( 'spring' );
			if ( level === THIEF_LEVEL ) intros.push( 'thief' );
			if ( level === FINDER_LEVEL ) intros.push( 'finder' );
			if ( level === TTOOL_LEVEL ) intros.push( 'ttool' );
			if ( level === LUNATIC_LEVEL ) intros.push( 'lunatic' );
			if ( level === FINAL_LEVEL ) intros.push( 'outro1' );

		}

		return {
			intros,
			banner: game.gameplan === GamePlanMode.COOPERATIVE ? `SECTOR ${ this.level + 1 }` : 'GET READY'
		};

	}

	// ------------------------------------------------------------ wave logic

	/**
	 * `update_game()` — the per-tick director.
	 *
	 * Outside a running game this quietly keeps a few creatures alive so the
	 * menu has something moving behind it.
	 */
	updateGame(): void {

		const { game } = this;

		if ( game.gamemode !== GameMode.GAME ) {

			// Attract mode.
			if ( game.aBalls < 5 && chance( 50 ) ) game.creator( ObjectType.BALL );
			if ( game.aLunatics < 5 && chance( 50 ) ) game.creator( ObjectType.LUNATIC );
			if ( game.aBballs < 4 && chance( 200 ) ) game.creator( ObjectType.BBALL );
			return;

		}

		if ( this.ktime ) {

			this.ktime --;
			if ( this.ktime === 0 ) this.resolve();
			return;

		}

		if ( game.gameplan === GamePlanMode.DEATHMATCH ) this.updateDeathmatch();
		else this.updateCooperative();

	}

	/** The delayed transitions `ktime`/`kmode` were counting down to. */
	private resolve(): void {

		const { game } = this;

		switch ( this.kmode ) {

			case 1: // Deathmatch round over: reset the arena.
				this.initObjects();
				break;

			case 2: // Sector 100 cleared: the game is won.
				this.lastLevel = 0;
				this.level = 1;
				game.gamemode = GameMode.MENU;
				game.finished = true;
				break;

			case 3: // Sector cleared: bank the surviving lives and move on.

				if ( game.aBalls || game.aBballs || game.aInspectors || game.aLunatics ) break;

				for ( let i = 0; i < game.nrockets; i ++ ) {

					const o = game.objects[ i ];
					if ( o.type === ObjectType.ROCKET && o.live ) o.score += o.live * 20;

				}

				this.level ++;
				this.initObjects();
				break;

			case 4: // Everyone died: replay the sector at a hundred point cost.

				for ( let i = 0; i < game.nrockets; i ++ ) {

					if ( game.objects[ i ].type === ObjectType.ROCKET ) game.objects[ i ].score -= 100;

				}

				this.replaying = true;
				this.initObjects();
				this.replaying = false;
				break;

			default:
				break;

		}

	}

	private updateDeathmatch(): void {

		const { game } = this;

		if ( game.nrockets === 1 ) {

			if ( chance( 60 ) ) game.creator( ObjectType.HOLE );

			if ( game.aRockets === 0 ) {

				this.ktime = 50;
				this.kmode = 1;
				game.objects[ 0 ].score -= 100;

			}

			if ( game.aLunatics === 0 ) {

				this.ktime = 50;
				this.kmode = 1;
				game.objects[ 0 ].score += 100;

			}

			return;

		}

		if ( game.aBalls === 0 ) this.secondpart = 1;
		if ( game.aLunatics < game.nrockets && chance( 150 ) ) game.creator( ObjectType.LUNATIC );

		if ( this.secondpart ) {

			if ( chance( 100 ) ) game.creator( ObjectType.BBALL );
			if ( chance( 60 ) ) game.creator( ObjectType.HOLE );
			if ( chance( 400 ) ) game.creator( ObjectType.BBALL );
			if ( chance( 400 ) ) game.creator( ObjectType.INSPECTOR );
			if ( chance( 600 ) ) game.creator( ObjectType.EHOLE );

		}

		if ( game.aRockets <= 1 ) {

			this.ktime = 50;
			this.kmode = 1;

		}

	}

	private updateCooperative(): void {

		const { game } = this;
		const level = this.level;

		if ( level === FINAL_LEVEL ) {

			if ( ! game.aApples ) { this.ktime = 50; this.kmode = 2; }
			if ( game.aBalls < 15 && chance( 40 ) ) game.creator( ObjectType.BALL );
			if ( game.aBballs < 3 && chance( 3000 ) ) game.creator( ObjectType.BBALL );

		} else {

			this.gtime --;

			// Sector cleared once nothing hostile is left standing.
			if ( game.aBalls === 0 && game.aBballs === 0 && game.aInspectors === 0 && game.aLunatics === 0 ) {

				this.ktime = 50;
				this.kmode = 3;

			}

			// Reinforcements, but only once the opening grace period is over.
			if ( game.aBalls < 4 * level && this.gtime < 0 ) {

				if ( chance( ( game.nrockets === 1 ? 200 : 150 ) + ( 110 - level ) ) ) game.creator( ObjectType.BALL );

			}

			if ( game.aLunatics < level - LUNATIC_LEVEL && game.aLunatics < 3 && this.gtime < 0 ) {

				if ( chance( ( game.nrockets === 1 ? 800 : 450 ) + ( 110 - level ) ) ) game.creator( ObjectType.LUNATIC );

			}

			if ( game.aHoles < 4 * ( level - HOLE_LEVEL ) && this.gtime < 0 ) {

				if ( chance( 412 + Math.trunc( 512 / level ) ) ) game.creator( ObjectType.HOLE );

			}

			if ( game.aBballs < 4 * ( level - bballLevel( game.nrockets ) ) && this.gtime < 0 ) {

				const odds = ( game.nrockets === 1 ? 700 : 500 ) + Math.trunc( ( 110 - level ) / 3 ) + Math.trunc( 2024 / level );
				if ( chance( odds ) ) game.creator( ObjectType.BBALL );

			}

			if ( game.aInspectors < Math.trunc( level / INSPECTOR_LEVEL ) && this.gtime < 0 ) {

				if ( chance( 1500 + 10 * ( 110 - level ) ) ) game.creator( ObjectType.INSPECTOR );

			}

			if ( game.aEholes < Math.trunc( level / EHOLE_LEVEL ) + 1 && this.gtime < 0 && level >= EHOLE_LEVEL ) {

				if ( chance( 500 + Math.trunc( 1000 / level ) ) ) game.creator( ObjectType.EHOLE );

			}

		}

		if ( game.aRockets === 0 ) {

			this.ktime = 50;
			this.kmode = 4;

		}

	}

}

