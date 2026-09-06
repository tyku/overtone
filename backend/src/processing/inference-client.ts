import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  credentials,
  loadPackageDefinition,
  Metadata,
  ServiceError,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';
import type { CommandRow, ProcessSnapshot } from './processing.types';

type Rpc = (
  input: object,
  metadata: Metadata,
  options: { deadline: Date },
  callback: (error: ServiceError | null, value: unknown) => void,
) => void;
@Injectable()
export class InferenceClient implements OnModuleDestroy {
  private readonly client: Client & { startFullPipeline: Rpc; getProcess: Rpc };
  constructor(config: ConfigService) {
    const definition = loadSync(join(__dirname, 'inference.proto'), {
      enums: String,
      defaults: true,
    });
    const pkg = loadPackageDefinition(definition) as unknown as {
      medscribe: {
        inference: {
          v1: {
            InferenceService: new (
              address: string,
              channelCredentials: ReturnType<typeof credentials.createInsecure>,
            ) => InferenceClient['client'];
          };
        };
      };
    };
    this.client = new pkg.medscribe.inference.v1.InferenceService(
      config.get<string>('INFERENCE_GRPC_ADDRESS', 'localhost:50051'),
      config.get('INFERENCE_GRPC_TLS') === 'true'
        ? credentials.createSsl()
        : credentials.createInsecure(),
    );
  }
  private call<T>(
    method: 'startFullPipeline' | 'getProcess',
    input: object,
    deadline: Date,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.client[method](
        input,
        new Metadata(),
        { deadline },
        (error, value) => (error ? reject(error) : resolve(value as T)),
      );
    });
  }
  async start(command: CommandRow, deadline: Date) {
    const response = await this.call<{ commandId: string }>(
      'startFullPipeline',
      {
        command: {
          commandId: command.command_id,
          requestId: command.request_id,
        },
        sourceAudioKey: command.source_audio_key,
        ...command.parameters,
      },
      deadline,
    );
    if (response.commandId !== command.command_id)
      throw new Error(
        'Inference start returned a different commandId; update medical-scribe',
      );
  }
  get(commandId: string, deadline: Date) {
    return this.call<ProcessSnapshot>('getProcess', { commandId }, deadline);
  }
  onModuleDestroy() {
    this.client.close();
  }
}
