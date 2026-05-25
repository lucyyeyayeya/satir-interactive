/// <reference types="vite/client" />

/**
 * WebSocket URL resolution
 *
 * - Production (Railway + Cloudflare Pages):
 *     Set VITE_WS_URL=wss://your-service.railway.app in Cloudflare Pages env vars
 *
 * - Local dev:
 *     Falls back to ws(s)://localhost:3001 automatically
 */
export const WS_URL: string =
  import.meta.env.VITE_WS_URL ||
  (() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.hostname}:3001`
  })()
