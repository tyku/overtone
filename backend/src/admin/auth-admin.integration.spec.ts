import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request, { type Agent } from 'supertest';
import type { Server } from 'node:http';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SessionGuard } from '../auth/session.guard';
import { DatabaseService } from '../database/database.service';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('authentication and administration HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let adminService: AdminService;
  let adminAgent: Agent;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController, AdminController],
      providers: [
        DatabaseService,
        PasswordService,
        AuthService,
        SessionGuard,
        PermissionsGuard,
        AdminService,
        Reflector,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            DATABASE_URL: process.env.TEST_DATABASE_URL,
            NODE_ENV: 'development',
          }),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    database = app.get(DatabaseService);
    adminService = app.get(AdminService);
  });

  beforeEach(async () => {
    await database.pool.query(
      `TRUNCATE request_events,processing_intents,processing_commands,requests,
       user_sessions,user_permissions,auth_login_buckets,users,clinics CASCADE`,
    );
    const bootstrap = await adminService.bootstrapAdmin(
      'admin@example.com',
      'Admin clinic',
    );
    adminAgent = request.agent(server);
    const login = await adminAgent
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: bootstrap.password })
      .expect(201);
    expect(login.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(login.headers['set-cookie']?.[0]).toContain('SameSite=Strict');
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a clinic and returns a new user password only once', async () => {
    const clinic = await adminAgent
      .post('/api/admin/clinics')
      .send({ name: 'New clinic' })
      .expect(201);
    const created = await adminAgent
      .post('/api/admin/users')
      .send({
        email: 'doctor@example.com',
        clinicId: clinic.body.id,
        permissions: ['requests:use'],
      })
      .expect(201);

    expect(created.body.password).toHaveLength(20);
    expect(created.body.user.passwordCreatedAt).toBeTruthy();
    const list = await adminAgent.get('/api/admin/users').expect(200);
    const doctor = list.body.items.find(
      (item: { email: string }) => item.email === 'doctor@example.com',
    );
    expect(doctor.passwordCreatedAt).toBeTruthy();
    expect(doctor).not.toHaveProperty('password');
    expect(doctor).not.toHaveProperty('passwordHash');
  });

  it('invalidates an active session when the administrator blocks a user', async () => {
    const clinic = await adminAgent
      .post('/api/admin/clinics')
      .send({ name: 'New clinic' })
      .expect(201);
    const created = await adminAgent
      .post('/api/admin/users')
      .send({
        email: 'doctor@example.com',
        clinicId: clinic.body.id,
        permissions: ['requests:use'],
      })
      .expect(201);
    const doctorAgent = request.agent(server);
    await doctorAgent
      .post('/api/auth/login')
      .send({ email: 'doctor@example.com', password: created.body.password })
      .expect(201);
    await doctorAgent.get('/api/auth/session').expect(200);

    await adminAgent
      .patch(`/api/admin/users/${created.body.user.id}`)
      .send({ blocked: true })
      .expect(200);
    await doctorAgent.get('/api/auth/session').expect(401);
  });
});
