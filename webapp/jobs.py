from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from context.memory import SharedContext
from orchestrator.graph import run_pipeline_stepwise
from utils.errors import safe_message
from webapp.schemas import BatchJobResponse, BatchJobResult, BatchValidationSummary


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class BatchJob:
    job_id: str
    file_name: str
    validation: BatchValidationSummary
    status: str = "queued"
    progress: float = 0.0
    current_step: str = "Queued"
    result: dict[str, Any] | None = None
    error_message: str | None = None
    created_at: datetime = field(default_factory=_utcnow)
    updated_at: datetime = field(default_factory=_utcnow)


class BatchJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, BatchJob] = {}
        self._lock = threading.Lock()

    def create(self, file_name: str, validation: BatchValidationSummary) -> BatchJob:
        job = BatchJob(job_id=uuid.uuid4().hex, file_name=file_name, validation=validation)
        with self._lock:
            self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> BatchJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def to_response(self, job_id: str) -> BatchJobResponse:
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return BatchJobResponse(
            job_id=job.job_id,
            file_name=job.file_name,
            status=job.status,
            progress=job.progress,
            current_step=job.current_step,
            validation=job.validation,
            result=BatchJobResult(**job.result) if job.result else None,
            error_message=job.error_message,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    def run_job(self, job_id: str, records: list[dict[str, Any]]) -> None:
        job = self.get(job_id)
        if job is None:
            return

        ctx = SharedContext()
        ctx.new_run()

        def on_step(step_name: str, step_index: int, total_steps: int) -> None:
            with self._lock:
                current = self._jobs.get(job_id)
                if current is None:
                    return
                current.status = "running"
                current.current_step = step_name
                current.progress = round(min(step_index / max(total_steps, 1), 1.0), 2)
                current.updated_at = _utcnow()

        try:
            with self._lock:
                job.status = "running"
                job.current_step = "Preparing records"
                job.progress = 0.02
                job.updated_at = _utcnow()

            result = run_pipeline_stepwise(records, ctx, on_step=on_step)

            with self._lock:
                current = self._jobs.get(job_id)
                if current is None:
                    return
                current.status = "completed"
                current.progress = 1.0
                current.current_step = "Complete"
                current.result = {
                    "load_result": getattr(result, "load_result", {}),
                    "quality_report": getattr(result, "quality_report", {}),
                }
                current.updated_at = _utcnow()
        except Exception as exc:
            with self._lock:
                current = self._jobs.get(job_id)
                if current is None:
                    return
                current.status = "failed"
                current.error_message = safe_message(exc)
                current.current_step = "Failed"
                current.updated_at = _utcnow()
