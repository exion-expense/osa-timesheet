import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** ใส่ Content-Security-Policy ตอน build (GitHub Pages ตั้ง HTTP header เองไม่ได้) */
function securityMeta(supabaseUrl: string): Plugin {
  const origin = (() => {
    try {
      return new URL(supabaseUrl).origin
    } catch {
      return ''
    }
  })()
  const ws = origin.replace(/^http/, 'ws')
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${origin} ${ws}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'security-meta',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  }
}

/** GitHub Pages: ให้ทุก URL (เช่น /c/xxxx) เปิดแอปได้ และไม่ผ่าน Jekyll */
function githubPages(): Plugin {
  return {
    name: 'github-pages',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist')
      copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'))
      writeFileSync(resolve(out, '.nojekyll'), '')
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_BASE || '/',
    plugins: [react(), tailwindcss(), securityMeta(env.VITE_SUPABASE_URL ?? ''), githubPages()],
    // ไม่ฝังไฟล์เล็กเป็น data: URI เพื่อให้ผ่าน CSP (font-src 'self')
    build: { sourcemap: false, assetsInlineLimit: 0 },
  }
})
