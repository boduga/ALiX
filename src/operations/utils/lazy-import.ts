export type Loader<T> = () => T | Promise<T>;
export type Lazy<T> = Loader<T> & { isLoaded: () => boolean };

export function lazy<T>(loader: Loader<T>): Lazy<T> {
  let cache: T | undefined;
  let loaded = false;
  let pending: Promise<T> | undefined;

  const fn = ((..._args: any[]): any => {
    if (loaded) return cache;
    const result = loader();
    if (result instanceof Promise) {
      if (!pending) {
        pending = result.then((r) => {
          cache = r;
          loaded = true;
          return r;
        });
      }
      return pending;
    } else {
      cache = result;
      loaded = true;
      return result;
    }
  }) as Lazy<T>;

  fn.isLoaded = () => loaded;
  return fn;
}