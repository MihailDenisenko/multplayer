// Схема базы данных игры "Чепуха".
// Используем Drizzle ORM (pg-core). Все таблицы хранят состояние комнат,
// игроков, листков бумаги и записей (вопросов/ответов) на них.

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ───────────────────────────── Комнаты ─────────────────────────────
export const rooms = pgTable(
  "rooms",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 8 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("lobby"), // lobby | playing | finished
    maxPlayers: integer("max_players").notNull().default(6),
    folds: integer("folds").notNull().default(12), // лимит загибов каждого листка
    foldsDone: integer("folds_done").notNull().default(0),
    direction: varchar("direction", { length: 3 }).notNull().default("cw"), // cw | ccw
    style: varchar("style", { length: 12 }).notNull().default("realistic"), // realistic | cartoon
    showFirstAuthor: boolean("show_first_author").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("rooms_code_idx").on(table.code)],
);

// ───────────────────────────── Игроки ─────────────────────────────
export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 64 }).notNull(),
    name: varchar("name", { length: 40 }).notNull(),
    avatar: text("avatar"), // base64 data-url круглой аватарки
    seat: integer("seat").notNull(), // порядок за столом (0..N-1)
    isHost: boolean("is_host").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("players_token_idx").on(table.token),
    index("players_room_idx").on(table.roomId),
  ],
);

// ───────────────────────────── Листки ─────────────────────────────
export const sheets = pgTable(
  "sheets",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    originPlayerId: integer("origin_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    currentHolderId: integer("current_holder_id").references(() => players.id, {
      onDelete: "set null",
    }),
    isActiveForHolder: boolean("is_active_for_holder").notNull().default(true),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull().defaultNow(),
    targetEntries: integer("target_entries").notNull(), // сохранено для совместимости; лимит задаётся в rooms.folds
    foldsDone: integer("folds_done").notNull().default(0),
    status: varchar("status", { length: 12 }).notNull().default("active"), // active | finished
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sheets_room_idx").on(table.roomId),
    index("sheets_holder_idx").on(table.currentHolderId),
  ],
);

// ───────────────────────────── Записи ─────────────────────────────
export const entries = pgTable(
  "entries",
  {
    id: serial("id").primaryKey(),
    sheetId: integer("sheet_id")
      .notNull()
      .references(() => sheets.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    type: varchar("type", { length: 10 }).notNull(), // question | answer
    text: text("text").notNull(),
    keyword: varchar("keyword", { length: 60 }), // только для вопросов
    authorId: integer("author_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    authorName: varchar("author_name", { length: 40 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("entries_sheet_idx").on(table.sheetId)],
);
