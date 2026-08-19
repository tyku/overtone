declare module 'ws' {
  import { EventEmitter } from 'node:events';
  import { IncomingMessage, Server } from 'node:http';

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;

    close(code?: number, reason?: string): void;
    send(data: string): void;
    on(
      event: 'message',
      listener: (payload: Buffer, isBinary: boolean) => void,
    ): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { server: Server; path: string });

    close(): void;
    on(
      event: 'connection',
      listener: (socket: WebSocket, request: IncomingMessage) => void,
    ): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }
}
