// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { PostProcessing, type Camera, type Renderer, type Scene } from 'three/webgpu';
import { float, mrt, output, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/** The bloom pass plus the knob that switches it off. */
export interface BloomPipeline {
	postProcessing: PostProcessing;
	/** 0 disables the effect without rebuilding the graph. */
	setEnabled( enabled: boolean ): void;
}

/**
 * Selective bloom, driven by a `bloomIntensity` channel on the scene's MRT.
 *
 * Every material declares how much it glows via `setBloom()`, and the pass
 * default of zero means anything unmarked — the backdrop, the sector floor —
 * stays crisp. This is the approach `webgpu_postprocessing_bloom_selective`
 * uses, and it suits Koules well: the original's brightest objects were its
 * palette-ramped spheres and its white hot spit lines, which is exactly what
 * gets tagged here.
 */
export function createBloomPipeline( renderer: Renderer, scene: Scene, camera: Camera ): BloomPipeline {

	const scenePass = pass( scene, camera );

	scenePass.setMRT( mrt( {
		output,
		bloomIntensity: float( 0 )
	} ) );

	const outputPass = scenePass.getTextureNode();
	const bloomIntensityPass = scenePass.getTextureNode( 'bloomIntensity' );

	const bloomPass = bloom( outputPass.mul( bloomIntensityPass ), 0.7, 0.32, 0.05 );

	// Two finished graphs, swapped on demand. Zeroing the bloom's input would
	// leave its whole blur pyramid rendering every frame to produce black.
	const withBloom = outputPass.add( bloomPass ).renderOutput();
	const withoutBloom = outputPass.renderOutput();

	const postProcessing = new PostProcessing( renderer );
	postProcessing.outputNode = withBloom;

	let current = true;

	return {
		postProcessing,
		setEnabled( value: boolean ): void {

			if ( value === current ) return;

			current = value;
			postProcessing.outputNode = value ? withBloom : withoutBloom;
			postProcessing.needsUpdate = true;

		}
	};

}
