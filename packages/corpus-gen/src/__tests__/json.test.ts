/**
 * Model replies are not clean JSON. These are the shapes actually observed
 * coming back from Qwen on INFINITY and from Gemini via Vertex.
 */
import { describe, expect, it } from 'vitest';
import { extractJsonArray, extractJsonArrays, parseItems } from '../json.js';

const ITEMS = '[{"text": "WHY IS THERE A SECOND FRIDGE", "hint": "an extra cold appliance"}]';

describe('extractJsonArray', () => {
  it('handles a bare array', () => {
    expect(extractJsonArray(ITEMS)).toBe(ITEMS);
  });
  it('strips a ```json fence', () => {
    expect(extractJsonArray('```json\n' + ITEMS + '\n```')).toBe(ITEMS);
  });
  it('strips a bare ``` fence', () => {
    expect(extractJsonArray('```\n' + ITEMS + '\n```')).toBe(ITEMS);
  });
  it('skips prose before and after', () => {
    expect(extractJsonArray(`Here you go!\n\n${ITEMS}\n\nHope that helps.`)).toBe(ITEMS);
  });
  it('strips a leaked <think> block', () => {
    expect(extractJsonArray(`<think>let me consider [this]</think>\n${ITEMS}`)).toBe(ITEMS);
  });
  it('returns null when there is no array at all', () => {
    expect(extractJsonArray('I cannot help with that request.')).toBeNull();
  });
});

describe('parseItems', () => {
  it('reads text and hint', () => {
    expect(parseItems(ITEMS)).toEqual([{ text: 'WHY IS THERE A SECOND FRIDGE', hint: 'an extra cold appliance' }]);
  });
  it('recovers the real array when reasoning prose contains a decoy bracket', () => {
    const reply = `Looking at this, I need lines like [milk, eggs] but funnier.\n\n${ITEMS}`;
    expect(parseItems(reply)).toEqual([{ text: 'WHY IS THERE A SECOND FRIDGE', hint: 'an extra cold appliance' }]);
  });
  it('prefers the longer array when several parse', () => {
    const decoy = '["one", "two"]';
    const real =
      '[{"text":"A","hint":"a"},{"text":"B","hint":"b"},{"text":"C","hint":"c"}]';
    expect(parseItems(`${decoy}\nthen\n${real}`)).toHaveLength(3);
  });
  it('salvages a reply truncated mid-array', () => {
    const truncated = '[{"text":"ONE","hint":"first"},{"text":"TWO","hint":"second"},{"text":"THR';
    expect(parseItems(truncated)).toEqual([
      { text: 'ONE', hint: 'first' },
      { text: 'TWO', hint: 'second' },
    ]);
  });
  it('tolerates a trailing comma', () => {
    expect(parseItems('[{"text":"ONE","hint":"first"},]')).toEqual([{ text: 'ONE', hint: 'first' }]);
  });
  it('accepts "phrase" as an alias for "text"', () => {
    expect(parseItems('[{"phrase":"ONE","hint":"first"}]')).toEqual([{ text: 'ONE', hint: 'first' }]);
  });
  it('gives a bare string an empty hint, which the validator then rejects', () => {
    expect(parseItems('["JUST A PHRASE"]')).toEqual([{ text: 'JUST A PHRASE', hint: '' }]);
  });
  it('drops entries with no usable text', () => {
    expect(parseItems('[{"hint":"orphan"},{"text":"  "},{"text":"OK","hint":"fine"}]')).toEqual([
      { text: 'OK', hint: 'fine' },
    ]);
  });
  it('returns null on a reply with no JSON', () => {
    expect(parseItems('Sorry, I cannot do that.')).toBeNull();
  });
  it('finds every balanced candidate', () => {
    expect(extractJsonArrays('[1] and [2,3]').length).toBeGreaterThanOrEqual(2);
  });
});
