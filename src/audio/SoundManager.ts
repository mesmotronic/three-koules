// SPDX-FileCopyrightText: © 1994-1995 Sujal M. Patel
// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { Sample } from '../core/Constants.js';

/** The seven samples from `sounds/`, in `S_*` order. */
const FILES: readonly string[] = [
	'start', 'end', 'colize', 'destroy1', 'destroy2', 'creator1', 'creator2'
];

/**
 * Per sample gain. The originals are 8 kHz 8-bit recordings whose levels are
 * all over the place; these bring them into rough balance.
 */
const GAINS: readonly number[] = [ 0.55, 0.55, 0.30, 0.5, 0.5, 0.35, 0.35 ];

/** How many voices one sample may occupy at once, so pile-ups stay audible. */
const MAX_VOICES = 4;

/** Events a browser will accept as the gesture that starts audio. */
const GESTURES: readonly string[] = [ 'pointerdown', 'keydown', 'touchstart' ];

/**
 * `sound.c` and `koules.sndsrv.*` over the Web Audio API.
 *
 * The original forked a helper process and wrote one byte per effect down a
 * pipe. Here each effect is a decoded buffer played through a shared gain, and
 * per-sample voice limits stand in for the sound server's mixing budget.
 */
export class SoundManager {

	private context: AudioContext | null = null;
	private master: GainNode | null = null;
	private buffers: ( AudioBuffer | null )[] = [];
	private voices: number[] = new Array( FILES.length ).fill( 0 );

	enabled = true;

	/** Decodes every sample. Safe to call before the first user gesture. */
	async load( baseUrl = 'sounds/' ): Promise<void> {

		const context = new AudioContext();
		this.context = context;

		const master = context.createGain();
		master.gain.value = 0.8;
		master.connect( context.destination );
		this.master = master;

		this.buffers = await Promise.all( FILES.map( async name => {

			try {

				const response = await fetch( `${ baseUrl }${ name }.wav` );
				if ( ! response.ok ) return null;

				return await context.decodeAudioData( await response.arrayBuffer() );

			} catch {

				// A missing or undecodable sample simply stays silent.
				return null;

			}

		} ) );

	}

	/** Browsers suspend new contexts until a gesture unlocks them. */
	resume(): void {

		void this.context?.resume();

	}

	/**
	 * Arms the context to start on the player's first input.
	 *
	 * The game goes straight into its opening crawl with nothing to click, so
	 * there is no gesture to hang the unlock on. Browsers will not start an
	 * audio context without one, which means the first few seconds are silent
	 * until the player touches a key, a pad or the screen — at which point
	 * this fires once and gets out of the way.
	 */
	unlockOnGesture(): void {

		const unlock = (): void => {

			this.resume();

			for ( const type of GESTURES ) window.removeEventListener( type, unlock );

		};

		for ( const type of GESTURES ) window.addEventListener( type, unlock, { passive: true } );

	}

	/** `play_sound()`. */
	play( sample: Sample ): void {

		const { context, master } = this;

		if ( ! this.enabled || context === null || master === null ) return;
		if ( context.state !== 'running' ) return;

		const buffer = this.buffers[ sample ];
		if ( ! buffer ) return;

		if ( this.voices[ sample ] >= MAX_VOICES ) return;
		this.voices[ sample ] ++;

		const source = context.createBufferSource();
		source.buffer = buffer;

		const gain = context.createGain();
		gain.gain.value = GAINS[ sample ] ?? 0.5;

		source.connect( gain );
		gain.connect( master );
		source.onended = () => {

			this.voices[ sample ] --;
			source.disconnect();
			gain.disconnect();

		};

		source.start();

	}

	dispose(): void {

		void this.context?.close();
		this.context = null;
		this.master = null;

	}

}
