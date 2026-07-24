declare module 'neo-blessed' {
  export namespace Widgets {
    interface ScreenOptions {
      input?: NodeJS.ReadableStream;
      output?: NodeJS.WritableStream;
      smartCSR?: boolean;
      title?: string;
      fullUnicode?: boolean;
      sendFocus?: boolean;
    }

    interface ListElementOptions {
      top?: string | number;
      left?: string | number;
      width?: string | number;
      height?: string | number;
      label?: string;
      border?: { type?: string };
      style?: Record<string, unknown>;
      items?: string[];
      keys?: boolean;
      vi?: boolean;
    }

    interface TextareaOptions {
      top?: string | number;
      left?: string | number;
      bottom?: string | number;
      right?: string | number;
      width?: string | number;
      height?: string | number;
      inputOnFocus?: boolean;
      mouse?: boolean;
      keys?: boolean;
      style?: Record<string, unknown>;
    }

    interface BoxOptions {
      top?: string | number;
      left?: string | number;
      bottom?: string | number;
      right?: string | number;
      width?: string | number;
      height?: string | number;
      content?: string;
      label?: string;
      border?: { type?: string };
      style?: Record<string, unknown>;
      tags?: boolean;
      scrollable?: boolean;
      alwaysScroll?: boolean;
      scrollbar?: Record<string, unknown>;
      hidden?: boolean;
    }

    interface Screen {
      append(child: Element): void;
      render(): void;
      destroy(): void;
      key(keys: string | string[], listener: (ch: unknown, key: { full: string }) => void): void;
    }

    interface Element {
      setContent(content: string): void;
      setValue(value: string): void;
      setItems(items: string[]): void;
      setScrollPerc(percent: number): void;
      getValue(): string;
      clearValue(): void;
      on(event: string, listener: (...args: unknown[]) => void): void;
      emit(event: string, ...args: unknown[]): boolean;
      key(keys: string | string[], listener: (ch: unknown, key: { full: string }) => void): void;
      focus(): void;
      append(child: Element): void;
    }

    interface BoxElement extends Element {}
    interface ListElement extends Element {}
    interface TextareaElement extends Element {}
  }

  export function screen(options?: Widgets.ScreenOptions): Widgets.Screen;
  export function box(options?: Widgets.BoxOptions): Widgets.BoxElement;
  export function list(options?: Widgets.ListElementOptions): Widgets.ListElement;
  export function textarea(options?: Widgets.TextareaOptions): Widgets.TextareaElement;
}
