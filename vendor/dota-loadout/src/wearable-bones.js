/** Names in a hero skeleton are permanent; names supplied by extra wearable rigs
 * only live while the owning item is equipped. Multiple worn pieces may expose
 * the same auxiliary name, so detach restores the previous live owner. */
export function wearableBoneOwners(bones, inverses, heroNames) {
  const owners = new Map();
  const attach = w => {
    const token = w.localBones;
    if (!token) return;
    for (const part of token) for (const key of part.keys) {
      if (heroNames.has(key)) continue;
      const stack = owners.get(key) || [];
      if (!stack.some(o => o.token === token && o.bone === part.bone))
        stack.push({token, bone:part.bone, inverse:part.inverse});
      owners.set(key,stack);
      const top=stack[stack.length-1];bones[key]=top.bone;inverses[key]=top.inverse;
    }
  };
  const detach = w => {
    const token = w.localBones;
    if (!token) return;
    for (const part of token) for (const key of part.keys) {
      const stack = (owners.get(key)||[]).filter(o=>o.token!==token);
      if (stack.length) {owners.set(key,stack);const top=stack[stack.length-1];bones[key]=top.bone;inverses[key]=top.inverse;}
      else {owners.delete(key);if(!heroNames.has(key)){delete bones[key];delete inverses[key];}}
    }
  };
  return {attach,detach};
}
