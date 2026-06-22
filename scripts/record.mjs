/**
 * Graba un GIF de la experiencia 3D "corriendo": primero mueve el mouse para
 * mostrar la inclinación del bote, luego recorre el scroll 0% -> 100%.
 * No requiere ffmpeg: codifica en JS puro con gifenc.
 *
 * Uso:  npm run build && node scripts/record.mjs
 * Salida: preview/walkthrough.gif
 */
import http from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { PNG } from 'pngjs'
import gifenc from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = gifenc

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const distDir = path.join(root, 'dist')
const outDir = path.join(root, 'preview')

const W = 720
const H = 450
const DELAY = 70 // ms por frame (~14 fps)

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
}
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    let filePath = path.join(distDir, urlPath)
    if (urlPath === '/' || !existsSync(filePath)) filePath = path.join(distDir, 'index.html')
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
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForSelector('canvas', { timeout: 20000 })
  await wait(3500)

  const gif = GIFEncoder()
  let first = true
  const addFrame = async () => {
    const buf = Buffer.from(await page.screenshot({ type: 'png' }))
    const { data } = PNG.sync.read(buf) // RGBA
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, W, H, { palette, delay: DELAY, repeat: first ? 0 : undefined })
    first = false
  }

  const setScroll = (p) =>
    page.evaluate((progress) => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, Math.round(progress * max))
    }, p)

  // --- Segmento 1: inclinación con el mouse (scroll en 0%) ---
  await setScroll(0)
  const cx = W / 2
  const cy = H / 2
  const tiltFrames = 16
  for (let i = 0; i < tiltFrames; i++) {
    const a = (i / tiltFrames) * Math.PI * 2
    await page.mouse.move(cx + Math.cos(a) * (W * 0.35), cy + Math.sin(a) * (H * 0.35))
    await wait(90)
    await addFrame()
    console.log('tilt', i + 1, '/', tiltFrames)
  }

  // --- Segmento 2: recorrido de scroll 0% -> 100% ---
  const scrollFrames = 48
  for (let i = 0; i <= scrollFrames; i++) {
    await setScroll(i / scrollFrames)
    await wait(80)
    await addFrame()
    if (i % 8 === 0) console.log('scroll', Math.round((i / scrollFrames) * 100) + '%')
  }
  // Sostener el clímax unos frames.
  for (let i = 0; i < 6; i++) {
    await wait(80)
    await addFrame()
  }

  gif.finish()
  const file = path.join(outDir, 'walkthrough.gif')
  await writeFile(file, gif.bytes())
  console.log('GIF escrito:', file)

  await browser.close()
  server.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
