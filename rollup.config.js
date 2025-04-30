import path from 'node:path';
import { readFileSync } from 'node:fs';
import { babel } from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

const BIN_DIR = 'bin';

const dirname = path.dirname(new URL(import.meta.url).pathname);

const outputDir = path.join(dirname, BIN_DIR);

const config = [
    {
        cache: false,
        input: [
            'src/github-poll.js',
            'src/github-publish.js',
            'src/github-stats.js',
        ],
        output: {
            dir: outputDir,
            format: 'cjs',
            exports: 'auto',
            // Add shebang to make it executable
            banner: '#!/usr/bin/env node',
        },
        external: [
            // External dependencies that should not be bundled
            ...Object.keys(pkg.dependencies || {}),
            'path',
            'fs',
            'os',
            'util',
            'events',
            'stream',
            'buffer',
            'crypto',
            'zlib',
            'http',
            'https',
            'url',
            'querystring',
        ],
        plugins: [
            nodeResolve({
                preferBuiltins: true,
            }),
            commonjs(),
            babel({
                babelHelpers: 'bundled',
                exclude: 'node_modules/**',
            }),
        ],
    },
];

export default config;
