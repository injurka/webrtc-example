import { baseCfg, importsCfg, runtimeCfg, viteCfg } from './build'

export default defineNuxtConfig({
  ssr: true,

  $development: {
    runtimeConfig: runtimeCfg.development,
  },

  $production: {
    runtimeConfig: runtimeCfg.production,
  },

  imports: importsCfg,
  vite: viteCfg,
  ...baseCfg,

  compatibilityDate: '2024-07-27',
})
