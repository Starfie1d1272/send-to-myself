import assert from "node:assert/strict";
import test from "node:test";
import { createItemInput, itemSchema, updateItemInput } from "../src/schema.ts";

test("item metadata keeps arbitrary string keys and nested preview data", () => {
  const meta = { preview: { title: "标题", status: "ok" }, suggestions: { todo: false }, custom: 42 };
  const item = itemSchema.parse({
    id: "fixture",
    content: "文字",
    kind: "text",
    category: "none",
    isTodo: false,
    completed: false,
    pinned: false,
    sensitive: false,
    meta,
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
  });
  assert.deepEqual(item.meta, meta);
});

test("create input retains defaults and validates offline deduplication keys", () => {
  assert.deepEqual(createItemInput.parse({}), { content: "" });
  assert.deepEqual(createItemInput.parse({ content: "文字", dedupeKey: "offline-1" }), {
    content: "文字",
    dedupeKey: "offline-1",
  });
  assert.equal(createItemInput.safeParse({ dedupeKey: "" }).success, false);
  assert.equal(createItemInput.safeParse({ content: "x".repeat(100001) }).success, false);
});

test("partial updates preserve nullable due dates and reject invalid fields", () => {
  assert.deepEqual(updateItemInput.parse({ dueAt: null, isTodo: true }), { dueAt: null, isTodo: true });
  assert.deepEqual(updateItemInput.parse({}), {});
  assert.equal(updateItemInput.safeParse({ category: "todo" }).success, false);
  assert.equal(updateItemInput.safeParse({ dueAt: "tomorrow" }).success, false);
  assert.equal(updateItemInput.safeParse({ completed: "true" }).success, false);
});
