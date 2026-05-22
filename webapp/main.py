from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from webapp.auth import clear_auth_cookie, ensure_authenticated, get_app_password, is_authenticated, require_auth_enabled, set_auth_cookie
from webapp.jobs import BatchJobStore
from webapp.schemas import (
    AgentAuditResponse,
    BatchJobResponse,
    DuplicateClusterResponse,
    LoginRequest,
    LoginResponse,
    OverrideAuditResponse,
    OverviewResponse,
    SessionResponse,
    VendorCheckResponse,
    VendorCreateRequest,
    VendorCreateResponse,
    VendorSearchResponse,
)
from utils.errors import safe_message
from webapp.services import (
    DuplicateWarning,
    ensure_database_ready,
    fetch_agent_actions,
    fetch_duplicate_cluster,
    fetch_overview,
    fetch_override_actions,
    fetch_vendor_directory,
    insert_vendor_record,
    parse_vendor_file,
    run_vendor_check,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        ensure_database_ready()
    except Exception:
        logger.exception("Database initialization failed during startup; continuing in degraded mode.")
    yield


app = FastAPI(title="VendorOrchestrator", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

job_store = BatchJobStore()
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled application error", exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": _friendly_error_message(exc)},
    )


def _friendly_error_message(exc: Exception) -> str:
    message = safe_message(exc)
    if "Can't connect to MySQL server" in message or "OperationalError" in message:
        return "Database connection failed. Start MySQL or verify the configured MYSQL_* settings."
    return message


@app.get("/api/session", response_model=SessionResponse)
def get_session(request: Request) -> SessionResponse:
    return SessionResponse(
        require_auth=require_auth_enabled(),
        authenticated=is_authenticated(request),
    )


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response) -> LoginResponse:
    if not require_auth_enabled():
        return LoginResponse(success=True)
    if payload.password != get_app_password():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password.")
    set_auth_cookie(response)
    return LoginResponse(success=True)


@app.post("/api/auth/logout", response_model=LoginResponse)
def logout(response: Response) -> LoginResponse:
    clear_auth_cookie(response)
    return LoginResponse(success=True)


@app.get("/api/overview", response_model=OverviewResponse)
def overview(request: Request) -> OverviewResponse:
    ensure_authenticated(request)
    return fetch_overview()


@app.post("/api/batch-jobs", response_model=BatchJobResponse)
async def create_batch_job(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
) -> BatchJobResponse:
    ensure_authenticated(request)
    content = await file.read()
    try:
        records, validation = parse_vendor_file(file.filename or "upload.csv", content)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if validation.missing_required:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Missing required columns.",
                "validation": validation.model_dump(),
            },
        )

    job = job_store.create(file.filename or "upload.csv", validation)
    background_tasks.add_task(job_store.run_job, job.job_id, records)
    return job_store.to_response(job.job_id)


@app.get("/api/batch-jobs/{job_id}", response_model=BatchJobResponse)
def get_batch_job(request: Request, job_id: str) -> BatchJobResponse:
    ensure_authenticated(request)
    try:
        return job_store.to_response(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch job not found.") from exc


@app.post("/api/vendors/check", response_model=VendorCheckResponse)
def check_vendor(request: Request, payload: VendorCreateRequest) -> VendorCheckResponse:
    ensure_authenticated(request)
    try:
        result = run_vendor_check(payload.vendor.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return VendorCheckResponse(**result)


@app.post("/api/vendors", response_model=VendorCreateResponse)
def create_vendor(request: Request, payload: VendorCreateRequest) -> VendorCreateResponse:
    ensure_authenticated(request)
    try:
        vendor_id, duplicate_check, used_override = insert_vendor_record(
            payload.vendor.model_dump(),
            force_add=payload.force_add,
            override_reason=payload.override_reason,
            analyst_name=payload.analyst_name,
        )
    except DuplicateWarning as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.result) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return VendorCreateResponse(
        vendor_id=vendor_id,
        status="created_with_override" if used_override else "created",
        duplicate_check=VendorCheckResponse(**duplicate_check),
    )


@app.get("/api/vendors", response_model=VendorSearchResponse)
def list_vendors(
    request: Request,
    search_name: str = Query(default=""),
    search_tax: str = Query(default=""),
    include_duplicates: bool = Query(default=False),
) -> VendorSearchResponse:
    ensure_authenticated(request)
    return VendorSearchResponse(
        **fetch_vendor_directory(
            search_name=search_name,
            search_tax=search_tax,
            include_duplicates=include_duplicates,
        )
    )


@app.get("/api/vendors/{vendor_id}/duplicates", response_model=DuplicateClusterResponse)
def vendor_duplicates(request: Request, vendor_id: int) -> DuplicateClusterResponse:
    ensure_authenticated(request)
    try:
        return DuplicateClusterResponse(**fetch_duplicate_cluster(vendor_id))
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/api/audit/agent-actions", response_model=AgentAuditResponse)
def audit_agent_actions(
    request: Request,
    agent_name: str = Query(default="All"),
) -> AgentAuditResponse:
    ensure_authenticated(request)
    return AgentAuditResponse(entries=fetch_agent_actions(agent_name=agent_name))


@app.get("/api/audit/overrides", response_model=OverrideAuditResponse)
def audit_overrides(request: Request) -> OverrideAuditResponse:
    ensure_authenticated(request)
    return OverrideAuditResponse(entries=fetch_override_actions())


if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/{full_path:path}")
def spa_entry(full_path: str) -> Response:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    if FRONTEND_DIST.exists():
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

    return JSONResponse(
        {
            "message": "Frontend build not found. Run the Vite build or start the frontend dev server.",
        },
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    )
