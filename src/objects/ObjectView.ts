// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	RingGeometry,
	SphereGeometry,
	Sprite,
	SpriteNodeMaterial,
	type Texture
} from 'three/webgpu';

import { EYE_RADIUS, EYE_RADIUS1, Letter, ObjectType, RAD } from '../core/Constants.js';
import type { GameObject } from '../game/GameObject.js';
import { type Appearance, bodyMaterial, glowMaterial, setBloom } from '../materials/BodyMaterials.js';
import { letterTexture } from '../materials/LetterTextures.js';

/** Shared geometry — every creature in Koules is a sphere at heart. */
const SPHERE = new SphereGeometry( 1, 32, 20 );
const RING = new RingGeometry( 0.45, 1.2, 48 );
const STALK = new CylinderGeometry( 0.055, 0.09, 1, 8 );

/** Maps a live object to the bitmap `koules.c` would have blitted for it. */
export function appearanceOf( object: GameObject, index: number ): Appearance | null {

	switch ( object.type ) {

		case ObjectType.BALL: return 'ball';

		case ObjectType.LBALL:
			switch ( object.letter ) {

				case Letter.ACCEL: return 'accel';
				case Letter.GUMM: return 'gumm';
				case Letter.THIEF: return 'thief';
				case Letter.FINDER: return 'finder';
				case Letter.TTOOL: return 'ttool';
				default: return 'ball';

			}

		case ObjectType.BBALL: return 'bball';
		case ObjectType.INSPECTOR: return 'inspector';
		case ObjectType.LUNATIC: return 'lunatic';
		case ObjectType.APPLE: return 'apple';
		case ObjectType.HOLE: return 'hole';
		case ObjectType.EHOLE: return 'ehole';
		case ObjectType.ROCKET: return `rocket${ ( index % 5 ) as 0 | 1 | 2 | 3 | 4 }`;
		default: return null;

	}

}

/**
 * The visual for one slot of the object array.
 *
 * Slots are recycled by the simulation — a koule becomes a lettered koule,
 * then a plain koule again — so a view reconfigures itself in place rather
 * than being torn down and rebuilt.
 */
export class ObjectView extends Group {

	private readonly body = new Mesh( SPHERE, bodyMaterial( 'ball' ) );

	/** Accretion disc, only shown for the two kinds of hole. */
	private ring: Mesh | null = null;

	/** The rocket's pair of eyes, or the boss's single one. */
	private eyes: Mesh[] = [];

	/** The boss's stalk. */
	private stalk: Mesh | null = null;

	/** Decal carrying a pickup's letter. */
	private decal: Sprite | null = null;

	private appearance: Appearance | null = null;
	private eyeAppearance: Appearance | null = null;
	private decalLetter: Letter = Letter.NONE;

	constructor() {

		super();
		this.visible = false;
		this.body.castShadow = true;
		this.add( this.body );

	}

	/**
	 * Rebuilds the attachments this appearance needs.
	 *
	 * Cheap enough to call every frame; it returns immediately unless the
	 * object has actually changed into something else.
	 */
	private configure( appearance: Appearance, object: GameObject, index: number ): void {

		const isHole = appearance === 'hole' || appearance === 'ehole';
		const isRocket = appearance.startsWith( 'rocket' );
		const isApple = appearance === 'apple';

		if ( appearance !== this.appearance ) {

			this.appearance = appearance;
			this.body.material = bodyMaterial( appearance );

			this.setRing( isHole ? appearance : null );
			this.setStalk( isApple );

		}

		// Eyes: two for a rocket, one for the boss, none for anything else.
		// A rocket carrying a stolen toolkit shows thief koules instead, which
		// is the tell that it can rob you.
		const eyeAppearance: Appearance | null = isRocket
			? ( object.thief ? 'thief' : `eye${ ( index % 5 ) as 0 | 1 | 2 | 3 | 4 }` )
			: ( isApple ? 'eye0' : null );

		const eyeCount = isRocket ? 2 : ( isApple ? 1 : 0 );
		this.setEyes( eyeAppearance, eyeCount, object.thief === 1 );

		this.setDecal( object.type === ObjectType.LBALL ? object.letter : Letter.NONE );

	}

	private setRing( appearance: Appearance | null ): void {

		if ( appearance === null ) {

			if ( this.ring !== null ) { this.remove( this.ring ); this.ring = null; }
			return;

		}

		if ( this.ring === null ) {

			this.ring = new Mesh( RING, glowMaterial( appearance ) );
			this.add( this.ring );

		} else {

			this.ring.material = glowMaterial( appearance );

		}

	}

	private setStalk( wanted: boolean ): void {

		if ( ! wanted ) {

			if ( this.stalk !== null ) { this.remove( this.stalk ); this.stalk = null; }
			return;

		}

		if ( this.stalk !== null ) return;

		const material = new MeshBasicNodeMaterial( { color: 0x9a7a3c } );
		setBloom( material, 0.2 );

		this.stalk = new Mesh( STALK, material );
		this.add( this.stalk );

	}

	private setEyes( appearance: Appearance | null, count: number, thief: boolean ): void {

		while ( this.eyes.length > count ) {

			const eye = this.eyes.pop();
			if ( eye !== undefined ) this.remove( eye );

		}

		if ( appearance === null || count === 0 ) {

			this.eyeAppearance = null;
			return;

		}

		while ( this.eyes.length < count ) {

			const eye = new Mesh( SPHERE, bodyMaterial( appearance ) );
			eye.castShadow = true;
			this.eyes.push( eye );
			this.add( eye );

		}

		if ( appearance !== this.eyeAppearance ) {

			this.eyeAppearance = appearance;
			for ( const eye of this.eyes ) eye.material = bodyMaterial( appearance );

		}

		// A thief's stolen koules ride slightly larger than ordinary eyes,
		// mirroring the original swapping in the full sized ball bitmap.
		const scale = thief ? 8 : EYE_RADIUS;
		for ( const eye of this.eyes ) eye.scale.setScalar( scale );

	}

	private setDecal( letter: Letter ): void {

		if ( letter === this.decalLetter ) return;
		this.decalLetter = letter;

		if ( letter === Letter.NONE ) {

			if ( this.decal !== null ) { this.remove( this.decal ); this.decal = null; }
			return;

		}

		const texture: Texture | null = letterTexture( letter );
		if ( texture === null ) return;

		if ( this.decal === null ) {

			const material = new SpriteNodeMaterial( {
				map: texture,
				transparent: true,
				depthWrite: false,
				sizeAttenuation: true
			} );
			setBloom( material, 0.3 );

			this.decal = new Sprite( material );
			this.add( this.decal );

		} else {

			( this.decal.material as SpriteNodeMaterial ).map = texture;
			( this.decal.material as SpriteNodeMaterial ).needsUpdate = true;

		}

	}

	/**
	 * Positions the view for the current frame.
	 *
	 * @param object - Simulation state for this slot.
	 * @param index - Slot number, which also selects a player's colours.
	 * @param alpha - Fraction through the current 25 Hz tick.
	 */
	update( object: GameObject, index: number, alpha: number ): void {

		const appearance = object.live ? appearanceOf( object, index ) : null;

		if ( appearance === null ) {

			this.visible = false;
			return;

		}

		this.visible = true;
		this.configure( appearance, object, index );

		this.position.set( object.worldX( alpha ), object.worldY( alpha ), 0 );
		this.body.scale.setScalar( object.radius );

		// Keep the boss's squash after the uniform scale above.
		if ( appearance === 'apple' ) this.body.scale.set( object.radius * 1.06, object.radius * 0.94, object.radius );

		if ( this.ring !== null ) {

			this.ring.scale.setScalar( object.radius );
			// Sit the disc in front of the sphere's near pole; left at the
			// centre it would be swallowed by the very body it surrounds.
			this.ring.position.z = object.radius * 1.05;
			// A slow counter-rotation, standing in for the original's spiky
			// star bitmap, which appeared to churn as objects passed it.
			this.ring.rotation.z -= appearance === 'ehole' ? 0.03 : 0.018;

		}

		if ( this.stalk !== null ) {

			this.stalk.scale.set( object.radius, object.radius * 0.7, object.radius );
			this.stalk.position.set( object.radius * 0.3, object.radius * 1.2, 0 );
			this.stalk.rotation.z = RAD( 22 );

		}

		if ( this.decal !== null ) {

			this.decal.scale.setScalar( object.radius * 1.5 );
			this.decal.position.set( 0, 0, object.radius * 0.85 );

		}

		// Eyes ride the hull at +/- 30 degrees off the facing direction. The
		// original's y axis pointed down, so the world y offset is negated.
		//
		// In two dimensions the eyes simply overlapped the hull bitmap. On a
		// sphere they have to be lifted to the surface, or they vanish inside
		// it: at 10 units out on a radius 14 hull, the surface is 9.8 up.
		if ( this.eyes.length === 2 ) {

			const rot = object.rotationAt( alpha );
			const surface = Math.sqrt( Math.max( 1, object.radius * object.radius - EYE_RADIUS1 * EYE_RADIUS1 ) );

			for ( let e = 0; e < 2; e ++ ) {

				const a = rot + ( e === 0 ? - RAD( 30 ) : RAD( 30 ) );

				this.eyes[ e ].position.set(
					Math.sin( a ) * EYE_RADIUS1,
					- Math.cos( a ) * EYE_RADIUS1,
					surface + ( object.thief ? 4 : 2 )
				);

			}

		} else if ( this.eyes.length === 1 ) {

			// The boss's single eye sat low on its body.
			const offset = object.radius - 15;
			const surface = Math.sqrt( Math.max( 1, object.radius * object.radius - offset * offset ) );

			this.eyes[ 0 ].position.set( 0, - offset, surface * 0.85 );
			this.eyes[ 0 ].scale.setScalar( EYE_RADIUS * 1.6 );

		}

	}

}

