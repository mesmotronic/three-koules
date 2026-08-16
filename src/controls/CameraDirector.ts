// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { Camera, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu';

import { GAME_HEIGHT, RAD, ViewMode, toWorldX, toWorldY } from '../core/Constants.js';
import type { GameObject } from '../game/GameObject.js';

/** Seconds a change of view takes to fly. */
const TRANSITION = 1.15;

/** How quickly a following camera catches up, per second. */
const FOLLOW_RATE = 6;

/** How quickly the followed heading catches up. Slower, or it whips. */
const HEADING_RATE = 2.6;

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
interface Pose {
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

/**
 * Places the camera, and flies it between the game's points of view.
 *
 * The simulation is resolutely two dimensional — it was written for a
 * framebuffer — so none of this touches gameplay. What it does change is which
 * way is up: in the two following modes the camera turns with the ship, and a
 * player pressing "up" means "away from me" rather than "towards the top of the
 * sector". {@link headingOffset} carries that rotation back to the input code so
 * the controls stay honest, which is the only concession the modes need.
 *
 * Transitions interpolate position and orientation as a quaternion rather than
 * as angles, because the top-down and following views disagree about which axis
 * is up and slerp is the only thing that crosses that cleanly.
 */
export class CameraDirector {

	mode: ViewMode = ViewMode.TOP;

	/** Distance at which the whole sector fits, from the layout. */
	distance = 1000;

	/** World units the sector sits above the viewport centre. */
	lift = 0;

	/** Idle drift, disabled during a crawl and by the menu setting. */
	driftEnabled = true;

	private transition = 0;
	private readonly fromPosition = new Vector3();
	private readonly fromQuaternion = new Quaternion();
	private fromFov = TOP_FOV;

	/** Smoothed ship heading the following modes track. */
	private heading = Math.PI;

	/** Smoothed ship position, so a respawn does not snap the camera. */
	private readonly focus = new Vector3();
	private hasFocus = false;

	constructor( readonly camera: PerspectiveCamera ) {}

	/**
	 * Rotation to add to a player's input so that "up" means "away from the
	 * camera". Zero in the two fixed views, where the sector is already square
	 * to the screen.
	 */
	get headingOffset(): number {

		return POSES[ this.mode ].rotating ? this.heading - Math.PI : 0;

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

	/**
	 * @param delta - Seconds since the last frame.
	 * @param elapsed - Total elapsed seconds, for the idle drift.
	 * @param player - The ship the following modes track, if there is one.
	 */
	update( delta: number, elapsed: number, player: GameObject | null ): void {

		this.followPlayer( delta, player );
		this.poseFor( this.mode, elapsed );

		const pose = POSES[ this.mode ];

		if ( this.transition < 1 ) {

			this.transition = Math.min( 1, this.transition + delta / TRANSITION );

			const t = ease( this.transition );

			this.camera.position.lerpVectors( this.fromPosition, _position, t );
			this.camera.quaternion.slerpQuaternions( this.fromQuaternion, _quaternion, t );
			this.camera.fov = MathUtils.lerp( this.fromFov, pose.fov, t );
			this.camera.updateProjectionMatrix();
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

		if ( this.camera.fov !== pose.fov ) {

			this.camera.fov = pose.fov;
			this.camera.updateProjectionMatrix();

		}

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

	/** Writes the target position and orientation for a mode into the scratch. */
	private poseFor( mode: ViewMode, elapsed: number ): void {

		const drift = this.driftEnabled && ! POSES[ mode ].rotating;
		const swayX = drift ? Math.sin( elapsed * 0.13 ) * 9 + Math.sin( elapsed * 0.31 ) * 2.5 : 0;
		const swayY = drift ? Math.cos( elapsed * 0.17 ) * 7 : 0;
		const breath = drift ? 1 + Math.sin( elapsed * 0.09 ) * 0.014 : 1;

		switch ( mode ) {

			case ViewMode.TOP: {

				_position.set( swayX, - this.lift + swayY, this.distance * breath );
				_target.set( swayX * 0.35, - this.lift + swayY * 0.35, 0 );
				_dummy.up.set( 0, 1, 0 );
				break;

			}

			case ViewMode.ANGLED: {

				// Tipped back about the x axis so the near edge of the sector
				// splays toward the viewer and the far edge narrows away.
				const pitch = RAD( 34 );
				const range = this.distance * 1.06 * breath;

				_position.set(
					swayX,
					- this.lift - Math.sin( pitch ) * range + swayY,
					Math.cos( pitch ) * range
				);
				// Aiming a little above centre keeps the trapezoid balanced,
				// since its near edge takes up more of the frame.
				_target.set( 0, - this.lift + GAME_HEIGHT * 0.06, 0 );
				_dummy.up.set( 0, 1, 0 );
				break;

			}

			case ViewMode.CHASE: {

				// Behind and above the ship, looking along its heading. Up is
				// the sector's normal here, so the plane reads as ground.
				const dx = Math.sin( this.heading );
				const dy = - Math.cos( this.heading );

				_position.set(
					this.focus.x - dx * 150,
					this.focus.y - dy * 150,
					128
				);
				_target.set( this.focus.x + dx * 90, this.focus.y + dy * 90, 0 );
				_dummy.up.set( 0, 0, 1 );
				break;

			}

			case ViewMode.COCKPIT: {

				const dx = Math.sin( this.heading );
				const dy = - Math.cos( this.heading );

				// Just past the ship's nose, so its own exhaust is behind the
				// lens rather than filling it.
				_position.set(
					this.focus.x + dx * 22,
					this.focus.y + dy * 22,
					24
				);
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
