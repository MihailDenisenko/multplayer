// Общие типы, используемые и на клиенте, и на сервере (только типы, без логики).

export type RoomStatus = "lobby" | "playing" | "finished";
export type RoomDirection = "cw" | "ccw";
export type RoomStyle = "realistic" | "cartoon";
export type SheetStage = "question_only" | "answer_and_question" | "final_answer";
export type PlayerActivity = "writing" | "waiting" | "done" | "offline";

export interface RoomSettingsDTO {
  code: string;
  status: RoomStatus;
  maxPlayers: number;
  folds: number;
  foldsDone: number;
  direction: RoomDirection;
  style: RoomStyle;
  showFirstAuthor: boolean;
}

export interface PlayerPublicDTO {
  id: number;
  name: string;
  avatar: string | null;
  seat: number;
  isHost: boolean;
  activity: PlayerActivity;
  isMe: boolean;
}

export interface MySheetDTO {
  sheetId: number;
  stage: SheetStage;
  keyword: string | null; // ключевое слово, видимое сейчас (null на question_only)
  firstAuthorName: string | null; // если включена опция показа первого автора
  progress: { count: number; target: number };
  foldsDone: number;
  receivedFromName: string | null;
}

export interface StateResponseDTO {
  room: RoomSettingsDTO;
  players: PlayerPublicDTO[];
  me: { id: number; name: string; seat: number; isHost: boolean };
  mySheet: MySheetDTO | null;
  waitingForName: string | null; // от кого жду листок, если сейчас ничего нет
  queuedCount: number; // сколько листков ждут своей очереди у меня "в стопке"
  sheetsProgress: { finished: number; total: number };
  finished: boolean;
}

export interface ResultEntryDTO {
  type: "question" | "answer";
  text: string;
  keyword: string | null;
  authorName: string;
}

export interface ResultSheetDTO {
  sheetId: number;
  originAuthorName: string;
  entries: ResultEntryDTO[];
}

export interface ResultsResponseDTO {
  room: RoomSettingsDTO;
  sheets: ResultSheetDTO[];
}
