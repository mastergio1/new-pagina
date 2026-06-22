/**
 * Preview headless de la experiencia 3D.
 * Sirve /dist, abre Chromium con WebGL por software (SwiftShader) y captura
 * la escena en varios puntos del scroll (0% -> 100%).
 *
 * Uso:  npm run build && node scripts/capture.mjs
 * Salida: preview/frame-XX.png
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const distDir = path.join(root, 'dist')
const outDir = path.join(root, 'preview')

if (!existsSync(distDir)) {
  console.error('No existe dist/. Corre primero: npm run build')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

// --- Servidor estático mínimo para dist/ (SPA: fallback a index.html) ---
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let filePath = path.join(distDir, urlPath)
    if (urlPath === '/' || !existsSync(filePath)) {
      filePath = path.join(distDir, 'index.html')
    }
    const body = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir(outDir, { recursive: true })
  await new Promise((r) => server.listen(0, r))
  const { port } = server.address()
  const url = `http://localhost:${port}/`
  console.log('Sirviendo', url)

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  page.on('console', (m) => console.log('  [page]', m.text()))
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas', { timeout: 20000 })
  // Render por software es lento: damos margen a que el primer frame, el
  // entorno procedural y la transmisión del vidrio se estabilicen.
  await wait(4000)

  const stops = [
    { p: 0.0, name: '00-intro' },
    { p: 0.3, name: '01-rotacion' },
    { p: 0.5, name: '02-pre-zoom' },
    { p: 0.78, name: '03-zoom' },
    { p: 1.0, name: '04-inmersion' },
  ]

  for (let i = 0; i < stops.length; i++) {
    const { p, name } = stops[i]
    await page.evaluate((progress) => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, Math.round(progress * max))
    }, p)
    // Esperar a que el damp de cámara/partículas alcance el objetivo.
    await wait(1600)
    const file = path.join(outDir, `frame-${name}.png`)
    await page.screenshot({ path: file })
    console.log('Capturado', `${Math.round(p * 100)}%`, '->', file)
  }

  await browser.close()
  server.close()
  console.log('Listo. Imágenes en preview/')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
