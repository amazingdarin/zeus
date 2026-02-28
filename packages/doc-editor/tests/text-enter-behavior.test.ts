import assert from "node:assert/strict"
import { test } from "node:test"

import {
  resolveTextEnterBehavior,
  type TextEnterContext,
} from "../src/extensions/TextEnterBehaviorExtension"

function createContext(partial: Partial<TextEnterContext>): TextEnterContext {
  return {
    selectionEmpty: true,
    inCodeBlock: false,
    listItemType: null,
    listItemEmpty: false,
    inBlockquote: false,
    currentTextBlockEmpty: false,
    ...partial,
  }
}

test("enter behavior: non-empty ordered/bullet list item continues list", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        listItemType: "listItem",
        listItemEmpty: false,
      }),
    ),
    "continue-list-item",
  )
})

test("enter behavior: empty ordered/bullet list item exits list to paragraph", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        listItemType: "listItem",
        listItemEmpty: true,
      }),
    ),
    "exit-list-item",
  )
})

test("enter behavior: non-empty task item continues task list", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        listItemType: "taskItem",
        listItemEmpty: false,
      }),
    ),
    "continue-list-item",
  )
})

test("enter behavior: empty task item exits task list to paragraph", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        listItemType: "taskItem",
        listItemEmpty: true,
      }),
    ),
    "exit-list-item",
  )
})

test("enter behavior: empty blockquote line exits blockquote", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        inBlockquote: true,
        currentTextBlockEmpty: true,
      }),
    ),
    "exit-blockquote",
  )
})

test("enter behavior: non-empty paragraph/heading keeps default split behavior", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        currentTextBlockEmpty: false,
      }),
    ),
    "none",
  )
})

test("enter behavior: code block keeps default enter behavior", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        inCodeBlock: true,
      }),
    ),
    "none",
  )
})

test("enter behavior: non-collapsed selection keeps default behavior", () => {
  assert.equal(
    resolveTextEnterBehavior(
      createContext({
        selectionEmpty: false,
        listItemType: "listItem",
        listItemEmpty: true,
      }),
    ),
    "none",
  )
})
