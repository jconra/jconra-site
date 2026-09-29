export const qualities=['Chipped','Flawed','Normal','Flawless','Perfect'];
export const chances=[[100,0,0,0,0],[70,30,0,0,0],[60,30,10,0,0],[50,30,20,0,0],[40,30,20,10,0],[30,30,30,10,0],[20,30,30,20,0],[10,30,30,30,0],[0,30,30,30,10]];
export const costs=[20,50,80,110,140,170,200,230];
const gem=(color,damage,cooldown,range,effect)=>({color,damage,cooldown,range,effect});
export const gems={
Ruby:gem('#e77b75',[[8,9],[13,16],[20,25],[28,45],[80,104]],[1000,1000,1000,1000,1000],[114,114,114,114,129],'Splash damage · burns with a crimson burst'),
Topaz:gem('#eace6f',[[4,4],[8,8],[14,14],[25,25],[75,75]],[800,1000,1000,800,1000],[72,72,72,72,86],'Attacks up to 3 enemies at once'),
Aquamarine:gem('#7cd5ce',[[6,8],[12,15],[24,30],[48,55],[110,132]],[350,350,350,350,227],[50,52,54,61,79],'Rapid crystal bolts'),
Sapphire:gem('#82aee9',[[5,8],[10,13],[18,23],[30,40],[60,75]],[1000,1000,1000,1000,750],[72,107,114,122,200],'Frost · slows enemy movement'),
Diamond:gem('#e1e9dc',[[8,12],[16,18],[30,37],[58,65],[140,150]],[800,1000,1000,1000,1000],[72,79,86,93,107],'Ground only · 25% chance for 2× critical damage'),
Amethyst:gem('#c99de2',[[9,13],[20,27],[30,40],[60,75],[140,150]],[800,750,1000,1000,1000],[143,161,179,186,215],'Air only · strikes flying enemies'),
Opal:gem('#a1cabb',[[5,5],[10,10],[20,20],[40,40],[85,85]],[800,1000,1000,750,650],[86,100,114,129,143],'Aura · increases nearby gem attack speed by 10–35%'),
Emerald:gem('#8bcf8e',[[4,7],[10,13],[15,25],[30,38],[80,90]],[800,1000,1000,750,750],[72,79,86,100,114],'Poison · damage over time and movement slow')};
const special=(recipe,damage,cooldown,range,color,effect)=>({recipe,damage,cooldown,range,color,effect});
export const specials={
'Black Opal':special([['Opal',4],['Diamond',3],['Aquamarine',2]],[24,24],1000,114,'#767caf','Aura · +30% damage to nearby gems'),
'Blood Stone':special([['Ruby',4],['Aquamarine',3],['Amethyst',2]],[67,67],500,100,'#e14d63','Burn · 135 DPS with 57-radius splash'),
'Dark Emerald':special([['Emerald',4],['Sapphire',3],['Topaz',1]],[89,150],800,79,'#35ab73','12.5% chance to stun for 1 second'),
Gold:special([['Amethyst',4],['Amethyst',3],['Diamond',1]],[159,190],1000,114,'#ffe08b','25% chance for 2× critical damage'),
Jade:special([['Emerald',2],['Opal',2],['Sapphire',1]],[29,35],500,114,'#95e5bc','Poison · 5 DPS · slows 50% for 2s · extra gold at level 3'),
Malachite:special([['Opal',0],['Emerald',0],['Aquamarine',0]],[5,6],350,107,'#a8e99b','Prismatic volley · attacks 3 enemies at once'),
'Pink Diamond':special([['Diamond',4],['Topaz',2],['Diamond',2]],[149,175],750,114,'#f5a5d0','Ground only · 10% chance for 5× damage'),
'Red Crystal':special([['Ruby',2],['Emerald',3],['Amethyst',1]],[49,75],800,186,'#fc727e','Air only · aura reduces air armor by 5 / 6 / 7'),
Silver:special([['Topaz',0],['Diamond',0],['Sapphire',0]],[19,21],1000,79,'#dce5f5','Splash frost · slows by 20% in a 36 radius'),
'Star Ruby':special([['Ruby',1],['Ruby',0],['Amethyst',0]],[10,11],250,38,'#ff947e','Burn aura · 40 damage per second'),
'Uranium 238':special([['Topaz',4],['Sapphire',2],['Opal',1]],[64,65],250,86,'#d4f77b','Radiation aura · 260 DPS · 50% slow within 64 range'),
'Yellow Sapphire':special([['Sapphire',4],['Topaz',3],['Ruby',3]],[99,100],1000,114,'#ffe8a0','Splash frost · 20% slow within 57 radius'),
'Paraiba Tourmaline':special([['Aquamarine',4],['Opal',3],['Emerald',1],['Aquamarine',1]],[25,105],750,122,'#73f6e0','Ground armor aura −4 · 33% chance for 100-damage frost nova')};
export function stats(t){let d=specials[t.type]||gems[t.type];let special=!!specials[t.type],level=t.level||0;return {color:d.color,damage:special?d.damage.map(v=>v*(1+level*.4)):d.damage[t.q],cooldown:special?(t.type==='Jade'&&level>=2?350:d.cooldown):d.cooldown[t.q],range:special?d.range:d.range[t.q],effect:d.effect};}
export function recipeFor(type,towers,anchor){let used=[];for(let [name,q] of specials[type].recipe){let t=towers.find(t=>t.type===name&&t.q===q&&!used.includes(t));if(!t)return null;used.push(t);}return !anchor||used.includes(anchor)?used:null;}
export function rollQuality(level,random=Math.random()){let sum=0;return chances[level].findIndex(n=>(sum+=n)>random*100);}
export const COLS=19,ROWS=17;
export const pads=[[3,12],[3,6],[14,6],[14,12],[9,12],[9,3]];
export const start=[0,8],end=[18,3];
export const key=(c,r)=>`${c},${r}`;
export function neighbors(c,r){return [[c-1,r],[c+1,r],[c,r-1],[c,r+1],[c+(r%2?1:-1),r-1],[c+(r%2?1:-1),r+1]].filter(([x,y])=>x>=0&&x<COLS&&y>=0&&y<ROWS);}
export function findPath(from,to,blocked){let queue=[from],seen=new Map([[key(...from),null]]);for(let i=0;i<queue.length;i++){let p=queue[i];if(key(...p)===key(...to)){let out=[];let k=key(...p);while(k){out.unshift(k.split(',').map(Number));k=seen.get(k);}return out;}for(let n of neighbors(...p)){let k=key(...n);if(!seen.has(k)&&!blocked.has(k)){seen.set(k,key(...p));queue.push(n);}}}return null;}
export function fullRoute(blocked){let points=[start,...pads,end],route=[];for(let i=1;i<points.length;i++){let p=findPath(points[i-1],points[i],blocked);if(!p)return null;route.push(...p.slice(i===1?0:1));}return route;}
