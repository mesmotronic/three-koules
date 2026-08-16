// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { BoxGeometry, Group, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';

import type { GameObject } from '../game/GameObject.js';
import { setBloom } from '../materials/BodyMaterials.js';

/** A unit bar along x, stretched between two objects. */
const BAR = new BoxGeometry( 1, 1, 1 );

const THICKNESS = 2.2;

/**
 * The tethers a cornered koule spits onto whoever touched it.
 *
 * `koules.c` drew these as plain white one pixel lines in palette entry 255.
 * Here they are thin emissive bars so the bloom pass gives them the same
 * hot, over-bright look the VGA white had against a near black field.
 */
export class SpringField extends Group {

	private readonly bars: Mesh[] = [];
	private readonly material: MeshBasicNodeMaterial;

	constructor() {

		super();

		this.material = new MeshBasicNodeMaterial( { color: 0xf2f6ff } );
		setBloom( this.material, 1.5 );

	}

	/**
	 * Rebuilds the tethers for this frame.
	 *
	 * @param objects - The simulation's object array.
	 * @param nobjects - How much of it is in use.
	 * @param alpha - Fraction through the current tick.
	 */
	update( objects: readonly GameObject[], nobjects: number, alpha: number ): void {

		let used = 0;

		for ( let i = 0; i < nobjects; i ++ ) {

			const from = objects[ i ];
			if ( ! from.live || from.lineto === - 1 ) continue;

			const to = objects[ from.lineto ];
			if ( ! to.live ) continue;

			const x1 = from.worldX( alpha );
			const y1 = from.worldY( alpha );
			const x2 = to.worldX( alpha );
			const y2 = to.worldY( alpha );

			const dx = x2 - x1;
			const dy = y2 - y1;
			const length = Math.sqrt( dx * dx + dy * dy );
			if ( length < 0.001 ) continue;

			const bar = this.barAt( used ++ );

			bar.visible = true;
			bar.position.set( ( x1 + x2 ) / 2, ( y1 + y2 ) / 2, 0 );
			bar.rotation.z = Math.atan2( dy, dx );
			bar.scale.set( length, THICKNESS, THICKNESS );

		}

		for ( let i = used; i < this.bars.length; i ++ ) this.bars[ i ].visible = false;

	}

	private barAt( index: number ): Mesh {

		let bar = this.bars[ index ];

		if ( bar === undefined ) {

			bar = new Mesh( BAR, this.material );
			this.bars[ index ] = bar;
			this.add( bar );

		}

		return bar;

	}

}
