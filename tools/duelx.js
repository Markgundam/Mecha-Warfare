// paired seeded duels: each war is played twice from the same seed, once with the switch on for one side and once off
// node tools/duelx.js . <aix,keys> [wars] [doctrine]   (prints win rates with the switches on vs off, matchup by matchup)
const path=require('path'); const MW=require(path.resolve(process.argv[2],'engine.js'));
const K=process.argv[3].split(','), N=+process.argv[4]||120, only=process.argv[5];
const docs=Object.keys(MW.DOCTRINES), maps=MW.MAP_IDS;
function mul(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
const res={};
function play(g,seat,on,me,foe,map){
  for(const k of K) MW.AIX[k]=on?[seat]:false;
  MW.setRng(mul(g*7919+13));
  const d=seat?[foe,me]:[me,foe];
  MW.newGame({map,players:[{name:'Azure',doctrine:d[0],isAI:true,learn:false},{name:'Ember',doctrine:d[1],isAI:true,learn:false}]});
  let n=0; while(MW.S.phase!=='over'&&n++<30000) MW.aiStep();
  return MW.S.winner===seat?1:0;
}
for(let g=0;g<N;g++){
  const seat=g%2, me=only||docs[Math.floor(g/2)%3], foe=docs[Math.floor(g/6)%3], map=maps[Math.floor(g/18)%maps.length];
  const a=play(g,seat,true,me,foe,map), b=play(g,seat,false,me,foe,map);
  const r=res[me+' v '+foe]=res[me+' v '+foe]||{g:0,a:0,b:0}; r.g++; r.a+=a; r.b+=b;
}
let G=0,A=0,B=0; for(const k in res){const r=res[k];G+=r.g;A+=r.a;B+=r.b;console.log(k.padEnd(28),'on',(100*r.a/r.g).toFixed(0)+'%','off',(100*r.b/r.g).toFixed(0)+'%',' n',r.g);}
console.log('ALL on',(100*A/G).toFixed(1)+'% off',(100*B/G).toFixed(1)+'%',G);
