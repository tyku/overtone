import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionGuard } from './session.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionGuard, PermissionsGuard],
  exports: [AuthService, PasswordService, SessionGuard, PermissionsGuard],
})
export class AuthModule {}
