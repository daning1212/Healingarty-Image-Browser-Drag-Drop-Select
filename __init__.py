"""Canvas image browser for ComfyUI. Paths refer to the server machine."""
import asyncio
import hashlib
import io
import json
import math
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


def folder_tree(raw, offset=0):
    path = Path(raw or folder_paths.get_input_directory()).expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError('폴더 경로를 입력하세요.')
    children = []
    with os.scandir(path) as scan:
        for entry in scan:
            try:
                if entry.is_dir():
                    children.append({'name': entry.name, 'path': str(path / entry.name)})
            except OSError:
                continue
    children.sort(key=lambda item: item['name'].casefold())
    chain = [*reversed(path.parents), path]
    return {'path': str(path), 'ancestors': [{'path': str(p), 'name': p.name or str(p)} for p in chain],
            'children': children[offset:offset+120], 'next': offset+120 if offset+120 < len(children) else None}


@routes.get('/healingarty/browser/folders')
async def get_folder_tree(request):
    try:
        offset = max(0, int(request.query.get('offset', 0)))
    except ValueError:
        raise web.HTTPBadRequest(text='잘못된 페이지 값')
    return web.json_response(await guarded(folder_tree, request.query.get('path', ''), offset))


class HealingartyImageBrowser:
    """Read the selected original image only when its IMAGE output executes."""
    CATEGORY = 'Healingarty'
    RETURN_TYPES = ('IMAGE', 'IMAGE')
    RETURN_NAMES = ('IMAGE', 'CROP IMAGE')
    FUNCTION = 'load_selected'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'selected_path': ('STRING', {'default': '', 'multiline': False})},
                'optional': {'crop_state': ('STRING', {'default': '', 'multiline': False})}}

    @classmethod
    def VALIDATE_INPUTS(cls, selected_path, crop_state=''):
        if not selected_path and not crop_state:
            return '탐색기에서 사용할 이미지를 먼저 클릭하세요.'
        try:
            if selected_path:
                image_path(selected_path)
            state = parse_crop_state(crop_state)
            if state:
                image_path(state['path'])
            return True
        except (OSError, ValueError) as exc:
            return str(exc)

    @classmethod
    def IS_CHANGED(cls, selected_path, crop_state=''):
        try:
            digest = hashlib.sha256()
            state = parse_crop_state(crop_state)
            digest.update(crop_state.encode())
            for raw in dict.fromkeys([selected_path or state['path'], *([state['path']] if state else [])]):
                with image_path(raw).open('rb') as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(block)
            return digest.hexdigest()
        except (OSError, ValueError):
            return float('nan')

    def load_selected(self, selected_path, crop_state=''):
        import numpy as np
        import torch
        state = parse_crop_state(crop_state)
        def read_image(raw):
            with Image.open(image_path(raw)) as original:
                img = ImageOps.exif_transpose(original)
                if img.mode == 'I':
                    img = img.point(lambda value: value * (1 / 255))
                return img.convert('RGB')
        def tensor(img):
            pixels = np.asarray(img, dtype=np.float32) / 255.0
            return torch.from_numpy(pixels).unsqueeze(0)
        original = read_image(selected_path or state['path'])
        source = original if not state or state['path'] == selected_path else read_image(state['path'])
        cropped = process_crop(source, state) if state else source
        original_tensor = tensor(original)
        return (original_tensor, tensor(cropped) if state else original_tensor)


def parse_crop_state(raw):
    if not raw:
        return None
    try:
        state = json.loads(raw)
        if not isinstance(state, dict) or not isinstance(state.get('path'), str) or not state['path']:
            raise ValueError()
        size, box = state['size'], state['box']
        if len(size) != 2 or len(box) != 4 or any(type(v) is not int for v in [*size, *box]):
            raise ValueError()
        w, h = size
        x, y, right, bottom = box
        if not (w > 0 and h > 0 and 0 <= x < right <= w and 0 <= y < bottom <= h):
            raise ValueError()
        limit = state.get('max_edge', 0)
        if type(limit) is not int or not 0 <= limit <= 32768:
            raise ValueError()
        return state
    except (ValueError, TypeError, KeyError):
        raise ValueError('크롭 설정이 잘못되었습니다. 이미지를 다시 불러오세요.') from None


def process_crop(image, state):
    if list(image.size) != state['size']:
        raise ValueError('불러온 뒤 원본 해상도가 바뀌었습니다. 크롭 이미지를 다시 불러오세요.')
    result = image.crop(tuple(state['box']))
    limit = state.get('max_edge', 0)
    if limit and max(result.size) > limit:
        scale = limit / max(result.size)
        size = tuple(max(1, math.floor(v * scale + 0.5)) for v in result.size)
        result = result.resize(size, Image.Resampling.LANCZOS)
    return result


NODE_CLASS_MAPPINGS['Healingarty/ImageBrowser'] = HealingartyImageBrowser
NODE_DISPLAY_NAME_MAPPINGS['Healingarty/ImageBrowser'] = 'Healingarty Image Browser — Drag, Drop & Select'



def large_preview(raw):
    path = image_path(raw)
    with Image.open(path) as original:
        img = ImageOps.exif_transpose(original)
        width, height = img.size
        img.thumbnail((2048, 2048))
        buffer = io.BytesIO()
        img.convert('RGB').save(buffer, 'JPEG', quality=92)
    return buffer.getvalue(), width, height


@routes.get('/healingarty/browser/preview')
async def get_large_preview(request):
    data, width, height = await guarded(large_preview, request.query.get('path', ''))
    return web.Response(body=data, content_type='image/jpeg', headers={'X-Image-Width': str(width), 'X-Image-Height': str(height), 'Cache-Control': 'no-store'})
