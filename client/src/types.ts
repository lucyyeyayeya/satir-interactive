// Shared WebSocket message types

export interface Question {
  id: string
  text: string
  index: number  // 0-based, only valid when session is active
  total: number
}

export interface QuestionDraft {
  id: string
  text: string
}

export interface ParticipantInfo {
  participantId: string
  nickname: string   // display name (may have ② suffix if deduped)
  label: string      // "參與者 1" fallback
}

export interface ParticipantAnswers {
  participantId: string
  nickname: string
  label: string
  answers: string[]
}

// Client → Server
export type ClientMessage =
  | { type: 'create_room' }
  | { type: 'join'; roomId: string; role: 'host' | 'participant'; nickname?: string }
  | { type: 'add_question'; question: { id: string; text: string } }
  | { type: 'remove_question'; questionId: string }
  | { type: 'reorder_questions'; questionIds: string[] }
  | { type: 'start_session' }
  | { type: 'next_question' }
  | { type: 'submit_answer'; answer: string }
  | { type: 'reveal' }

// Server → Client
export type ServerMessage =
  | { type: 'room_created'; roomId: string }
  | {
      type: 'joined'
      role: 'host' | 'participant'
      participantId: string
      participantCount: number
      currentQuestion: Question | null
      phase: RoomPhase
      questions: QuestionDraft[]        // full deck so host can restore on rejoin
      participants: ParticipantInfo[]   // who is in the room
      nickname: string                  // confirmed nickname (may be deduped)
    }
  | { type: 'participant_list'; participants: ParticipantInfo[] }
  | { type: 'question_deck_updated'; questions: QuestionDraft[] }
  | { type: 'question_updated'; question: Question }
  | { type: 'session_started'; question: Question }
  | { type: 'answer_received'; answerCount: number; participantCount: number }
  | { type: 'revealed'; answers: ParticipantAnswers[] }
  | { type: 'session_ended' }
  | { type: 'error'; message: string }

export type RoomPhase = 'waiting' | 'answering' | 'revealed' | 'ended'

// LocalStorage schema for dashboard
export interface SavedRoom {
  roomId: string
  title: string       // e.g. "5/15 薩提爾工作坊"
  createdAt: string   // ISO string
}
