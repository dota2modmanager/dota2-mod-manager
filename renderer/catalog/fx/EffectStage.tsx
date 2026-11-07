/* The recolor editor uses the same dota-loadout renderer as the dressed hero. */
import { useEffect, useRef, useState } from 'react';
import { effectCarrier } from '../preview3d/loadout-source.ts';
import type { HeroScene } from '../preview3d/scene.ts';
import type { ParticleDef, LoadoutResources } from '../../api/preview3d.ts';

export function hasSprites(def:ParticleDef):boolean {
  const renderers=Array.isArray(def.tree.m_Renderers)?def.tree.m_Renderers:[];
  return renderers.some(r=>r&&typeof r==='object'&&!Array.isArray(r)&&/^C_OP_Render(Sprites|Trails|Ropes|Models|Blobs|Projected)$/.test(String(r._class)))||def.children.some(hasSprites);
}
export function EffectStage({path,defs,sprites,resources,play}:{path:string;defs:ParticleDef[];sprites:Record<string,Uint8Array>;resources?:LoadoutResources;play:number}){
  const host=useRef<HTMLDivElement>(null),scene=useRef<HeroScene|null>(null),latest=useRef(defs);
  const [error,setError]=useState(''),[issues,setIssues]=useState(0);latest.current=defs;
  useEffect(()=>{
    if(!host.current)return;
    const container=host.current,controller=new AbortController();setError('');setIssues(0);
    void import('../preview3d/scene.ts').then(({mountScene})=>mountScene(container,effectCarrier(),[],{signal:controller.signal,isolated:true,label:L`Предпросмотр эффекта`,sprites,resources,
      particles:latest.current.map(def=>({part:-1,def})),onWarnings:w=>{if(!controller.signal.aborted)setIssues(w.length);},
    })).then(async active=>{if(controller.signal.aborted){active.dispose();return;}scene.current=active;await active.effects(latest.current.map(def=>({part:-1,def})));}).catch(e=>{if(!controller.signal.aborted)setError(String(e));});
    return()=>{controller.abort();scene.current=null;};
  },[path,sprites,resources]);
  useEffect(()=>{void scene.current?.effects(defs.map(def=>({part:-1,def}))).catch(e=>{if(e.name!=='AbortError')setError(String(e));});},[defs,play]);
  return <><div ref={host} className="fx-canvas" />
    {error&&<div className="fx-preview-status" role="alert">{L`Не удалось открыть 3D`}: {error}</div>}
    {!error&&issues>0&&<div className="fx-preview-status">{L`Часть эффекта пока не поддерживается`}</div>}
  </>;
}
