import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
    build: {
        rolldownOptions: {
            input: Object.fromEntries(
                ['index', 'login', 'signup', 'main', 'camera', 'create-class', 'location'].map(page => [
                    page,
                    fileURLToPath(new URL(`./${page}.html`, import.meta.url)),
                ])
            ),
        },
    },
})
