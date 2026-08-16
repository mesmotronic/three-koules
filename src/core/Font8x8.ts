/**
 * The 8x8 bitmap font Koules shipped, from `xlib/font8x8.c`.
 *
 * The SDL build drew all of its interface text with SDL_gfx's built-in font,
 * set once in `sdl/init.c` via
 * `gfxPrimitivesSetFont (gfxPrimitivesFontdata, 8, 8)`. That is the standard
 * IBM PC / CP437 8x8 ROM font, and Koules carries its own copy of it for the
 * X11 backend — 256 glyphs of 8 rows, one bit per pixel, most significant bit
 * leftmost. Using the bundled copy keeps the port free of any font dependency
 * and guarantees the glyphs are the ones the game actually drew.
 */

/** 2048 bytes: 256 glyphs x 8 rows. */
const FONT_DATA =
	"AAAAAAAAAAB+gaWBvYF+AH7/2//D/34ANn9/fz4cCAAIHD5/PhwIABwcCGt/awgcCBw+fz4IHD4AABg8PBgAAP//58PD5///" +
	"ADxmQkJmPAD/w5m9vZnD/w8HDTxmZmY8PGZmZjwYfhgwODw2NHDw4H9jf2NjZ+bAGNt+ZmZ+2xhAcHx/fHBAAAEHH38fBwEA" +
	"GDx+GBh+PBhmZmZmZgBmAD96ejoKCgoAHjMcNjYcZjwAAAAAfn5+ABg8fhh+PBh+GDx+GBgYGAAYGBgYfjwYAAAMDn8ODAAA" +
	"ABg4fzgYAAAAAGBgYH8AAAAkZv9mJAAAABg8fv//AAAA//9+PBgAAAAAAAAAAAAAGBgYGBgAGABmZmYAAAAAAGxs/mz+bGwA" +
	"EHzQfBZ8EAAAxswYMGbGADhsOHbczHYAGBgwAAAAAAAMGDAwMBgMADAYDAwMGDAAAGw4/jhsAAAAGBh+GBgAAAAAAAAAGBgw" +
	"AAAAfgAAAAAAAAAAADAwAAAGDBgwYMAAPGZufnZmPAAMHDwMDAwMADxmBhwwYH4APGYGHAZmPAAcPGzM/gwMAH5gYHwGZjwA" +
	"PGBgfGZmPAB+BgYMGDAwADxmZjxmZjwAPGZmPgYGPAAAMDAAADAwAAAYGAAAGBgwDBgwYDAYDAAAAH4AAH4AADAYDAYMGDAA" +
	"PGYGDBgAGAA8Zm5ubGA8ABg8ZmZ+ZmYAfGZmfGZmfAA8ZmBgYGY8AHxmZmZmZnwAfmBgfGBgfgB+YGB8YGBgADxmYG5mZjwA" +
	"ZmZmfmZmZgA8GBgYGBg8AAYGBgZmZjwAZmx4cHhsZgBgYGBgYGB+AMbu/tbGxsYAZnZ+bmZmZgA8ZmZmZmY8AHxmZnxgYGAA" +
	"PGZmZmZuPAZ8ZmZ8ZmZmADxmYDwGZjwAfhgYGBgYGABmZmZmZmY8AGZmZmZmPBgAxsbG1v7uxgBmZjwYPGZmAGZmZjwYGBgA" +
	"fgYMGDBgfgA8MDAwMDA8AADAYDAYDAYAPAwMDAwMPAAYPGYAAAAAAAAAAAAAAAD/GBgMAAAAAAAAADwGPmY+AGBgYHxmZnwA" +
	"AAA8ZmBmPAAGBgY+ZmY+AAAAPGZ+YD4AHDYwfDAwMAAAAD5mZj4GPGBgfGZmZmYAGAAYGBgYGAAMAAwMDAxsOGBgZmx4bGYA" +
	"MDAwMDAwGAAAAOz+1tbGAAAAfGZmZmYAAAA8ZmZmPAAAAHxmZnxgYAAAPmZmPgYGAAB8ZmBgYAAAAD5gPAZ8ADAwfDAwNhwA" +
	"AABmZmZmPgAAAGZmZjwYAAAAxtb+7kQAAABmPBg8ZgAAAGZmZj4GPAAAfgwYMH4AHDAwYDAwHAAYGBgYGBgYADgMDAYMDDgA" +
	"dtwAAAAAAAAAABg8ZmZ+ADxmYGBmPBgwZgBmZmZmPgAOADxmfmA8ADxmPAY+Zj4AZgA8Bj5mPgBwADwGPmY+ABgYPAY+Zj4A" +
	"AAA+YGA+GDA8ZjxmfmA8AGYAPGZ+YDwAcAA8Zn5gPABmABgYGBgYADxmGBgYGBgAcAAYGBgYGADGOGzG/sbGABgYADxmfmYA" +
	"DgB8YHhgfAAAAH4afth+AD542N742N4APGY8ZmZmPABmADxmZmY8AHAAPGZmZjwAPGYAZmZmPgBwAGZmZmY+AGYAZmZmPgY8" +
	"ZjxmZmZmPABmAGZmZmY8AAwMPmBgPgwMOGxg8GBm/ABmZjwYfhh+GHxmZnxmb2ZjDhsYPBgYeDAOADwGPmY+AA4AGBgYGBgA" +
	"DgA8ZmZmPAAOAGZmZmY+AHbcAHxmZmYAfgBmdn5uZgA+ZmY+AH4AADxmZjwAfgAAGAAYMGBmPAAAAAB+YGAAAAAAAH4GBgAA" +
	"xszYPmPGDB/GzNg2btYfBhgAGBgYGBgAADZs2Gw2AAAA2Gw2bNgAACKIIogiiCKIVapVqlWqVardd9133XfddwgICAgICAgI" +
	"CAgICPgICAgICAj4+AgICBwcHBz8HBwcAAAAAPwcHBwAAAD4+AgICBwcHPz8HBwcHBwcHBwcHBwAAAD8/BwcHBwcHPz8AAAA" +
	"HBwcHPwAAAAICAj4+AAAAAAAAAD4CAgICAgICA8AAAAICAgI/wAAAAAAAAD/CAgICAgICA8ICAgAAAAA/wAAAAgICAj/CAgI" +
	"CAgIDw8ICAgcHBwcHxwcHBwcHB8fAAAAAAAAHx8cHBwcHBz//wAAAAAAAP//HBwcHBwcHx8cHBwAAAD//wAAABwcHP//HBwc" +
	"CAgI//8AAAAcHBwc/wAAAAAAAP//CAgIAAAAAP8cHBwcHBwcHwAAAAgICA8PAAAAAAAADw8ICAgAAAAAHxwcHBwcHBz/HBwc" +
	"CAgI//8ICAgICAgI+AAAAAAAAAAPCAgI//////////8AAAAA//////Dw8PDw8PDwDw8PDw8PDw//////AAAAAAAAdszMzHYA" +
	"PGZmfGZmfGB+ZmBgYGBgAAAA/mxsbGYAfmYwGDBmfgAAAD5sbGw4AAAAZmZmZn/AAAB+2BgYDAB8OHzW1nw4fHzGxv7GxnwA" +
	"fMbGxmxs7gAeMBg8ZmY8AAAAftvbfgAAAwY+a3M+YMAeMGB+YDAeAHzGxsbGxsYAAH4AfgB+AAAYGH4YGAB+ADAYDBgwAH4A" +
	"DBgwGAwAfgAOGxsYGBgYGBgYGBgY2NhwGBgAfgAYGAAAdtwAdtwAADxmZjwAAAAAAAAAGBgAAAAAAAAAGAAAAB4YGBgY2Hg4" +
	"eGxsbGwAAAA4DBgwPAAAAAAAPDw8PAAAAAAAAAAAAAA=";

export const GLYPH_SIZE = 8;

let _glyphs: Uint8Array | null = null;

/** Decodes the font on first use. */
function glyphs(): Uint8Array {

	if ( _glyphs === null ) {

		const binary = atob( FONT_DATA );
		_glyphs = new Uint8Array( binary.length );

		for ( let i = 0; i < binary.length; i ++ ) _glyphs[ i ] = binary.charCodeAt( i );

	}

	return _glyphs;

}

/**
 * The eight row bitmaps for a character.
 *
 * Anything outside CP437's low range falls back to a space rather than drawing
 * a stray glyph from the high half of the page.
 */
export function glyphRows( code: number ): Uint8Array {

	const data = glyphs();
	const index = ( code >= 0 && code < 256 ? code : 32 ) * GLYPH_SIZE;

	return data.subarray( index, index + GLYPH_SIZE );

}

/** True if the pixel at (x, y) of this glyph is set. */
export function glyphPixel( code: number, x: number, y: number ): boolean {

	if ( x < 0 || x >= GLYPH_SIZE || y < 0 || y >= GLYPH_SIZE ) return false;

	return ( glyphRows( code )[ y ] >> ( 7 - x ) & 1 ) === 1;

}

/** CP437 code points the interface borrows for symbols. */
export const CP437 = {
	/** A filled diamond, used as a life pip. */
	DIAMOND: 0x04,
	/** Solid triangles, used to mark the selected menu row. */
	RIGHT: 0x10,
	LEFT: 0x11
} as const;
