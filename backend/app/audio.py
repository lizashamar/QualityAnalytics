"""Resolve organizer player pages and stream media without exposing signed URLs."""
from __future__ import annotations

import ipaddress
import re
import socket
import threading
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from .services import ApiError


class _Player(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('audio', 'source') and attrs.get('src'):
            self.sources.append(attrs['src'])


class AudioProxy:
    def __init__(self, additional_hosts=()):
        self.additional_hosts = {h.lower().strip() for h in additional_hosts if h.strip()}
        self.cache = {}
        self.lock = threading.Lock()

    def _check(self, url, hosts):
        parts = urlsplit(url)
        if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.port not in (None, 443) or parts.hostname.lower() not in hosts:
            raise ApiError(502, 'Недопустимый адрес записи. Требуется HTTPS на разрешённом сервере.')
        try:
            addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
        except OSError:
            raise ApiError(502, 'Сервер записи недоступен.') from None
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ApiError(502, 'Адрес записи не должен указывать на локальную или частную сеть.')

    def _open(self, client, url, hosts, headers):
        for _ in range(5):
            self._check(url, hosts)
            response = client.send(client.build_request('GET', url, headers=headers), stream=True)
            if response.status_code not in (301, 302, 303, 307, 308):
                return response
            location = response.headers.get('location')
            response.close()
            if not location:
                break
            url = urljoin(url, location)
        raise ApiError(502, 'Слишком много перенаправлений записи.')

    def stream(self, source, range_header=None):
        if not source:
            raise ApiError(404, 'У диалога нет записи.')
        if range_header and not re.fullmatch(r'bytes=(?:\d+-\d*|-\d+)', range_header):
            raise ApiError(400, 'Поддерживается один диапазон байтов.')
        host = urlsplit(source).hostname
        hosts = self.additional_hosts | ({host.lower()} if host else set())
        client = httpx.Client(timeout=httpx.Timeout(60, connect=20), follow_redirects=False)
        response = None
        try:
            with self.lock:
                cached = self.cache.get(source)
            target = cached[1] if cached and cached[0] > time.monotonic() else source
            headers = {'Accept-Encoding': 'identity'}
            if range_header:
                headers['Range'] = range_header
            response = self._open(client, target, hosts, headers if target != source else {'Accept-Encoding': 'identity'})
            if target != source and response.status_code in (401, 403, 404):
                response.close()
                response = self._open(client, source, hosts, {'Accept-Encoding': 'identity'})
            kind = response.headers.get('content-type', '').split(';')[0].lower()
            if kind in ('text/html', 'application/xhtml+xml') and response.status_code < 400:
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > 512 * 1024:
                        raise ApiError(502, 'Страница записи слишком велика.')
                    chunks.append(chunk)
                page_url = str(response.url)
                response.close()
                player = _Player()
                player.feed(b''.join(chunks).decode('utf-8', errors='replace'))
                if not player.sources:
                    raise ApiError(502, 'На странице записи не найден аудиофайл.')
                target = urljoin(page_url, player.sources[0])
                response = self._open(client, target, hosts, headers)
                kind = response.headers.get('content-type', '').split(';')[0].lower()
            elif range_header and target == source and response.status_code == 200:
                response.close()
                response = self._open(client, source, hosts, headers)
            if response.status_code == 416:
                outgoing = {'Content-Range': response.headers.get('content-range', 'bytes */0')}
                response.close(); client.close()
                return StreamingResponse(iter(()), status_code=416, headers=outgoing)
            if response.status_code not in (200, 206) or not (kind.startswith('audio/') or kind == 'application/octet-stream'):
                raise ApiError(502, 'Аудиофайл недоступен. Обновите запись или повторите позже.')
            with self.lock:
                if len(self.cache) >= 128:
                    self.cache.clear()
                self.cache[source] = (time.monotonic() + 240, str(response.url))
            outgoing = {name: response.headers[name] for name in ('content-length', 'content-range', 'accept-ranges') if name in response.headers}
            if response.headers.get('content-encoding', 'identity') != 'identity':
                outgoing.pop('content-length', None)
            outgoing['Cache-Control'] = 'private, no-store'
            def close():
                response.close()
                client.close()
            def content():
                try:
                    yield from response.iter_bytes()
                finally:
                    close()
            return StreamingResponse(content(), status_code=response.status_code, media_type=kind, headers=outgoing, background=BackgroundTask(close))
        except (httpx.HTTPError, OSError):
            if response is not None:
                response.close()
            client.close()
            raise ApiError(502, 'Не удалось загрузить запись. Повторите позже.') from None
        except BaseException:
            if response is not None:
                response.close()
            client.close()
            raise
