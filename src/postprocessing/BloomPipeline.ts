// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { PostProcessing, type Camera, type Renderer, type Scene } from 'three/webgpu';
import { float, mrt, output, pass, uniform } from 'three/tsl';
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

	const enabled = uniform( 1 );
	const bloomPass = bloom( outputPass.mul( bloomIntensityPass ).mul( enabled ), 0.7, 0.32, 0.05 );

	const postProcessing = new PostProcessing( renderer );
	postProcessing.outputNode = outputPass.add( bloomPass ).renderOutput();

	return {
		postProcessing,
		setEnabled( value: boolean ): void {

			enabled.value = value ? 1 : 0;

		}
	};

}
