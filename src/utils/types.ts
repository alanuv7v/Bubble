export type DeepPartial<T> = T extends Function | boolean | number | string | symbol | null | undefined | bigint
  ? T
  : T extends Array<infer U>
  ? _DeepPartialArray<U>
  : T extends ReadonlyArray<infer U>
  ? _DeepPartialReadonlyArray<U>
  : T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

type _DeepPartialArray<T> = Array<DeepPartial<T>>;
type _DeepPartialReadonlyArray<T> = ReadonlyArray<DeepPartial<T>>;

export type DeepValue<T> = T extends object
  ? T extends (...args: any[]) => any
    ? T
    : DeepValue<T[keyof T]>
  : T;
  
export type ChangeNodes<T, U> = {
  [K in keyof T]-?: NonNullable<T[K]> extends any[]
    ? U[]
    : NonNullable<T[K]> extends object
      ? NonNullable<T[K]> extends (...args: any[]) => any
        ? U
        : ChangeNodes<NonNullable<T[K]>, U>
      : U;
};

export type ReplaceNodes<T, U, Prop extends PropertyKey> = 
  T extends object
    ? T extends (...args: any[]) => any
      ? T
      : Prop extends keyof Required<T>
        ? U
        : { [K in keyof T]: ReplaceNodes<T[K], U, Prop> }
    : T;

export type DeepObject<Key extends number|symbol|string, Leaf> = {
  [K in Key]: Leaf | DeepObject<Key, Leaf>
}

export type NonMetaKey<T extends string> = T extends `_${string}` ? never : T;