// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	AmbientLight,
	BoxGeometry,
	CanvasTexture,
	Color,
	DirectionalLight,
	Group,
	LinearFilter,
	Mesh,
	MeshBasicNodeMaterial,
	PlaneGeometry,
	PointLight,
	RepeatWrapping,
	SRGBColorSpace,
	ShadowNodeMaterial
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { GAME_HEIGHT, GAME_WIDTH } from '../core/Constants.js';
import { PALETTE, back, paletteColor } from '../core/Palette.js';
import { setBloom } from '../materials/BodyMaterials.js';
import { randMod } from '../core/Random.js';

/** Resolution of the generated backdrop. */
const BACKDROP_SIZE = 512;

/**
 * `createbackground()` — the dark, faintly mottled field the game played on.
 *
 * Each pixel diffuses its left and upper neighbours plus a little noise, then
 * clamps to the bottom ten entries of the background ramp. The result is a
 * very dark blue cloud, which is exactly what the original looked like despite
 * the source calling it "fancy dark red".
 */
function createBackdropTexture(): CanvasTexture {

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = BACKDROP_SIZE;

	const ctx = canvas.getContext( '2d' );
	if ( ctx === null ) return new CanvasTexture( canvas );

	const image = ctx.createImageData( BACKDROP_SIZE, BACKDROP_SIZE );
	const data = image.data;
	const ramp = new Uint8Array( BACKDROP_SIZE * BACKDROP_SIZE );

	for ( let y = 0; y < BACKDROP_SIZE; y ++ ) {

		for ( let x = 0; x < BACKDROP_SIZE; x ++ ) {

			const p = y * BACKDROP_SIZE + x;
			let sum = 0;
			let n = 0;

			if ( x > 0 ) { sum += ramp[ p - 1 ]; n ++; }
			if ( y > 0 ) { sum += ramp[ p - BACKDROP_SIZE ]; n ++; }

			let c = Math.trunc( ( sum + randMod( 16 ) ) / ( n + 1 ) );
			if ( c > 9 ) c = 9;
			ramp[ p ] = c;

			const entry = back( c ) * 3;
			data[ p * 4 + 0 ] = Math.round( PALETTE[ entry + 0 ] * 255 );
			data[ p * 4 + 1 ] = Math.round( PALETTE[ entry + 1 ] * 255 );
			data[ p * 4 + 2 ] = Math.round( PALETTE[ entry + 2 ] * 255 );
			data[ p * 4 + 3 ] = 255;

		}

	}

	ctx.putImageData( image, 0, 0 );

	const texture = new CanvasTexture( canvas );
	texture.colorSpace = SRGBColorSpace;
	texture.wrapS = texture.wrapT = RepeatWrapping;
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;

	return texture;

}

/**
 * The inset square sector: its floor, its glowing boundary and its lights.
 *
 * The boundary is new. In the original the sector edge was invisible and you
 * learned it by losing koules — and lives — to it. A frame costs nothing and
 * makes the inset presentation legible.
 */
export class Playfield extends Group {

	/** The boundary's material, tinted when something dies against the wall. */
	private frameMaterial: MeshBasicNodeMaterial | null = null;
	// `drawbackground()` ruled its divider under the playfield in `back(16)`;
	// the sector frame is drawn from the same ramp, a little brighter so the
	// boundary reads at a glance.
	private readonly frameColor = paletteColor( back( 20 ), new Color() );
	private readonly flashColor = new Color( 0xbcd8ff );
	private flash = 0;

	/** The key light's shadow, redrawn only when something has moved. */
	private keyShadow: DirectionalLight[ 'shadow' ] | null = null;

	constructor() {

		super();

		// --- floor ----------------------------------------------------------

		// Unlit: the original wrote these bytes straight into the framebuffer,
		// so no light ever touched them. Shading the floor is what turns a
		// faithful palette into a glowing blue swimming pool.
		const floor = new Mesh(
			new PlaneGeometry( GAME_WIDTH, GAME_HEIGHT ),
			new MeshBasicNodeMaterial( { map: createBackdropTexture() } )
		);
		// Deep enough that even the boss's 32 unit radius clears it when the
		// camera is low, since every object is centred on the plane.
		floor.position.z = - 40;
		this.add( floor );

		// A shadow catcher just above it. The floor itself has to stay unlit
		// to keep the palette honest, and an unlit material cannot receive a
		// shadow, so the shadows are drawn onto a transparent plane instead —
		// which also means their strength is a dial rather than a consequence
		// of the lighting rig.
		const shadows = new Mesh(
			new PlaneGeometry( GAME_WIDTH, GAME_HEIGHT ),
			new ShadowNodeMaterial( { transparent: true, opacity: 0.55, color: 0x000000 } )
		);
		shadows.position.z = - 39;
		shadows.receiveShadow = true;
		this.add( shadows );

		// --- boundary -------------------------------------------------------

		const thickness = 3;
		const depth = 10;
		this.frameMaterial = new MeshBasicNodeMaterial( { color: this.frameColor } );
		setBloom( this.frameMaterial, 0.8 );

		// The bars sit just outside the sector rather than straddling its edge.
		// Centred on the boundary they overlapped down the middle and the long
		// horizontals still stood a half thickness proud of the verticals, so
		// every corner had a little tab hanging off it. Offset by half their
		// thickness they butt together exactly: the horizontals own the corner
		// squares and the verticals run between them.
		const offsetX = GAME_WIDTH / 2 + thickness / 2;
		const offsetY = GAME_HEIGHT / 2 + thickness / 2;

		const bars = [
			new BoxGeometry( GAME_WIDTH + thickness * 2, thickness, depth ).translate( 0, offsetY, 0 ),
			new BoxGeometry( GAME_WIDTH + thickness * 2, thickness, depth ).translate( 0, - offsetY, 0 ),
			new BoxGeometry( thickness, GAME_HEIGHT, depth ).translate( - offsetX, 0, 0 ),
			new BoxGeometry( thickness, GAME_HEIGHT, depth ).translate( offsetX, 0, 0 )
		];

		// One mesh rather than four: the frame never moves independently, and a
		// single draw is one less thing for each split-screen viewport to do.
		const merged = mergeGeometries( bars );
		for ( const bar of bars ) bar.dispose();

		this.add( new Mesh( merged, this.frameMaterial ) );

		// --- lighting -------------------------------------------------------

		// `draw_ball_bitmap` put its highlight up and to the left of centre, so
		// the key light sits there; the rest is fill to keep the dark side of
		// each sphere from going flat black.
		const key = new DirectionalLight( 0xfff2e0, 2.6 );
		key.position.set( - 0.55, 0.8, 1 ).normalize().multiplyScalar( 900 );
		key.castShadow = true;

		// An orthographic frustum sized to the sector: everything that can cast
		// is inside it, so there is nothing to gain from fitting it per frame.
		const shadow = key.shadow.camera;
		// Generous rather than tight: the sector is seen at an angle from the
		// light, so its footprint on the shadow plane is wider than the sector.
		shadow.left = - GAME_WIDTH * 0.9;
		shadow.right = GAME_WIDTH * 0.9;
		shadow.top = GAME_HEIGHT * 0.9;
		shadow.bottom = - GAME_HEIGHT * 0.9;
		shadow.near = 100;
		shadow.far = 2000;
		shadow.updateProjectionMatrix();

		key.shadow.mapSize.set( 2048, 2048 );
		// The floor sits 40 units below objects centred on the plane, so the
		// bias only has to cover that gap rather than a deep scene.
		key.shadow.bias = - 0.0008;
		key.shadow.normalBias = 2;

		// Redrawn on demand rather than automatically. The light is orthographic
		// and welded to the sector, so the map depends on where the objects are
		// and on nothing else — least of all on which camera is looking. Three
		// tracks staleness per camera, so left on automatic it would redraw the
		// whole 2048 square map once for every split-screen viewport. Asking for
		// it once a frame instead lets the first viewport draw it and the rest
		// share it, and lets a paused game skip the pass altogether.
		key.shadow.autoUpdate = false;
		this.keyShadow = key.shadow;

		this.add( key );
		this.add( key.target );

		const rim = new DirectionalLight( 0x6fa8ff, 0.7 );
		rim.position.set( 0.7, - 0.5, 0.4 );
		this.add( rim );

		this.add( new AmbientLight( 0x24365c, 1.1 ) );

		// A soft glow over the middle of the sector, so objects read against
		// the backdrop even when they drift away from the key light.
		const centre = new PointLight( 0x89b6ff, 26000, 0, 2 );
		centre.position.set( 0, 0, 210 );
		this.add( centre );

	}

	/**
	 * Marks the shadow map stale.
	 *
	 * Called once per rendered frame while anything is moving — objects are
	 * interpolated between ticks, so a map refreshed at the tick rate would
	 * visibly trail them. The first viewport drawn redraws it; the rest reuse
	 * it, which is the whole point.
	 */
	invalidateShadows(): void {

		if ( this.keyShadow !== null ) this.keyShadow.needsUpdate = true;

	}

	/** Kicks the boundary glow, called when something dies against the wall. */
	pulse(): void {

		this.flash = 0.55;

	}

	update( delta: number ): void {

		if ( this.flash <= 0 ) return;

		this.flash = Math.max( 0, this.flash - delta * 4 );

		this.frameMaterial?.color.copy( this.frameColor ).lerp( this.flashColor, this.flash );

	}

}
