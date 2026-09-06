# Overtone

Сервис приёмов: браузерная запись → HTTP multipart → FFmpeg → S3 → закрытие в PostgreSQL.

## Что реализовано

- Страница приёмов: дата, статус, открытие, новые сверху, cursor-пагинация.
- Один технический пользователь; у него не более одного незакрытого приёма.
- Серверный `requestId`, одна запись на приём. Стоп позволяет продолжить; «Завершить приём» навсегда фиксирует аудио, включая после ошибки/перезагрузки.
- Один multipart-запрос с частями и проверяемым манифестом. Части временно сохраняются на диске, итоговое аудио — в S3.
- Идемпотентное закрытие, повторы с/без файлов, восстановление результата S3 после ошибки PostgreSQL.
- Принудительное закрытие, история событий, отображение и скачивание Markdown-отчёта, безопасный рендеринг HTML.
- Закрытие и намерение обработки фиксируются одной транзакцией PostgreSQL.

Фоновый исполнитель реализован отдельным процессом NestJS/TypeScript с BullMQ. Он вызывает `StartFullPipeline`, опрашивает `GetProcess` по `commandId` раз в 3 секунды и получает проверенный Markdown-отчёт из S3. Через 5 минут от первой отправки приём получает `processing_failed / PROCESSING_TIMEOUT`; GPU-команда этим не отменяется. SLO 30 секунд на реальном GPU пока не измерен. Подробности: [WORKER_DESIGN.md](WORKER_DESIGN.md).

Авторизация и админка отложены. Все браузеры сейчас используют одного технического пользователя, определённого backend.

## Локальный запуск Docker

Нужны Docker Compose; для запуска inference рядом должен лежать `../medical-scribe/`. Для GPU также нужен NVIDIA Container Runtime.

```sh
cp backend/.env.example backend/.env
```

Если `.env` уже существует, добавьте новые переменные из `.env.example`, не затирая текущие credentials. Для Docker:

```dotenv
DATABASE_URL=postgresql://overtone:overtone_local@postgres:5432/overtone
POSTGRES_USER=overtone
POSTGRES_PASSWORD=overtone_local
POSTGRES_DB=overtone
S3_ENDPOINT=http://minio:9000
```

При изменении пользователя/пароля PostgreSQL обновите и `DATABASE_URL`. Пароль внутри URL должен быть URL-encoded.

Из корня Overtone:

```sh
docker compose --env-file backend/.env \
  -f docker-compose.yml \
  -f docker-compose.postgres.yaml \
  -f docker-compose.s3.yaml \
  up -d --build
```

- Frontend: http://localhost:8080
- API/health: http://localhost:3000/api/health
- MinIO: http://localhost:9001
- PostgreSQL: localhost:5432

Backend выполняет версионированные SQL-миграции при запуске под блокировкой PostgreSQL. Если PostgreSQL ещё стартует, restart policy перезапустит API. При недоступном S3 API остаётся доступным для истории/принудительного закрытия; сохранение вернёт явную ошибку.

MongoDB и Redis для этого блока не нужны. Старые Compose-файлы и их volumes сохранены; новая БД получает отдельный `postgres_data` volume.

## Запуск backend на хосте

Нужны Node.js 22+ и FFmpeg. PostgreSQL и MinIO должны быть запущены. В `backend/.env` используйте `localhost` для обоих endpoints:

```dotenv
DATABASE_URL=postgresql://overtone:overtone_local@localhost:5432/overtone
S3_ENDPOINT=http://localhost:9000
```

```sh
cd backend
npm ci
npm run start:dev
```

Backend также раздаёт frontend из соседней папки, поэтому достаточно http://localhost:3000.

### Запуск worker

Нужны Redis, PostgreSQL, S3 и пересобранный medical-scribe с `GetProcess(commandId)` / `StartProcessResponse.command_id`. Уже запущенный старый образ нужно пересобрать: исходники сами в контейнер не попадают.

Для API и worker на хосте в `backend/.env`:

```dotenv
DATABASE_URL=postgresql://overtone:overtone_local@localhost:5432/overtone
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=<пароль Redis>
REDIS_HOST_PORT=6379
S3_ENDPOINT=http://localhost:9000
INFERENCE_GRPC_ADDRESS=localhost:50051
INFERENCE_LLM_BACKEND=LOCAL
```

Параметры LLM фиксируются при создании команды. `LOCAL` не обращается к платному провайдеру; для настроенного OpenRouter используется `OPENROUTER`.

В отдельном терминале из корня:

```sh
cd backend
npm ci
npm run build
npm run start:worker
```

В Docker из корня (инфраструктура уже запущена):

```sh
docker compose --env-file backend/.env -f docker-compose.redis.yaml up -d
docker compose --env-file backend/.env -f docker-compose.inference.mock.yaml up -d --build
docker compose --env-file backend/.env -f docker-compose.worker.yaml up -d --build
```

`MEDSCRIBE_DATABASE_URL` нужен для inference, `WORKER_DATABASE_URL` — для worker внутри Docker (host `postgres` либо адрес облачной БД). API также должен иметь доступ к Redis. Для Docker API задайте `REDIS_URL=redis://redis:6379`, `INFERENCE_GRPC_ADDRESS=inference:50051`, внутренние адреса PostgreSQL/S3. Локальные и Docker env пока разделяются вручную.

Текущий `mock` medical-scribe имитирует Speech Core/roles, но его FullPipeline требует загруженных моделей: без них он завершится `MODEL_LOAD_FAILED`. Для сквозных тестов используется отдельный fixture из `backend/test/fixtures/`, который не включён в приложение. На GPU выбирайте `docker-compose.inference.gpu.yaml`.

## HTTP-контракт

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/requests` | Создать приём; `201` или `409 ACTIVE_REQUEST_EXISTS` с существующим ID |
| GET | `/api/requests?limit=20&cursor=...` | История всех приёмов |
| GET | `/api/requests/{id}` | Состояние и `audioStored: true/false/null` |
| POST | `/api/requests/{id}/complete` | Multipart с аудио либо JSON `{}` для повтора без файлов |
| POST | `/api/requests/{id}/abandon` | JSON `{}` или `{ "reason": "..." }` |
| POST | `/api/requests/{id}/retry-processing` | JSON `{ "commandId": "ID предыдущей попытки" }`; проверяет прежнюю команду перед новым запуском |
| GET | `/api/requests/{id}/report` | Готовый Markdown-документ в JSON-обёртке |

Multipart содержит файлы `part_1`, `part_2`, … и строковое JSON-поле `manifest`:

```json
{"parts":[{"partNo":1,"field":"part_1","mimeType":"audio/webm;codecs=opus","bytes":12345,"sha256":"64 lowercase hex characters"}]}
```

Порядок массива — порядок склейки; номера начинаются с 1 без пропусков. Backend проверяет фактические размер и SHA-256 каждого файла. Другой вход под тем же `requestId` получает `409 AUDIO_CONTENT_CONFLICT`.

`/complete`: `200` означает S3 + закрытие в PostgreSQL, `202` означает, что другая операция над приёмом ещё идёт. После `202` клиент продолжает ожидать и сверяет состояние, не считает приём закрытым.

Форма ошибки:

```json
{"requestId":"...","error":{"code":"REQUEST_FINALIZATION_FAILED","message":"...","retryAction":"complete_without_audio"}}
```

- `AUDIO_UPLOAD_REQUIRED` → `upload_audio`: повтор с файлами.
- `REQUEST_FINALIZATION_FAILED` → `complete_without_audio`: S3 подтверждён, повтор без файлов.
- `REQUEST_STATE_UNKNOWN` → `check_status`: исход неизвестен; GET состояния, при недоступности повтор проверки.
- `AUDIO_SAVE_FAILED` → `complete_without_audio`: сервер сохранил staging, можно повторить без файлов; если staging недоступен, следующий ответ потребует upload.
- `AUDIO_CONTENT_CONFLICT`, `AUDIO_INTEGRITY_FAILED`, `AUDIO_DECODE_FAILED` → без автоматического retry.

Потерянный HTTP-ответ тоже требует проверки состояния. `audioStored: null` означает невозможность достоверной проверки S3. Это не доказательство отсутствия аудио.

## Хранение и гарантии этого блока

Аудио S3: `requests/{requestId}/input/audio.m4a`. Запись выполняется условным PUT `If-None-Match: *`; существующий объект не перезаписывается. Метаданные содержат ID, fingerprint исходного манифеста и SHA-256 итогового аудио; S3 проверяет checksum при загрузке. Для восстановления backend сверяет объект с зафиксированным входом.

В PostgreSQL: `requests`, `request_events`, `processing_intents`, `schema_migrations`. Уникальный partial index запрещает второй открытый приём. Session advisory lock сериализует закрытие/abandon без длинной транзакции во время FFmpeg/S3. При потере соединения блокировка освобождается; запись S3 остаётся неизменяемой, транзакция закрытия не может выполниться на потерянном соединении.

`DATABASE_URL` должен вести напрямую в PostgreSQL либо через пулер в режиме session pooling: transaction pooling несовместим с используемыми session advisory locks.

После успешного закрытия временные серверные файлы удаляются. Неудачный staging сохраняется для повторов; автоматическая уборка таких серверных файлов пока не реализована. Это требует контроля диска до следующего блока.

Браузер хранит аудио в IndexedDB. Подтверждение S3 позволяет удалить аудиочанки, сохранив метаданные/ссылку на отчёт. После force-close без S3 — 3 часа хранения; очистка при открытии и раз в минуту. Активные записи по этому TTL не удаляются. Старые IndexedDB-записи сохраняются и доступны для скачивания в разделе предыдущей версии.

## Технические ограничения

Длительность приёма не ограничена продуктовым правилом. Начальные технические настройки:

- `MAX_UPLOAD_BYTES=1073741824` — 1 GiB суммарного аудио;
- `MAX_AUDIO_PARTS=1000`;
- `FFMPEG_TIMEOUT_MS=1800000` — 30 минут на сборку;
- `HTTP_UPLOAD_TIMEOUT_MS=2100000` — 35 минут на HTTP upload;
- Nginx: 1025 MiB с запасом на multipart, ожидание upstream 35 минут.

При изменении размера/таймаута синхронизируйте backend, Nginx и timeout multipart в `frontend/request-api.js`. Это технические пределы, а не 30-секундный SLO отчёта. Проверены Chromium и WebM/Opus; Safari/мобильные браузеры и часовые записи ещё требуют проверки. Используются IndexedDB, Web Locks и Web Crypto; доступ к микрофону требует HTTPS, кроме localhost.

## Проверки

```sh
cd backend
npm run build
npm test -- --runInBand
npm run test:frontend
```

Интеграционные тесты используют **отдельную тестовую БД**: они очищают таблицы приёмов.

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/overtone_test npm run test:integration
TEST_FFMPEG=ffmpeg TEST_FFPROBE=ffprobe npm test -- --runInBand
npx playwright install chromium
npm run test:browser
```

Без `TEST_DATABASE_URL` SQL-интеграционные тесты пропускаются. Они проверяют реальную PostgreSQL с тестовым S3-адаптером; браузерные проверки используют настоящий MediaRecorder и тестовые HTTP-ответы. Отдельный тест проверяет настоящий FFmpeg. Полный Docker/MinIO/GPU smoke нужен перед развёртыванием.

Frontend-библиотеки Markdown/очистки HTML закреплены в backend lockfile и поставляются локально с лицензиями. После обновления зависимостей: `npm run vendor:frontend`.

## Inference и правила эксплуатации

`docker-compose.inference.mock.yaml` и `docker-compose.inference.gpu.yaml` собирают сервис из `../medical-scribe`. Для обработки приёмов также запустите worker Overtone.

- Mock и GPU используют один сервис/порт `50051`; одновременно выбирайте один режим.
- Не запускайте второй MinIO из medical-scribe.
- Внутри Docker используйте `minio`/`postgres`, а не `localhost`.
- Не удаляйте volumes командой `down -v` без явного решения владельца данных.
- Не переиспользуйте рабочую БД для интеграционных тестов.
