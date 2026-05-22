import io
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import webapp.main as main
from webapp.services import DuplicateWarning


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("REQUIRE_AUTH", "true")
    monkeypatch.setenv("APP_PASSWORD", "secret")
    monkeypatch.setattr(main, "ensure_database_ready", lambda: None)
    with TestClient(main.app) as test_client:
        yield test_client


def login(client: TestClient):
    response = client.post("/api/auth/login", json={"password": "secret"})
    assert response.status_code == 200


def test_session_and_login_flow(client: TestClient):
    response = client.get("/api/session")
    assert response.status_code == 200
    assert response.json() == {"require_auth": True, "authenticated": False}

    bad_login = client.post("/api/auth/login", json={"password": "wrong"})
    assert bad_login.status_code == 401

    login(client)
    authed = client.get("/api/session")
    assert authed.json() == {"require_auth": True, "authenticated": True}

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    after_logout = client.get("/api/session")
    assert after_logout.json()["authenticated"] is False


def test_batch_job_status_lifecycle(client: TestClient, monkeypatch):
    login(client)

    def fake_run_job(job_id, records):
        job = main.job_store.get(job_id)
        assert job is not None
        job.status = "completed"
        job.progress = 1.0
        job.current_step = "Complete"
        job.result = {
            "load_result": {
                "total_processed": len(records),
                "inserted_canonical": 1,
                "duplicates_marked": 0,
                "clusters": 1,
            },
            "quality_report": {
                "total_records": len(records),
                "flagged_records": 0,
                "quality_issue_rate": 0.0,
                "total_issues": 0,
                "needs_review": False,
            },
        }

    monkeypatch.setattr(main.job_store, "run_job", fake_run_job)

    upload = io.BytesIO(b"vendor_name,address\nAcme,123 Main")
    response = client.post(
        "/api/batch-jobs",
        files={"file": ("vendors.csv", upload, "text/csv")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["validation"]["record_count"] == 1
    assert payload["status"] in {"queued", "completed"}

    status_response = client.get(f"/api/batch-jobs/{payload['job_id']}")
    assert status_response.status_code == 200
    assert status_response.json()["result"]["load_result"]["total_processed"] == 1


def test_batch_job_rejects_missing_required_columns(client: TestClient):
    login(client)
    response = client.post(
        "/api/batch-jobs",
        files={"file": ("vendors.csv", io.BytesIO(b"name,address\nAcme,123 Main"), "text/csv")},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["message"] == "Missing required columns."
    assert detail["validation"]["missing_required"] == ["vendor_name"]


def test_vendor_check_and_create_paths(client: TestClient, monkeypatch):
    login(client)

    monkeypatch.setattr(
        main,
        "run_vendor_check",
        lambda record: {
            "recommendation": "warn",
            "matches": [{"vendor_id": 1, "vendor_name": "Acme Corporation"}],
            "message": "High-confidence duplicate found.",
        },
    )

    payload = {
        "vendor": {
            "vendor_name": "Acme Corp",
            "address": "123 Main",
            "city": "Austin",
            "state": "TX",
            "zip": "78701",
            "country": "US",
            "tax_id": "12-3456789",
        },
        "force_add": False,
        "override_reason": "",
        "analyst_name": "analyst",
    }

    check_response = client.post("/api/vendors/check", json=payload)
    assert check_response.status_code == 200
    assert check_response.json()["recommendation"] == "warn"

    def fake_insert_vendor_record(*args, **kwargs):
        raise DuplicateWarning(
            {
                "recommendation": "warn",
                "matches": [{"vendor_id": 1}],
                "message": "Review required.",
            }
        )

    monkeypatch.setattr(main, "insert_vendor_record", fake_insert_vendor_record)
    conflict = client.post("/api/vendors", json=payload)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["recommendation"] == "warn"

    monkeypatch.setattr(
        main,
        "insert_vendor_record",
        lambda *args, **kwargs: (
            42,
            {
                "recommendation": "warn",
                "matches": [{"vendor_id": 1}],
                "message": "Vendor added with override.",
            },
            True,
        ),
    )
    created = client.post("/api/vendors", json={**payload, "force_add": True})
    assert created.status_code == 200
    assert created.json()["status"] == "created_with_override"


def test_vendor_search_duplicate_cluster_and_audit(client: TestClient, monkeypatch):
    login(client)

    monkeypatch.setattr(
        main,
        "fetch_vendor_directory",
        lambda **kwargs: {
            "metrics": {
                "active_vendors": 3,
                "total_records": 4,
                "duplicates": 1,
                "showing": 1,
            },
            "results": [
                {
                    "id": 1,
                    "vendor_name": "Acme Corp",
                    "address": "123 Main",
                    "city": "Austin",
                    "state": "TX",
                    "zip": "78701",
                    "country": "US",
                    "tax_id": "12-3456789",
                    "status": "active",
                    "cluster_id": 88,
                    "source": "batch",
                    "created_at": None,
                    "updated_at": None,
                }
            ],
        },
    )
    vendors = client.get("/api/vendors?search_name=Acme")
    assert vendors.status_code == 200
    assert vendors.json()["metrics"]["active_vendors"] == 3

    monkeypatch.setattr(
        main,
        "fetch_duplicate_cluster",
        lambda vendor_id: {
            "vendor_id": vendor_id,
            "cluster_id": 88,
            "canonical_vendor": {
                "id": vendor_id,
                "vendor_name": "Acme Corp",
                "address": "123 Main",
                "city": "Austin",
                "state": "TX",
                "zip": "78701",
                "country": "US",
                "tax_id": "12-3456789",
                "status": "active",
                "cluster_id": 88,
                "source": "batch",
                "created_at": None,
                "updated_at": None,
            },
            "duplicates": [],
        },
    )
    cluster = client.get("/api/vendors/1/duplicates")
    assert cluster.status_code == 200
    assert cluster.json()["cluster_id"] == 88

    monkeypatch.setattr(
        main,
        "fetch_agent_actions",
        lambda agent_name="All": [
            {
                "id": 1,
                "agent_name": agent_name,
                "action": "insert",
                "vendor_id": 5,
                "confidence": 0.98,
                "timestamp": "2026-05-21T12:00:00+00:00",
                "details_json": None,
            }
        ],
    )
    monkeypatch.setattr(
        main,
        "fetch_override_actions",
        lambda: [
            {
                "id": 1,
                "vendor_id": 5,
                "original_action": "block_duplicate",
                "override_action": "force_insert",
                "reason": "Manual review",
                "analyst_name": "analyst",
                "timestamp": "2026-05-21T12:00:00+00:00",
            }
        ],
    )

    audit = client.get("/api/audit/agent-actions?agent_name=LoaderAgent")
    assert audit.status_code == 200
    assert audit.json()["entries"][0]["agent_name"] == "LoaderAgent"

    overrides = client.get("/api/audit/overrides")
    assert overrides.status_code == 200
    assert overrides.json()["entries"][0]["reason"] == "Manual review"
