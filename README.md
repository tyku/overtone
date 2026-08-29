# Overtone

Runbook для разработчика или AI-агента, которому нужно локально поднять весь контур записи и обработки аудио.

## Что входит в контур

```text
Browser frontend
    ↓ HTTP
Overtone NestJS API
    ↓ FFmpeg: WebM/Opus → M4A/AAC
MinIO (S3 bucket medical-scribe)
    ↓ sourceAudioKey
medical-scribe inference: mock или GPU
```

- `frontend/` — статическое браузерное приложение записи аудио.
- `backend/` — NestJS API, локальная финализация записи и загрузка M4A в S3.
- `../medical-scribe/` — соседний репозиторий inference-сервиса.
- `CLIENT_CONTRACT.md` — контракт браузерной записи, восстановления и HTTP-загрузки.

Итоговая запись сохраняется в S3:

```text
requests/<session-id>/input/<recording-id>.m4a
```

## Обязательная структура каталогов

Репозитории должны лежать рядом:

```text
dev/
├── overtone/
└── medical-scribe/
```

Compose-файлы Overtone используют build context `../medical-scribe` для inference.

## Требования

- Docker с `docker compose`.
- Для GPU-режима: NVIDIA GPU, рабочий NVIDIA Container Runtime и CUDA-драйвер хоста.
- Для запуска backend без Docker: Node.js 22 и FFmpeg.

Все Docker-команды ниже выполняются из корня `overtone/`.

## Настройка окружения

Создайте конфигурации, если их ещё нет:

```bash
cp backend/.env.example backend/.env
cp ../medical-scribe/.env.example ../medical-scribe/.env
```

Для Docker в `backend/.env` должно быть:

```dotenv
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=medical-scribe
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
```

Внутри контейнеров нельзя использовать `localhost` для MinIO: `localhost` указывает на сам контейнер. Используется DNS-имя `minio` в общей сети `overtone-network`.

`../medical-scribe/.env` содержит настройки моделей, LLM и рабочего каталога inference. S3-настройки в корневых inference Compose-файлах переопределяются значениями из `backend/.env`.

## Быстрый запуск: полный mock-стек

Mock не требует GPU и подходит для проверки всей интеграции:

```bash
docker compose --env-file backend/.env \
  -f docker-compose.yml \
  -f docker-compose.s3.yaml \
  -f docker-compose.inference.mock.yaml \
  up -d --build
```

Команда запускает:

- `api` — NestJS, порт `3000`;
- `frontend` — Nginx, порт `8080`;
- `minio` — S3 API `9000`, Console `9001`;
- `minio-init` — создаёт bucket `medical-scribe`;
- `inference` — mock gRPC, порт `50051`.

## Быстрый запуск: полный GPU-стек

```bash
docker compose --env-file backend/.env \
  -f docker-compose.yml \
  -f docker-compose.s3.yaml \
  -f docker-compose.inference.gpu.yaml \
  up -d --build
```

GPU Compose использует `../medical-scribe/Dockerfile.gpu` и передаёт контейнеру все доступные NVIDIA GPU.

Mock и GPU описывают один сервис `inference` и используют один порт `50051`. Одновременно должен работать только один режим. Запуск другой команды пересоберёт и пересоздаст `inference`.

## Рекомендуемый запуск по этапам

Если нужно видеть, на каком этапе произошла ошибка, запускайте последовательно.

### 1. MinIO и общая сеть

```bash
docker compose --env-file backend/.env \
  -f docker-compose.s3.yaml \
  up -d
```

Этот Compose создаёт:

- сеть `overtone-network`;
- MinIO;
- bucket `medical-scribe`.

### 2. Overtone API и frontend

```bash
docker compose --env-file backend/.env up -d --build
```

### 3. Один inference-режим

Mock:

```bash
docker compose --env-file backend/.env \
  -f docker-compose.inference.mock.yaml \
  up -d --build
```

GPU:

```bash
docker compose --env-file backend/.env \
  -f docker-compose.inference.gpu.yaml \
  up -d --build
```

## Проверка после запуска

Показать контейнеры:

```bash
docker compose --env-file backend/.env ps
docker compose --env-file backend/.env -f docker-compose.s3.yaml ps
docker compose --env-file backend/.env -f docker-compose.inference.mock.yaml ps
```

Проверить API напрямую и через frontend proxy:

```bash
curl http://localhost:3000/api/health
curl http://localhost:8080/api/health
```

Ожидается:

```json
{"status":"ok"}
```

Интерфейсы:

- Overtone: http://localhost:8080
- MinIO Console: http://localhost:9001
- NestJS API: http://localhost:3000
- inference gRPC: `localhost:50051`

Для inference вызовите `GetHealth` через Postman/gRPC. Mock должен вернуть `READY`; GPU станет `READY` после загрузки моделей и проверки S3.

## Логи

```bash
# Overtone
docker compose --env-file backend/.env logs -f api frontend

# MinIO
docker compose --env-file backend/.env \
  -f docker-compose.s3.yaml \
  logs -f minio minio-init

# Mock inference
docker compose --env-file backend/.env \
  -f docker-compose.inference.mock.yaml \
  logs -f inference

# GPU inference
docker compose --env-file backend/.env \
  -f docker-compose.inference.gpu.yaml \
  logs -f inference
```

## Остановка

Остановить отдельные части без удаления данных:

```bash
docker compose --env-file backend/.env \
  -f docker-compose.inference.mock.yaml down

docker compose --env-file backend/.env down

docker compose --env-file backend/.env \
  -f docker-compose.s3.yaml down
```

Для GPU вместо mock-файла укажите `docker-compose.inference.gpu.yaml`.

Не добавляйте `-v`, если не хотите удалить записи, MinIO bucket и остальные Docker volumes.

## Старые контейнеры medical-scribe

До переноса управления в Overtone inference и MinIO могли запускаться из `../medical-scribe`. Их нужно остановить один раз, иначе будут заняты порты `50051`, `9000` и `9001`:

```bash
cd ../medical-scribe
docker compose -f compose.local.yml down --remove-orphans
docker compose -f compose.gpu.yml down --remove-orphans
cd ../overtone
```

После этого mock/GPU запускаются только из Overtone. В `medical-scribe/compose.local.yml` и `compose.gpu.yml` собственный MinIO закомментирован.

## Дополнительная инфраструктура

MongoDB и Redis сейчас не нужны для цепочки `запись → M4A → S3`, но их Compose-файлы сохранены:

```bash
docker compose --env-file backend/.env \
  -f docker-compose.mongo.yaml up -d

docker compose --env-file backend/.env \
  -f docker-compose.redis.yaml up -d
```

Перед запуском добавьте в `backend/.env` необходимые `MONGO_*` и `REDIS_PASSWORD`.

## Типовые ошибки

### `network overtone-network declared as external, but could not be found`

Сначала запустите `docker-compose.s3.yaml`: именно он создаёт общую сеть.

### `port is already allocated`

- `50051` — уже работает другой mock/GPU inference;
- `9000` или `9001` — уже работает другой MinIO;
- `3000` или `8080` — уже запущен Overtone вне текущего Compose.

Проверка:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

### `Configured S3 bucket is unavailable`

Проверьте:

- MinIO имеет статус `healthy`;
- bucket `medical-scribe` создан;
- endpoint внутри контейнеров равен `http://minio:9000`;
- credentials в Overtone и inference совпадают.

### `Cannot connect to the Docker daemon`

Запустите Docker Desktop/daemon и повторите команду.

### GPU inference не становится `READY`

Сначала проверьте доступ GPU:

```bash
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu24.04 nvidia-smi
```

Затем проверьте пути моделей и переменные в `../medical-scribe/.env`.

## Важные правила для AI-агента

1. Выполнять Compose-команды из корня Overtone.
2. Не поднимать второй MinIO из `medical-scribe`.
3. Не заменять `http://minio:9000` на `localhost` внутри контейнеров.
4. Не запускать mock и GPU одновременно: оба занимают `50051`.
5. Не использовать `docker compose down -v` без явного разрешения владельца данных.
6. Перед удалением конфликтующего контейнера проверить его Compose project и подключённый volume через `docker inspect`.
