import { useEffect, useRef, useState, useCallback } from 'react'
import { ClientMessage, ServerMessage } from '../types'

export function useWebSocket(
  url: string,
  onMessage: (msg: ServerMessage) => void
): { send: (msg: ClientMessage) => void; connected: boolean } {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)

  // Keep the callback ref current without reopening the socket
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (wsRef.current === ws) setConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage
        onMessageRef.current(msg)
      } catch {
        console.error('Failed to parse WebSocket message:', event.data)
      }
    }

    ws.onclose = () => {
      // Guard against StrictMode double-mount: only update state if this
      // is still the active connection (not one that was already replaced).
      if (wsRef.current === ws) {
        setConnected(false)
        wsRef.current = null
      }
    }

    ws.onerror = () => {
      console.error('WebSocket connection error')
    }

    return () => {
      ws.close()
    }
  }, [url])

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    } else {
      console.warn('WebSocket not connected, cannot send:', msg)
    }
  }, [])

  return { send, connected }
}
