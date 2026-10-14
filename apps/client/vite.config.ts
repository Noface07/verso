import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import type { Plugin } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// foliate-js loads pdf.js's worker, CSS, cmaps and fonts at runtime from
// new URL('vendor/pdfjs/…', import.meta.url), i.e. next to the bundled chunk in
// dist/assets. Vite can't see those dynamic paths, so production builds shipped
// without them and every PDF failed to open. Copy them alongside the chunk.
function copyPdfjsAssets(): Plugin {
  const src = path.resolve(__dirname, 'vendor/foliate-js/vendor/pdfjs')
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    closeBundle() {
      const dest = path.resolve(__dirname, 'dist/assets/vendor/pdfjs')
      fs.cpSync(src, dest, { recursive: true, filter: (f) => !f.endsWith('.map') })
    },
  }
}

// Vite rewrites `new URL(`vendor/pdfjs/${path}`, import.meta.url)` into a glob, and
// rejects that one ("Invalid glob ... must start with './'"), so loading pdf.js
// failed and no PDF could be imported. Hide the pattern from Vite (foliate-js is
// a submodule, so patch it at transform time); the files resolve at runtime from
// next to the module: vendor/ in dev, the copied assets in production builds.
function fixFoliatePdfjsPaths(): Plugin {
  return {
    name: 'fix-foliate-pdfjs-paths',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/foliate-js/pdf.js')) return null
      const patched = code.replace(
        'const pdfjsPath = path => new URL(`vendor/pdfjs/${path}`, import.meta.url).toString()',
        'const __pdfjsBase = import.meta.url; const pdfjsPath = path => new URL(`vendor/pdfjs/${path}`, __pdfjsBase).toString()',
      )
      if (patched === code) this.warn('foliate-js pdf.js changed; pdf.js path fix not applied')
      return { code: patched, map: null }
    },
  }
}

export default defineConfig({
  plugins: [fixFoliatePdfjsPaths(), react(), tailwindcss(), copyPdfjsAssets()],
  resolve: {
    alias: {
      '@verso/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  // @ts-expect-error vitest config option
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
})
