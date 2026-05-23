import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // (or vue, etc.)
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [
    react(),
    basicSsl() // <-- Add this here
  ],
  server: {
    https: true // <-- Explicitly tell the server to use HTTPS
  }
})