"""Execution-scoped UI events, routed to the executing Comfy client only."""
import logging
import sys
from uuid import uuid4

LOG=logging.getLogger('h3_continuum_ez')


class GenerationProgress:
    def __init__(self,timeline,engine_id=None):
        self.timeline=timeline;self.engine_id=engine_id;self.run_id=uuid4().hex;self.seq=0
        module=sys.modules.get('server')
        self.server=getattr(getattr(module,'PromptServer',None),'instance',None)
        self.client=getattr(self.server,'client_id',None)

    def __call__(self,event,**data):
        self.seq+=1
        value={'event':event,'run_id':self.run_id,'seq':self.seq,
               'node_id':self.timeline.get('node_id'),'engine_id':self.engine_id,**data}
        if event=='start':value['plan']=self.timeline.get('source_plan',self.timeline.get('plan'))
        if self.server is not None and self.client is not None:
            try:self.server.send_sync('h3ez_progress',value,self.client)
            except Exception:LOG.debug('Progress client unavailable',exc_info=True)
        return value
