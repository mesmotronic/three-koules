// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import {
	Color,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	AdditiveBlending,
	type Material
} from 'three/webgpu';
import { mrt, uniform } from 'three/tsl';

import { ROCKET_COLOR } from '../core/Constants.js';
import { paletteColor } from '../core/Palette.js';

/**
 * The distinct looks `framebuffer.c` baked into bitmaps at startup.
 *
 * Each was a 32 step ramp starting at a palette index. Two shading functions
 * were used: the normal one spanned the whole ramp with a highlight up and to
 * the left, and `draw_reversed_ball_bitmap` used only the brighter half, which
 * is why thieves, finders and lunatics read as flat and glowing.
 */
export type Appearance =
	| 'ball' | 'accel' | 'gumm' | 'thief' | 'finder' | 'ttool'
	| 'bball' | 'inspector' | 'lunatic' | 'apple'
	| 'hole' | 'ehole'
	| 'rocket0' | 'rocket1' | 'rocket2' | 'rocket3' | 'rocket4'
	| 'eye0' | 'eye1' | 'eye2' | 'eye3' | 'eye4';

interface Recipe {
	/** Palette ramp base, as passed to the original's bitmap builders. */
	base: number;
	/** True for the ramps drawn with `draw_reversed_ball_bitmap`. */
	reversed?: boolean;
	roughness?: number;
	metalness?: number;
	/** Emissive strength as a fraction of the base colour. */
	emissive?: number;
	/** How strongly this appearance feeds the bloom pass. */
	bloom?: number;
}

/**
 * Sampling a ramp at `base + 8` lands near the middle of the lit half, which
 * is the closest single colour to what the old dithered sphere read as. The
 * reversed ramps only ever used `base + 16` upward, so they are sampled higher.
 */
const NORMAL_OFFSET = 8;
const REVERSED_OFFSET = 24;

const RECIPES: Readonly<Record<Appearance, Recipe>> = {
	// Koules and their pickups.
	ball: { base: 64, roughness: 0.34, emissive: 0.20, bloom: 0.35 },
	accel: { base: 4 * 32, roughness: 0.30, emissive: 0.30, bloom: 0.7 },
	gumm: { base: 5 * 32, roughness: 0.30, emissive: 0.30, bloom: 0.7 },
	thief: { base: 192, reversed: true, roughness: 0.45, emissive: 0.35, bloom: 0.8 },
	finder: { base: 0, reversed: true, roughness: 0.45, emissive: 0.40, bloom: 0.9 },
	ttool: { base: 3 * 32 - 5, reversed: true, roughness: 0.45, emissive: 0.30, bloom: 0.6 },

	// Heavier creatures.
	bball: { base: 4 * 32, roughness: 0.22, metalness: 0.15, emissive: 0.22, bloom: 0.6 },
	inspector: { base: 160, roughness: 0.28, emissive: 0.25, bloom: 0.5 },
	lunatic: { base: 192, reversed: true, roughness: 0.5, emissive: 0.75, bloom: 1.4 },
	apple: { base: 64, roughness: 0.30, emissive: 0.18, bloom: 0.4 },

	// Holes: the body is the void, the ring is the glow.
	hole: { base: 64, emissive: 0, bloom: 0 },
	ehole: { base: 128, emissive: 0, bloom: 0 },

	// Hulls: `rocketcolor[]` from `koules.c`.
	rocket0: { base: ROCKET_COLOR[ 0 ], roughness: 0.26, emissive: 0.28, bloom: 0.8 },
	rocket1: { base: ROCKET_COLOR[ 1 ], roughness: 0.26, emissive: 0.28, bloom: 0.8 },
	rocket2: { base: ROCKET_COLOR[ 2 ], roughness: 0.26, emissive: 0.28, bloom: 0.8 },
	rocket3: { base: ROCKET_COLOR[ 3 ], roughness: 0.26, emissive: 0.28, bloom: 0.8 },
	rocket4: { base: ROCKET_COLOR[ 4 ], roughness: 0.26, emissive: 0.28, bloom: 0.8 },

	// Eyes: `eye_bitmap[i]` used base `32 + 32 * i`, deliberately different
	// from the hull so each player's eyes contrast with their own colour.
	// Ramp 32..63 runs dark to bright, the opposite way round to the others,
	// so player one is sampled from its far end to land on a readable blue.
	eye0: { base: 32, reversed: true, roughness: 0.2, emissive: 0.55, bloom: 0.9 },
	eye1: { base: 64, roughness: 0.2, emissive: 0.55, bloom: 0.9 },
	eye2: { base: 96, roughness: 0.2, emissive: 0.55, bloom: 0.9 },
	eye3: { base: 128, roughness: 0.2, emissive: 0.55, bloom: 0.9 },
	eye4: { base: 160, roughness: 0.2, emissive: 0.55, bloom: 0.9 }
};

const _bodies = new Map<Appearance, MeshStandardNodeMaterial>();
const _glows = new Map<Appearance, MeshBasicNodeMaterial>();

/** The representative colour of an appearance's palette ramp. */
export function appearanceColor( appearance: Appearance, target = new Color() ): Color {

	const recipe = RECIPES[ appearance ];
	return paletteColor( recipe.base + ( recipe.reversed ? REVERSED_OFFSET : NORMAL_OFFSET ), target );

}

/**
 * Tags a material so the bloom pass picks it up.
 *
 * Selective bloom is done with a `bloomIntensity` channel on the scene's MRT,
 * exactly as `webgpu_postprocessing_bloom_selective` does. Materials without a
 * tag inherit the pass default of zero and stay sharp.
 *
 * The tag is remembered so it can be lifted again: a material carrying an MRT
 * node cannot be drawn straight to the canvas, because the output struct it
 * compiles has no colour member for a target that has only one attachment.
 * See {@link setBloomTagging}.
 */
export function setBloom( material: Material, intensity: number ): void {

	_tagged.set( material, mrt( { bloomIntensity: uniform( intensity ) } ) );
	if ( _tagging ) ( material as MeshStandardNodeMaterial ).mrtNode = _tagged.get( material )!;

}

/** Every material `setBloom` has touched, with the node it was given. */
const _tagged = new Map<Material, ReturnType<typeof mrt>>();
let _tagging = true;

/**
 * Turns the bloom tags on or off across every material at once.
 *
 * Selective bloom needs a second render target, which only the post-processing
 * pass provides. Split screen draws its viewports straight to the canvas, so
 * the tags come off for the duration — the picture loses its glow rather than
 * failing to compile. Called on a change of view, never per frame.
 */
export function setBloomTagging( enabled: boolean ): void {

	if ( enabled === _tagging ) return;
	_tagging = enabled;

	for ( const [ material, node ] of _tagged ) {

		( material as MeshStandardNodeMaterial ).mrtNode = enabled ? node : null;
		material.needsUpdate = true;

	}

}

/** The shaded body material for an appearance, created once and shared. */
export function bodyMaterial( appearance: Appearance ): MeshStandardNodeMaterial {

	const existing = _bodies.get( appearance );
	if ( existing !== undefined ) return existing;

	const recipe = RECIPES[ appearance ];
	const color = appearanceColor( appearance );

	const material = new MeshStandardNodeMaterial( {
		color,
		roughness: recipe.roughness ?? 0.4,
		metalness: recipe.metalness ?? 0
	} );

	// Holes swallow light rather than reflecting it.
	if ( appearance === 'hole' || appearance === 'ehole' ) {

		material.color.setRGB( 0.01, 0.01, 0.015 );
		material.roughness = 1;

	}

	const emissive = recipe.emissive ?? 0;
	if ( emissive > 0 ) material.emissive.copy( color ).multiplyScalar( emissive );

	setBloom( material, recipe.bloom ?? 0 );

	_bodies.set( appearance, material );
	return material;

}

/**
 * An unlit additive material in the appearance's colour.
 *
 * Used for the accretion rings around the two kinds of hole, where the
 * original wrote palette entries straight into the framebuffer rather than
 * shading anything. Sampled mid-ramp: the very top of a ramp is nearly white,
 * which the bloom pass then blows out into a featureless disc.
 */
export function glowMaterial( appearance: Appearance ): MeshBasicNodeMaterial {

	const existing = _glows.get( appearance );
	if ( existing !== undefined ) return existing;

	const material = new MeshBasicNodeMaterial( {
		color: paletteColor( RECIPES[ appearance ].base + 10 ),
		transparent: true,
		blending: AdditiveBlending,
		depthWrite: false
	} );

	setBloom( material, 0.9 );

	_glows.set( appearance, material );
	return material;

}
