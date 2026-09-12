#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
FRONTEND_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
TEST_VERSION="${TEST_VERSION:-production-image-test}"
TEST_FRONTEND_PORT="${TEST_FRONTEND_PORT:-18082}"
IMAGE="overtone-frontend-test:$$"
CONTAINER="overtone-frontend-test-$$"
container_started=false

cleanup() {
  if [ "$container_started" = true ]; then
    docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
  fi
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker build \
  --build-arg "APP_VERSION=$TEST_VERSION" \
  --target runtime \
  --tag "$IMAGE" \
  "$FRONTEND_DIR"

docker run --detach \
  --name "$CONTAINER" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --publish "127.0.0.1:$TEST_FRONTEND_PORT:8080" \
  "$IMAGE" >/dev/null
container_started=true

test "$(docker inspect --format '{{.Config.User}}' "$CONTAINER")" = nginx
test "$(docker inspect --format '{{.Config.StopSignal}}' "$CONTAINER")" = SIGTERM
case "$(docker inspect --format '{{json .Config.ExposedPorts}}' "$CONTAINER")" in
  *'"8080/tcp"'*) ;;
  *) exit 1 ;;
esac
test "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CONTAINER")" = \
  "$TEST_VERSION"
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$CONTAINER")" = true
test "$(docker inspect --format '{{json .HostConfig.Binds}}' "$CONTAINER")" = null
test "$(docker inspect --format '{{json .Config.Volumes}}' "$CONTAINER")" = null
test "$(docker inspect --format '{{index .HostConfig.Tmpfs "/tmp"}}' "$CONTAINER")" = \
  'rw,noexec,nosuid,size=16m'

attempt=0
until curl --fail --silent --show-error \
  "http://127.0.0.1:$TEST_FRONTEND_PORT/frontend-health" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$CONTAINER"
    exit 1
  fi
  sleep 1
done

attempt=0
until [ "$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER")" = healthy ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker inspect --format '{{json .State.Health}}' "$CONTAINER"
    exit 1
  fi
  sleep 1
done

cd "$FRONTEND_DIR"
STACK_BASE_URL="http://127.0.0.1:$TEST_FRONTEND_PORT" \
STACK_EXPECTED_VERSION="$TEST_VERSION" \
npm run test:stack

# Nginx is PID 1 and must handle Docker's SIGTERM stop without being killed.
docker stop --time 5 "$CONTAINER" >/dev/null
test "$(docker inspect --format '{{.State.ExitCode}}' "$CONTAINER")" = 0
container_started=false
docker rm "$CONTAINER" >/dev/null

echo "Production image checks passed: $IMAGE"
