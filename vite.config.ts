import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// En build usamos el subpath del repo para GitHub Pages
// (https://mastergio1.github.io/new-pagina/); en dev se sirve desde la raíz.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/new-pagina/' : '/',
  plugins: [react()],
}))
