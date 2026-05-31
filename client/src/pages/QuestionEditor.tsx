import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import { QuestionDraft, ServerMessage, ClientMessage, SavedRoom } from '../types'
import { WS_URL } from '../lib/config'

const STORAGE_KEY = 'satir_rooms'

function loadRoomTitle(roomId: string): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return '課堂'
    const rooms = JSON.parse(raw) as SavedRoom[]
    return rooms.find((r) => r.roomId === roomId)?.title ?? '課堂'
  } catch {
    return '課堂'
  }
}

// ── Question localStorage persistence ────────────────────────────────────────

function loadQuestionsLocally(roomId: string): { id: string; text: string }[] {
  try {
    const raw = localStorage.getItem(`satir_questions_${roomId}`)
    return raw ? (JSON.parse(raw) as { id: string; text: string }[]) : []
  } catch {
    return []
  }
}

function saveQuestionsLocally(roomId: string, qs: { id: string; text: string }[]) {
  try {
    localStorage.setItem(`satir_questions_${roomId}`, JSON.stringify(qs))
  } catch {}
}

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

interface LocalQuestion {
  localId: string   // stable UI key (never changes during edit session)
  serverId: string  // last confirmed server id
  text: string
  synced: boolean   // true = server knows about this question with current text
}

export default function QuestionEditor() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()

  const roomTitle = roomId ? loadRoomTitle(roomId) : '課堂'

  // Local question deck — server is source of truth on mount, then we sync actions
  const [questions, setQuestions] = useState<LocalQuestion[]>([])
  const [joined, setJoined] = useState(false)
  const [roomPhase, setRoomPhase] = useState<'waiting' | 'answering' | 'revealed' | 'ended'>('waiting')
  const [startingSession, setStartingSession] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track pending add operations: localId -> resolve when server confirms
  const pendingAddsRef = useRef<Map<string, (serverId: string) => void>>(new Map())
  // Track inflight server question ids so we can reconcile deck_updated
  const serverQuestionsRef = useRef<QuestionDraft[]>([])
  // Prevent double-restore from localStorage
  const restoredRef = useRef(false)
  // Stable ref to send for use inside effects without circular deps
  const sendRef = useRef<((msg: ClientMessage) => void) | null>(null)

  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())

  // Auto-expand a textarea to fit its content
  function autoExpand(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  // Auto-expand all visible textareas (e.g. after load)
  function expandAll() {
    textareaRefs.current.forEach((el) => autoExpand(el))
  }

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === 'joined') {
      setJoined(true)
      setRoomPhase(msg.phase)
      serverQuestionsRef.current = msg.questions
      setQuestions(
        msg.questions.map((q) => ({
          localId: q.id,
          serverId: q.id,
          text: q.text,
          synced: true,
        }))
      )
      // Expand after DOM settles
      setTimeout(expandAll, 50)
    } else if (msg.type === 'question_deck_updated') {
      serverQuestionsRef.current = msg.questions
      // Resolve any pending add operations by matching new server question
      // The server echoes back the full deck — the newest question will be the
      // one we just sent (we match by text since we don't get a per-add ack)
      // Actually we track them by insertion order in pendingAddsRef.
      // Since the server just confirms the deck, we update synced state:
      setQuestions((prev) => {
        const serverMap = new Map(msg.questions.map((q) => [q.id, q]))
        return prev.map((lq) => ({
          ...lq,
          synced: serverMap.has(lq.serverId),
        }))
      })
    } else if (msg.type === 'session_started') {
      navigate(`/host/${roomId}`)
    } else if (msg.type === 'error') {
      setError(msg.message)
      setStartingSession(false)
    }
  }, [navigate, roomId])

  const { send, connected } = useWebSocket(WS_URL, handleMessage)
  // Keep sendRef in sync so the restore effect can call send without circular deps
  sendRef.current = send

  // Auto-restore questions from localStorage when room is empty after join
  useEffect(() => {
    if (!joined || !roomId || restoredRef.current) return
    if (questions.length > 0) {
      restoredRef.current = true
      return
    }
    const saved = loadQuestionsLocally(roomId)
    if (saved.length === 0) return
    restoredRef.current = true
    saved.forEach((q) => sendRef.current?.({ type: 'add_question', question: q }))
    setQuestions(
      saved.map((q) => ({
        localId: q.id,
        serverId: q.id,
        text: q.text,
        synced: false,
      }))
    )
    setTimeout(expandAll, 50)
  }, [joined, questions.length, roomId])

  // Persist questions to localStorage whenever they change
  useEffect(() => {
    if (!roomId || !joined) return
    saveQuestionsLocally(
      roomId,
      questions.map((q) => ({ id: q.serverId, text: q.text }))
    )
  }, [questions, roomId, joined])

  // Join as host on connect
  const sentJoin = useRef(false)
  useEffect(() => {
    if (connected && !sentJoin.current && roomId) {
      sentJoin.current = true
      send({ type: 'join', roomId, role: 'host' })
    }
    return () => {
      sentJoin.current = false
    }
  }, [connected, roomId, send])

  // ── Question actions ──────────────────────────────────────────────

  function addQuestion() {
    const newId = generateId()
    const newQuestion: LocalQuestion = {
      localId: newId,
      serverId: newId,
      text: '',
      synced: false,
    }
    setQuestions((prev) => [...prev, newQuestion])
    send({ type: 'add_question', question: { id: newId, text: '' } })

    // Focus the new textarea after render
    setTimeout(() => {
      const el = textareaRefs.current.get(newId)
      if (el) {
        el.focus()
        autoExpand(el)
      }
    }, 30)
  }

  function deleteQuestion(localId: string) {
    // Read current questions ref to avoid stale closure, send OUTSIDE setState
    const q = questions.find((x) => x.localId === localId)
    if (q) send({ type: 'remove_question', questionId: q.serverId })
    setQuestions((prev) => prev.filter((x) => x.localId !== localId))
  }

  function moveQuestion(localId: string, direction: 'up' | 'down') {
    const idx = questions.findIndex((x) => x.localId === localId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= questions.length) return
    const next = [...questions]
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    send({ type: 'reorder_questions', questionIds: next.map((q) => q.serverId) })
    setQuestions(next)
  }

  function handleTextChange(localId: string, value: string) {
    setQuestions((prev) =>
      prev.map((q) => (q.localId === localId ? { ...q, text: value, synced: false } : q))
    )
  }

  function handleBlur(localId: string) {
    // Read current state directly — all sends OUTSIDE setState to avoid
    // StrictMode double-invocation (which would send remove twice).
    const q = questions.find((x) => x.localId === localId)
    if (!q || q.synced) return

    const newServerId = generateId()
    send({ type: 'remove_question', questionId: q.serverId })
    send({ type: 'add_question', question: { id: newServerId, text: q.text } })
    const updatedIds = questions.map((x) =>
      x.localId === localId ? newServerId : x.serverId
    )
    send({ type: 'reorder_questions', questionIds: updatedIds })

    setQuestions((prev) =>
      prev.map((x) =>
        x.localId === localId ? { ...x, serverId: newServerId, synced: true } : x
      )
    )
  }

  // ── Start session ─────────────────────────────────────────────────

  function handleStartSession() {
    if (questions.length === 0 || startingSession) return
    setStartingSession(true)
    setError(null)
    send({ type: 'start_session' })
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* ── Slim header ─────────────────────────────────────────── */}
      <header className="bg-white border-b border-amber-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          {/* Left: back link */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-sm text-stone-500 hover:text-amber-700 transition shrink-0"
          >
            <span>←</span>
            <span>儀表板</span>
          </button>

          {/* Center: title + room code */}
          <div className="flex-1 text-center min-w-0">
            <p className="text-sm font-semibold text-stone-800 truncate">{roomTitle}</p>
            <p className="text-xs font-mono text-stone-400">{roomId}</p>
          </div>

          {/* Right: enter classroom (no start) */}
          <button
            onClick={() => navigate(`/host/${roomId}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition shrink-0"
          >
            <span>▶</span>
            <span>取得討論間資訊</span>
          </button>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────── */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 pb-28">
        {/* Page heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-stone-800">題庫編輯</h1>
          <p className="text-sm text-stone-400 mt-1">
            共 <span className="font-semibold text-amber-700">{questions.length}</span> 題
          </p>
        </div>

        {/* Connection notice */}
        {!connected && (
          <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
            正在連線至伺服器…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Empty state */}
        {joined && questions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-3xl mb-4">
              📝
            </div>
            <p className="text-stone-500 font-medium">尚未新增題目</p>
            <p className="text-stone-400 text-sm mt-1">點擊下方按鈕開始</p>
          </div>
        )}

        {/* Question list */}
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <div
              key={q.localId}
              className="bg-white rounded-2xl border border-amber-100 shadow-sm px-4 py-3 flex gap-3 group hover:border-amber-200 transition"
            >
              {/* Number badge */}
              <div className="flex-shrink-0 mt-1 w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
                {idx + 1}
              </div>

              {/* Textarea */}
              <textarea
                ref={(el) => {
                  if (el) textareaRefs.current.set(q.localId, el)
                  else textareaRefs.current.delete(q.localId)
                }}
                rows={2}
                value={q.text}
                placeholder="輸入題目內容…"
                onChange={(e) => {
                  handleTextChange(q.localId, e.target.value)
                  autoExpand(e.target)
                }}
                onBlur={() => handleBlur(q.localId)}
                className="flex-1 resize-none overflow-hidden text-stone-800 placeholder-stone-300 text-sm leading-relaxed focus:outline-none bg-transparent word-break break-words"
                style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
              />

              {/* Controls */}
              <div className="flex flex-col items-center gap-1 flex-shrink-0 ml-1">
                <button
                  onClick={() => moveQuestion(q.localId, 'up')}
                  disabled={idx === 0}
                  className="w-6 h-6 flex items-center justify-center rounded text-stone-300 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-20 disabled:cursor-not-allowed transition text-xs leading-none"
                  title="上移"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveQuestion(q.localId, 'down')}
                  disabled={idx === questions.length - 1}
                  className="w-6 h-6 flex items-center justify-center rounded text-stone-300 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-20 disabled:cursor-not-allowed transition text-xs leading-none"
                  title="下移"
                >
                  ▼
                </button>
                <button
                  onClick={() => deleteQuestion(q.localId)}
                  className="w-6 h-6 flex items-center justify-center rounded text-stone-300 hover:text-red-400 hover:bg-red-50 transition text-base leading-none mt-1 opacity-0 group-hover:opacity-100"
                  title="刪除"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add question button */}
        <button
          onClick={addQuestion}
          disabled={!connected}
          className="mt-4 w-full py-3 border-2 border-dashed border-amber-200 hover:border-amber-400 hover:bg-amber-50 text-amber-600 hover:text-amber-700 text-sm font-semibold rounded-2xl transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ＋ 新增題目
        </button>
      </main>

      {/* ── Sticky bottom bar ────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-amber-100 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-stone-400">
            共 <span className="font-semibold text-stone-700">{questions.length}</span> 題
          </p>

          {roomPhase !== 'waiting' ? (
            /* Session already started — show status + go-to-classroom button */
            <div className="flex items-center gap-3">
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 font-semibold">
                {roomPhase === 'ended' ? '課堂已結束' : '課堂進行中'}
              </span>
              <button
                onClick={() => navigate(`/host/${roomId}`)}
                className="flex items-center gap-2 px-5 py-2.5 bg-amber-700 hover:bg-amber-800 text-white font-bold text-sm rounded-xl transition shadow-sm"
              >
                <span>▶</span>
                取得討論間資訊
              </button>
            </div>
          ) : (
            /* Waiting phase — normal start button */
            <button
              onClick={handleStartSession}
              disabled={questions.length === 0 || startingSession || !connected}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-700 hover:bg-amber-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-bold text-sm rounded-xl transition shadow-sm"
            >
              {startingSession ? (
                <>
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
                  啟動中…
                </>
              ) : (
                <>
                  <span>▶</span>
                  開始課堂
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
