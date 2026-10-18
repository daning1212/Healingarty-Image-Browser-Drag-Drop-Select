"""Canvas image browser for ComfyUI. Paths refer to the server machine."""
import asyncio
import hashlib
import io
import os
from pathlib import Path
import shutil
import tempfile
import subprocess
import sys

from aiohttp import web
from PIL import Image, ImageOps
import folder_paths
from server import PromptServer

WEB_DIRECTORY = './web'
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'}
_slots = asyncio.Semaphore(4)


def image_path(raw):
    path = Path(raw).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
        raise ValueError('지원하는 이미지 파일이 아닙니다.')
    return path


def browse(raw, offset=0, limit=80, query=''):
    path = Path(raw or folder_paths.get_input_directory()).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError('폴더 경로를 입력하세요.')
    # No image decoding during directory listing. Scan off the event loop.
    entries = []
    with os.scandir(path) as scan:
        for entry in scan:
            try:
                directory = entry.is_dir()
                if (directory or Path(entry.name).suffix.lower() in EXTENSIONS) and query.casefold() in entry.name.casefold():
                    entries.append({'name': entry.name, 'path': str(path / entry.name), 'directory': directory})
            except OSError:
                continue
    entries.sort(key=lambda e: (not e['directory'], e['name'].casefold()))
    return {'path': str(path), 'parent': str(path.parent), 'items': entries[offset:offset+limit],
            'next': offset + limit if offset + limit < len(entries) else None, 'total': len(entries)}


def thumbnail(raw):
    path = image_path(raw)
    with Image.open(path) as original:
        img = ImageOps.exif_transpose(original)
        width, height = img.size
        img.thumbnail((256, 256))
        buffer = io.BytesIO()
        img.convert('RGB').save(buffer, 'JPEG', quality=80)
    return buffer.getvalue(), width, height


def import_image(raw):
    source = image_path(raw)
    # Validate before copying, but preserve the original bytes and metadata.
    with Image.open(source) as img:
        img.verify()
    root = Path(folder_paths.get_input_directory()).resolve()
    try:
        return source.relative_to(root).as_posix()
    except ValueError:
        pass
    stat = source.stat()
    key = hashlib.sha256(f'{source}:{stat.st_mtime_ns}:{stat.st_size}'.encode()).hexdigest()[:24]
    target_dir = root / 'healingarty_browser'
    target_dir.mkdir(exist_ok=True)
    target = target_dir / (key + source.suffix.lower())
    if not target.exists():
        fd, temporary = tempfile.mkstemp(dir=target_dir)
        os.close(fd)
        try:
            shutil.copyfile(source, temporary)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return target.relative_to(root).as_posix()


async def guarded(work, *args):
    try:
        async with _slots:
            return await asyncio.to_thread(work, *args)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise web.HTTPBadRequest(text=str(exc)) from exc


routes = PromptServer.instance.routes

@routes.get('/healingarty/browser/list')
async def list_folder(request):
    try:
        offset = max(0, int(request.query.get('offset', 0)))
        limit = min(120, max(1, int(request.query.get('limit', 80))))
    except ValueError:
        raise web.HTTPBadRequest(text='잘못된 페이지 값')
    result = await guarded(browse, request.query.get('path', ''), offset, limit, request.query.get('q', ''))
    return web.json_response(result)

@routes.get('/healingarty/browser/roots')
async def roots(request):
    drives = [f'{chr(i)}:\\' for i in range(65, 91) if os.path.isdir(f'{chr(i)}:\\')] if os.name == 'nt' else ['/']
    return web.json_response({'roots': list(dict.fromkeys([folder_paths.get_input_directory(), folder_paths.get_output_directory(), str(Path.home()), *drives]))})

@routes.get('/healingarty/browser/thumbnail')
async def get_thumbnail(request):
    data, width, height = await guarded(thumbnail, request.query.get('path', ''))
    return web.Response(body=data, content_type='image/jpeg', headers={'X-Image-Width': str(width), 'X-Image-Height': str(height), 'Cache-Control': 'no-store'})

@routes.post('/healingarty/browser/import')
async def copy_image(request):
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get('path'), str):
        raise web.HTTPBadRequest(text='이미지 경로가 필요합니다.')
    value = await guarded(import_image, body['path'])
    return web.json_response({'value': value})


@routes.post('/healingarty/browser/open')
async def open_folder(request):
    body = await request.json()
    path = Path(body.get('path', '')).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise web.HTTPBadRequest(text='폴더를 선택하세요.')
    # Shell-free, explicit user action; opens on the ComfyUI host.
    try:
        if os.name == 'nt':
            os.startfile(str(path))
        else:
            subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', str(path)])
    except OSError as exc:
        raise web.HTTPBadRequest(text=str(exc)) from exc
    return web.json_response({'ok': True})
