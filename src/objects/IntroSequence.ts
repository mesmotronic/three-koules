import { Group, Mesh, SphereGeometry } from 'three/webgpu';

import {
	BALL_RADIUS,
	BBALL_RADIUS,
	EYE_RADIUS,
	EYE_RADIUS1,
	GAME_HEIGHT,
	GAME_WIDTH,
	RAD,
	ROCKET_RADIUS,
	Sample
} from '../core/Constants.js';
import { ball as ballRamp } from '../core/Palette.js';
import { randMod } from '../core/Random.js';
import type { ParticleSystem } from '../game/ParticleSystem.js';
import { type Appearance, bodyMaterial } from '../materials/BodyMaterials.js';
import { B_LINE, D1_LINE, D2_LINE, KOULES_LINE, PLAYER_LINE } from '../misc/TextData.js';

const SPHERE = new SphereGeometry( 1, 32, 20 );

/** The crawl ran at 65 Hz and moved everything by fixed per-frame amounts. */
const FRAME_RATE = 65;

/** Koules per ring, from `draw_koules`'s 60 degree step. */
const RING_COUNT = 6;

/** Which bitmap each ring used: red koules, then a green and a blue deserter. */
const RING_APPEARANCE: readonly Appearance[] = [ 'ball', 'accel', 'gumm' ];

const toWorldX = ( x: number ): number => x - GAME_WIDTH / 2;
const toWorldY = ( y: number ): number => GAME_HEIGHT / 2 - y;

/**
 * The choreography that plays over the opening crawl, from `starwars()`.
 *
 * Three rings of koules close on the centre while the story scrolls past.
 * When the crawl reaches the line about Earth's champions a ship materialises
 * in the middle, rocks gently, and is finally knocked aside by a B_BALL rising
 * from the bottom of the screen. Each beat is cued by a line number rather
 * than a clock, so it stays in step however fast the text is read.
 */
export class IntroSequence extends Group {

	private readonly rings: Mesh[][] = [];
	private readonly ship = new Group();
	private readonly shipBody = new Mesh( SPHERE, bodyMaterial( 'rocket0' ) );
	private readonly shipEyes: Mesh[] = [];
	private readonly bball = new Mesh( SPHERE, bodyMaterial( 'bball' ) );

	// `r[]` and `rp[]` — each ring's radius and its closing speed.
	private readonly r = [ 0, 0, 0 ];
	private readonly rp = [ 0, 0.6, 0.6 ];
	private readonly collided = [ false, false, false ];

	/** `r1` — the radius the rings start from, out at the screen corners. */
	private r1 = 0;

	private angle = 0;

	private playX = 0;
	private playY = 0;
	private playR = 0;
	private playP = 0.03;

	private bballY = 0;
	private bballActive = false;

	private time = 0;
	private time1 = 0;
	private ringPlaced = false;
	private shipPlaced = false;
	private knocked = false;

	constructor(
		private readonly particles: ParticleSystem,
		private readonly playSound: ( sample: Sample ) => void
	) {

		super();
		this.visible = false;

		for ( let z = 0; z < 3; z ++ ) {

			const ring: Mesh[] = [];

			for ( let i = 0; i < RING_COUNT; i ++ ) {

				const koule = new Mesh( SPHERE, bodyMaterial( RING_APPEARANCE[ z ] ) );
				koule.scale.setScalar( BALL_RADIUS );
				koule.visible = false;
				ring.push( koule );
				this.add( koule );

			}

			this.rings.push( ring );

		}

		this.shipBody.scale.setScalar( ROCKET_RADIUS );
		this.ship.add( this.shipBody );

		for ( let e = 0; e < 2; e ++ ) {

			const eye = new Mesh( SPHERE, bodyMaterial( 'eye0' ) );
			eye.scale.setScalar( EYE_RADIUS );
			this.shipEyes.push( eye );
			this.ship.add( eye );

		}

		this.ship.visible = false;
		this.add( this.ship );

		this.bball.scale.setScalar( BBALL_RADIUS );
		this.bball.visible = false;
		this.add( this.bball );

	}

	start(): void {

		this.r1 = Math.hypot( GAME_WIDTH / 2, GAME_HEIGHT / 2 );
		this.r[ 0 ] = this.r[ 1 ] = this.r[ 2 ] = this.r1;
		this.rp[ 0 ] = 0;
		this.rp[ 1 ] = this.rp[ 2 ] = 0.6;
		this.collided.fill( false );

		this.angle = 0;
		this.playX = 0;
		this.playY = 0;
		this.playR = 0;
		this.playP = 0.03;
		this.bballY = 0;
		this.bballActive = false;
		this.time = 0;
		this.time1 = 0;
		this.ringPlaced = false;
		this.shipPlaced = false;
		this.knocked = false;

		this.visible = true;

	}

	stop(): void {

		this.visible = false;
		this.ship.visible = false;
		this.bball.visible = false;

		for ( const ring of this.rings ) for ( const koule of ring ) koule.visible = false;

	}

	/**
	 * @param delta - Seconds since the last frame.
	 * @param actu - The crawl's highest visible line, which cues every beat.
	 */
	update( delta: number, actu: number ): void {

		if ( ! this.visible ) return;

		const frames = delta * FRAME_RATE;

		// --- rings ----------------------------------------------------------

		for ( let z = 0; z < 3; z ++ ) {

			if ( ! this.collided[ z ] && this.r[ z ] <= ROCKET_RADIUS + BALL_RADIUS ) {

				// A ring that reaches the ship is flung back out.
				this.collided[ z ] = true;
				this.rp[ z ] = - 6;
				this.playSound( Sample.COLIZE );

			}

		}

		if ( actu >= D1_LINE ) this.r[ 1 ] -= this.rp[ 1 ] * frames;
		if ( actu >= D2_LINE ) this.r[ 2 ] -= this.rp[ 2 ] * frames;

		// --- the ring of koules materialising --------------------------------

		if ( actu >= KOULES_LINE && this.time1 === 0 ) {

			this.kouleCreator( GAME_HEIGHT / 2 - 20 );
			this.time1 = 1;

		}

		if ( this.time1 > 0 ) this.time1 += frames;

		if ( this.time1 >= 100 && ! this.ringPlaced ) {

			this.ringPlaced = true;
			this.r[ 0 ] = GAME_HEIGHT / 2 - 20;

		}

		if ( this.ringPlaced ) {

			this.r[ 0 ] -= this.rp[ 0 ] * frames;
			this.angle += 0.3 * frames;

		}

		// --- the ship --------------------------------------------------------

		if ( actu >= PLAYER_LINE && this.time === 0 ) {

			this.starCreator();
			this.time = 1;

		}

		if ( this.time > 0 ) this.time += frames;

		if ( this.time >= 100 && ! this.shipPlaced ) {

			this.shipPlaced = true;
			this.playX = GAME_WIDTH / 2;
			this.playY = GAME_HEIGHT / 2;
			this.playR = RAD( 180 );
			// Only now do the red koules start closing in.
			this.rp[ 0 ] = 1.5;
			this.playSound( Sample.CREATOR2 );

		}

		this.playR += this.playP * frames;

		if ( this.playR < RAD( - 45 ) ) { this.playP = 0.015; this.playR = RAD( - 45 ); }
		if ( this.playR > RAD( 45 ) ) { this.playP = - 0.03; this.playR = RAD( 45 ); }

		// --- the B_BALL -------------------------------------------------------

		if ( actu >= B_LINE && ! this.bballActive ) {

			this.bballActive = true;
			this.bballY = GAME_HEIGHT + 30;

		}

		if ( this.bballActive ) this.bballY -= frames;

		if ( this.shipPlaced && this.bballY > 0 && this.bballY < GAME_HEIGHT / 2 + ROCKET_RADIUS / 2 ) {

			if ( ! this.knocked ) {

				this.knocked = true;
				this.playSound( Sample.END );

			}

			this.playY -= 10 * frames;

		}

		this.layout();

	}

	private layout(): void {

		for ( let z = 0; z < 3; z ++ ) {

			const visible = this.r[ z ] < this.r1;

			for ( let i = 0; i < RING_COUNT; i ++ ) {

				const koule = this.rings[ z ][ i ];
				koule.visible = visible;

				if ( ! visible ) continue;

				// A ring flung back out reverts to the plain red bitmap.
				const appearance = this.rp[ z ] > 0 ? RING_APPEARANCE[ z ] : RING_APPEARANCE[ 0 ];
				koule.material = bodyMaterial( appearance );

				const a = RAD( i * 60 ) + RAD( this.angle );

				koule.position.set(
					toWorldX( GAME_WIDTH / 2 + Math.sin( a ) * this.r[ z ] ),
					toWorldY( GAME_HEIGHT / 2 + Math.cos( a ) * this.r[ z ] ),
					0
				);

			}

		}

		this.ship.visible = this.shipPlaced;

		if ( this.shipPlaced ) {

			this.ship.position.set( toWorldX( this.playX ), toWorldY( this.playY ), 0 );

			for ( let e = 0; e < 2; e ++ ) {

				const a = this.playR + ( e === 0 ? - RAD( 30 ) : RAD( 30 ) );

				this.shipEyes[ e ].position.set(
					Math.sin( a ) * EYE_RADIUS1,
					- Math.cos( a ) * EYE_RADIUS1,
					ROCKET_RADIUS * 0.55
				);

			}

		}

		this.bball.visible = this.bballActive && this.bballY > - 20;

		if ( this.bball.visible ) {

			this.bball.position.set( 0, toWorldY( this.bballY ), 0 );

		}

	}

	/** `koulescreator()` — six clouds converging into the ring. */
	private kouleCreator( radius: number ): void {

		const time = 100;
		this.playSound( Sample.CREATOR1 );

		for ( let i = 0; i < 360; i += 60 ) {

			// The original negated the sine here but not in `draw_koules`, so
			// its clouds converged on mirrored positions. Matched up instead.
			const x1 = GAME_WIDTH / 2 + Math.sin( RAD( i ) ) * radius;
			const y1 = GAME_HEIGHT / 2 + Math.cos( RAD( i ) ) * radius;

			const count = Math.trunc( BALL_RADIUS * BALL_RADIUS * Math.PI );

			for ( let z = 0; z < count; z ++ ) {

				const x = randMod( GAME_WIDTH );
				const y = randMod( GAME_HEIGHT );

				this.particles.add( x, y, ( x1 - x ) / time, ( y1 - y ) / time, ballRamp( randMod( 32 ) ), time );

			}

		}

	}

	/** `starcreator()` — the cloud that becomes the ship. */
	private starCreator(): void {

		const time = 100;
		this.playSound( Sample.CREATOR1 );

		const count = Math.trunc( ROCKET_RADIUS * ROCKET_RADIUS * Math.PI );

		for ( let z = 0; z < count; z ++ ) {

			const x = randMod( GAME_WIDTH );
			const y = randMod( GAME_HEIGHT );

			this.particles.add(
				x, y,
				( GAME_WIDTH / 2 - x ) / time,
				( GAME_HEIGHT / 2 - y ) / time,
				randMod( 32 ),
				time
			);

		}

	}

}
