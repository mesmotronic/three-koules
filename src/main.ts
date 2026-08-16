// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import './main.css';
import { Koules } from './Koules.js';

const container = document.getElementById( 'container' );
const boot = document.getElementById( 'boot' );
const message = document.getElementById( 'boot-message' );

if ( container === null || boot === null || message === null ) {

	throw new Error( 'three-koules: page markup is missing' );

}

/** Shows a readable message instead of a blank canvas when WebGPU is absent. */
function fail( text: string ): void {

	boot!.classList.add( 'error' );
	boot!.classList.remove( 'hidden' );
	message!.textContent = text;

}

async function start(): Promise<void> {

	if ( navigator.gpu === undefined ) {

		fail(
			'This port renders with WebGPU, which this browser does not expose. ' +
			'Try a current version of Chrome, Edge or Safari.'
		);

		return;

	}

	const koules = new Koules( container! );

	try {

		await koules.init();

	} catch ( error ) {

		fail( `WebGPU failed to start: ${ error instanceof Error ? error.message : String( error ) }` );
		return;

	}

	boot!.classList.add( 'hidden' );
	koules.start();

}

void start();
