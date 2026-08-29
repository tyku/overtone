import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RecordingsModule } from './recordings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    RecordingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
