import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import {
  ServerMessage,
  ClientMessage,
  Question,
  QuestionDraft,
  ParticipantAnswers,
  ParticipantInfo,
  RoomPhase,
} from '../types'
import { WS_URL } from '../lib/config'

// ── QR Modal ──────────────────────────────────────────────────────────────────

function QRModal({
  url,
  onClose,
  onCopy,
  copied,
}: {
  url: string
  onClose: () => void
  onCopy: () => void
  copied: boolean
}) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=220x220&margin=2`
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-amber-100 w-full max-w-sm p-6 text-center">
        <h2 className="text-lg font-bold text-stone-800 mb-1">加入討論</h2>
        <p className="text-xs text-stone-400 mb-4">學員掃描 QR Code 或使用連結加入</p>
        <img
          src={qrSrc}
          alt="QR Code"
          className="w-52 h-52 mx-auto rounded-xl border border-amber-100 mb-4"
        />
        <p className="text-xs font-mono text-amber-900 bg-amber-50 rounded-lg px-3 py-2 break-all mb-4">
          {url}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCopy}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${
              copied
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            {copied ? '✓ 已複製連結' : '複製連結'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50 transition"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
        connected ? 'bg-green-400' : 'bg-amber-300 animate-pulse'
      }`}
      title={connected ? '已連線' : '連線中...'}
    />
  )
}

// ── Right sidebar ─────────────────────────────────────────────────────────────

function ParticipantList({
  participants,
  count,
}: {
  participants: ParticipantInfo[]
  count: number
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider flex-1">
          學員名單
        </p>
        <span className="text-xs bg-amber-100 text-amber-800 font-bold rounded-full px-2 py-0.5">
          {count}
        </span>
        <span className="text-stone-400 text-xs group-hover:text-stone-600 transition ml-1">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {!collapsed && (
        <div className="max-h-[200px] overflow-y-auto">
          {participants.length === 0 ? (
            <p className="text-xs text-stone-400 py-4 text-center">尚未有學員加入</p>
          ) : (
            <div className="space-y-1.5">
              {participants.map((p) => (
                <div
                  key={p.participantId}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-amber-50 transition"
                >
                  <div className="w-7 h-7 rounded-full bg-amber-200 flex items-center justify-center text-amber-800 font-bold text-xs flex-shrink-0">
                    {p.nickname ? p.nickname.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-stone-700 truncate">{p.nickname}</p>
                    <p className="text-xs text-stone-400 truncate">{p.label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QuestionProgress({
  questions,
  currentQuestion,
  allSummary,
  viewingRoundQuestionId,
  onSelectRound,
}: {
  questions: QuestionDraft[]
  currentQuestion: Question | null
  allSummary: { question: Question; answers: ParticipantAnswers[] }[]
  viewingRoundQuestionId: string | null
  onSelectRound: (summaryIndex: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  // Map question id → summary index for revealed rounds
  const summaryIndexById = new Map(allSummary.map((s, i) => [s.question.id, i]))

  return (
    <div className="border-t border-amber-100 pt-4">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 w-full text-left mb-2 group"
      >
        <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider flex-1">
          題目進度
        </p>
        <span className="text-stone-400 text-xs group-hover:text-stone-600 transition">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-1.5">
          {questions.length === 0 ? (
            <p className="text-xs text-stone-400">（無題目）</p>
          ) : (
            questions.map((q, i) => {
              const isCurrent = currentQuestion?.id === q.id
              const summaryIdx = summaryIndexById.get(q.id)
              const isRevealed = summaryIdx !== undefined
              const isViewing = viewingRoundQuestionId === q.id

              return (
                <div
                  key={q.id}
                  onClick={() => isRevealed && onSelectRound(summaryIdx!)}
                  title={isRevealed ? '點擊回顧此輪答案' : undefined}
                  className={`rounded-lg px-3 py-2 text-xs leading-snug transition select-none ${
                    isViewing
                      ? 'bg-amber-300 border border-amber-400 text-amber-900 font-semibold cursor-pointer'
                      : isCurrent
                      ? 'bg-amber-200 border border-amber-300 text-amber-900 font-semibold'
                      : isRevealed
                      ? 'bg-stone-100 text-stone-600 cursor-pointer hover:bg-amber-50 hover:text-amber-800'
                      : 'bg-stone-100 text-stone-400'
                  }`}
                >
                  <span className="mr-1.5 font-bold text-stone-400">{i + 1}.</span>
                  {q.text}
                  {isRevealed && !isCurrent && (
                    <span className="ml-1 text-stone-400">✓</span>
                  )}
                </div>
              )
            })
          )}
          {/* Return to current button when viewing history */}
          {viewingRoundQuestionId && (
            <button
              onClick={() => onSelectRound(-1)}
              className="w-full mt-1 py-1.5 rounded-lg text-xs font-semibold bg-stone-700 text-white hover:bg-stone-800 transition"
            >
              目前進度 ▶
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main area phases ──────────────────────────────────────────────────────────

function WaitingMain({
  joinUrl,
  participantCount,
  copied,
  onCopy,
  onShowQR,
  questionCount,
  roomId,
  onStart,
}: {
  joinUrl: string
  participantCount: number
  copied: boolean
  onCopy: () => void
  onShowQR: () => void
  questionCount: number
  roomId: string
  onStart: () => void
}) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(joinUrl)}&size=160x160&margin=2`

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-6 py-8">
      <div className="text-center">
        <div className="text-5xl mb-3">🌿</div>
        <h2 className="text-2xl font-bold text-stone-700">準備開始</h2>
        {questionCount === 0 ? (
          <p className="text-stone-400 text-sm mt-1">尚未設定題目，請前往題庫頁設定後再開始討論</p>
        ) : (
          <p className="text-stone-400 text-sm mt-1">
            已設定 {questionCount} 題，等學員加入後按「開始討論」
          </p>
        )}
      </div>

      {/* Participant count */}
      <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 border border-amber-200 rounded-full">
        <span className="text-xl">👥</span>
        <span className="text-amber-800 font-bold">{participantCount}</span>
        <span className="text-amber-700 text-sm">位學員已加入</span>
      </div>

      {/* QR Code inline */}
      <div className="flex flex-col items-center gap-2">
        <img
          src={qrSrc}
          alt="QR Code"
          className="w-32 h-32 rounded-xl border border-amber-200 cursor-pointer hover:border-amber-400 transition shadow-sm"
          onClick={onShowQR}
          title="點擊放大"
        />
        <button
          onClick={onShowQR}
          className="text-xs text-amber-600 hover:text-amber-800 hover:underline transition"
        >
          放大 QR Code
        </button>
      </div>

      {/* Join URL */}
      <div className="w-full max-w-sm bg-white rounded-xl border border-amber-100 shadow-sm p-4">
        <p className="text-xs text-stone-500 font-semibold mb-2">加入連結</p>
        <div className="flex items-center gap-2 bg-amber-50 rounded-lg px-3 py-2">
          <span className="flex-1 text-xs font-mono text-amber-900 break-all leading-relaxed">
            {joinUrl}
          </span>
          <button
            onClick={onCopy}
            className={`flex-shrink-0 px-2.5 py-1 rounded text-xs font-semibold transition ${
              copied
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-amber-200 hover:bg-amber-300 text-amber-900'
            }`}
          >
            {copied ? '已複製' : '複製'}
          </button>
        </div>
      </div>

      {/* CTA */}
      {questionCount === 0 ? (
        <Link
          to={`/host/${roomId}/edit`}
          className="px-8 py-3 bg-amber-700 hover:bg-amber-800 text-white font-bold text-sm rounded-2xl transition shadow-md"
        >
          前往題庫設定 →
        </Link>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onStart}
            className="px-10 py-3.5 bg-amber-700 hover:bg-amber-800 text-white font-bold text-base rounded-2xl transition shadow-md"
          >
            ▶ 開始討論
          </button>
          <Link
            to={`/host/${roomId}/edit`}
            className="text-xs text-stone-400 hover:text-amber-700 hover:underline transition"
          >
            ✏️ 編輯題目
          </Link>
        </div>
      )}
    </div>
  )
}

function AnsweringMain({
  question,
  answerCount,
  participantCount,
  onReveal,
}: {
  question: Question
  answerCount: number
  participantCount: number
  onReveal: () => void
}) {
  const pct = participantCount > 0 ? Math.round((answerCount / participantCount) * 100) : 0

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Question badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold bg-amber-100 text-amber-800 rounded-full px-3 py-1">
          第 {question.index + 1} 輪 / 共 {question.total} 輪
        </span>
      </div>

      {/* Question text */}
      <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-6">
        <p className="text-2xl font-bold text-stone-800 leading-relaxed">{question.text}</p>
      </div>

      {/* Answer progress */}
      <div className="bg-white rounded-2xl border border-amber-100 shadow-sm px-6 py-5">
        <p className="text-xs text-stone-500 font-medium mb-2">回答狀況</p>
        <p className="text-2xl font-bold text-stone-800 mb-3">
          已回答{' '}
          <span className="text-amber-700">{answerCount}</span>
          <span className="text-base font-normal text-stone-400 mx-1">/</span>
          {participantCount} 人
        </p>
        {participantCount > 0 && (
          <div className="w-full bg-amber-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-amber-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            onClick={onReveal}
            disabled={answerCount === 0}
            className="px-6 py-2.5 bg-amber-700 hover:bg-amber-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-bold rounded-xl transition shadow-sm text-sm"
          >
            公佈答案
          </button>
        </div>
      </div>
    </div>
  )
}

function RevealedMain({
  question,
  answers,
  isLast,
  onNext,
  isHistory = false,
  showNicknames,
  onToggleShowNicknames,
}: {
  question: Question
  answers: ParticipantAnswers[]
  isLast: boolean
  onNext: () => void
  isHistory?: boolean
  showNicknames: boolean
  onToggleShowNicknames: (show: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-4 py-4">
      {/* Question */}
      <div className="bg-white rounded-2xl border border-amber-100 shadow-sm px-6 py-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold bg-amber-100 text-amber-800 rounded-full px-2.5 py-0.5">
            第 {question.index + 1} 輪
          </span>
        </div>
        <p className="text-lg font-bold text-stone-800 leading-relaxed">{question.text}</p>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-stone-600">
          學員回答
          <span className="ml-1.5 text-stone-400 font-normal text-xs">（{answers.length} 位）</span>
        </h3>

        {/* Nickname toggle — synced to all participant devices */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-stone-500">顯示暱稱</span>
          <button
            onClick={() => onToggleShowNicknames(!showNicknames)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              showNicknames ? 'bg-amber-500' : 'bg-stone-300'
            }`}
            role="switch"
            aria-checked={showNicknames}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                showNicknames ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Answers grid — 3 columns on desktop */}
      {answers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm px-6 py-10 text-center">
          <p className="text-stone-400 text-sm">暫無回答</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 lg:gap-4">
          {answers.map((pa) => {
            const displayName = showNicknames ? pa.nickname : pa.label
            return (
              <div
                key={pa.participantId}
                className="bg-white rounded-2xl border border-amber-100 shadow-sm p-4 hover:border-amber-200 transition"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center text-sm text-amber-800 font-bold flex-shrink-0">
                    {(showNicknames ? pa.nickname : pa.label).charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm lg:text-base font-semibold text-stone-700 truncate">
                    {displayName}
                  </span>
                </div>
                <div className="flex flex-col gap-2 min-w-0">
                  {pa.answers.map((answer, i) => (
                    <span
                      key={i}
                      className="text-sm lg:text-base text-stone-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100 leading-relaxed break-words"
                    >
                      {answer}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Navigation — hidden in history/review mode */}
      {!isHistory && (
        <div className="flex justify-end pt-1">
          {isLast ? (
            <button
              onClick={onNext}
              className="px-7 py-2.5 bg-stone-700 hover:bg-stone-800 text-white font-bold rounded-xl transition shadow-sm text-sm"
            >
              結束討論
            </button>
          ) : (
            <button
              onClick={onNext}
              className="px-7 py-2.5 bg-amber-700 hover:bg-amber-800 text-white font-bold rounded-xl transition shadow-sm text-sm"
            >
              下一題 →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Host component ───────────────────────────────────────────────────────

export default function Host() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<RoomPhase>('waiting')
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [questions, setQuestions] = useState<QuestionDraft[]>([])
  const [participants, setParticipants] = useState<ParticipantInfo[]>([])
  const [participantCount, setParticipantCount] = useState(0)
  const [answerCount, setAnswerCount] = useState(0)
  const [revealedAnswers, setRevealedAnswers] = useState<ParticipantAnswers[]>([])
  // Accumulated summary across all questions
  const [allSummary, setAllSummary] = useState<
    { question: Question; answers: ParticipantAnswers[] }[]
  >([])
  const [copied, setCopied] = useState(false)
  const [copiedSummary, setCopiedSummary] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showNicknames, setShowNicknames] = useState(false)

  // Sidebar: open by default on desktop (≥1024px), closed on mobile
  const [showSidebar, setShowSidebar] = useState(() => window.innerWidth >= 1024)

  // Round history navigation — null = current live phase
  const [viewingRound, setViewingRound] = useState<number | null>(null)

  // Prevent waiting-screen flash: hide content until server confirms phase
  const [serverSynced, setServerSynced] = useState(false)

  const joinUrl = `${window.location.origin}/join/${roomId}`
  const joinedRef = useRef(false)

  // Stable ref so handleMessage (empty deps) can always read the current question
  const currentQuestionRef = useRef<Question | null>(null)
  useEffect(() => {
    currentQuestionRef.current = currentQuestion
  }, [currentQuestion])

  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'joined':
        setServerSynced(true)
        setPhase(msg.phase)
        setCurrentQuestion(msg.currentQuestion)
        setParticipantCount(msg.participantCount)
        setQuestions(msg.questions ?? [])
        setParticipants(msg.participants ?? [])
        setShowNicknames(msg.showNicknames)
        break

      case 'nickname_visibility':
        setShowNicknames(msg.show)
        break

      case 'participant_list':
        setParticipants(msg.participants)
        setParticipantCount(msg.participants.length)
        break

      case 'question_deck_updated':
        setQuestions(msg.questions)
        break

      case 'session_started':
        setCurrentQuestion(msg.question)
        setPhase('answering')
        setAnswerCount(0)
        setRevealedAnswers([])
        break

      case 'question_updated':
        setCurrentQuestion(msg.question)
        setPhase('answering')
        setAnswerCount(0)
        setRevealedAnswers([])
        break

      case 'answer_received':
        setAnswerCount(msg.answerCount)
        setParticipantCount(msg.participantCount)
        break

      case 'revealed': {
        const q = currentQuestionRef.current
        setRevealedAnswers(msg.answers)
        setPhase('revealed')
        // Accumulate for end-of-session summary
        if (q) {
          setAllSummary((prev) => {
            const filtered = prev.filter((s) => s.question.id !== q.id)
            return [...filtered, { question: q, answers: msg.answers }]
          })
        }
        break
      }

      case 'session_ended':
        setPhase('ended')
        break

      case 'error':
        setErrorMsg(msg.message)
        break

      default:
        break
    }
  }, [])

  const { send, connected } = useWebSocket(WS_URL, handleMessage)

  useEffect(() => {
    if (connected && !joinedRef.current && roomId) {
      joinedRef.current = true
      send({ type: 'join', roomId, role: 'host' })
    }
    return () => {
      joinedRef.current = false
    }
  }, [connected, roomId, send])

  async function copyJoinUrl() {
    try {
      await navigator.clipboard.writeText(joinUrl)
    } catch {
      const el = document.createElement('textarea')
      el.value = joinUrl
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copySummaryText() {
    const lines = allSummary.map(({ question, answers }, i) => {
      const header = `第${i + 1}輪：${question.text}`
      const sep = '─'.repeat(24)
      const rows = answers.map((pa) => `• ${pa.nickname}：${pa.answers.join('、')}`)
      return [header, sep, ...rows].join('\n')
    })
    const full = `【討論摘要】房間 ${roomId}\n${'═'.repeat(24)}\n\n${lines.join('\n\n')}`
    navigator.clipboard.writeText(full).catch(() => {
      const el = document.createElement('textarea')
      el.value = full
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    })
    setCopiedSummary(true)
    setTimeout(() => setCopiedSummary(false), 3000)
  }

  function handleStart() {
    send({ type: 'start_session' } as ClientMessage)
  }

  function handleReveal() {
    send({ type: 'reveal' } as ClientMessage)
  }

  function handleNext() {
    send({ type: 'next_question' } as ClientMessage)
  }

  function handleToggleShowNicknames(show: boolean) {
    setShowNicknames(show)
    send({ type: 'set_nickname_visibility', show } as ClientMessage)
  }

  const isLastQuestion =
    currentQuestion !== null && currentQuestion.index === currentQuestion.total - 1

  // ── Ended / Summary screen ────────────────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <div className="min-h-screen bg-amber-50 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-amber-100 shadow-sm sticky top-0 z-20">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xl">🌸</span>
              <div>
                <p className="text-base font-bold text-amber-900">討論結束</p>
                <p className="text-xs font-mono text-stone-400">{roomId}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={copySummaryText}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                  copiedSummary
                    ? 'bg-green-100 text-green-700 border border-green-200'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
              >
                {copiedSummary ? '✓ 已複製' : '📋 複製摘要'}
              </button>
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm font-semibold rounded-xl transition"
              >
                返回儀表板
              </button>
            </div>
          </div>
        </header>

        {/* Reminder banner */}
        <div className="bg-amber-100 border-b border-amber-200">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <p className="text-amber-800 text-sm font-semibold flex-1">
              摘要不會自動儲存！請點「複製摘要」後貼到筆記保存。
            </p>
            <button
              onClick={copySummaryText}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                copiedSummary
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-amber-600 text-white hover:bg-amber-700'
              }`}
            >
              {copiedSummary ? '✓ 已複製' : '複製摘要'}
            </button>
          </div>
        </div>

        {/* Summary content */}
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
          {allSummary.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="text-5xl mb-4">📋</div>
              <p className="text-stone-400">無答題記錄</p>
            </div>
          ) : (
            <div className="space-y-6">
              {allSummary.map(({ question, answers }, i) => (
                <div
                  key={question.id}
                  className="bg-white rounded-2xl border border-amber-100 shadow-sm p-5"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold bg-amber-100 text-amber-800 rounded-full px-2.5 py-0.5">
                      第 {i + 1} 輪
                    </span>
                    <span className="text-xs text-stone-400">（{answers.length} 位回答）</span>
                  </div>
                  <p className="text-lg font-bold text-stone-800 mb-4 leading-relaxed">
                    {question.text}
                  </p>
                  {answers.length === 0 ? (
                    <p className="text-xs text-stone-400">（無回答）</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 lg:gap-4">
                      {answers.map((pa) => (
                        <div
                          key={pa.participantId}
                          className="bg-amber-50 rounded-xl p-3 border border-amber-100"
                        >
                          <p className="text-sm lg:text-base font-semibold text-stone-600 mb-2 truncate">
                            {pa.nickname}
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {pa.answers.map((a, j) => (
                              <span
                                key={j}
                                className="text-sm lg:text-base text-stone-700 bg-white rounded-lg px-3 py-2 border border-amber-100 leading-relaxed break-words"
                              >
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    )
  }

  // ── Main layout ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-amber-50 flex flex-col">
      {/* Slim sticky header */}
      <header className="bg-white border-b border-amber-100 shadow-sm sticky top-0 z-20">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          {/* Left: back button + title (room code hidden on mobile) */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-1 text-sm text-stone-500 hover:text-amber-700 transition flex-shrink-0"
              title="返回儀表板"
            >
              <span>←</span>
              <span className="hidden sm:inline text-xs">儀表板</span>
            </button>
            <span className="text-stone-200 hidden sm:inline">|</span>
            <h1 className="text-sm sm:text-base font-bold text-amber-900 truncate">
              薩提爾討論-互動小卡
            </h1>
            <span className="hidden sm:inline text-stone-300">·</span>
            <span className="hidden sm:inline text-xs text-stone-500 flex-shrink-0">
              房間{' '}
              <span className="font-mono font-semibold text-stone-700">{roomId}</span>
            </span>
          </div>

          {/* Right: participant badge + connection + QR + edit + sidebar toggle */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center gap-1 text-sm text-stone-600">
              <span>👥</span>
              <span className="font-semibold text-amber-800">{participantCount}</span>
            </div>
            <ConnectionDot connected={connected} />
            <button
              onClick={() => setShowQRModal(true)}
              className="px-2 py-1 rounded-lg text-xs font-semibold transition border bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
            >
              <span className="hidden sm:inline">QR / 連結</span>
              <span className="sm:hidden">QR</span>
            </button>
            {(phase === 'waiting' || phase === 'answering') && (
              <Link
                to={`/host/${roomId}/edit`}
                className="px-2 py-1 rounded-lg text-xs font-semibold border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-800 transition"
              >
                <span className="hidden sm:inline">✏️ 題庫</span>
                <span className="sm:hidden">✏️</span>
              </Link>
            )}
            {/* Sidebar hamburger toggle */}
            <button
              onClick={() => setShowSidebar((v) => !v)}
              className={`w-8 h-8 flex flex-col items-center justify-center gap-1 rounded-lg border transition flex-shrink-0 ${
                showSidebar
                  ? 'bg-amber-100 border-amber-300 text-amber-800'
                  : 'bg-white border-stone-200 text-stone-500 hover:bg-stone-50'
              }`}
              title={showSidebar ? '收起名單' : '展開名單'}
            >
              <span className="block w-4 h-0.5 bg-current rounded-full" />
              <span className="block w-4 h-0.5 bg-current rounded-full" />
              <span className="block w-4 h-0.5 bg-current rounded-full" />
            </button>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {errorMsg && (
        <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 text-red-600 text-sm flex items-center gap-2">
          <span className="flex-shrink-0">⚠️</span>
          <span className="flex-1">{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-red-400 hover:text-red-600 text-lg leading-none ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* 2-column layout: main + right sidebar */}
      <div className="flex-1 flex flex-col lg:flex-row gap-0 overflow-hidden">
        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto px-4 lg:px-6 py-4 lg:py-6">

          {/* Round navigation tabs — shown once at least one round has been revealed */}
          {allSummary.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {allSummary.map((s, i) => (
                <button
                  key={s.question.id}
                  onClick={() => setViewingRound(i)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    viewingRound === i
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                  }`}
                >
                  第 {i + 1} 輪
                </button>
              ))}
              <button
                onClick={() => setViewingRound(null)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                  viewingRound === null
                    ? 'bg-stone-700 text-white shadow-sm'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                目前 ▶
              </button>
            </div>
          )}

          {/* Loading spinner until server confirms phase (prevents waiting-screen flash) */}
          {!serverSynced ? (
            <div className="flex items-center justify-center min-h-[300px]">
              <div className="w-8 h-8 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin" />
            </div>
          ) : viewingRound !== null && allSummary[viewingRound] ? (
            <RevealedMain
              question={allSummary[viewingRound].question}
              answers={allSummary[viewingRound].answers}
              isLast={false}
              onNext={() => {}}
              isHistory={true}
              showNicknames={showNicknames}
              onToggleShowNicknames={handleToggleShowNicknames}
            />
          ) : (
            <>
              {phase === 'waiting' && (
                <WaitingMain
                  joinUrl={joinUrl}
                  participantCount={participantCount}
                  copied={copied}
                  onCopy={copyJoinUrl}
                  onShowQR={() => setShowQRModal(true)}
                  questionCount={questions.length}
                  roomId={roomId ?? ''}
                  onStart={handleStart}
                />
              )}
              {phase === 'answering' && currentQuestion && (
                <AnsweringMain
                  question={currentQuestion}
                  answerCount={answerCount}
                  participantCount={participantCount}
                  onReveal={handleReveal}
                />
              )}
              {phase === 'revealed' && currentQuestion && (
                <RevealedMain
                  question={currentQuestion}
                  answers={revealedAnswers}
                  isLast={isLastQuestion}
                  onNext={handleNext}
                  showNicknames={showNicknames}
                  onToggleShowNicknames={handleToggleShowNicknames}
                />
              )}
            </>
          )}
        </main>

        {/* Right sidebar: participants + question progress */}
        <aside
          className={`
            w-full lg:w-56 xl:w-64 flex-shrink-0
            bg-white border-t lg:border-t-0 lg:border-l border-amber-100
            ${showSidebar ? 'block' : 'hidden'}
          `}
        >
          <div className="p-4 flex flex-col gap-4 lg:max-h-[calc(100vh-56px)] lg:overflow-y-auto">
            <ParticipantList participants={participants} count={participantCount} />
            {phase !== 'waiting' && (
              <QuestionProgress
                questions={questions}
                currentQuestion={currentQuestion}
                allSummary={allSummary}
                viewingRoundQuestionId={
                  viewingRound !== null ? (allSummary[viewingRound]?.question.id ?? null) : null
                }
                onSelectRound={(idx) => setViewingRound(idx === -1 ? null : idx)}
              />
            )}
          </div>
        </aside>
      </div>

      {/* QR Modal */}
      {showQRModal && (
        <QRModal
          url={joinUrl}
          onClose={() => setShowQRModal(false)}
          onCopy={copyJoinUrl}
          copied={copied}
        />
      )}

      {/* Version footer */}
      <footer className="text-center py-2 text-xs text-stone-300 border-t border-amber-50">
        v7 · 薩提爾討論-互動小卡 · Made by Lucy Y
      </footer>
    </div>
  )
}
