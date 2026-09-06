"""Test-only model substitute; real medical-scribe gRPC, PostgreSQL and S3 writer."""
import asyncio
import logging
from pathlib import Path
import tempfile
import time
import grpc
from medscribe.service.artifacts import ArtifactWriter
from medscribe.service.commands import CommandRegistry
from medscribe.service.config import ServiceConfig
from medscribe.service.database import create_pool, run_migrations
from medscribe.service.generated import inference_pb2_grpc
from medscribe.service.handlers import InferenceServicer
from medscribe.service.process_executor import ProcessExecutor
from medscribe.service.process_repository import ProcessRepository, FULL_PIPELINE_STAGES
from medscribe.service.runtime import RuntimeState
from medscribe.service.storage import S3Storage

class TestClinical:
    def __init__(self, storage):
        self.storage = storage

    def run_full_pipeline(self, command, source_key, *, progress, **kwargs):
        assert self.storage.object_exists(source_key)
        for stage in FULL_PIPELINE_STAGES:
            progress.stage_started(stage)
            time.sleep(0.3)
            progress.stage_succeeded(stage)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'clinical_document.md'
            path.write_text('# Integration fixture report\n\nSynthetic audio; no clinical inference.\n')
            return ArtifactWriter(self.storage).publish_files(command, {'clinical_document.md': path})

async def main():
    config = ServiceConfig.from_env()
    pool = create_pool(config.database_url, max_size=4)
    pool.open(wait=True)
    run_migrations(pool)
    repo = ProcessRepository(pool)
    storage = S3Storage.from_config(config.s3)
    clinical = TestClinical(storage)
    executor = ProcessExecutor(repo, clinical, storage, poll_seconds=0.1,
                               heartbeat_seconds=1, lease_seconds=30)
    runtime = RuntimeState()
    runtime.mark_ready('Integration fixture ready')
    server = grpc.aio.server()
    inference_pb2_grpc.add_InferenceServiceServicer_to_server(
        InferenceServicer(runtime, None, storage, CommandRegistry(), clinical, repo), server)
    server.add_insecure_port('0.0.0.0:50051')
    await server.start()
    executor.start()
    try:
        await server.wait_for_termination()
    finally:
        await executor.stop()
        pool.close()

logging.basicConfig(level=logging.INFO)
asyncio.run(main())
