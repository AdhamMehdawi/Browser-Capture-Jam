import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recordingsTable = pgTable("recordings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull().default("Untitled Recording"),
  duration: integer("duration").notNull().default(0),
  pageUrl: text("page_url"),
  pageTitle: text("page_title"),
  networkLogsCount: integer("network_logs_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  consoleCount: integer("console_count").notNull().default(0),
  clickCount: integer("click_count").notNull().default(0),
  videoObjectPath: text("video_object_path"),
  shareToken: text("share_token").unique(),
  tags: text("tags").array().notNull().default([]),
  events: jsonb("events").notNull().default([]),
  browserInfo: jsonb("browser_info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const usersTable = pgTable("snapcap_users", {
  id: text("id").primaryKey(),
  apiKey: text("api_key").unique(),
  apiKeyPreview: text("api_key_preview"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRecordingSchema = createInsertSchema(recordingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertRecording = z.infer<typeof insertRecordingSchema>;
export type Recording = typeof recordingsTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
