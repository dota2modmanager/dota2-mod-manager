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
