// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import './main.css';
import { Koules } from './Koules.js';

const container = document.getElementById( 'container' );
const gate = document.getElementById( 'gate' );
const button = document.getElementById( 'gate-button' );

if ( container === null || gate === null || button === null ) {

	throw new Error( 'three-koules: page markup is missing' );

}

/** Shows a readable message instead of a blank canvas when WebGPU is absent. */
function fail( message: string ): void {

	gate!.classList.add( 'error' );
	gate!.classList.remove( 'hidden' );

	const paragraph = gate!.querySelector( 'p' );
	if ( paragraph !== null ) paragraph.textContent = message;

}

async function boot(): Promise<void> {

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

	button!.addEventListener( 'click', () => {

		gate!.classList.add( 'hidden' );
		koules.start();

	}, { once: true } );

	button!.removeAttribute( 'disabled' );

}

void boot();
