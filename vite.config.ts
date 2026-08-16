// SPDX-FileCopyrightText: © 2026 Mesmotronic Limited
// SPDX-License-Identifier: GPL-2.0-or-later

import { defineConfig } from 'vite';

export default defineConfig( {

	base: './',
	server: {
		open: true
	},
	build: {
		target: 'esnext',
		chunkSizeWarningLimit: 1500
	}

} );
