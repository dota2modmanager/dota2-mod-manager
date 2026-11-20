/* What bridge.js leaves on window for api.js and uninstall-api.js, for the root tsconfig.json that
 * checks those two through their JSDoc. The window's own TypeScript sees window.api typed in
 * renderer/api/, not this. */
export {};

declare global {
  interface MmBridge {
    /** Call a channel; the answer is what Rust returns, with bytes as Uint8Array. */
    invoke(channel: string, ...args: unknown[]): Promise<any>;
    /** Call a channel without waiting for an answer. */
    send(channel: string, ...args: unknown[]): void;
    /** Hear what the shell sends on a channel. */
    on(channel: string, cb: (...args: any[]) => void): void;
    /** The full path of a file dropped on the window, or '' when it was not dropped. */
    pathOf(file: File): string;
  }

  interface Window {
    __mm: MmBridge;
    api: Record<string, unknown>;
  }
}
