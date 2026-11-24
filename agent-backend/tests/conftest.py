"""Keep unit tests separate from desktop accounts, settings and provider calls."""
import ipaddress
import socket

import pytest


@pytest.fixture(autouse=True)
def isolated_desktop_configuration(tmp_path, monkeypatch):
    import app.config

    monkeypatch.setenv("DESKAURA_CONFIG_PATH", str(tmp_path / "isolated-config.json"))
    for name in ("LLM_API_KEY", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL"):
        monkeypatch.delenv(name, raising=False)
    keys = {}
    monkeypatch.setattr(app.config.keyring, "get_password", lambda service, name: keys.get((service, name)))
    monkeypatch.setattr(app.config.keyring, "set_password", lambda service, name, value: keys.update({(service, name): value}))
    monkeypatch.setattr(app.config.keyring, "delete_password", lambda service, name: keys.pop((service, name), None))
    original_connect = socket.socket.connect

    def local_only(sock, address):
        try:
            local = ipaddress.ip_address(address[0]).is_loopback
        except (ValueError, TypeError, IndexError):
            local = False
        if not local:
            raise OSError("External networking is disabled in unit tests")
        return original_connect(sock, address)

    monkeypatch.setattr(socket.socket, "connect", local_only)
