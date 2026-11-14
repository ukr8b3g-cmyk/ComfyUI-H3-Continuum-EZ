import wave
from contextlib import contextmanager

import numpy as np
import pytest
from h3ezstudio.audio_probe import inspect_audio
from h3ezstudio.media import open_media_input
from h3ezstudio.plan import normalize_plan,default_plan,PlanError

def test_streamed_audio_metadata_is_not_clamped_to_video(tmp_path):
    path=tmp_path/'tone.wav'
    with wave.open(str(path),'wb')as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes((np.sin(np.arange(17*8000)*.1)*10000).astype('<i2').tobytes())
    info=inspect_audio({'name':path.name,'type':'input'},tmp_path)
    assert info['duration']==17 and max(info['peaks'])>0 and len(info['peaks'])<=2048
    p=default_plan();p['assets']=[{'id':'a','kind':'audio','duration':17,'file':{'name':path.name,'type':'input'}}];p['audio']=[{'id':'c','asset_id':'a','start':0,'source_in':0,'duration':17}]
    assert normalize_plan(p)['audio'][0]['duration']==17

def test_audio_metadata_cannot_escape_input_root(tmp_path):
    with pytest.raises((PlanError,ValueError,OSError)):inspect_audio({'name':'../outside.wav','type':'input'},tmp_path)


def test_media_input_provides_only_the_opened_stream(tmp_path, monkeypatch):
    import av

    source_path = tmp_path / 'primary.wav'
    source_path.write_bytes(b'fixture')
    container = object()

    @contextmanager
    def open_container(source, *, mode, container_options, io_open):
        assert mode == 'r'
        assert source.seekable()
        assert source.read() == b'fixture'
        assert container_options['protocol_whitelist'] == ''
        for reference in ('another.wav', 'https://example.invalid/audio.wav'):
            with pytest.raises(PermissionError, match='contain their own streams'):
                io_open(reference, 1, {})
        yield container

    monkeypatch.setattr(av, 'open', open_container)
    with open_media_input(source_path) as opened:
        assert opened is container
