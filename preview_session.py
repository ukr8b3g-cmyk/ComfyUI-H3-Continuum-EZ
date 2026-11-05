"""Bounded audiovisual proxies and persistent, sparse result thumbnails."""
from pathlib import Path
from uuid import uuid4
import json,logging,os,re,time,threading
import torch
from .stream_video import StreamVideo

NAMESPACE='h3_continuum_ez_previews'
OWNER='h3ez-preview-v1'
TTL=24*3600
QUOTA=2*1024**3
RUN_QUOTA=512*1024**2
LOCK=threading.RLock()
LOG=logging.getLogger('h3_continuum_ez')
FILE_RE=re.compile(r'EZ_[0-9a-f]{32}(?:\.partial)?\.mp4$')


def preview_root(temp_root):return Path(temp_root)/NAMESPACE


def _runs(temp_root):
    root=preview_root(temp_root)
    if not root.is_dir() or root.is_symlink():return []
    found=[]
    for folder in root.iterdir():
        if not re.fullmatch(r'[0-9a-f]{32}',folder.name) or folder.is_symlink() or not folder.is_dir():continue
        if folder.resolve().parent!=root.resolve():continue
        marker=folder/'owner.json'
        try:
            if marker.is_symlink():continue
            data=json.loads(marker.read_text())
            if data.get('owner')!=OWNER:continue
            files=list(folder.iterdir())
            if any(f.is_symlink() or not f.is_file() or (f.name!='owner.json' and not FILE_RE.fullmatch(f.name)) for f in files):continue
            active=bool(data.get('active',True))
            if active:
                try:
                    import psutil
                    proc=psutil.Process(int(data['pid']))
                    active=abs(proc.create_time()-float(data['process_start']))<1
                except (ImportError,KeyError,ValueError,PermissionError):pass
                except Exception as exc:
                    if type(exc).__name__ in ('NoSuchProcess','ZombieProcess'):active=False
            found.append({'folder':folder,'files':files,'bytes':sum(f.stat().st_size for f in files),
                          'active':active,'time':float(data['time'])})
        except (OSError,ValueError,TypeError):continue
    return found


def preview_status(temp_root):
    with LOCK:
        rows=_runs(temp_root)
        return {'path':str(preview_root(temp_root)),'bytes':sum(r['bytes'] for r in rows),
                'active_bytes':sum(r['bytes'] for r in rows if r['active']),
                'inactive_bytes':sum(r['bytes'] for r in rows if not r['active']), 'ttl_hours':24}


def collect_previews(temp_root,*,force=False,now=None):
    now=time.time() if now is None else now
    with LOCK:
        rows=sorted(_runs(temp_root),key=lambda x:x['time']);total=sum(r['bytes'] for r in rows);deleted=0
        for row in rows:
            if row['active'] or not (force or now-row['time']>TTL or total>QUOTA):continue
            # Only direct, validated owned files. Never recursively traverse directories.
            for file in row['files']:file.unlink(missing_ok=True)
            row['folder'].rmdir();total-=row['bytes'];deleted+=row['bytes']
        return deleted


class PreviewSession:
    def __init__(self,temp_root,output_root,run_id=None):
        self.temp_root=Path(temp_root) if temp_root else None
        self.output_root=Path(output_root) if output_root else None
        self.run_id=run_id or uuid4().hex
        if not re.fullmatch(r'[0-9a-f]{32}',self.run_id):raise ValueError('Invalid preview run id')
        self.folder=None;self.owner=None;self.filmstrip=[];self.bytes=0;self.disabled=False

    def _begin(self):
        if self.folder is not None or self.temp_root is None:return
        collect_previews(self.temp_root)
        root=preview_root(self.temp_root)
        if root.is_symlink():raise OSError('Preview folder must not be a symlink')
        self.folder=root/self.run_id
        self.folder.mkdir(parents=True,exist_ok=False)
        self.owner={'owner':OWNER,'pid':os.getpid(),'active':True,'time':time.time()}
        try:
            import psutil
            self.owner['process_start']=psutil.Process().create_time()
        except ImportError:pass
        (self.folder/'owner.json').write_text(json.dumps(self.owner))

    @staticmethod
    def _small(image):
        h,w=image.shape[:2];scale=min(1.,512/max(h,w))
        width,height=max(2,int(w*scale)//2*2),max(2,int(h*scale)//2*2)
        if (height,width)==(h,w):return image
        return torch.nn.functional.interpolate(image.movedim(-1,0).unsqueeze(0),size=(height,width),mode='bilinear',align_corners=False)[0].movedim(0,-1)

    def append(self,images,audio,part,shot_geometry,cancel):
        if self.disabled:return {}
        result={}
        try:
            # Five fixed times per logical shot, independent of the number of parts.
            from PIL import Image
            if self.output_root is not None:
                folder=self.output_root/'h3_continuum_ez';folder.mkdir(parents=True,exist_ok=True)
                g=shot_geometry
                targets=sorted(set(g['start_frame']+round(i*(g['frames']-1)/4) for i in range(5)))
                for frame in targets:
                    if part['start_frame']<=frame<part['start_frame']+part['frames']:
                        cancel();small=self._small(images[frame-part['start_frame']])
                        pixels=(small[...,:3]*255).clamp(0,255).to(dtype=torch.uint8,device='cpu').numpy()
                        name=f'EZ_{self.run_id}_s{g["index"]}_f{frame}.jpg';pending=folder/(name+'.partial')
                        try:
                            Image.fromarray(pixels).save(pending,format='JPEG',quality=78)
                            pending.replace(folder/name)
                        finally:pending.unlink(missing_ok=True)
                        item={'filename':name,'subfolder':'h3_continuum_ez','type':'output','shot_id':part['shot_id'],'time':frame/24}
                        self.filmstrip.append(item);result.setdefault('thumbnails',[]).append(item)
            if self.temp_root is not None and self.bytes<RUN_QUOTA:
                self._begin();sample=self._small(images[0]);height,width=sample.shape[:2]
                sub=f'{NAMESPACE}/{self.run_id}'
                with StreamVideo(self.temp_root,width,height,24,cancel,subfolder=sub,preset='ultrafast',crf='28',file_type='temp') as writer:
                    writer.configure_audio(int(audio['sample_rate']),int(audio['waveform'].shape[1]))
                    writer.append(self._small(frame) for frame in images)
                    record=writer.finish(audio,len(images));self.bytes+=writer.path.stat().st_size
                result['clip']={**record,'start':part['start'],'end':part['end'],'shot_id':part['shot_id'],'part_index':part['part_index']}
            elif self.temp_root is not None:result['preview_warning']='Preview proxy quota reached; final output continues.'
        except Exception as exc:
            # Cancellation must remain cancellation, including Core's non-standard exception type.
            cancel()
            self.disabled=True;result['preview_warning']=str(exc)
            LOG.warning('Intermediate preview unavailable; final output continues: %s',exc)
        return result

    def close(self):
        if self.folder is not None and self.owner is not None:
            try:
                self.owner.update(active=False,time=time.time())
                (self.folder/'owner.json').write_text(json.dumps(self.owner))
                collect_previews(self.temp_root)
            except OSError:LOG.warning('Preview cleanup deferred',exc_info=True)

    def __enter__(self):return self
    def __exit__(self,*args):self.close()
