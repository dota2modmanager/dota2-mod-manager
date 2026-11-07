const rgbAlpha='SPRITECARD_TEXTURE_CHANNEL_MIX_A_RGBALPHA';
export function usesRgbAlpha(channels){
 return channels==null||channels==='SPRITECARD_TEXTURE_CHANNEL_MIX_RGB'||channels==='SPRITECARD_TEXTURE_CHANNEL_MIX_RGBA';
}
export function enableDarkBlend(root,rgb){
 if(Math.max(...rgb)>16)return;
 for(const renderer of root.m_Renderers??[]){
  if(!['C_OP_RenderSprites','C_OP_RenderTrails','C_OP_RenderRopes'].includes(renderer._class)||renderer.m_nOutputBlendMode==='PARTICLE_OUTPUT_BLEND_MODE_MOD2X')continue;
  const additive=renderer.m_nOutputBlendMode==='PARTICLE_OUTPUT_BLEND_MODE_ADD';
  if(additive)delete renderer.m_nOutputBlendMode;
  if(additive||Object.hasOwn(renderer,'m_flAddSelfAmount')){
   for(const texture of renderer.m_vecTexturesInput??[])if(usesRgbAlpha(texture.m_nTextureChannels))texture.m_nTextureChannels=rgbAlpha;
  }
  if(Object.hasOwn(renderer,'m_flAddSelfAmount'))renderer.m_flAddSelfAmount=0;
 }
}

// Explicit RGB recolor must include later color operators and renderer constants.
export function forceParticleColor(root,rgb){
 const bytes=old=>[...rgb,...(Array.isArray(old)&&old.length>3?[old[3]]:[])],vector=(old,scale=null)=>rgb.map(c=>c/255*(scale??Math.max(...old.slice(0,3).map(Math.abs))));
 const colorKeys=new Set(['m_ConstantColor','m_ColorMin','m_ColorMax','m_ColorFade','m_Color','m_LiteralColor']),vectorKeys=new Set(['m_vecOutput','m_vecOutputMin','m_vecOutputMax','m_vOutputMin','m_vOutputMax','m_vecMin','m_vecMax']);
 function visit(node){if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;
  const field=node.m_nFieldOutput??node.m_nOutputField,isColor=[6,22].includes(field)||typeof field==='string'&&/TINT_RGB|GLOW_RGB/.test(field)||field==null&&['C_INIT_InitVec','C_OP_SetVec'].includes(node._class);
  for(const [key,value]of Object.entries(node)){
   if(colorKeys.has(key)&&Array.isArray(value)&&value.length>=3)node[key]=bytes(value);
   else if(isColor&&vectorKeys.has(key)&&Array.isArray(value)&&value.length>=3)node[key]=vector(value);
   else if(isColor&&key==='m_InputValue')node[key]={m_nType:'PVEC_TYPE_LITERAL_COLOR',m_LiteralColor:[...rgb]};
   else if(key!=='m_Children')visit(value);
  }
  if(node._class==='C_INIT_RandomColor'){node.m_ColorMin=bytes(node.m_ColorMin??[0,0,0,255]);node.m_ColorMax=bytes(node.m_ColorMax??[0,0,0,255]);}
  if(isColor&&node.m_nCPInput===15){node.m_vOutputMin=vector(rgb,1);node.m_vOutputMax=vector(rgb,1);node.m_nSetMethod='PARTICLE_SET_REPLACE_VALUE';node.m_flOpStrength={m_nType:'PF_TYPE_LITERAL',m_flLiteralValue:1};}
  if(/^C_OP_Render/.test(node._class??'')&&Object.hasOwn(node,'m_flAddSelfAmount'))node.m_flAddSelfAmount=0;
 }
 visit(root);root.m_ConstantColor=[...rgb,255];
 for(const renderer of root.m_Renderers??[])if(['C_OP_RenderSprites','C_OP_RenderTrails','C_OP_RenderRopes'].includes(renderer._class))renderer.m_bStudioRecolor=true;
 return root;
}
