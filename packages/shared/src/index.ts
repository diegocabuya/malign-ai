export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${String(value)}`);
};

export * from './canonical-json.js';
