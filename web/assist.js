// Own only the auxiliary text job. Never alter the user's graph or interrupt
// another queue item. Core performs inference, allocation, caching and offload.
import {canonical,dependencyPayload,validateCandidate,DEFAULT_MODEL,setEnhancer,SHOT_ONLY_CONTRACT} from './enhancer.js';
const PREFIX='/h3-continuum-ez/assist';
export class AssistCancelled extends Error {constructor(message='Candidate request invalidated / 候補を無効化しました'){super(message);this.name='AssistCancelled';}}
export class AssistClient {
  constructor({api,getState,onStatus=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),pollMs=900,maxPolls=4000,explicitRequests=false}){
    this.api=api;this.getState=getState;this.onStatus=onStatus;this.sleep=sleep;this.pollMs=pollMs;this.maxPolls=maxPolls;
    this.epoch=0;this.active=null;this.closed=false;this.lastEnabled=!!getState().plan.prompt_enhancer?.enabled;
    this.cache=new Map();this.cacheBytes=0;this.uncertain=null;
    this.explicitRequests=explicitRequests;
  }
  _status(phase,detail='',extra={}){if(!this.closed)this.onStatus({phase,detail,...extra});}
  _emit(ticket,phase,detail='',extra={}){if(ticket.epoch===this.epoch&&!ticket.invalid)this._status(phase,detail,{target:ticket.target,...extra});}
  _state(){const s=this.getState();if(this.closed||s.alive===false)throw new AssistCancelled();return s;}
  _enabled(){const s=this._state();if(!this.explicitRequests&&s.plan.prompt_enhancer?.enabled!==true)throw new Error('Prompt enhancer is OFF / プロンプトエンハンサーはOFFです');return s;}
  _requestPlan(s){const p=JSON.parse(JSON.stringify(s.plan));if(this.explicitRequests)setEnhancer(p,true);return p;}
  _identity(state){return canonical(state.identity??{});}
  _assert(ticket){
    const s=this._state();
    if((!this.explicitRequests&&s.plan.prompt_enhancer?.enabled!==true)||this.epoch!==ticket.epoch||this._identity(s)!==ticket.identity)throw new AssistCancelled();
    let current;try{current=canonical(dependencyPayload(s.plan,ticket.target,s.external??null,ticket.contract,ticket.includeCommon));}catch{throw new AssistCancelled();}
    if(current!==ticket.dependency)throw new AssistCancelled('Input changed; candidate is stale / 入力条件が変更されたため候補を無効化しました');
    return s;
  }
  async _json(path,options={}){
    if(!this.api?.fetchApi)throw new Error('ComfyUI API is not connected / ComfyUI APIに接続できません');
    const response=await this.api.fetchApi(path,options);
    let data;try{data=await response.json();}catch{throw new Error(`Invalid server response (${response.status}) / サーバー応答を読み取れません`);}
    if(!response.ok){const error=new Error(typeof data.error==='string'?data.error:data.error?.message||`HTTP ${response.status}: ${JSON.stringify(data.node_errors||data).slice(0,600)}`);error.status=response.status;throw error;}
    return data;
  }
  _post(path,data){return this._json(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
  async capabilities(){this._enabled();const value=await this._post(PREFIX+'/capabilities',{enabled:true});this._enabled();return value;}
  async preflight(plan){this._state();return this._post(PREFIX+'/preflight',{plan});}
  sync(){
    if(this.closed)return;
    const s=this.getState(),enabled=s.plan.prompt_enhancer?.enabled===true;
    if(!this.explicitRequests&&this.lastEnabled&&!enabled)this.invalidate('off');
    this.lastEnabled=enabled;
    if(this.active){try{this._assert(this.active);}catch{this.invalidate('stale');}}
  }
  invalidate(reason='cancelled'){
    this.epoch++;const old=this.active;this.active=null;
    if(old){old.invalid=true;void this._removeWaiting(old);}
    this._status(reason,'',{target:old?.target});
  }
  async _removeWaiting(ticket){
    if(!ticket.promptId)return;
    try{
      const queue=await this._json('/queue');
      // Exact prompt ID AND our unguessable output ID, not a positional index.
      const own=(queue.queue_pending||[]).find(x=>x?.[1]===ticket.promptId&&x?.[2]?.[ticket.outputId]);
      if(own)await this._post('/queue',{delete:[ticket.promptId]});
    }catch{/* No global interrupt fallback; the result is still invalidated. */}
  }
  generate({target,imageId=null,model=null,refresh=false}){
    let s;try{s=this._enabled();}catch(e){return Promise.reject(e);}
    if(this.uncertain)return Promise.reject(new Error('Submission is unconfirmed. Check the ComfyUI queue/history before requesting again / 受付不明です。ComfyUIのキュー・履歴を確認してください'));
    const contract=this.explicitRequests&&target.field==='prompt'?SHOT_ONLY_CONTRACT:undefined;
    if(s.externalUnknown&&!contract&&(target.field==='global_prompt'||s.plan.shots.find(x=>x.id===target.shot_id)?.prompt_mode!=='replace'))return Promise.reject(new Error('External text has not executed. Select Studio text or first resolve the external input / 外部入力が未確定です。Studio原文へ切り替えるか外部入力を先に確定してください'));
    const dependency=canonical(dependencyPayload(s.plan,target,s.external??null,contract)),identity=this._identity(s);
    const canvasModel=s.identity?.canvasModel;
    if(canvasModel==='')return Promise.reject(new Error('Select the model in the workflow Load CLIP node / ワークフローのLoad CLIPでモデルを選んでください'));
    model=canvasModel??(model||s.plan.prompt_enhancer?.model||DEFAULT_MODEL);
    const key=canonical({dependency,identity,target,imageId,model});
    if(this.active){if(this.active.key===key)return this.active.promise;return Promise.reject(new Error('Another text request is in progress / 別の文章候補を生成中です'));}
    const ticket={epoch:this.epoch,target:{...target},dependency,identity,key,contract,promptId:null,outputId:null,invalid:false,refresh};
    this.active=ticket;
    const body={plan:this._requestPlan(s),target:{...target},external_prompt:s.external??null,image_id:imageId,model};
    if(contract)body.contract=contract;
    if(s.identity?.canvasLoader)body.loader={type:s.identity.canvasLoader.type,device:s.identity.canvasLoader.device};
    ticket.promise=this._run(ticket,body).finally(()=>{if(this.active===ticket)this.active=null;});
    return ticket.promise;
  }
  async _run(ticket,body){
    try{
      this._emit(ticket,'preparing');
      let prepared;
      try{prepared=await this._post(PREFIX+'/prepare',body);}
      catch(error){
        if(ticket.contract&&error.status===400&&error.message==='Invalid AI request fields'){
          throw new Error('Restart ComfyUI to finish the AI update. / AI機能の更新を反映するにはComfyUIを再起動してください。');
        }
        throw error;
      }
      this._assert(ticket);
      if(!prepared.graph||typeof prepared.output_id!=='string'||!prepared.receipt||typeof prepared.request_id!=='string')throw new Error('Invalid AI preparation response');
      if(ticket.contract&&prepared.receipt.dependencies?.contract!==ticket.contract)throw new Error('Unexpected AI prompt scope');
      ticket.outputId=prepared.output_id;ticket.prepared=prepared;
      const cached=ticket.refresh?null:this.cache.get(prepared.cache_key);
      if(cached){this.cache.delete(prepared.cache_key);this.cache.set(prepared.cache_key,cached);this._emit(ticket,'ready','', {cached:true});return {...cached.value,ticket,receipt:prepared.receipt};}
      this._emit(ticket,'submitting');
      let acknowledgement;
      try{
        acknowledgement=await this._post('/prompt',{prompt:prepared.graph,
          ...(this.api.clientId?{client_id:this.api.clientId}:{}),
          extra_data:{h3ez_assist:{request_id:prepared.request_id,kind:'prompt-enhancer'}}});
      }catch(error){
        // A definitive HTTP rejection is not an uncertain submission.
        if(error.status>=400&&error.status<500)throw error;
        // Never blindly resubmit after losing an acknowledgement.
        const id=await this._recoverSubmitted(ticket);
        if(!id){this.uncertain=ticket;this._emit(ticket,'unconfirmed',String(error.message));throw error;}
        acknowledgement={prompt_id:id};
      }
      if(typeof acknowledgement.prompt_id!=='string'){this.uncertain=ticket;throw new Error('Submission unconfirmed: ComfyUI returned no prompt_id. Check queue/history before retrying.');}
      ticket.promptId=acknowledgement.prompt_id;
      try{this._assert(ticket);}catch(error){await this._removeWaiting(ticket);throw error;}
      this._emit(ticket,'queued','',{promptId:ticket.promptId});
      const text=await this._poll(ticket);this._assert(ticket);
      const result={text:validateCandidate(text),receipt:prepared.receipt,cacheKey:prepared.cache_key};
      this._cache(prepared.cache_key,result);this._emit(ticket,'ready');return {...result,ticket};
    }catch(error){
      if(error instanceof AssistCancelled){this._emit(ticket,'stale',error.message);await this._removeWaiting(ticket);}
      else if(!this.uncertain&&!this.closed)this._emit(ticket,'error',String(error.message||error));
      throw error;
    }
  }
  async _recoverSubmitted(ticket){
    try{
      const q=await this._json('/queue');
      for(const item of [...(q.queue_running||[]),...(q.queue_pending||[])])if(item?.[2]?.[ticket.outputId]&&typeof item[1]==='string')return item[1];
      const history=await this._json('/history?max_items=20');
      for(const [id,value] of Object.entries(history||{}))if(value?.outputs?.[ticket.outputId]||value?.prompt?.[2]?.[ticket.outputId])return id;
    }catch{/* Remain unconfirmed instead of duplicating a request. */}
    return null;
  }
  async _poll(ticket){
    let failures=0;
    for(let i=0;i<this.maxPolls;i++){
      this._assert(ticket);
      let all;
      try{all=await this._json('/history/'+encodeURIComponent(ticket.promptId));failures=0;}
      catch(error){if(++failures>=3)throw error;await this.sleep(this.pollMs);continue;}
      this._assert(ticket);
      const record=all?.[ticket.promptId];
      if(record){
        const output=record.outputs?.[ticket.outputId]?.text;
        if(output!==undefined){const text=Array.isArray(output)?output[0]:output;if(typeof text!=='string')throw new Error('Invalid generated_text output');return text;}
        const error=(record.status?.messages||[]).find(x=>['execution_error','execution_interrupted'].includes(x?.[0]));
        if(error)throw new Error(error[1]?.exception_message||'AI job stopped / AIジョブが停止しました');
        if(record.status?.completed||record.status?.status_str==='error')throw new Error('AI completed without candidate text / AI本文を取得できませんでした');
      }
      if(i===0||i%5===0){
        try{const q=await this._json('/queue');this._assert(ticket);if((q.queue_running||[]).some(x=>x[1]===ticket.promptId))this._emit(ticket,'running');}catch(error){if(error instanceof AssistCancelled)throw error;}
      }
      await this.sleep(this.pollMs);
    }
    throw new Error('Stopped waiting for AI output. Check the ComfyUI queue/history / AI結果の待機を終了しました。ComfyUIのキュー・履歴を確認してください');
  }
  async adopt(result,text=result.text){
    const s=this._assert(result.ticket);validateCandidate(text);
    const response=await this._post(PREFIX+'/adopt',{plan:this._requestPlan(s),target:result.ticket.target,
      external_prompt:s.external??null,receipt:result.receipt,candidate:text});
    this._assert(result.ticket);
    if(!response.entry)throw new Error('Missing adopted prompt entry');return response.entry;
  }
  async editAdopted(entry,text){
    const s=this._enabled();
    const contract=entry.dependencies.contract,includeCommon=Boolean(entry.dependencies.common);
    const ticket={epoch:this.epoch,target:{...entry.target},identity:this._identity(s),contract,includeCommon,
      dependency:canonical(dependencyPayload(s.plan,entry.target,s.external??null,contract,includeCommon))};
    return this.adopt({ticket,receipt:entry,text},text);
  }
  async confirmUnknownSubmission(){
    if(!this.uncertain)return true;
    const ticket=this.uncertain;
    const id=await this._recoverSubmitted(ticket);
    if(id){ticket.promptId=id;await this._removeWaiting(ticket);this.uncertain=null;return true;}
    // Do not clear an unresolved acknowledgement on an automatic timer.
    return false;
  }
  _cache(key,value){
    const bytes=canonical(value).length*2;if(bytes>2*1024*1024)return;
    if(this.cache.has(key)){this.cacheBytes-=this.cache.get(key).bytes;this.cache.delete(key);}
    this.cache.set(key,{value,bytes});this.cacheBytes+=bytes;
    while(this.cache.size>8||this.cacheBytes>2*1024*1024){const key=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(key).bytes;this.cache.delete(key);}
  }
  dispose(){if(this.closed)return;this.invalidate('cancelled');this.closed=true;this.cache.clear();this.cacheBytes=0;}
}
