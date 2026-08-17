// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { Camera, MathUtils, PerspectiveCamera, Quaternion, Vector3, Vector4 } from 'three/webgpu';

import { GAME_HEIGHT, RAD, ViewMode, toWorldX, toWorldY } from '../core/Constants.js';
import type { GameObject } from '../game/GameObject.js';

/**
 * Seconds a change of view takes to fly.
 *
 * Unhurried on purpose. The sector fills the screen and the whole frame
 * swings during a change, so a quick flight reads as the room moving rather
 * than the camera, which is the short road to motion sickness.
 */
const TRANSITION = 2.3;

/** How quickly a following camera catches up, per second. */
const FOLLOW_RATE = 6;

/** How quickly the followed heading catches up. Slower, or it whips. */
const HEADING_RATE = 2.6;

/** Breathing room left around the angled view's exact fit. */
const FIT_MARGIN = 1.05;

/**
 * Scratch used to turn a look-at into a quaternion.
 *
 * It has to be a Camera rather than a plain Object3D: `lookAt` aims +Z at the
 * target for ordinary objects and -Z for cameras, so anything else ends up
 * facing squarely away from the scene.
 */
const _dummy = new Camera();
const _position = new Vector3();
const _target = new Vector3();
const _quaternion = new Quaternion();

/** Where a mode puts the camera, and how it is framed. */
export interface Pose {
	fov: number;
	/** True if the mode turns with the player, so controls must turn too. */
	rotating: boolean;
}

/**
 * The overhead field of view.
 *
 * The layout sizes the sector against this, and the director sets the camera
 * from it, so the two have to be the same number rather than agree by luck.
 */
export const TOP_FOV = 35;

export const POSES: Readonly<Record<ViewMode, Pose>> = {
	[ ViewMode.TOP ]: { fov: TOP_FOV, rotating: false },
	[ ViewMode.ANGLED ]: { fov: 42, rotating: false },
	[ ViewMode.CHASE ]: { fov: 62, rotating: true },
	[ ViewMode.COCKPIT ]: { fov: 78, rotating: true }
};

/** How the sector is framed, shared by every view. */
export interface Framing {
	/** Distance at which the whole sector fits the inset square. */
	distance: number;
	/** World units the sector sits above the viewport centre. */
	lift: number;
	/**
	 * The status line's share of the viewport height.
	 *
	 * The angled view frames itself against the whole canvas rather than the
	 * inset square — nothing is laid out over it — so the one thing it has to
	 * be told is how much of the bottom the scores take, to sit above them
	 * rather than under them.
	 */
	statusFraction: number;
	/** Idle drift, disabled during a crawl and by the menu setting. */
	drift: boolean;
	/** Seconds elapsed, for that drift. */
	elapsed: number;
}

/**
 * One viewport's camera, and the state it needs to fly and to follow.
 *
 * Split screen is simply several of these: each holds its own transition and
 * its own smoothed idea of where its ship is and which way it is facing, so
 * two players in chase view do not drag each other's cameras about.
 */
export class CameraView {

	readonly camera = new PerspectiveCamera( TOP_FOV, 1, 1, 6000 );

	private transition = 1;
	private readonly fromPosition = new Vector3();
	private readonly fromQuaternion = new Quaternion();
	private fromFov = TOP_FOV;

	/** Smoothed ship heading the following modes track. */
	heading = Math.PI;

	/** Smoothed ship position, so a respawn does not snap the camera. */
	private readonly focus = new Vector3();
	private hasFocus = false;

	private mode: ViewMode = ViewMode.TOP;

	/** Fraction of the canvas this view occupies, as x, y, width, height. */
	readonly viewport = new Vector4( 0, 0, 1, 1 );

	/**
	 * Places this view on the canvas.
	 *
	 * @param x - Fractions of the canvas: origin, then size.
	 * @param canvasAspect - The canvas's own width over height, without which
	 * the aspect would come out as the ratio of the fractions and everything
	 * in the viewport would be stretched.
	 */
	setViewport( x: number, y: number, width: number, height: number, canvasAspect: number ): void {

		this.viewport.set( x, y, width, height );
		this.camera.aspect = height > 0 ? ( width / height ) * canvasAspect : canvasAspect;
		this.camera.updateProjectionMatrix();

	}

	/** Begins a flight to a new point of view. */
	setMode( mode: ViewMode ): void {

		if ( mode === this.mode ) return;

		this.fromPosition.copy( this.camera.position );
		this.fromQuaternion.copy( this.camera.quaternion );
		this.fromFov = this.camera.fov;
		this.transition = 0;
		this.mode = mode;

	}

	/** Drops the camera straight onto the current mode, with no flight. */
	snap(): void {

		this.transition = 1;
		this.hasFocus = false;

	}

	update( delta: number, framing: Framing, player: GameObject | null ): void {

		this.followPlayer( delta, player );
		this.poseFor( framing );

		const pose = POSES[ this.mode ];

		if ( this.transition < 1 ) {

			this.transition = Math.min( 1, this.transition + delta / TRANSITION );

			const t = ease( this.transition );

			this.camera.position.lerpVectors( this.fromPosition, _position, t );
			this.camera.quaternion.slerpQuaternions( this.fromQuaternion, _quaternion, t );
			this.setFov( MathUtils.lerp( this.fromFov, pose.fov, t ) );
			return;

		}

		// Settled: the fixed views are already where they belong, and the
		// following ones ease after the ship rather than sticking to it.
		if ( pose.rotating ) {

			const k = 1 - Math.exp( - FOLLOW_RATE * delta );
			this.camera.position.lerp( _position, k );
			this.camera.quaternion.slerp( _quaternion, k );

		} else {

			this.camera.position.copy( _position );
			this.camera.quaternion.copy( _quaternion );

		}

		this.setFov( pose.fov );

	}

	private setFov( fov: number ): void {

		if ( this.camera.fov === fov ) return;

		this.camera.fov = fov;
		this.camera.updateProjectionMatrix();

	}

	/** Eases the tracked position and heading toward the ship's. */
	private followPlayer( delta: number, player: GameObject | null ): void {

		if ( player === null || ! player.live ) return;

		_target.set( toWorldX( player.x ), toWorldY( player.y ), 0 );

		if ( ! this.hasFocus ) {

			this.focus.copy( _target );
			this.heading = player.rotation;
			this.hasFocus = true;
			return;

		}

		this.focus.lerp( _target, 1 - Math.exp( - FOLLOW_RATE * delta ) );

		// Take the shortest way round, or the camera unwinds the long way when
		// the ship crosses from one side of due north to the other.
		const difference = wrapAngle( player.rotation - this.heading );
		this.heading += difference * ( 1 - Math.exp( - HEADING_RATE * delta ) );

	}

	/** Writes the target position and orientation for this mode into scratch. */
	private poseFor( framing: Framing ): void {

		const { distance, lift, elapsed } = framing;
		const drift = framing.drift && ! POSES[ this.mode ].rotating;

		const swayX = drift ? Math.sin( elapsed * 0.13 ) * 9 + Math.sin( elapsed * 0.31 ) * 2.5 : 0;
		const swayY = drift ? Math.cos( elapsed * 0.17 ) * 7 : 0;
		const breath = drift ? 1 + Math.sin( elapsed * 0.09 ) * 0.014 : 1;

		switch ( this.mode ) {

			case ViewMode.TOP: {

				_position.set( swayX, - lift + swayY, distance * breath );
				_target.set( swayX * 0.35, - lift + swayY * 0.35, 0 );
				_dummy.up.set( 0, 1, 0 );
				break;

			}

			case ViewMode.ANGLED: {

				// Tipped back about the x axis so the near edge of the sector
				// splays toward the viewer and the far edge narrows away.
				const pitch = RAD( 34 );

				const tanFov = Math.tan( RAD( POSES[ ViewMode.ANGLED ].fov ) / 2 );

				// Framed against the screen rather than against the square the
				// overhead view draws in. Seen along a tilt the near edge is
				// both nearer the lens and lower in the frame, so it is the
				// edge that runs out of room first; putting it exactly on the
				// bottom of the usable height and solving for the distance is
				// what fills the screen without pushing the wall the player is
				// about to be shoved into off the bottom of it.
				const usable = tanFov * ( 1 - framing.statusFraction );
				const range = ( GAME_HEIGHT / 2 ) *
					( Math.cos( pitch ) / usable + Math.sin( pitch ) ) * FIT_MARGIN * breath;

				// Then lift the framing by half the status line, so the sector
				// centres in the space above the scores and not in the canvas.
				const rise = framing.statusFraction * range * tanFov / Math.cos( pitch );

				_position.set( swayX, - rise - Math.sin( pitch ) * range + swayY, Math.cos( pitch ) * range );
				_target.set( 0, - rise, 0 );
				_dummy.up.set( 0, 1, 0 );
				break;

			}

			case ViewMode.CHASE: {

				// Behind and above the ship, looking along its heading. Up is
				// the sector's normal here, so the plane reads as ground.
				const dx = Math.sin( this.heading );
				const dy = - Math.cos( this.heading );

				_position.set( this.focus.x - dx * 150, this.focus.y - dy * 150, 128 );
				_target.set( this.focus.x + dx * 90, this.focus.y + dy * 90, 0 );
				_dummy.up.set( 0, 0, 1 );
				break;

			}

			case ViewMode.COCKPIT: {

				const dx = Math.sin( this.heading );
				const dy = - Math.cos( this.heading );

				// Just past the ship's nose, so its own exhaust is behind the
				// lens rather than filling it.
				_position.set( this.focus.x + dx * 22, this.focus.y + dy * 22, 24 );
				_target.set( this.focus.x + dx * 420, this.focus.y + dy * 420, 6 );
				_dummy.up.set( 0, 0, 1 );
				break;

			}

			default:
				break;

		}

		_dummy.position.copy( _position );
		_dummy.lookAt( _target );
		_quaternion.copy( _dummy.quaternion );

	}

}

/** Smooth start and finish, so the flight has no visible corners. */
function ease( t: number ): number {

	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow( - 2 * t + 2, 3 ) / 2;

}

/** Folds an angle into -PI..PI. */
function wrapAngle( a: number ): number {

	return Math.atan2( Math.sin( a ), Math.cos( a ) );

}
