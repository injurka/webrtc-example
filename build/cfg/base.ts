import { resolve } from 'node:path'
import type { NuxtConfig } from 'nuxt/schema'

export const baseCfg: NuxtConfig = {
  devServer: {
    port: 5173,
  },

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  modules: [
    '@nuxt/eslint',
    'vuetify-nuxt-module',
  ],

  vuetify: {
    vuetifyOptions: {
      theme: {
        defaultTheme: 'light',
        themes: {
          light: {
            dark: false,
            colors: {
              primary: '#ffb800',
              secondary: '#eaeff8',
              accent: '#344079',
              error: '#b71c1c',
            },
          },
        },
      },
    },
  },

  eslint: {
    config: {
      standalone: false,
    },
  },

  css: [
    '#/assets/scss/global.scss',
  ],

  alias: {
    '#': resolve(__dirname, '../../'),
  },

  devtools: {
    timeline: { enabled: true },
  },
}
