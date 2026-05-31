import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import type {
  ClientMessage,
  ParticipantAnswers,
  Question,
  RoomPhase,
  ServerMessage,
} from '../types'
import { WS_URL } from '../lib/config'

// ─── Outer component: nickname gate ─────────────────────────────────────────

const nicknameKey = (roomId: string) => `satir_nickname_${roomId}`

export default function Participant() {
  const { roomId } = useParams<{ roomId: string }>()

  // Restore saved nickname — auto-skip form if nickname already saved for this room
  const saved = roomId ? (localStorage.getItem(nicknameKey(roomId)) ?? '') : ''
  const [pendingNickname, setPendingNickname] = useState(saved)
  const [submittedNickname, setSubmittedNickname] = useState<string | null>(saved || null)

  const handleNicknameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = pendingNickname.trim()
    if (!trimmed) return
    if (roomId) localStorage.setItem(nicknameKey(roomId), trimmed)
    setSubmittedNickname(trimmed)
  }

  // Screen 0: nickname entry (no WS yet)
  if (submittedNickname === null) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-6">
          <div className="w-full max-w-sm flex flex-col gap-8">
            {/* Header */}
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🌿</span>
              </div>
              <h1 className="text-2xl font-semibold text-stone-800 mb-1">加入課堂</h1>
              {roomId && (
                <p className="text-stone-400 text-sm">
                  課室代碼：
                  <span className="font-mono font-semibold text-stone-600">{roomId}</span>
                </p>
              )}
            </div>

            {/* Nickname form */}
            <form onSubmit={handleNicknameSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="nickname-input"
                  className="text-sm font-medium text-stone-600"
                >
                  你的暱稱
                </label>
                <input
                  id="nickname-input"
                  type="text"
                  value={pendingNickname}
                  onChange={(e) => setPendingNickname(e.target.value)}
                  placeholder="請輸入你的暱稱"
                  maxLength={20}
                  autoFocus
                  className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-4 text-stone-800 text-lg placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300 shadow-sm transition"
                />
                <p className="text-xs text-stone-400 text-right">
                  {pendingNickname.trim().length} / 20
                </p>
              </div>
              <button
                type="submit"
                disabled={!pendingNickname.trim()}
                className="w-full py-4 rounded-2xl bg-amber-500 text-white font-semibold text-base tracking-wide shadow-md active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 hover:bg-amber-600"
              >
                加入課堂
              </button>
            </form>
          </div>
        </div>
      </PageShell>
    )
  }

  // Screens 1–6: WS-connected flow
  return (
    <ParticipantSession
      roomId={roomId ?? ''}
      requestedNickname={submittedNickname}
    />
  )
}

// ─── Inner component: WS-connected session ───────────────────────────────────

interface SessionState {
  phase: RoomPhase
  participantId: string | null
  confirmedNickname: string | null  // from server's joined.nickname
  question: Question | null
  revealedAnswers: ParticipantAnswers[]
  submissionsThisQuestion: string[]
  errorMessage: string | null
  joined: boolean
}

const initialSessionState: SessionState = {
  phase: 'waiting',
  participantId: null,
  confirmedNickname: null,
  question: null,
  revealedAnswers: [],
  submissionsThisQuestion: [],
  errorMessage: null,
  joined: false,
}

function ParticipantSession({
  roomId,
  requestedNickname,
}: {
  roomId: string
  requestedNickname: string
}) {
  const [state, setState] = useState<SessionState>(initialSessionState)
  const [inputValue, setInputValue] = useState('')
  const [justSubmitted, setJustSubmitted] = useState(false)
  const justSubmittedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasJoinedRef = useRef(false)

  const wsUrl = WS_URL

  const clearAnsweringState = () => {
    setInputValue('')
    setJustSubmitted(false)
    if (justSubmittedTimerRef.current) {
      clearTimeout(justSubmittedTimerRef.current)
    }
  }

  const handleMessage = (msg: ServerMessage) => {
    setState((prev) => {
      switch (msg.type) {
        case 'joined':
          // Save server-confirmed nickname (may differ due to ②③ deduplication)
          localStorage.setItem(nicknameKey(roomId), msg.nickname)
          return {
            ...prev,
            joined: true,
            participantId: msg.participantId,
            confirmedNickname: msg.nickname,
            phase: msg.phase,
            question: msg.currentQuestion,
            submissionsThisQuestion: [],
            errorMessage: null,
          }

        case 'session_started':
        case 'question_updated':
          clearAnsweringState()
          return {
            ...prev,
            phase: 'answering',
            question: msg.question,
            submissionsThisQuestion: [],
            revealedAnswers: [],
            errorMessage: null,
          }

        case 'revealed':
          return {
            ...prev,
            phase: 'revealed',
            revealedAnswers: msg.answers,
            errorMessage: null,
          }

        case 'session_ended':
          return {
            ...prev,
            phase: 'ended',
            errorMessage: null,
          }

        case 'error':
          return {
            ...prev,
            errorMessage: msg.message,
          }

        default:
          return prev
      }
    })
  }

  const { send, connected } = useWebSocket(wsUrl, handleMessage)

  // Send join once per connection
  useEffect(() => {
    if (connected && !hasJoinedRef.current && roomId) {
      hasJoinedRef.current = true
      const msg: ClientMessage = {
        type: 'join',
        roomId,
        role: 'participant',
        nickname: requestedNickname,
      }
      send(msg)
    }
    return () => {
      hasJoinedRef.current = false
    }
  }, [connected, roomId, requestedNickname, send])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (justSubmittedTimerRef.current) {
        clearTimeout(justSubmittedTimerRef.current)
      }
    }
  }, [])

  const handleSubmit = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return

    const msg: ClientMessage = { type: 'submit_answer', answer: trimmed }
    send(msg)

    setState((prev) => ({
      ...prev,
      submissionsThisQuestion: [...prev.submissionsThisQuestion, trimmed],
    }))

    setInputValue('')
    setJustSubmitted(true)

    if (justSubmittedTimerRef.current) {
      clearTimeout(justSubmittedTimerRef.current)
    }
    justSubmittedTimerRef.current = setTimeout(() => {
      setJustSubmitted(false)
    }, 2500)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // ─── Screen 6: Error ────────────────────────────────────────────────────────

  if (state.errorMessage) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
          <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center">
            <span className="text-3xl">⚠️</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-rose-700 mb-2">發生錯誤</h2>
            <p className="text-rose-600 text-base leading-relaxed">{state.errorMessage}</p>
          </div>
          <p className="text-stone-400 text-sm">請確認連結是否正確，或聯繫課堂主持人</p>
        </div>
      </PageShell>
    )
  }

  // ─── Screen 1: Connecting ───────────────────────────────────────────────────

  if (!connected || !state.joined) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
          <SpinnerRing />
          <p className="text-stone-500 text-lg tracking-wide">正在加入課堂...</p>
          {roomId && (
            <p className="text-stone-400 text-sm">
              課室代碼：<span className="font-mono font-semibold text-stone-600">{roomId}</span>
            </p>
          )}
        </div>
      </PageShell>
    )
  }

  // ─── Screen 5: Session ended ────────────────────────────────────────────────

  if (state.phase === 'ended') {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
          <div className="w-20 h-20 rounded-full bg-green-50 border-2 border-green-200 flex items-center justify-center">
            <span className="text-4xl">🙏</span>
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-stone-700 mb-3">課堂結束，謝謝參與！</h2>
            <p className="text-stone-400 text-base leading-relaxed max-w-xs mx-auto">
              感謝你在這次薩提爾課堂中的投入與分享
            </p>
          </div>
        </div>
      </PageShell>
    )
  }

  // ─── Screen 2: Waiting ──────────────────────────────────────────────────────

  if (state.phase === 'waiting') {
    const nicknameChanged =
      state.confirmedNickname !== null &&
      state.confirmedNickname !== requestedNickname

    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
              <span className="text-4xl">🌿</span>
            </div>
            {/* Gentle pulse ring */}
            <div className="absolute inset-0 rounded-full border-2 border-amber-200 animate-ping opacity-30" />
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-stone-700 mb-2">已加入！</h2>
            <p className="text-stone-500 text-base">等待老師開始課程...</p>
          </div>

          {state.confirmedNickname && (
            <div className="flex flex-col items-center gap-2">
              <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs text-amber-600 mb-0.5">你的暱稱</p>
                <p className="font-semibold text-amber-800 text-base">
                  {state.confirmedNickname}
                </p>
              </div>
              {nicknameChanged && (
                <p className="text-sm text-stone-400">
                  你的暱稱顯示為「
                  <span className="font-medium text-stone-600">{state.confirmedNickname}</span>
                  」
                </p>
              )}
            </div>
          )}

          {roomId && (
            <div className="px-4 py-2 bg-stone-100 rounded-xl">
              <p className="text-stone-400 text-xs mb-1">課室代碼</p>
              <p className="font-mono font-bold text-stone-700 text-lg tracking-widest">{roomId}</p>
            </div>
          )}
        </div>
      </PageShell>
    )
  }

  // ─── Screen 4: Revealed ─────────────────────────────────────────────────────

  if (state.phase === 'revealed') {
    return (
      <PageShell>
        <div className="px-5 py-7 max-w-lg mx-auto">
          {state.question && (
            <div className="mb-6">
              <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                第 {state.question.index + 1} 題 / 共 {state.question.total} 題
              </span>
              <h2 className="text-xl font-semibold text-stone-800 leading-snug mt-3">
                {state.question.text}
              </h2>
            </div>
          )}

          <h3 className="text-sm font-medium text-stone-500 mb-3">所有參與者的回答</h3>
          <div className="flex flex-col gap-4">
            {state.revealedAnswers.map((participant) => {
              const isMe = participant.participantId === state.participantId
              return (
                <div
                  key={participant.participantId}
                  className={`rounded-2xl p-4 ${
                    isMe
                      ? 'bg-amber-50 border-2 border-amber-300 shadow-sm'
                      : 'bg-white border border-stone-200 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isMe ? 'bg-amber-400' : 'bg-stone-300'
                      }`}
                    />
                    <span
                      className={`text-sm font-semibold ${
                        isMe ? 'text-amber-700' : 'text-stone-600'
                      }`}
                    >
                      {participant.nickname}
                      {isMe && (
                        <span className="ml-2 text-xs font-normal text-amber-500">（你）</span>
                      )}
                    </span>
                  </div>
                  {participant.answers.length === 0 ? (
                    <p className="text-stone-400 text-sm italic">未作答</p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {participant.answers.map((ans, i) => (
                        <li key={i} className="flex gap-3 items-start">
                          <span className="text-xs text-stone-400 mt-0.5 min-w-[1.25rem] text-right flex-shrink-0">
                            {i + 1}.
                          </span>
                          <span className="text-stone-700 text-sm leading-relaxed break-all">{ans}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 py-3 rounded-xl bg-stone-50 border border-stone-100">
            <SpinnerDots />
            <p className="text-stone-400 text-sm">等待下一題...</p>
          </div>
        </div>
      </PageShell>
    )
  }

  // ─── Screen 3: Answering ────────────────────────────────────────────────────

  return (
    <PageShell>
      <div className="px-5 py-7 max-w-lg mx-auto flex flex-col gap-6">
        {/* Question header */}
        {state.question && (
          <div>
            <div className="mb-3">
              <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
                第 {state.question.index + 1} 題 / 共 {state.question.total} 題
              </span>
            </div>
            <h2 className="text-2xl font-semibold text-stone-800 leading-snug">
              {state.question.text}
            </h2>
          </div>
        )}

        {/* Answer input */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-stone-500" htmlFor="answer-input">
            你的回答
          </label>
          <textarea
            id="answer-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="在這裡輸入你的想法..."
            rows={4}
            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-stone-800 text-base leading-relaxed placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300 resize-none shadow-sm transition"
          />
          <p className="text-xs text-stone-400 text-right">⌘ + Enter 快速送出</p>
        </div>

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!inputValue.trim()}
          className="w-full py-4 rounded-2xl bg-amber-500 text-white font-semibold text-base tracking-wide shadow-md active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 hover:bg-amber-600"
        >
          送出答案
        </button>

        {/* Confirmation flash + submission log */}
        <div className="flex flex-col gap-3 min-h-[2.5rem]">
          {justSubmitted && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-50 border border-green-200">
              <span className="text-green-500 font-bold text-base">✓</span>
              <span className="text-green-700 text-sm font-medium">已送出</span>
            </div>
          )}

          {state.submissionsThisQuestion.length > 0 && (
            <div className="rounded-2xl bg-stone-50 border border-stone-100 px-4 py-3">
              <p className="text-xs text-stone-400 mb-2">
                你已送出 {state.submissionsThisQuestion.length} 則答案
              </p>
              <ol className="flex flex-col gap-1.5">
                {state.submissionsThisQuestion.map((ans, i) => (
                  <li key={i} className="flex gap-2 items-start">
                    <span className="text-xs text-stone-300 mt-0.5 min-w-[1.25rem] text-right flex-shrink-0">
                      {i + 1}.
                    </span>
                    <span className="text-stone-500 text-sm leading-relaxed break-all flex-1 min-w-0">{ans}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* Waiting status */}
        <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-stone-50 border border-stone-100 mt-auto">
          <SpinnerDots />
          <p className="text-stone-400 text-sm">等待老師翻牌...</p>
        </div>
      </div>
    </PageShell>
  )
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 font-sans">
      <div className="w-full h-1.5 bg-gradient-to-r from-amber-300 via-orange-300 to-rose-300" />
      <div className="max-w-lg mx-auto">{children}</div>
    </div>
  )
}

// ─── Spinner: ring ────────────────────────────────────────────────────────────

function SpinnerRing() {
  return (
    <div
      className="w-12 h-12 rounded-full border-4 border-stone-200 border-t-amber-400 animate-spin"
      role="status"
      aria-label="載入中"
    />
  )
}

// ─── Spinner: dots ────────────────────────────────────────────────────────────

function SpinnerDots() {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-stone-300 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}
