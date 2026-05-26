import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Question {
  id: string;
  text: string;
}

type Phase = "waiting" | "answering" | "revealed" | "ended";

interface Participant {
  participantId: string;
  nickname: string;
  label: string;
  ws: WebSocket;
  answersByQuestion: Map<number, string[]>;
}

interface Room {
  roomId: string;
  questions: Question[];
  currentIndex: number;
  phase: Phase;
  hostWs: WebSocket | null;
  participants: Map<string, Participant>; // participantId → Participant
  nicknames: Set<string>; // currently active (deduped) nicknames
  nextParticipantNumber: number;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>();

interface ClientMeta {
  roomId: string;
  role: "host" | "participant";
  participantId?: string;
}
const clientMeta = new Map<WebSocket, ClientMeta>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CIRCLED_NUMBERS = ["②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

function deduplicateNickname(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (const suffix of CIRCLED_NUMBERS) {
    const candidate = base + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  // Fallback: append a short uuid segment
  return base + "-" + randomUUID().slice(0, 4);
}

function generateRoomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let id: string;
  do {
    id = Array.from({ length: 4 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
  } while (rooms.has(id));
  return id;
}

function send(ws: WebSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastAll(room: Room, data: object): void {
  if (room.hostWs) send(room.hostWs, data);
  for (const p of room.participants.values()) {
    send(p.ws, data);
  }
}

function currentQuestionPayload(
  room: Room
): { id: string; text: string; index: number; total: number } | null {
  if (room.questions.length === 0 || room.phase === "waiting") return null;
  const q = room.questions[room.currentIndex];
  if (!q) return null;
  return {
    id: q.id,
    text: q.text,
    index: room.currentIndex,
    total: room.questions.length,
  };
}

function participantListPayload(
  room: Room
): { participantId: string; nickname: string; label: string }[] {
  return Array.from(room.participants.values()).map((p) => ({
    participantId: p.participantId,
    nickname: p.nickname,
    label: p.label,
  }));
}

function answeredCount(room: Room): number {
  let count = 0;
  for (const p of room.participants.values()) {
    const answers = p.answersByQuestion.get(room.currentIndex);
    if (answers && answers.length > 0) count++;
  }
  return count;
}

function broadcastParticipantList(room: Room): void {
  if (room.hostWs) {
    send(room.hostWs, {
      type: "participant_list",
      participants: participantListPayload(room),
    });
  }
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function handleCreateRoom(ws: WebSocket): void {
  const roomId = generateRoomId();
  const room: Room = {
    roomId,
    questions: [],
    currentIndex: 0,
    phase: "waiting",
    hostWs: ws,
    participants: new Map(),
    nicknames: new Set(),
    nextParticipantNumber: 1,
  };
  rooms.set(roomId, room);
  clientMeta.set(ws, { roomId, role: "host" });

  send(ws, { type: "room_created", roomId });
}

function handleJoin(
  ws: WebSocket,
  roomId: string,
  role: "host" | "participant",
  nickname?: string
): void {
  const room = rooms.get(roomId);
  if (!room) {
    send(ws, { type: "error", message: `找不到房間 ${roomId}，請確認房間代碼` });
    return;
  }

  if (role === "host") {
    room.hostWs = ws;
    clientMeta.set(ws, { roomId, role: "host" });

    send(ws, {
      type: "joined",
      role: "host",
      participantId: "host",
      participantCount: room.participants.size,
      currentQuestion: currentQuestionPayload(room),
      phase: room.phase,
      questions: room.questions,
      participants: participantListPayload(room),
      nickname: "host",
    });

    if (room.phase === "revealed") {
      const answers = Array.from(room.participants.values()).map((p) => ({
        participantId: p.participantId,
        nickname: p.nickname,
        label: p.label,
        answers: p.answersByQuestion.get(room.currentIndex) ?? [],
      }));
      send(ws, { type: "revealed", answers });
    } else if (room.phase === "waiting") {
      send(ws, { type: "question_deck_updated", questions: room.questions });
    }
  } else {
    // Participant
    const base = nickname?.trim() || "參與者";
    const confirmedNickname = deduplicateNickname(base, room.nicknames);
    room.nicknames.add(confirmedNickname);

    const participantId = randomUUID();
    const label = `參與者 ${room.nextParticipantNumber++}`;
    const participant: Participant = {
      participantId,
      nickname: confirmedNickname,
      label,
      ws,
      answersByQuestion: new Map(),
    };
    room.participants.set(participantId, participant);
    clientMeta.set(ws, { roomId, role: "participant", participantId });

    send(ws, {
      type: "joined",
      role: "participant",
      participantId,
      participantCount: room.participants.size,
      currentQuestion: currentQuestionPayload(room),
      phase: room.phase,
      questions: room.questions,
      participants: participantListPayload(room),
      nickname: confirmedNickname,
    });

    broadcastParticipantList(room);
  }
}

function handleAddQuestion(ws: WebSocket, question: Question): void {
  const meta = clientMeta.get(ws);
  if (!meta || meta.role !== "host") {
    send(ws, { type: "error", message: "只有主持人可以新增題目" });
    return;
  }

  const room = rooms.get(meta.roomId);
  if (!room) {
    send(ws, { type: "error", message: "找不到此房間" });
    return;
  }

  if (room.phase !== "waiting") {
    send(ws, {
      type: "error",
      message: "課堂進行中，無法修改題目",
    });
    return;
  }

  if (!question || typeof question.id !== "string" || typeof question.text !== "string") {
    send(ws, { type: "error", message: "題目格式錯誤" });
    return;
  }

  room.questions.push({ id: question.id, text: question.text });
  broadcastAll(room, { type: "question_deck_updated", questions: room.questions });
}

function handleRemoveQuestion(ws: WebSocket, questionId: string): void {
  const meta = clientMeta.get(ws);
  if (!meta || meta.role !== "host") {
    send(ws, { type: "error", message: "只有主持人可以刪除題目" });
    return;
  }

  const room = rooms.get(meta.roomId);
  if (!room) {
    send(ws, { type: "error", message: "找不到此房間" });
    return;
  }

  if (room.phase !== "waiting") {
    send(ws, {
      type: "error",
      message: "課堂進行中，無法修改題目",
    });
    return;
  }

  const before = room.questions.length;
  room.questions = room.questions.filter((q) => q.id !== questionId);

  if (room.questions.length === before) {
    send(ws, { type: "error", message: `找不到題目（id: ${questionId}）` });
    return;
  }

  broadcastAll(room, { type: "question_deck_updated", questions: room.questions });
}

function handleReorderQuestions(ws: WebSocket, questionIds: string[]): void {
  const meta = clientMeta.get(ws);
  if (!meta || meta.role !== "host") {
    send(ws, { type: "error", message: "只有主持人可以排序題目" });
    return;
  }

  const room = rooms.get(meta.roomId);
  if (!room) {
    send(ws, { type: "error", message: "找不到此房間" });
    return;
  }

  if (room.phase !== "waiting") {
    send(ws, {
      type: "error",
      message: "課堂進行中，無法修改題目",
    });
    return;
  }

  if (!Array.isArray(questionIds)) {
    send(ws, { type: "error", message: "題目順序格式錯誤" });
    return;
  }

  const questionMap = new Map(room.questions.map((q) => [q.id, q]));
  const reordered: Question[] = [];
  for (const id of questionIds) {
    const q = questionMap.get(id);
    if (q) reordered.push(q);
  }

  // Append any questions not mentioned in the provided id list (safety net)
  for (const q of room.questions) {
    if (!questionIds.includes(q.id)) reordered.push(q);
  }

  room.questions = reordered;
  broadcastAll(room, { type: "question_deck_updated", questions: room.questions });
}

function handleStartSession(ws: WebSocket): void {
  const meta = clientMeta.get(ws);
  if (!meta || meta.role !== "host") {
    send(ws, { type: "error", message: "只有主持人可以開始課堂" });
    return;
  }

  const room = rooms.get(meta.roomId);
  if (!room) {
    send(ws, { type: "error", message: "找不到此房間" });
    return;
  }

  if (room.phase !== "waiting") {
    send(ws, { type: "error", message: "課堂已開始，無法重新啟動" });
    return;
  }

  if (room.questions.length === 0) {
    send(ws, { type: "error", message: "請先新增至少一個題目" });
    return;
  }

  room.phase = "answering";
  room.currentIndex = 0;

  broadcastAll(room, {
    type: "session_started",
    question: currentQuestionPayload(room),
  });
}

function handleNextQuestion(ws: WebSocket): void {
  const meta = clientMeta.get(ws);
  if (!meta || meta.role !== "host") {
    send(ws, { type: "error", message: "只有主持人可以切換題目" });
    return;
  }

  const room = rooms.get(meta.roomId);
  if (!room) {
    send(ws, { type: "error", message: "找不到此房間" });
    return;
  }

  if (room.phase === "ended") {
    send(ws, { type: "error", message: "課堂已結束" });
    return;
  }

  if (room.phase === "waiting") {
    send(ws, { type: "error", message: "課堂尚未開始" });
    return;
  }

  if (room.currentIndex >= room.questions.length - 1) {
    room.phase = "ended";
    broadcastAll(room, { type: "session_ended" });
    return;
  }

  room.currentIndex += 1;
  room.phase = "answering";

  broadcastAll(room, {
    type: "question_updated",
    question: currentQuestionPayload(room),
  });
}

function handleSubmitAnswer(ws: WebSocket, answer: string): void {
  const meta = clientMeta.get(ws);
  if (!meta || meta.role !== "participant" || !meta.participantId) {
    send(ws, { type: "error", message: "只有學員可以送出回答" });
    return;
  }

  const room = rooms.get(meta.roomId);
  if (!room) {
    send(ws, { type: "error", message: "找不到此房間" });
    return;
  }

  if (room.phase !== "answering") {
    send(ws, {
      type: "error",
      message: "目前非作答階段，無法送出回答",
    });
    return;
  }

  const participant = room.participants.get(meta.participantId);
  if (!participant) {
    send(ws, { type: "error", message: "找不到此學員" });
    return;
  }

  const existing = participant.answersByQuestion.get(room.currentIndex) ?? [];
  existing.push(answer);
  participant.answersByQuestion.set(room.currentIndex, existing);

  if (room.hostWs) {
    send(room.hostWs, {
      type: "answer_received",
      answerCount: answeredCount(room),
      participantCount: room.participants.size,
    });
  }
}

function handleReveal(ws: WebSocket): void {
  const meta = clientMeta.get(ws);
  if (!meta || meta.role !== "host") {
    send(ws, { type: "error", message: "只有主持人可以公佈答案" });
    return;
  }

  const room = rooms.get(meta.roomId);
  if (!room) {
    send(ws, { type: "error", message: "找不到此房間" });
    return;
  }

  if (room.phase === "ended") {
    send(ws, { type: "error", message: "課堂已結束" });
    return;
  }

  if (room.phase === "waiting") {
    send(ws, { type: "error", message: "課堂尚未開始" });
    return;
  }

  room.phase = "revealed";

  const answers = Array.from(room.participants.values()).map((p) => ({
    participantId: p.participantId,
    nickname: p.nickname,
    label: p.label,
    answers: p.answersByQuestion.get(room.currentIndex) ?? [],
  }));

  broadcastAll(room, { type: "revealed", answers });
}

// ---------------------------------------------------------------------------
// Disconnect cleanup
// ---------------------------------------------------------------------------

function handleDisconnect(ws: WebSocket): void {
  const meta = clientMeta.get(ws);
  if (!meta) return;

  const room = rooms.get(meta.roomId);
  if (!room) {
    clientMeta.delete(ws);
    return;
  }

  if (meta.role === "host") {
    room.hostWs = null;
  } else if (meta.role === "participant" && meta.participantId) {
    const participant = room.participants.get(meta.participantId);
    if (participant) {
      room.nicknames.delete(participant.nickname);
      room.participants.delete(meta.participantId);
    }
    broadcastParticipantList(room);
  }

  clientMeta.delete(ws);
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws: WebSocket) => {
  ws.on("message", (raw: Buffer | string) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "訊息格式錯誤" });
      return;
    }

    const { type } = msg;

    switch (type) {
      case "create_room": {
        handleCreateRoom(ws);
        break;
      }
      case "join": {
        const roomId = msg.roomId as string;
        const role = msg.role as "host" | "participant";
        const nickname = msg.nickname as string | undefined;
        if (!roomId || (role !== "host" && role !== "participant")) {
          send(ws, { type: "error", message: "加入房間的資料格式錯誤" });
          return;
        }
        handleJoin(ws, roomId, role, nickname);
        break;
      }
      case "add_question": {
        const question = msg.question as Question;
        handleAddQuestion(ws, question);
        break;
      }
      case "remove_question": {
        const questionId = msg.questionId as string;
        if (typeof questionId !== "string") {
          send(ws, { type: "error", message: "題目 ID 格式錯誤" });
          return;
        }
        handleRemoveQuestion(ws, questionId);
        break;
      }
      case "reorder_questions": {
        const questionIds = msg.questionIds as string[];
        handleReorderQuestions(ws, questionIds);
        break;
      }
      case "start_session": {
        handleStartSession(ws);
        break;
      }
      case "next_question": {
        handleNextQuestion(ws);
        break;
      }
      case "submit_answer": {
        const answer = msg.answer;
        if (typeof answer !== "string" || answer.trim() === "") {
          send(ws, { type: "error", message: "回答內容不可為空" });
          return;
        }
        handleSubmitAnswer(ws, answer.trim());
        break;
      }
      case "reveal": {
        handleReveal(ws);
        break;
      }
      default: {
        send(ws, { type: "error", message: `未知的訊息類型：${type}` });
      }
    }
  });

  ws.on("close", () => {
    handleDisconnect(ws);
  });

  ws.on("error", () => {
    handleDisconnect(ws);
  });
});

wss.on("listening", () => {
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});

wss.on("error", (err) => {
  console.error("WebSocketServer error:", err);
});
