import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../auth/permissions.guard';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminService } from './admin.service';

@Controller('api/admin')
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermissions('admin:access')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('clinics')
  @RequirePermissions('admin:clinics:manage')
  listClinics() {
    return this.admin.listClinics();
  }

  @Post('clinics')
  @RequirePermissions('admin:clinics:manage')
  createClinic(@Body() body: unknown) {
    return this.admin.createClinic(body);
  }

  @Get('users')
  @RequirePermissions('admin:users:manage')
  listUsers() {
    return this.admin.listUsers();
  }

  @Post('users')
  @RequirePermissions('admin:users:manage')
  createUser(@Body() body: unknown) {
    return this.admin.createUser(body);
  }

  @Patch('users/:id')
  @RequirePermissions('admin:users:manage')
  updateUser(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.admin.updateUser(actor.id, id, body);
  }

  @Post('users/:id/regenerate-password')
  @RequirePermissions('admin:users:manage')
  regeneratePassword(@Param('id') id: string) {
    return this.admin.regeneratePassword(id);
  }
}
