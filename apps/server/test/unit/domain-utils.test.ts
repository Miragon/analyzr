import { describe, expect, it } from 'vitest';

import {
  generateAgentTokenSecret,
  hashAgentTokenSecret,
  isWellFormedAgentToken,
} from '../../src/domain/agent-token-secret.ts';
import { decodeCursor, encodeCursor, toPage } from '../../src/domain/cursor.ts';
import { DomainError } from '../../src/domain/errors.ts';
import { resultWarnings } from '../../src/domain/use-cases/models.ts';
import { createSessionCodec } from '../../src/auth/session.ts';

describe('agent token secrets', () => {
  it('have the analyzr_at_ shape with a checksum, 8-char prefix and sha256', () => {
    const t = generateAgentTokenSecret();
    expect(t.secret).toMatch(/^analyzr_at_[0-9A-Za-z]{43}[0-9A-Za-z]{6}$/);
    expect(t.prefix).toBe(t.secret.slice(11, 19));
    expect(t.hash).toBe(hashAgentTokenSecret(t.secret));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(isWellFormedAgentToken(t.secret)).toBe(true);
  });

  it('are unique and reject typos via the checksum', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateAgentTokenSecret().secret));
    expect(secrets.size).toBe(50);
    const t = generateAgentTokenSecret().secret;
    const typo = `${t.slice(0, 20)}${t[20] === 'a' ? 'b' : 'a'}${t.slice(21)}`;
    expect(isWellFormedAgentToken(typo)).toBe(false);
    expect(isWellFormedAgentToken('analyzr_at_')).toBe(false);
    expect(isWellFormedAgentToken(`x${t}`)).toBe(false);
  });
});

// modelKeyFromPath moved to @analyzr/contracts (M6 S1): packages/contracts/test/paths.test.ts.

describe('resultWarnings (M6 S1: extractor warnings in import and PUT results)', () => {
  it('is empty without warnings, so the result keeps its shape', () => {
    expect(resultWarnings([])).toEqual({});
  });

  it('keeps the first 20 in order, cuts messages to 300 characters with … and counts all', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      code: 'parse-warning',
      message: `warning ${i}`,
      ...(i % 2 === 0 ? { elementId: `Task_${i}` } : {}),
    }));
    many[0] = { code: 'parse-warning', message: 'x'.repeat(490), elementId: 'Task_0' };
    const r = resultWarnings(many);
    expect(r.warningCount).toBe(25);
    expect(r.warnings).toHaveLength(20);
    expect(r.warnings?.[0]?.message).toHaveLength(300);
    expect(r.warnings?.[0]?.message).toBe(`${'x'.repeat(299)}…`);
    expect(r.warnings?.[1]).toEqual({ code: 'parse-warning', message: 'warning 1' });
    expect(r.warnings?.[2]).toEqual({
      code: 'parse-warning',
      message: 'warning 2',
      elementId: 'Task_2',
    });
    expect(r.warnings?.at(-1)?.message).toBe('warning 19');
  });

  it("keeps the extractor's too-many-warnings entry as the last one listed", () => {
    // The extractor stops at 100 warnings and appends one `too-many-warnings` (101 in all).
    const capped = [
      ...Array.from({ length: 100 }, (_, i) => ({ code: 'parse-warning', message: `w${i}` })),
      { code: 'too-many-warnings', message: '150 more warnings omitted' },
    ];
    const r = resultWarnings(capped);
    expect(r.warningCount).toBe(101);
    expect(r.warnings).toHaveLength(20);
    expect(r.warnings?.slice(0, 19).map((w) => w.message)).toEqual(
      Array.from({ length: 19 }, (_, i) => `w${i}`),
    );
    expect(r.warnings?.at(-1)).toEqual({
      code: 'too-many-warnings',
      message: '150 more warnings omitted',
    });
    // Only as the extractor's last entry; 20 or fewer are listed as they come.
    const few = resultWarnings([{ code: 'too-many-warnings', message: 'x' }]);
    expect(few.warnings).toEqual([{ code: 'too-many-warnings', message: 'x' }]);
  });

  it('never splits a surrogate pair and leaves a 300-character message whole', () => {
    const exact = resultWarnings([{ code: 'c', message: 'y'.repeat(300) }]);
    expect(exact.warnings?.[0]?.message).toBe('y'.repeat(300));
    const emoji = resultWarnings([{ code: 'c', message: `${'y'.repeat(298)}😀😀` }]);
    expect(emoji.warnings?.[0]?.message).toBe(`${'y'.repeat(298)}…`);
  });
});

describe('cursors', () => {
  it('round-trip and page', () => {
    const c = encodeCursor(['call', 'a#b', 'c#d']);
    expect(decodeCursor(c, ['string', 'string', 'string'])).toEqual(['call', 'a#b', 'c#d']);
    expect(toPage([1, 2, 3], 2, (n) => [n])).toEqual({
      items: [1, 2],
      nextCursor: encodeCursor([2]),
    });
    expect(toPage([1, 2], 2, (n) => [n]).nextCursor).toBeNull();
  });

  it.each(['nope', encodeCursor([1]), encodeCursor(['a', 'b'])])('rejects %s', (cursor) => {
    expect(() => decodeCursor(cursor, ['string'])).toThrow(DomainError);
  });

  it('takes an int only as a whole number within the integer column', () => {
    expect(decodeCursor(encodeCursor(['s', 0, 'p']), ['string', 'int', 'string'])).toEqual([
      's',
      0,
      'p',
    ]);
    expect(decodeCursor(encodeCursor([2_147_483_647]), ['int'])).toEqual([2_147_483_647]);
    for (const bad of [2_147_483_648, -1, 1.5, 1e300, '3']) {
      expect(() => decodeCursor(encodeCursor([bad]), ['int']), String(bad)).toThrow(DomainError);
    }
    // A plain number stays any number (e.g. a bigint seq).
    expect(decodeCursor(encodeCursor([2 ** 40]), ['number'])).toEqual([2 ** 40]);
  });
});

describe('session cookies', () => {
  const codec = createSessionCodec('k'.repeat(32), 3600);
  const now = new Date('2026-10-06T12:00:00Z');

  it('verifies what it issued, within its lifetime', () => {
    const value = codec.issue('analyzr-cli', now);
    expect(codec.verify(value, now)).toEqual({
      client: 'analyzr-cli',
      issuedAt: now.getTime() / 1000,
    });
    expect(codec.verify(value, new Date(now.getTime() + 3599_000))).not.toBeNull();
    expect(codec.verify(value, new Date(now.getTime() + 3600_000))).toBeNull();
  });

  it('rejects tampering, other keys and garbage', () => {
    const value = codec.issue('analyzr-web', now);
    expect(codec.verify(value.replace('analyzr-web', 'analyzr-cli'), now)).toBeNull();
    expect(createSessionCodec('x'.repeat(32)).verify(value, now)).toBeNull();
    expect(codec.verify('v1.analyzr-web.1.x.y', now)).toBeNull();
    expect(codec.verify('', now)).toBeNull();
  });
});
