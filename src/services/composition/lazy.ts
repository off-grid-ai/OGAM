/**
 * A stand-in that resolves its target on first use. Lets a module export a workspace-owned instance
 * as a plain value while the workspace itself may still be initializing (module cycles under eager
 * loaders such as jest). Every property read and method call goes to the real instance.
 */
export function lazyInstance<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const instance = resolve();
      const value = Reflect.get(instance, property) as unknown;
      if (typeof value !== 'function') return value;
      // A spy installed by a test must come back as itself, or its mock API is lost behind a bind.
      if ('mock' in (value as object)) return value;
      return (value as (...a: unknown[]) => unknown).bind(instance);
    },
    has(_target, property) {
      return property in resolve();
    },
    // Tests spy on methods; forward property writes and definitions to the real instance.
    set(_target, property, value) {
      return Reflect.set(resolve(), property, value);
    },
    defineProperty(_target, property, descriptor) {
      return Reflect.defineProperty(resolve(), property, descriptor);
    },
    // A restored spy is deleted from the object it was installed on; that must be the real instance,
    // or the dead spy shadows the prototype method forever.
    deleteProperty(_target, property) {
      return Reflect.deleteProperty(resolve(), property);
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
  });
}
