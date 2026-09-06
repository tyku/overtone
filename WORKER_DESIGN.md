# Асинхронная обработка приёмов

## Границы

Overtone управляет командами: создание, доставка, опрос, ручная новая попытка, получение отчёта. Medical-scribe выполняет целый pipeline, хранит процесс и состояния его этапов в собственной схеме PostgreSQL. Overtone не читает таблицы medical-scribe; исключение — явные интеграционные тесты.

Внешний идентификатор один: UUID `commandId` создаёт Overtone до отправки. `requestId` объединяет все попытки одного приёма. Старый `processId` оставлен в medical-scribe для совместимости, Overtone его не использует.

## Доставка и очередь

Закрытие приёма, `processing_intent` и начальная `processing_command` записываются одной транзакцией. После commit API публикует BullMQ job. Redis — транспорт, PostgreSQL — долговечное состояние и история.

Worker — отдельная точка входа `dist/worker/main.js`, без HTTP. Обрабатывает короткие действия с concurrency=8; это параллелизм gRPC/S3-операций, а не GPU-вычислений. BullMQ job содержит только `commandId`. Уникальный job ID: `commandId-revision`; после изменения next action растёт revision. Дубликаты действий сериализуются session advisory lock PostgreSQL. Нужен прямой/session-pooled URL, transaction pooling не подходит.

Redis настраивается с `noeviction`, чтобы память не удаляла части очереди. Документация: [соединения BullMQ](https://docs.bullmq.io/guide/connections), [идентификаторы заданий](https://docs.bullmq.io/guide/jobs/job-ids).

После перезапуска и каждые 60 секунд worker восстанавливает задания из `next_action_at`. Старые `processing_intents` без команды подхватываются, если приём ещё `processing`. При недоступности Redis сохранение аудио остаётся успешным; обработка начнётся после восстановления очереди. Фоновый опрос облачного PostgreSQL каждую секунду не используется.

## Команды и статусы

`StartFullPipeline` — атомарный get-or-create: тот же ID и параметры возвращают ту же команду; изменённые параметры дают конфликт. Потеря ответа не разрешает новый ID. Подтверждение старта переводит локальную команду из `pending` в `polling`.

`GetProcess(commandId)` вызывается раз в 3 секунды. PostgreSQL Overtone хранит последний подтверждённый remote status и snapshot этапов; история переходов отражается в `request_events` с `commandId`. Логи переходов содержат `requestId` и `commandId`, но не аудио/документ.

Предел ожидания — 5 минут от первой отправки Start, включая удалённую очередь; сетевые повторы не сбрасывают deadline. При недоступности worker/Redis фиксация просрочки произойдёт после восстановления. Это локальный предел ожидания, не отмена вычисления и не 30-секундный SLO.

| Remote / событие | Overtone command | Приём |
|---|---|---|
| queued / running | polling | processing |
| succeeded + проверенный отчёт | succeeded | completed |
| failed / lost | failed | processing_failed |
| 5 минут истекли | timed_out, remote status сохраняется | processing_failed / PROCESSING_TIMEOUT |
| Сеть / S3 временно недоступны | текущая команда + следующее действие | processing до deadline |

После `succeeded` worker проверяет точный префикс `requests/{requestId}/full-pipeline/{commandId}/`, схему `stage-result-v1`, единственный `clinical_document.md`, размер и SHA-256. Указатель отчёта и `completed` фиксируются транзакцией только для актуальной команды приёма. Ошибка S3 не вызывает новое GPU-вычисление.

## Ручной повтор

`POST /api/requests/{id}/retry-processing` принимает `{commandId}` предыдущей попытки. Идентификатор защищает от двух кликов и потери HTTP-ответа: повтор по уже заменённой команде возвращает текущее состояние.

Перед новой попыткой всегда вызывается GetProcess:

- succeeded: получить поздний отчёт прежней команды;
- failed: новый commandId, прежние параметры, история сохранена;
- queued/running: `PROCESS_STILL_RUNNING`, новый запуск не создаётся;
- lost: `PROCESS_LOST_UNCONFIRMED`; текущий medical-scribe определяет lost только по lease, это не доказательство остановки вычисления;
- недоступен / неизвестен: `PROCESSING_STATE_UNKNOWN`, новый запуск не создаётся.

Автоматически повторяются доставка и опрос, а не само GPU-вычисление. Отмена команд и безопасное разрешение retry после lost требуют отдельного подтверждения остановки в medical-scribe и пока не реализованы.

## Проверки

- `npm run test:processing` с отдельным `TEST_DATABASE_URL`: реальные PostgreSQL и gRPC; доставка, дубликаты, таймаут, поздний результат, retry, целостность.
- `npm run test:browser`: HTTP-fixtures и настоящий браузерный MediaRecorder.
- `npm run test:worker-smoke`: только отдельная тестовая инфраструктура; script удаляет свою очередь и проверяет восстановление. Нужны `TEST_DATABASE_URL`, `TEST_REDIS_URL`, `TEST_S3_ENDPOINT`, `TEST_GRPC_ADDRESS`, опционально `TEST_FFMPEG`.
- Для smoke используется `test/fixtures/inference-process-server.py` в актуальном medical-scribe dev image: настоящие handlers/repository/executor/artifact writer, тестовые вычисления. GPU-качество и время реального pipeline этим тестом не проверяются.
