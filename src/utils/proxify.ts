export default function proxify<T extends object>(
  obj: T,
  getter: null | ((key: string | symbol, value: any) => void),
  setter: null | ((key: string | symbol, old_val: any, value: any) => void)
): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const original_value = Reflect.get(target, prop, receiver);
      let result: any = original_value
      if (getter) {
        result = getter(prop, original_value)
      }
      return result;
    },
    set(target: Record<string, any>, prop: string, value) {
      // Check if the property is writable before setting it
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      if (descriptor && !descriptor.writable) {
        console.warn(`Property ${String(prop)} is not writable.`);
        return false; // Prevent setting non-writable properties
      }
      const old_val = target[prop];
      const result = Reflect.set(target, prop, value);
      if (result && setter) {
        setter(prop, old_val, value);
      }
      return result;
    },
  });
}
