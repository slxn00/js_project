
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({

    server: {
        port: 5173,
        allowedHosts: [
        'https://scholarships-decided-opens-portraits.trycloudflare.com'
        ],
    },


    build: {
        rolldownOptions: {
            input: Object.fromEntries(
                [
                    'index',
                    'login',
                    'signup',
                    'main',
                    'camera',
                    'create-class',
                    'location',
                    'admin',
                    'student'
                ].map(page => [
                    page,
                    fileURLToPath(
                        new URL(`./${page}.html`, import.meta.url)
                    ),
                ])
            ),
        },
    },
})
