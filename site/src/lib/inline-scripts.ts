/**
 * Scripts that have to run while the page is still being read, before the first paint, and so
 * are written into the page rather than bundled.
 *
 * Astro puts the hashes of the scripts it bundles into the content security policy, and not the
 * hashes of these. astro.config.mjs adds them, worked out from this same text, so a change here
 * carries its own permission with it. (The rainbow's one line in the head needs none: it comes
 * before the policy's <meta>, and a policy set that way covers only what follows it.)
 *
 * Each is one line, joined from the parts below, so nothing that tidies whitespace in the page can
 * change the text the hash was taken from.
 */

/**
 * The offer of this page in the other language (Base.astro, #langbar). An English page offers
 * Russian to a browser that prefers Russian to English; a Russian page offers English to a
 * browser with no Russian at all. Any choice is kept in localStorage ("mm-lang"): the offer's
 * link, its close button, or any language switch on the site, which all carry hreflang. Once
 * there is a choice, nothing is offered again.
 */
export const LANG_OFFER = [
  '(function(){',
  "var b=document.getElementById('langbar');if(!b)return;",
  "var k='mm-lang',me=document.documentElement.lang;",
  'try{if(localStorage.getItem(k))return}catch(e){return}',
  'var keep=function(v){try{localStorage.setItem(k,v)}catch(e){}};',
  "document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[hreflang]');if(a)keep(a.getAttribute('hreflang'))});",
  "var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||''],first=null,ru=false;",
  "for(var i=0;i<ls.length;i++){var l=String(ls[i]).toLowerCase().slice(0,2);if(l==='ru')ru=true;if(!first&&(l==='ru'||l==='en'))first=l}",
  "if(me==='en'?first!=='ru':ru)return;",
  'b.hidden=false;',
  "b.querySelector('[data-lang-stay]').addEventListener('click',function(){keep(me);b.hidden=true})",
  '})();',
].join('');

/**
 * The night from the beginning, once per round (the app does the same: src/pumpkin.ts
 * NIGHT_ROUND). Whatever the hunt and the lost page left behind goes: the reward the page wears,
 * Axe caught, the key shown, the mask in the footer. Ahead of EARLY_LOOK, so the page that
 * forgets is not first painted in the colours it is forgetting.
 */
export const NIGHT_ROUND = '1';
export const NIGHT_AGAIN = [
  `try{if(localStorage.getItem('mm-night')!=='${NIGHT_ROUND}'){`,
  "['mm-rainbow','mm-bled','mm-key','mm-heart'].forEach(function(k){localStorage.removeItem(k)});",
  `localStorage.setItem('mm-night','${NIGHT_ROUND}')}}catch(e){}`,
].join('');

/**
 * The hunt's reward, put on before the first paint so the page does not flash its plain colours
 * first (Hunt.astro sets mm-rainbow when it is earned). Which look it wears is scripts/look.ts
 * lookNow written small: `mm-look` if it names one, else the event of the day, else the rainbow.
 * It goes in the head ahead of the policy's <meta>, so it needs no hash; test/look.test.mjs runs
 * it against look.ts on every day of a year.
 */
export const EARLY_LOOK = [
  "try{if(localStorage.getItem('mm-rainbow')==='1'){",
  "var a=localStorage.getItem('mm-look'),d=new Date(),n=(d.getMonth()+1)*100+d.getDate();",
  "var l=a==='rainbow'||a==='halloween'?a:n>=1015&&n<=1110?'halloween':'rainbow';",
  'document.documentElement.classList.add(l)}}catch(e){}',
].join('');
