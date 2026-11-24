import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const JS_CHUNK_BUDGET_BYTES = 900 * 1024
const CSS_CHUNK_BUDGET_BYTES = 256 * 1024

/** Split large third-party libraries so route chunks stay small and cacheable. */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  const normalized = id.replace(/\\/g, '/')
  if (/node_modules\/(@codemirror|@lezer|codemirror|@uiw)\//.test(normalized)) return 'editor-vendor'
  if (/node_modules\/(chart\.js|chartjs-plugin-zoom|react-chartjs-2)\//.test(normalized)) return 'charts-vendor'
  if (/node_modules\/@dnd-kit\//.test(normalized)) return 'dnd-vendor'
  if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(normalized)) return 'react-vendor'
  if (/node_modules\/(react-markdown|remark-|rehype-|micromark|mdast-util|hast-util|unified|unist-util|vfile|lowlight|highlight\.js|prismjs)\//.test(normalized)) {
    return 'markdown-vendor'
  }
  return undefined
}

/** Fails the build when a single emitted file grows past its budget. */
function sizeBudgets(): Plugin {
  return {
    name: 'ayphr-size-budgets',
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        const budget = fileName.endsWith('.css') ? CSS_CHUNK_BUDGET_BYTES : JS_CHUNK_BUDGET_BYTES
        const bytes = output.type === 'chunk'
          ? Buffer.byteLength(output.code)
          : output.source instanceof Uint8Array
            ? output.source.byteLength
            : Buffer.byteLength(output.source)
        if (bytes <= budget) continue
        this.error(`${fileName} is ${(bytes / 1024).toFixed(0)} KiB, over the ${budget / 1024} KiB budget`)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@common': path.resolve(__dirname, 'common'),
    },
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    sizeBudgets(),
  ],
  build: {
    // Vite warns at 700 KiB; the plugin above is the hard limit.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
})
