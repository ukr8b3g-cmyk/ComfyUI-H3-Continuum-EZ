"""Exercise real route guards without importing a GPU model or starting a server."""
import asyncio
import json
import sys
from types import SimpleNamespace
import pytest
from aiohttp import web
from h3ezstudio.assist_api import register_routes, MAX_BODY, PREFIX
from h3ezstudio.plan import default_plan

class Routes:
    def __init__(self):self.handlers={}
    def post(self,path):
        def bind(fn):self.handlers[path]=fn;return fn
        return bind

class Content:
    def __init__(self,data):self.data=data
    async def iter_chunked(self,size):
        for start in range(0,len(self.data),size):yield self.data[start:start+size]

def request(data,**options):
    raw=json.dumps(data).encode()
    return SimpleNamespace(headers=options.get('headers',{}),host='localhost:8188',content_type=options.get('content_type','application/json'),content_length=options.get('length',len(raw)),content=Content(raw))

@pytest.fixture
def server(tmp_path,monkeypatch):
    def no_models(*_):raise AssertionError('model discovery must not execute while OFF')
    monkeypatch.setitem(sys.modules,'folder_paths',SimpleNamespace(get_input_directory=lambda:str(tmp_path),get_filename_list=no_models))
    routes=Routes();s=SimpleNamespace(routes=routes)
    register_routes(s)
    return s

def test_routes_register_once(server):
    before=dict(server.routes.handlers);register_routes(server)
    assert len(before)==5 and before==server.routes.handlers
    assert '/h3-continuum-ez/assist/media-info' in before

def test_route_off_stops_before_model_discovery(server):
    p=default_plan();body={'plan':p,'target':{'field':'prompt','shot_id':p['shots'][0]['id']}}
    response=asyncio.run(server.routes.handlers[PREFIX+'/prepare'](request(body)))
    assert response.status==400 and 'OFF' in response.text

def test_route_caps_require_explicit_enabled(server):
    response=asyncio.run(server.routes.handlers[PREFIX+'/capabilities'](request({'enabled':False})))
    assert response.status==400

@pytest.mark.parametrize('option,error',[
    ({'headers':{'Origin':'https://evil.example'}},web.HTTPForbidden),
    ({'content_type':'text/plain'},web.HTTPUnsupportedMediaType),
    ({'length':MAX_BODY+1},web.HTTPRequestEntityTooLarge),
])
def test_http_guards(server,option,error):
    with pytest.raises(error):asyncio.run(server.routes.handlers[PREFIX+'/prepare'](request({},**option)))

def test_cpu_preflight_route_works_without_model_discovery(server):
    response=asyncio.run(server.routes.handlers[PREFIX+'/preflight'](request({'plan':default_plan()})))
    assert response.status==200 and json.loads(response.text)['ok'] is True


def test_media_probe_needs_no_ai_model(server,monkeypatch):
    from h3ezstudio import audio_probe
    monkeypatch.setattr(audio_probe,'inspect_audio',lambda file,root:{'duration':60,'peaks':[]})
    response=asyncio.run(server.routes.handlers[PREFIX+'/media-info'](request({'file':{'name':'minute.mp3','type':'input'}})))
    assert response.status==200 and json.loads(response.text)['duration']==60
