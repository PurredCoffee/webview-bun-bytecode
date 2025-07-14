import { dlopen, FFIFunctionCallableSymbol, FFIType, ptr, type FFITypeOrString, type FFITypeToArgsType, type FFITypeToReturnsType, type Library, type Symbols, type ToFFIType } from "bun:ffi";
import { Webview } from "./webview";

export function encodeCString(value: string) {
  return ptr(new TextEncoder().encode(value + "\0"));
}

export class fakePtr {

}

export const instances: Webview[] = [];

/**
 * Unload the library and destroy all webview instances. Should only be run
 * once all windows are closed.
 */
export function unload() {
  for (const instance of instances) instance.destroy();
  lib.close();
}

let lib_file;

if (process.env.WEBVIEW_PATH) {
  lib_file = new Promise((resolve, reject) => resolve({ default: process.env.WEBVIEW_PATH }));
} else if (process.platform === "win32") {
  //@ts-expect-error
  lib_file = import("../build/libwebview.dll");
} else if (process.platform === "linux") {
  lib_file = import(`../build/libwebview-${process.arch}.so`);
} else if (process.platform === "darwin") {
  //@ts-expect-error
  lib_file = import("../build/libwebview.dylib");
}



/**
 * Typescript magic, straight rip from Libary.ts
 */
interface AsyncLibrary<Fns extends Symbols> {
  symbols: ConvertFns<Fns>;
  close(): void;
}
type ConvertFns<Fns extends Symbols> = {
  [K in keyof Fns]: {
    (
      ...args: Fns[K]["args"] extends infer A extends readonly FFITypeOrString[]
        ? { [L in keyof A]: FFITypeToArgsType[ToFFIType<A[L]>] }
        :
          [unknown] extends [Fns[K]["args"]]
          ? []
          : never
    ): [unknown] extends [Fns[K]["returns"]]
      ? undefined
      : Promise<FFITypeToReturnsType[ToFFIType<NonNullable<Fns[K]["returns"]>>]>;
    __ffi_function_callable: typeof FFIFunctionCallableSymbol;
  };
};
/**
 * End rip
 */

type asynccallback<funcO extends {[obj: string]: Promise<any>}> = {
    resolve: (result: unknown) => void, 
    reject: (error: unknown) => void, 
    funcName: keyof funcO,
    object: funcO,
    args: any[]
}

function wrapLib<Type extends Symbols>(lib_file: Promise<any> | undefined, symbols: Type): AsyncLibrary<Type> {
  let callbacks: asynccallback<any>[] = [];

  function wrapFuncAwait(funcName: string, object: any): any {
    return (...args: any[]) => {
      return new Promise((resolve, reject) => {
        callbacks.push({
          resolve,
          reject,
          funcName,
          object,
          args
        });
      })
    };
  }
  function wrapFuncImmediate(funcName: string, object: any): any {
    return (...args: any[]) => new Promise((resolve, reject) => {
      try {
        resolve(object[funcName](...args));
      } catch(e) {
        reject(e);
      }
    })
  }

  let fakelib: any = {symbols: {}}

  fakelib.close = wrapFuncAwait("close", fakelib);
  for (const key in symbols) {
    if (Object.prototype.hasOwnProperty.call(symbols, key)) {
      fakelib.symbols[key] = wrapFuncAwait(key, fakelib.symbols);
    }
  }
  if(lib_file == undefined) {
    console.warn("lib_file is undefined");
    return fakelib;
  }

  lib_file.then((result: any) => {
    const library: any = dlopen(result.default, symbols);
    fakelib.close = wrapFuncImmediate("close", library);
    for (const key in library.symbols) {
      if (Object.prototype.hasOwnProperty.call(library.symbols, key)) {
        fakelib.symbols[key] = wrapFuncImmediate(key, library.symbols);
      }
    }
    callbacks.forEach((obj) => {
      obj.object[obj.funcName](...obj.args).then(obj.resolve).catch(obj.reject);
    })
  })
  return fakelib as AsyncLibrary<Type>;
}

export const lib = wrapLib(lib_file, {
  webview_create: {
    args: [FFIType.i32, FFIType.ptr],
    returns: FFIType.ptr,
  },
  webview_destroy: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  webview_run: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  webview_terminate: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  webview_get_window: {
    args: [FFIType.ptr],
    returns: FFIType.ptr,
  },
  webview_set_title: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  webview_set_size: {
    args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.void,
  },
  webview_navigate: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  webview_set_html: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  webview_init: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  webview_eval: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  webview_bind: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.function, FFIType.ptr],
    returns: FFIType.void,
  },
  webview_unbind: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.void,
  },
  webview_return: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr],
    returns: FFIType.void,
  },
});
