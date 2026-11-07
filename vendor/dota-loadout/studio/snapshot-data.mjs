export function normalizeSnapshot(data){
 const rows=data.skinning??data.skin;
 const skinning=Array.isArray(rows)?rows.map(row=>Array.isArray(row)?row:(row?.joints??[]).map((name,i)=>[name,row.weights?.[i]??0])):undefined;
 return {...data,...(skinning?{skinning,skin:skinning}:{})};
}
