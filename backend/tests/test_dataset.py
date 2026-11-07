"""Checkpoint 1: proxy, persistence, same-origin access and failure recovery."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import organizers
from app.config import Settings
from app.main import create_app


@pytest.fixture
def proxy(tmp_path, monkeypatch):
    records = [{"conversation_id": f"dev-{i}", "language": "KZ", "transcript": [
        {"speaker": "operator", "text": "Сәлеметсіз бе!", "timestamp": "00:01"}
    ]} for i in range(65)]
    calls = []

    def get(url, timeout):
        calls.append(url)
        return httpx.Response(200, json={"isSuccess": True, "data": {"records": records, "total_records": 65}})

    monkeypatch.setattr(organizers, "http_get", get)
    settings = Settings(db_path=str(tmp_path / "db.sqlite"), dataset_path=str(tmp_path / "dataset.json"),
                        organizer_api_url="https://organizer.example/dataset?key=test")
    with TestClient(create_app(settings)) as client:
        yield client, settings, records, calls


def test_fetch_65_and_read_after_restart(proxy):
    client, settings, records, calls = proxy
    assert client.get("/api/dialogues").status_code == 404
    response = client.get("/api/fetch-dataset")
    assert response.status_code == 200
    assert response.json()["records"] == records
    assert "group_id=DEV" in calls[0]
    assert json.loads(settings.dataset_file.read_text())["records"] == records
    assert client.get("/api/dialogues").json() == records
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get("/api/dialogues").json() == records
    assert client.get("/api/fetch-dataset", params={"group_id": "CONTROL"}).json()["group_id"] == "CONTROL"
    assert "group_id=CONTROL" in calls[-1]
    assert client.get("/api/fetch-dataset", params={"group_id": " "}).status_code == 400


@pytest.mark.parametrize("failure", ["timeout", "http", "json", "shape"])
def test_failed_fetch_preserves_snapshot(proxy, monkeypatch, failure):
    client, settings, records, _ = proxy
    client.get("/api/fetch-dataset")
    before = settings.dataset_file.read_bytes()

    def fail(url, timeout):
        if failure == "timeout":
            raise httpx.ReadTimeout("timeout")
        if failure == "http":
            return httpx.Response(503)
        if failure == "json":
            return httpx.Response(200, text="invalid")
        return httpx.Response(200, json={"isSuccess": True, "data": {"records": {"bad": "shape"}}})

    monkeypatch.setattr(organizers, "http_get", fail)
    assert client.get("/api/fetch-dataset").status_code == 502
    assert settings.dataset_file.read_bytes() == before
    assert client.get("/api/dialogues").json() == records


def test_missing_configuration_and_corrupt_file(proxy):
    client, settings, _, _ = proxy
    settings.dataset_file.write_text("broken")
    assert client.get("/api/dialogues").status_code == 500
    with TestClient(create_app(settings.with_(organizer_api_url=""))) as unconfigured:
        assert unconfigured.get("/api/fetch-dataset").status_code == 502


def test_template_escapes_group():
    assert organizers.build_url("https://example.test/{group_id}", "A&B/C") == "https://example.test/A%26B%2FC"


def test_failed_disk_write_preserves_snapshot(proxy, monkeypatch):
    from app import dataset

    client, settings, _, _ = proxy
    assert client.get("/api/fetch-dataset").status_code == 200
    before = settings.dataset_file.read_bytes()

    def fail_replace(*args):
        raise OSError("disk failure")

    monkeypatch.setattr(dataset.os, "replace", fail_replace)
    assert client.get("/api/fetch-dataset").status_code == 500
    assert settings.dataset_file.read_bytes() == before
    assert list(settings.dataset_file.parent.glob(".dataset-*.tmp")) == []
