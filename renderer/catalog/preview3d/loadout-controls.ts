import { Vector3 } from 'three';
import type { HeroViewer } from 'dota-loadout';
import type { StudioView } from './studio-settings.ts';
export function loadoutView(viewer:HeroViewer):StudioView{return{yaw:viewer.turn.target,tilt:viewer.view.pitch,zoom:viewer.view.zoomTarget,target:viewer.view.center.toArray()};}
export function restoreLoadoutView(viewer:HeroViewer,state:StudioView):void{
  viewer.turn.angle=viewer.turn.target=state.yaw;viewer.turn.velocity=0;
  viewer.view.pitch=state.tilt;viewer.view.zoom=viewer.view.zoomTarget=state.zoom;viewer.view.center.fromArray(state.target);viewer.place();
}
/** Normalized WASD/QE motion and right-button panning stay local to the canvas. */
export function loadoutControls(viewer:HeroViewer){
  const canvas=viewer.canvas,keys=new Set<string>();let pan:{x:number;y:number;id:number}|null=null;
  const key=(e:KeyboardEvent,down:boolean)=>{if(!['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code))return;if(down)keys.add(e.code);else keys.delete(e.code);e.preventDefault();};
  const down=(e:KeyboardEvent)=>key(e,true),up=(e:KeyboardEvent)=>key(e,false),blur=()=>{keys.clear();pan=null;};
  const pointer=(e:PointerEvent)=>{canvas.focus({preventScroll:true});if(e.button===2){pan={x:e.clientX,y:e.clientY,id:e.pointerId};canvas.setPointerCapture(e.pointerId);e.preventDefault();}};
  const move=(e:PointerEvent)=>{if(!pan)return;const scale=viewer.view.distance/viewer.view.zoom/Math.max(1,canvas.clientHeight);const right=new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld,0),up=new Vector3().setFromMatrixColumn(viewer.camera.matrixWorld,1);viewer.view.center.addScaledVector(right,(pan.x-e.clientX)*scale).addScaledVector(up,(e.clientY-pan.y)*scale);pan.x=e.clientX;pan.y=e.clientY;viewer.place();};
  const end=()=>{pan=null;},context=(e:Event)=>e.preventDefault();
  canvas.tabIndex=0;canvas.addEventListener('keydown',down);canvas.addEventListener('keyup',up);canvas.addEventListener('blur',blur);canvas.addEventListener('pointerdown',pointer);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('contextmenu',context);window.addEventListener('blur',blur);
  return {tick(dt:number){
    if(!keys.size)return;
    const delta=new Vector3(Number(keys.has('KeyD'))-Number(keys.has('KeyA')),Number(keys.has('KeyE'))-Number(keys.has('KeyQ')),Number(keys.has('KeyS'))-Number(keys.has('KeyW')));
    if(!delta.lengthSq())return;delta.normalize().applyQuaternion(viewer.camera.quaternion);
    const speed=Math.max(1,viewer.view.distance*.3)*(keys.has('ShiftLeft')||keys.has('ShiftRight')?3:1);
    viewer.view.center.addScaledVector(delta,Math.min(dt,.1)*speed);viewer.place();
  },dispose(){blur();canvas.removeEventListener('keydown',down);canvas.removeEventListener('keyup',up);canvas.removeEventListener('blur',blur);canvas.removeEventListener('pointerdown',pointer);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',end);canvas.removeEventListener('pointercancel',end);canvas.removeEventListener('contextmenu',context);window.removeEventListener('blur',blur);}};
}
