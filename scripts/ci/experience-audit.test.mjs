import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classify, measure, overCeiling } from './experience-audit.mjs';

const textarea = "export const A = () => <textarea />;";

test('a bare textarea counts; one beside chatkit or writingkit does not', () => {
  assert.deepEqual(classify('src/Notes.tsx', textarea), ['bareTextareas']);
  assert.deepEqual(
    classify('src/Notes.tsx', "import { Composer } from '@bitbaum/chatkit/react';\n" + textarea),
    [],
  );
  assert.deepEqual(
    classify('src/Notes.tsx', "import { ArticleComposer } from '@bitbaum/writingkit/react';\n" + textarea),
    [],
  );
});

test('local chrome, composers, comments and article editors are named by their files', () => {
  assert.deepEqual(classify('src/components/Header.tsx', 'export const H = () => null;'), ['localChrome']);
  assert.deepEqual(
    classify('src/components/Header.tsx', "import { SiteMasthead } from '@bitbaum/sitekit/react';"),
    [],
  );
  assert.deepEqual(classify('src/ChatInput.tsx', 'export const C = () => null;'), ['localComposers']);
  assert.deepEqual(classify('src/CommentList.tsx', 'export const C = () => null;'), ['localComments']);
  assert.deepEqual(classify('src/ArticleComposer.tsx', 'export const C = () => null;'), ['localArticleEditors']);
  assert.deepEqual(classify('src/Card.tsx', 'export const C = () => null;'), []);
});

test('an exemption needs a stated reason of at least 20 characters', () => {
  assert.deepEqual(
    classify('src/Notes.tsx', '// experience-exempt: a code editor, dictation would corrupt it\n' + textarea),
    [],
  );
  assert.deepEqual(classify('src/Notes.tsx', '// experience-exempt: ok\n' + textarea), ['bareTextareas']);
  assert.deepEqual(
    classify('src/Notes.tsx', "'use client';\n// experience-exempt: a code editor, dictation would corrupt it\n" + textarea),
    [],
  );
});

test('measure skips tests, build output and dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'experience-'));
  try {
    const put = (path, body) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), body);
    };
    put('src/Notes.tsx', textarea);
    put('src/Notes.test.tsx', textarea);
    put('node_modules/x/Notes.tsx', textarea);
    put('.next/Notes.tsx', textarea);
    put('__tests__/Notes.tsx', textarea);
    put('src/components/Footer.tsx', 'export const F = () => null;');
    const { counts, files } = measure(dir);
    assert.equal(counts.bareTextareas, 1);
    assert.equal(counts.localChrome, 1);
    assert.deepEqual(files.bareTextareas, ['src/Notes.tsx']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a ceiling holds the count; no ceiling only reports; a missing kind means zero', () => {
  const counts = { bareTextareas: 3, localChrome: 1, localComposers: 0, localComments: 0, localArticleEditors: 0 };
  assert.deepEqual(overCeiling(counts, {}), []);
  assert.deepEqual(overCeiling(counts, { experience: { ceiling: { bareTextareas: 3, localChrome: 1 } } }), []);
  const over = overCeiling(counts, { experience: { ceiling: { bareTextareas: 2 } } });
  assert.equal(over.length, 2);
  assert.match(over[0], /bareTextareas: 3 above the ceiling of 2/);
  assert.match(over[1], /localChrome: 1 above the ceiling of 0/);
});

test('a chat with attachments or voice switched off needs a reason on that line', () => {
  const chat = "import { ChatApp } from '@bitbaum/chatkit/react';\n";
  assert.deepEqual(classify('src/Chat.tsx', chat + 'export const C = () => <ChatApp composer={{ attach: false }} />;'), ['mutedChats']);
  assert.deepEqual(classify('src/Chat.tsx', chat + 'export const C = () => <ChatApp composer={{ voice: false }} />;'), ['mutedChats']);
  assert.deepEqual(
    classify('src/Chat.tsx', chat + 'export const C = () => <ChatApp composer={{ attach: {} , voice: {} }} />;'),
    [],
  );
  assert.deepEqual(
    classify(
      'src/Chat.tsx',
      chat + '<ChatApp\n  composer={{ attach: false }} // experience-exempt: read-only archive, nothing can be sent\n/>',
    ),
    [],
  );
  assert.deepEqual(classify('src/Other.tsx', 'const o = { attach: false };\n<ChatApp />'), []);
});

test('mutedChats fails only a product whose ceiling names it', () => {
  const counts = { bareTextareas: 0, localChrome: 0, localComposers: 0, localComments: 0, localArticleEditors: 0, mutedChats: 2 };
  assert.deepEqual(overCeiling(counts, { experience: { ceiling: {} } }), []);
  const over = overCeiling(counts, { experience: { ceiling: { mutedChats: 0 } } });
  assert.equal(over.length, 1);
  assert.match(over[0], /mutedChats: 2 above the ceiling of 0/);
});
