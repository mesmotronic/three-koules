// SPDX-FileCopyrightText: © 1995-1996 Jan Hubicka
// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * The vector font from `font.c`, used only by the scroller.
 *
 * Koules drew its crawl with a bespoke stroke font rather than a bitmap one,
 * because every vertex goes through the perspective divide individually: a
 * glyph near the viewer is a noticeably wider trapezoid at its baseline than
 * at its cap, and no amount of scaling a bitmap reproduces that. Each glyph is
 * assembled from straight segments plus quarter arcs, and each arc is itself
 * only two chords — the whole font is polylines.
 *
 * This is a structural port of `vgadrawtext()`: the same three passes, the same
 * shared shapes, the same advance tables. It emits geometry in text space and
 * leaves the projection to the caller.
 */

/** `siz`, always `TEXTH` from `intro.c`. The glyph grid is built from it. */
export const SIZ = 25;

const S1 = SIZ;
const S2 = S1 * 2;
const S3 = S1 * 3;
const S4 = S1 * 4;
const S5 = S1 * 5;
const S6 = S1 * 6;

/** `gap` — the space added after every glyph. */
const GAP = S1;

/** Arc chord offset: `(r * 3) >> 2`, kept as integer as the original was. */
const R34 = ( SIZ * 3 ) >> 2;

/** `s1 >> 1`, used by A and M. */
const HALF = S1 >> 1;

/** Glyphs whose advance is one unit. Note the space, which is why it is blank. */
const NARROW = "ltfijk-. (),'";

/** Glyphs whose advance is two units. */
const NORMAL = '?/%abcdeghnopqrsuvxyzABCDEFGHIJKLNOPQRSTUVXYZ0123456789';

/** Glyphs whose advance is four units. */
const WIDE = 'mwMW';

export interface Layout {
	/** Flat segment list, `[x0, y0, x1, y1, ...]`, in text space. */
	readonly segments: Float32Array;
	/**
	 * Width as `vgatextsize()` reported it.
	 *
	 * The measuring pass ran with drawing disabled, which also skipped the
	 * pen nudges inside `i`, `.` and `M`, so this can differ slightly from
	 * where the pen actually finishes. The original centred lines with this
	 * number, so the port does too.
	 */
	readonly width: number;
}

const _cache = new Map<string, Layout>();

/** Lays a string out, cached. Called once per distinct line of the scripts. */
export function layout( text: string ): Layout {

	const cached = _cache.get( text );
	if ( cached !== undefined ) return cached;

	const out: number[] = [];

	/** Pen position while drawing. */
	let a = 0;
	/** Pen position as the measuring pass would have left it. */
	let measure = 0;

	const line = ( x1: number, y1: number, x2: number, y2: number ): void => {

		out.push( x1, y1, x2, y2 );

	};

	// `HLine()` discarded the second y entirely, so both ends share the first.
	const hline = ( x1: number, y1: number, x2: number ): void => {

		out.push( x1, y1, x2, y1 );

	};

	// `SSetPixel()` plotted a single point; kept as a degenerate segment so the
	// renderer can give it the same width as everything else.
	const dot = ( x: number, y: number ): void => {

		out.push( x, y, x, y );

	};

	const cUL = ( x: number, y: number ): void => {

		line( x - SIZ, y, x - R34, y - R34 );
		line( x - R34, y - R34, x, y - SIZ );

	};

	const cUR = ( x: number, y: number ): void => {

		line( x + SIZ, y, x + R34, y - R34 );
		line( x + R34, y - R34, x, y - SIZ );

	};

	const cLL = ( x: number, y: number ): void => {

		line( x - SIZ, y, x - R34, y + R34 );
		line( x - R34, y + R34, x, y + SIZ );

	};

	const cLR = ( x: number, y: number ): void => {

		line( x + SIZ, y, x + R34, y + R34 );
		line( x + R34, y + R34, x, y + SIZ );

	};

	const cLower = ( x: number, y: number ): void => { cLL( x, y ); cLR( x, y ); };
	const cUpper = ( x: number, y: number ): void => { cUL( x, y ); cUR( x, y ); };
	const cRight = ( x: number, y: number ): void => { cUR( x, y ); cLR( x, y ); };
	const cLeft = ( x: number, y: number ): void => { cUL( x, y ); cLL( x, y ); };
	const circle = ( x: number, y: number ): void => { cUpper( x, y ); cLower( x, y ); };

	// Four glyphs finished themselves in the original by falling through to
	// another case: Q into O, R into P, 9 into 8 and % into the slash. The
	// shared halves are named here and called outright instead.
	const drawO = (): void => {

		cUpper( a + S1, S1 );
		line( a, S1, a, S3 );
		line( a + S2, S1, a + S2, S3 );

	};

	const drawP = (): void => {

		cRight( a + S1, S1 );
		hline( a, 0, a + S1 );
		hline( a, S2, a + S1 );

	};

	const drawEight = (): void => circle( a + S1, S1 );

	const drawSlash = (): void => line( a, S4, a + S2, 0 );

	for ( const c of text ) {

		// --- pass one: shapes shared between several glyphs -----------------

		if ( 'abdgopq68'.includes( c ) ) {

			circle( a + S1, S3 );

		} else {

			if ( 'cehmnrs'.includes( c ) ) cUL( a + S1, S3 );
			if ( 'ehmnrBS35'.includes( c ) ) cUR( a + S1, S3 );
			if ( 'cetuyCGJOQSUl035'.includes( c ) ) cLL( a + S1, S3 );
			if ( 'suyBCDGJOQSU035'.includes( c ) ) cLR( a + S1, S3 );
			if ( 'BDEFHKLMNPR'.includes( c ) ) line( a, 0, a, S4 );

		}

		// --- pass two: what makes each glyph itself -------------------------

		switch ( c ) {

			// lowercase
			case 'a': line( a + S2, S2, a + S2, S4 ); break;
			case 'b': line( a, 0, a, S4 ); break;
			case 'c': hline( a + S1, S2, a + S2 ); hline( a + S1, S4, a + S2 ); break;
			case 'd': line( a + S2, 0, a + S2, S4 ); break;
			case 'e': line( a, S3, a + S2, S3 ); hline( a + S1, S4, a + S2 ); break;
			case 'f': cUL( a + S1, S1 ); line( a, S1, a, S4 ); hline( a, S2, a + S1 ); break;
			case 'g': line( a + S2, S2, a + S2, S5 ); cLower( a + S1, S5 ); break;
			case 'h': line( a, 0, a, S4 ); line( a + S2, S3, a + S2, S4 ); break;
			case 'i': dot( a, S1 ); line( a, S2, a, S4 ); a += - S1 + 1; break;
			case 'j': line( a + S1, S2, a + S1, S5 ); cLR( a, S5 ); dot( a + S1, S1 ); break;
			case 'k': line( a, 0, a, S4 ); line( a, S3, a + S1, S2 ); line( a, S3, a + S1, S4 ); break;
			case 'l': line( a, 0, a, S3 ); break;
			case 'm':
				line( a, S2, a, S4 );
				line( a + S2, S3, a + S2, S4 );
				line( a + S4, S3, a + S4, S4 );
				cUpper( a + S3, S3 );
				break;
			case 'n': line( a, S2, a, S4 ); line( a + S2, S3, a + S2, S4 ); break;
			case 'p': line( a, S2, a, S6 ); break;
			case 'q': line( a + S2, S2, a + S2, S6 ); break;
			case 'r': line( a, S2, a, S4 ); break;
			case 's':
				hline( a, S3, a + S2 );
				hline( a + S1, S2, a + S2 );
				hline( a, S4, a + S1 );
				break;
			case 't': line( a, S1, a, S3 ); hline( a, S2, a + S1 ); break;
			case 'u': line( a, S2, a, S3 ); line( a + S2, S2, a + S2, S4 ); break;
			case 'v': line( a, S2, a + S1, S4 ); line( a + S1, S4, a + S2, S2 ); break;
			case 'w':
				line( a, S2, a + S1, S4 );
				line( a + S1, S4, a + S2, S3 );
				line( a + S2, S3, a + S3, S4 );
				line( a + S3, S4, a + S4, S2 );
				break;
			case 'x': line( a, S2, a + S2, S4 ); line( a, S4, a + S2, S2 ); break;
			case 'y':
				line( a, S2, a, S3 );
				line( a + S2, S2, a + S2, S5 );
				cLower( a + S1, S5 );
				break;
			case 'z':
				hline( a, S2, a + S2 );
				line( a + S2, S2, a, S4 );
				hline( a, S4, a + S2 );
				break;

			// uppercase
			case 'A':
				line( a, S4, a + S1, 0 );
				line( a + S1, 0, a + S2, S4 );
				line( a + HALF, S2, a + S2 - HALF, S2 );
				break;
			case 'B':
				cRight( a + S1, S1 );
				hline( a, 0, a + S1 );
				hline( a, S2, a + S1 );
				hline( a, S4, a + S1 );
				break;
			case 'C': cUpper( a + S1, S1 ); line( a, S1, a, S3 ); break;
			case 'D':
				hline( a, 0, a + S1 );
				hline( a, S4, a + S1 );
				cUR( a + S1, S1 );
				line( a + S2, S1, a + S2, S3 );
				break;
			case 'E':
				hline( a, 0, a + S2 );
				hline( a, S2, a + S1 );
				hline( a, S4, a + S2 );
				break;
			case 'F': hline( a, 0, a + S2 ); hline( a, S2, a + S1 ); break;
			case 'G':
				cUpper( a + S1, S1 );
				line( a, S1, a, S3 );
				hline( a + S1, S2, a + S2 );
				line( a + S2, S2, a + S2, S3 );
				break;
			case 'H': hline( a, S2, a + S2 ); line( a + S2, 0, a + S2, S4 ); break;
			case 'I':
				hline( a, 0, a + S2 );
				line( a + S1, 0, a + S1, S4 );
				hline( a, S4, a + S2 );
				break;
			case 'J': line( a + S2, 0, a + S2, S3 ); break;
			case 'K': line( a + S2, 0, a, S2 ); line( a, S2, a + S2, S4 ); break;
			case 'L': hline( a, S4, a + S2 ); break;
			case 'M':
				line( a, 0, a + S1 + HALF, S2 );
				line( a + S1 + HALF, S2, a + S3, 0 );
				line( a + S3, 0, a + S3, S4 );
				a -= S1;
				break;
			case 'N': line( a, 0, a + S2, S4 ); line( a + S2, S4, a + S2, 0 ); break;

			case 'Q': line( a + S1, S3, a + S2, S4 ); drawO(); break;
			case 'O':
			case '0': drawO(); break;
			case 'R': line( a + S1, S2, a + S2, S4 ); drawP(); break;
			case 'P': drawP(); break;
			case 'S': cLeft( a + S1, S1 ); cUR( a + S1, S1 ); break;
			case 'T': hline( a, 0, a + S2 ); line( a + S1, 0, a + S1, S4 ); break;
			case 'U': line( a, 0, a, S3 ); line( a + S2, 0, a + S2, S3 ); break;
			case 'V': line( a, 0, a + S1, S4 ); line( a + S1, S4, a + S2, 0 ); break;
			case 'W':
				line( a, 0, a + S1, S4 );
				line( a + S1, S4, a + S2, S2 );
				line( a + S2, S2, a + S3, S4 );
				line( a + S3, S4, a + S4, 0 );
				break;
			case 'X': line( a, 0, a + S2, S4 ); line( a + S2, 0, a, S4 ); break;
			case 'Y':
				line( a, 0, a + S1, S2 );
				line( a + S2, 0, a + S1, S2 );
				line( a + S1, S2, a + S1, S4 );
				break;
			case 'Z':
				hline( a, 0, a + S2 );
				line( a + S2, 0, a, S4 );
				hline( a, S4, a + S2 );
				break;

			// digits; 0 is handled with O above
			case '1':
				line( a, S1, a + S1, 0 );
				line( a + S1, 0, a + S1, S4 );
				hline( a, S4, a + S2 );
				break;
			case '2':
				cUpper( a + S1, S1 );
				line( a + S2, S1, a, S4 );
				line( a, S4, a + S2, S4 );
				break;
			case '3': cUpper( a + S1, S1 ); cLR( a + S1, S1 ); break;
			case '4':
				line( a + S1, S4, a + S1, 0 );
				line( a + S1, 0, a, S2 );
				hline( a, S2, a + S2 );
				break;
			case '5':
				line( a + S2, 0, a, 0 );
				line( a, 0, a, S2 );
				line( a, S2, a + S1, S2 );
				break;
			case '6': cUpper( a + S1, S1 ); line( a, S1, a, S3 ); break;
			case '7': line( a, 0, a + S2, 0 ); line( a + S2, 0, a + S1, S4 ); break;

			case '9': line( a + S2, 0, a + S2, S4 ); drawEight(); break;
			case '8': drawEight(); break;

			// punctuation
			case '-': hline( a, S2, a + S1 ); break;
			case '+': hline( a, S2, a + S1 ); line( a + S2, 0, a + S2, S4 ); break;
			case '.': dot( a, S4 ); a += - S1 + 1; break;
			case ',': line( a - 1, S4 + S1, a, S4 ); break;
			case "'": line( a, 0, a - 1, S1 ); break;
			case '(':
				cUL( a + S1, S1 );
				cLL( a + S1, S3 );
				line( a, S1, a, S3 );
				break;
			case ')':
				cUR( a, S1 );
				cLR( a, S3 );
				line( a + S1, S1, a + S1, S3 );
				break;
			case '%': dot( a, 0 ); dot( a + S2, S4 ); drawSlash(); break;
			case '/': drawSlash(); break;
			case '?':
				cUpper( a + S1, S1 );
				line( a + S2, S1, a + S1, S2 );
				line( a + S1, S2, a + S1, S3 );
				dot( a + S1, S4 );
				break;
			default: break;

		}

		// --- pass three: advance --------------------------------------------

		if ( NARROW.includes( c ) ) {

			a += S1;
			measure += S1;

		} else if ( NORMAL.includes( c ) ) {

			a += S2;
			measure += S2;

		} else if ( WIDE.includes( c ) ) {

			a += S4;
			measure += S4;

		} else {

			// Anything the font does not know gets an underscore, which is how
			// the credits' "___" and "B_BALL" come out looking deliberate.
			hline( a, S4, a + S2 );
			a += S2;
			measure += S2;

		}

		a += GAP;
		measure += GAP;

	}

	const result: Layout = {
		segments: new Float32Array( out ),
		// `vgatextsize()` returned the pen position less one unit.
		width: measure - SIZ
	};

	_cache.set( text, result );

	return result;

}
