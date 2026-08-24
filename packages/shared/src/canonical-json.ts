import { createHash } from 'node:crypto';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const assertUnicodeScalarString = (value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('JCS input contains an unpaired high surrogate');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError('JCS input contains an unpaired low surrogate');
    }
  }
};

const canonicalize = (value: unknown, ancestors: Set<object>): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS only accepts finite JSON numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError(`JCS cannot serialize ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError('JCS cannot serialize cyclic values');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('JCS cannot serialize sparse arrays');
        items.push(canonicalize(value[index], ancestors));
      }
      return `[${items.join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const members = keys.map((key) => {
      assertUnicodeScalarString(key);
      return `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`;
    });
    return `{${members.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

/** RFC 8785 JSON Canonicalization Scheme for already-modelled I-JSON values. */
export const canonicalizeJson = (value: unknown): string => canonicalize(value, new Set());

export const sha256CanonicalJson = (value: unknown): string =>
  createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
