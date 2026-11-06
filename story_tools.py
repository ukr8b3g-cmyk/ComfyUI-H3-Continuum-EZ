"""Deterministic authoring helpers. Never change the physical sampling plan."""
from __future__ import annotations
import math
import re

CAMERAS = {
    'static': 'Keep the camera stationary.',
    'follow': 'The camera smoothly follows the subject.',
    'dolly_in': 'Move the camera slowly closer to the subject.',
    'dolly_out': 'Move the camera slowly away from the subject.',
    'pan_left': 'Pan the camera slowly to the left.',
    'pan_right': 'Pan the camera slowly to the right.',
    'orbit': 'Move the camera slowly around the subject.',
    'close_up': 'Use close-up framing without introducing a scene cut.',
}
ROLES = {'character','outfit','background','object','style'}


def normalize_story(raw, plan):
    from .plan import shot_geometry, effective_references
    geometry=shot_geometry(plan)
    for original, shot, g in zip(raw['shots'],plan['shots'],geometry):
        camera=original.get('camera')
        if camera is not None:
            if camera not in CAMERAS: raise ValueError('Unknown camera preset')
            shot['camera']=camera
        actions=original.get('actions',[])
        if not isinstance(actions,list) or len(actions)>32: raise ValueError('At most 32 action steps per shot')
        cleaned=[]; seen=set()
        for a in actions:
            if not isinstance(a,dict) or set(a)-{'id','kind','text','at','weight'}: raise ValueError('Invalid action step')
            aid=a.get('id'); kind=a.get('kind'); text=a.get('text'); at=a.get('at'); weight=a.get('weight',1)
            if not isinstance(aid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',aid) or aid in seen: raise ValueError('Invalid or duplicate action ID')
            seen.add(aid)
            if kind not in ('event','state'): raise ValueError('Action kind must be event or state')
            if not isinstance(text,str) or len(text)>5000: raise ValueError('Action text must be at most 5000 characters')
            if type(weight) not in (int,float) or not math.isfinite(weight) or not .01<=weight<=1000: raise ValueError('Invalid action weight')
            if at is not None and (type(at) not in (int,float) or not math.isfinite(at) or not 0<=at<g['seconds']): raise ValueError('Action time is outside its shot')
            cleaned.append({'id':aid,'kind':kind,'text':text,'at':at,'weight':weight})
        if 'actions' in original: shot['actions']=cleaned
        roles=original.get('reference_roles',[])
        if not isinstance(roles,list) or len(roles)>9: raise ValueError('At most nine reference roles per shot')
        active={plan['reference_slots'][r-1] for r in effective_references(plan,shot)}
        cleaned=[];seen=set()
        for role in roles:
            if not isinstance(role,dict) or set(role)-{'asset_id','role','description'}: raise ValueError('Invalid reference role')
            aid=role.get('asset_id'); kind=role.get('role'); description=role.get('description','')
            if aid not in active or aid in seen: raise ValueError('Role image must be an active reference, without duplicates')
            if kind not in ROLES: raise ValueError('Unknown reference role')
            if not isinstance(description,str) or len(description)>2000: raise ValueError('Role description is too long')
            seen.add(aid);cleaned.append({'asset_id':aid,'role':kind,'description':description})
        if 'reference_roles' in original: shot['reference_roles']=cleaned


def action_positions(shot, geometry):
    actions=shot.get('actions',[]); total=sum(a.get('weight',1) for a in actions) or 1
    cursor=0;out=[]
    for i,action in enumerate(actions):
        frame=round(action['at']*24) if action.get('at') is not None else math.floor(cursor*geometry['frames']/total)
        out.append((min(frame,geometry['frames']-1),i,action))
        cursor+=action.get('weight',1)
    return sorted(out,key=lambda x:(x[0],x[1]))


def story_text(plan,part):
    if plan['schema']!=2: return ''
    from .plan import shot_geometry
    shot=plan['shots'][part['shot_index']];g=shot_geometry(plan)[part['shot_index']]
    sections=[]
    camera=shot.get('camera')
    if camera: sections.append(CAMERAS[camera])
    for role in shot.get('reference_roles',[]):
        slot=plan['reference_slots'].index(role['asset_id'])+1
        text=f"Use @R{slot} as the {role['role']} reference."
        if role['description']:text+=' '+role['description']
        sections.append(text)
    lo=part['start_frame']-g['start_frame'];hi=lo+part['frames']
    state=None
    positions=action_positions(shot,g)
    for frame,_,action in positions:
        if frame>=lo: break
        if action['kind']=='state' and action['text']: state=action
    if state and not any(frame==lo and a['kind']=='state' for frame,_,a in positions):
        sections.append('Continue this ongoing action: '+state['text'])
    for frame,_,action in positions:
        if lo<=frame<hi and action['text']:
            sections.append(f"About {(frame-lo)/24:.3f} seconds into the new action: {action['text']}")
    return '\n\n'.join(sections)
