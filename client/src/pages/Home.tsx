import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import { ServerMessage, SavedRoom } from '../types'
import { WS_URL } from '../lib/config'

const STORAGE_KEY = 'satir_rooms'

function loadRooms(): SavedRoom[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedRoom[]) : []
  } catch {
    return []
  }
}

function saveRooms(rooms: SavedRoom[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms))
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export default function Home() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<SavedRoom[]>(() => loadRooms())

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const pendingTitleRef = useRef('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleInputRef = useRef<HTMLInputElement>(null)

  // Focus input when modal opens
  useEffect(() => {
    if (showModal) {
      setTimeout(() => titleInputRef.current?.focus(), 50)
    }
  }, [showModal])

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      if (msg.type === 'room_created') {
        const newRoom: SavedRoom = {
          roomId: msg.roomId,
          title: pendingTitleRef.current || '新課堂',
          createdAt: new Date().toISOString(),
        }
        // Save to localStorage SYNCHRONOUSLY before navigate so the new Home
        // instance reads the updated list when it mounts.
        const existing = loadRooms()
        const updated = [newRoom, ...existing]
        saveRooms(updated)
        setRooms(updated)
        navigate(`/host/${msg.roomId}/edit`)
      } else if (msg.type === 'error') {
        setError(msg.message)
        setIsCreating(false)
      }
    },
    [navigate]
  )

  const { send, connected } = useWebSocket(WS_URL, handleMessage)

  function openModal() {
    setTitleInput('')
    setError(null)
    setShowModal(true)
  }

  function closeModal() {
    if (isCreating) return
    setShowModal(false)
    setTitleInput('')
    setError(null)
  }

  function confirmCreate() {
    const title = titleInput.trim() || `課堂 ${formatDate(new Date().toISOString())}`
    if (!connected) {
      setError('尚未連線至伺服器，請稍候再試')
      return
    }
    pendingTitleRef.current = title
    setError(null)
    setIsCreating(true)
    send({ type: 'create_room' })
  }

  function handleModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') confirmCreate()
    if (e.key === 'Escape') closeModal()
  }

  function deleteRoom(roomId: string) {
    setRooms((prev) => {
      const updated = prev.filter((r) => r.roomId !== roomId)
      saveRooms(updated)
      return updated
    })
  }

  // Sort newest first
  const sortedRooms = [...rooms].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-amber-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-amber-900">薩提爾互動討論</h1>
            <p className="text-xs text-stone-400 mt-0.5">主持儀表板</p>
          </div>
          <button
            onClick={openModal}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold rounded-xl transition shadow-sm"
          >
            + 新建課堂
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {sortedRooms.length === 0 ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-3xl mb-4">
              📋
            </div>
            <p className="text-stone-500 font-medium text-lg">尚未建立任何課堂</p>
            <p className="text-stone-400 text-sm mt-1">點擊右上角「新建課堂」開始</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-stone-400 font-medium uppercase tracking-wider mb-4">
              我的課堂（共 {sortedRooms.length} 間）
            </p>
            {sortedRooms.map((room) => (
              <div
                key={room.roomId}
                className="bg-white rounded-2xl border border-amber-100 shadow-sm px-5 py-4 flex items-center gap-4 hover:border-amber-200 transition group"
              >
                {/* Icon */}
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-lg">
                  📚
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-stone-800 truncate">{room.title}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs font-mono text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">
                      {room.roomId}
                    </span>
                    <span className="text-xs text-stone-400">
                      {formatDate(room.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => navigate(`/host/${room.roomId}/edit`)}
                    className="px-3 py-1.5 bg-stone-100 hover:bg-amber-100 text-stone-600 hover:text-amber-800 text-sm font-semibold rounded-lg transition"
                    title="編輯題庫"
                  >
                    ✏️ 題庫
                  </button>
                  <button
                    onClick={() => navigate(`/host/${room.roomId}`)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition"
                    title="進入課堂"
                  >
                    ▶ 課堂
                  </button>
                  <button
                    onClick={() => deleteRoom(room.roomId)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-stone-300 hover:text-red-400 hover:bg-red-50 transition text-lg leading-none opacity-0 group-hover:opacity-100"
                    title="刪除記錄"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Room Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-amber-100 w-full max-w-md p-6"
            onKeyDown={handleModalKeyDown}
          >
            <h2 className="text-lg font-bold text-stone-800 mb-1">新建課堂</h2>
            <p className="text-sm text-stone-400 mb-4">輸入課堂名稱，建立後可管理題目</p>

            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              課堂名稱
            </label>
            <input
              ref={titleInputRef}
              type="text"
              className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-transparent transition text-sm"
              placeholder="例如：5/15 薩提爾工作坊"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              disabled={isCreating}
              maxLength={60}
            />

            {/* Connection status */}
            <div className="flex items-center gap-1.5 mt-2">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  connected ? 'bg-green-400' : 'bg-amber-300 animate-pulse'
                }`}
              />
              <span className="text-xs text-stone-400">
                {connected ? '已連線至伺服器' : '正在連線...'}
              </span>
            </div>

            {error && (
              <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">
                {error}
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={closeModal}
                disabled={isCreating}
                className="flex-1 py-2.5 border border-stone-200 text-stone-600 hover:bg-stone-50 font-semibold text-sm rounded-xl transition"
              >
                取消
              </button>
              <button
                onClick={confirmCreate}
                disabled={isCreating || !connected}
                className="flex-1 py-2.5 bg-amber-700 hover:bg-amber-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-bold text-sm rounded-xl transition shadow-sm"
              >
                {isCreating ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                    建立中...
                  </span>
                ) : (
                  '建立課堂'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <footer className="text-center py-3 text-xs text-stone-300">
        v6 · 薩提爾互動討論工具 · Made by Lucy Y
      </footer>
    </div>
  )
}
