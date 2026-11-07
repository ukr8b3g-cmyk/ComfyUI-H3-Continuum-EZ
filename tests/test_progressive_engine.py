"""Real Core, PyAV and disk buffers; model/sampler/VAE stay CPU fixtures."""
import copy,json,sys,types,wave
from contextlib import ExitStack
import av,numpy as np,pytest,torch
from PIL import Image
from .test_engine_boundary import runtime
from .test_storage_output import scratch
from h3ezstudio.plan import default_plan,shot_geometry,execution_plan
from h3ezstudio.media import render_original_audio
from h3ezstudio.preview_session import PreviewSession,preview_status,collect_previews
from h3ezstudio.progress import GenerationProgress
from h3ezstudio.vendor.continuum.v2.seeds import derive_chunk_seed


def test_long_shot_bounds_end_image_dialogue_and_next_shot_seed(runtime,scratch,tmp_path):
    eng,M,C,V,events,records=runtime;p=default_plan();p['chunking']={'enabled':True,'seconds':5};p['shots'][0].update(seconds=60,last_image='end')
    p['shots'].append({**copy.deepcopy(p['shots'][0]),'id':'second','seconds':5,'last_image':None,'transition':'continue'})
    for name,color in [('start',(250,0,0)),('end',(0,250,0)),('person',(0,0,250))]:
        Image.new('RGB',(96,64),color).save(tmp_path/(name+'.png'))
        p['assets'].append(dict(id=name,kind='image',label=name,file=dict(name=name+'.png',subfolder='',type='input')))
    p['first_image']='start';p['reference_slots'][0]='person';p['global_refs']=[1]
    p['assets'][-1]['subject_name']='女性';p['shots'][0]['dialogue']=[dict(speaker='person',text='そのまま進もう。',at=30)]
    emitted=[]
    result=eng.run_engine(model=M(),clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),sigmas=torch.tensor([1.,0.]),timeline={'plan':p},seed=123,width=64,height=32,input_root=tmp_path,buffer_backend='Disk-backed',progress=lambda event,**kw:emitted.append((event,kw)))
    parts=execution_plan(p)
    assert len(records)==len(parts)>2
    assert [e for e in events if e in ('sample','video_decode')]==['sample','video_decode']*len(parts)
    assert sum(g['frames'] for g in shot_geometry(p))==result[0].shape[0]
    assert records[0]['seed']==derive_chunk_seed(123,0,0)
    assert records[-1]['seed']==derive_chunk_seed(123,1,0)
    texts=[r['cond']['positive'][0][1]['fixture_prompt'] for r in records]
    assert sum('そのまま進もう。' in text for text in texts)==1
    terminal=parts[-2]
    for i,(rec,part) in enumerate(zip(records,parts)):
        cond=rec['cond']['positive'][0][1]
        frame_latent=rec['latent'].unbind()[0]
        from h3ezstudio.vendor.continuum.temporal import pixel_frames_for_latent_t
        physical=pixel_frames_for_latent_t(frame_latent.shape[2]);assert physical<=158
        keys=cond.get('minimax_keyframes',[])
        if part is terminal:
            assert len(keys)==1 and keys[0]['resolved_frame_index']==physical-1
            assert 'composition in <Picture 2>' in texts[i]
            assert '"女性" refers to the subject shown in <Picture 3>' in texts[i]
        elif i>0:assert not keys
    assert [e for e,data in emitted].count('part_complete')==len(parts)


def test_original_audio_stream_and_part_guide_are_bounded(runtime,scratch,tmp_path,monkeypatch):
    eng,M,C,V,events,records=runtime;p=default_plan();p['chunking']={'enabled':True,'seconds':5};p['shots'][0]['seconds']=30
    rate=32000;count=31*rate
    samples=(np.sin(np.arange(count)*2*np.pi*220/rate)*1000).astype('<i2')
    with wave.open(str(tmp_path/'voice.wav'),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(samples.tobytes())
    p['assets']=[dict(id='voice',kind='audio',label='voice',duration=31,file=dict(name='voice.wav',subfolder='',type='input'))]
    p['audio']=[dict(id='c',asset_id='voice',start=0,source_in=1,duration=30)]
    frames=sum(g['frames'] for g in shot_geometry(p))
    with ExitStack() as stack:
        bounded=render_original_audio(p,tmp_path,frames,stack=stack)
        reference=render_original_audio(p,tmp_path,frames)
        assert torch.equal(bounded['waveform'],reference['waveform'])
    original=eng.prepare_driving_audio_source;lengths=[]
    def checked(audio,*args,**kw):lengths.append(audio['waveform'].shape[-1]);return original(audio,*args,**kw)
    monkeypatch.setattr(eng,'prepare_driving_audio_source',checked)
    result=eng.run_engine(model=M(),clip=C(),video_vae=V(),audio_vae=V(True),sampler=object(),sigmas=torch.tensor([1.,0.]),timeline={'plan':p},seed=1,width=64,height=32,input_root=tmp_path,buffer_backend='Disk-backed')
    assert max(lengths)<=round(158*rate/24) and len(lengths)>1
    assert 'audio_decode' not in events
    assert torch.equal(result[1]['waveform'],reference['waveform'])


def test_playable_proxies_filmstrip_and_owned_cleanup(tmp_path):
    p=default_plan();p['shots'][0]['seconds']=16;gs=shot_geometry(p);parts=execution_plan(p)
    with PreviewSession(tmp_path/'temp',tmp_path/'out') as session:
        for part in parts:
            images=torch.full((part['frames'],32,64,3),.4)
            audio=dict(sample_rate=32000,waveform=torch.full((1,2,round(part['end']*32000)-round(part['start']*32000)),.02))
            record=session.append(images,audio,part,gs[0],lambda:None)
            assert 'preview_warning' not in record
            c=record['clip'];path=tmp_path/'temp'/c['subfolder']/c['filename']
            with av.open(str(path)) as container:assert sum(1 for _ in container.decode(video=0))==part['frames']
            with av.open(str(path)) as container:
                n=sum(f.samples for f in container.decode(audio=0));assert abs(n-audio['waveform'].shape[-1])<=2048
        assert len(session.filmstrip)==5
        assert preview_status(tmp_path/'temp')['active_bytes']>0
        assert collect_previews(tmp_path/'temp',force=True)==0
        folder=session.folder
    assert preview_status(tmp_path/'temp')['inactive_bytes']>0
    unowned=folder.parent/('a'*32);unowned.mkdir();(unowned/'keep.txt').write_text('protected')
    assert collect_previews(tmp_path/'temp',force=True)>0
    assert not folder.exists() and (unowned/'keep.txt').exists()
    assert len(list((tmp_path/'out'/'h3_continuum_ez').glob('*.jpg')))==5


def test_progress_routes_to_only_executing_client(monkeypatch):
    sent=[];server=types.SimpleNamespace(client_id='client',send_sync=lambda *args:sent.append(args))
    monkeypatch.setitem(sys.modules,'server',types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=server)))
    progress=GenerationProgress({'node_id':'12:7','plan':default_plan()},'12:8')
    progress('start');progress('sampling',shot_id='s',part_index=0)
    assert [x[1]['seq'] for x in sent]==[1,2]
    assert all(x[2]=='client' and x[1]['node_id']=='12:7' for x in sent)
    server.client_id=None;GenerationProgress({})('start');assert len(sent)==2


def test_preview_error_does_not_break_final_generation_and_cancel_propagates(tmp_path,monkeypatch):
    from h3ezstudio import preview_session
    p=default_plan();part=execution_plan(p)[0];g=shot_geometry(p)[0]
    images=torch.zeros(part['frames'],32,64,3);audio={'waveform':torch.zeros(1,2,165333),'sample_rate':32000}
    def broken(*args,**kwargs):raise OSError('fixture disk full')
    monkeypatch.setattr(preview_session,'StreamVideo',broken)
    with PreviewSession(tmp_path/'temp',tmp_path/'out') as session:
        record=session.append(images,audio,part,g,lambda:None)
        assert 'preview_warning' in record and not record.get('clip')
        assert len(record['thumbnails'])==5
    assert preview_status(tmp_path/'temp')['active_bytes']==0
    def cancelled():raise InterruptedError('fixture stop')
    with PreviewSession(tmp_path/'temp',tmp_path/'out') as session:
        with pytest.raises(InterruptedError):session.append(images,audio,part,g,cancelled)


def test_proxy_ttl_and_unknown_files_are_protected(tmp_path):
    import time
    from h3ezstudio.preview_session import TTL
    with PreviewSession(tmp_path,tmp_path/'output') as session:session._begin();folder=session.folder
    assert collect_previews(tmp_path,now=time.time()+TTL+1)>0
    assert not folder.exists()
    with PreviewSession(tmp_path,tmp_path/'output') as session:
        session._begin();folder=session.folder;(folder/'user-data.txt').write_text('keep')
    assert collect_previews(tmp_path,force=True)==0 and folder.exists()


def test_node_failure_marks_progress_without_publishing_result(tmp_path,monkeypatch):
    from h3ezstudio import engine
    from h3ezstudio.ez_nodes import H3ContinuumEZEngine
    sent=[];server=types.SimpleNamespace(client_id='client',send_sync=lambda name,event,client:sent.append(event))
    monkeypatch.setitem(sys.modules,'server',types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=server)))
    monkeypatch.setitem(sys.modules,'folder_paths',types.SimpleNamespace(get_input_directory=lambda:tmp_path,get_output_directory=lambda:tmp_path/'out',get_temp_directory=lambda:tmp_path/'temp'))
    def fail(**kw):kw['progress']('start');raise InterruptedError('fixture cancel')
    monkeypatch.setattr(engine,'run_engine',fail)
    with pytest.raises(InterruptedError):H3ContinuumEZEngine().generate(timeline={'plan':default_plan(),'node_id':'3'},unique_id='4')
    assert [x['event'] for x in sent]==['start','interrupted']
    assert not list(tmp_path.rglob('*.mp4'))
